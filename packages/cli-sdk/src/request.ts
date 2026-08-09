/**
 * @renxqoo/agent-data-cli —— 请求层(transport)
 *
 * 设计依据:docs/02-sdk-guide.md "ctx:请求与上下文"、docs/04-errors.md "何时 throw"。
 * 运行时中立:全局 fetch(Node 18+ / bun 原生)。
 *
 * 职责:
 *   - 拼 path/query/body → global fetch
 *   - errorOnStatus 匹配 status(404 / '5xx')→ 查 subtype 注册表 → 自动 throw 类型化错误
 *   - fetch reject(网络层)→ 包装 NetworkError(retryable)
 *   - 401 检测:on401 hook(阶段 2 接 oauth singleflight),无回调抛 AuthenticationError
 *
 * 请求方法(get/post/...)经过 plugin beforeRequest/afterRequest 包装(由 context.ts 调用本层)。
 */

import type { RequestOptions, TransportResponse, ErrorOnStatus } from "./types.js";
import {
  APIError,
  NetworkError,
  AuthenticationError,
  PermissionError,
  ValidationError,
  ConfigError,
  PolicyError,
  InternalError,
  ConfirmationRequiredError,
  categoryOfSubtype,
  type Category,
} from "./errs/index.js";

// ============================================================================
// errorOnStatus 匹配
// ============================================================================

/** 判断 status 是否匹配 errorOnStatus 的 key(支持 404 / '5xx' 形态)。 */
function statusMatches(status: number, key: number | `${number}xx`): boolean {
  if (typeof key === "number") return status === key;
  const m = /^(\d)xx$/.exec(key);
  if (!m) return false;
  return Math.floor(status / 100) === Number(m[1]);
}

/** 找到第一个匹配 status 的 subtype(注册序遍历)。 */
function matchErrorOnStatus(status: number, errorOnStatus?: ErrorOnStatus): string | undefined {
  if (!errorOnStatus) return undefined;
  for (const [key, subtype] of Object.entries(errorOnStatus)) {
    const numKey = /^(\d)xx$/.test(key) ? (key as `${number}xx`) : Number(key);
    if (statusMatches(status, numKey)) return subtype;
  }
  return undefined;
}

// ============================================================================
// 单次请求(无 401 重试;401 由 transport 包装)
// ============================================================================

interface RequestOptionsInternal extends RequestOptions {
  baseUrl?: string;
}

async function doFetch<T>(opts: RequestOptionsInternal): Promise<TransportResponse<T>> {
  // 绝对 URL(http(s)://)直连,不拼 baseUrl;相对路径才拼
  const base = /^https?:\/\//i.test(opts.path) ? "" : (opts.baseUrl ?? "");
  const url = appendQuery(base + opts.path, opts.query);
  const headers: Record<string, string> = { ...opts.headers };
  let body: string | undefined;
  if (opts.body !== undefined && opts.method !== "GET") {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      body,
      ...(opts.timeout !== undefined ? { signal: AbortSignal.timeout(opts.timeout) } : {}),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    const msg = err instanceof Error ? err.message : String(err);
    throw new NetworkError({
      subtype: isTimeout ? "timeout" : "connection_refused",
      message: isTimeout ? `Request timed out (${opts.timeout}ms)` : `Network error: ${msg}`,
      retryable: true,
      cause: err,
    });
  }

  // 解析 body
  let data: unknown;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text; // 非 JSON 响应原样返回字符串
    }
  } else {
    data = undefined;
  }

  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    respHeaders[k.toLowerCase()] = v;
  });

  return { status: res.status, data: data as T, headers: respHeaders };
}

/** 拼 query string(跳过 undefined/null 值)。 */
function appendQuery(path: string, query?: Record<string, unknown>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, String(item));
    } else {
      params.append(k, String(v));
    }
  }
  const s = params.toString();
  if (!s) return path;
  const hashIndex = path.indexOf("#");
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const separator = base.includes("?")
    ? base.endsWith("?") || base.endsWith("&")
      ? ""
      : "&"
    : "?";
  return `${base}${separator}${s}${hash}`;
}

function findHeaderKey(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === target);
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const existing = findHeaderKey(headers, name);
  if (existing) headers[existing] = value;
  else headers[name.toLowerCase()] = value;
}

function mergeHeaders(
  defaults?: Record<string, string>,
  request?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(defaults ?? {})) setHeader(merged, name, value);
  for (const [name, value] of Object.entries(request ?? {})) setHeader(merged, name, value);
  return merged;
}

function applyRefreshedToken(headers: Record<string, string>, token: string): void {
  const apiKey = findHeaderKey(headers, "x-api-key");
  if (apiKey) {
    headers[apiKey] = token;
    return;
  }
  const authorization = findHeaderKey(headers, "authorization");
  const current = authorization ? headers[authorization] : undefined;
  const scheme = current?.match(/^\s*(Basic|Bearer)\s/i)?.[1] ?? "Bearer";
  setHeader(headers, "authorization", `${scheme} ${token}`);
}

// ============================================================================
// Transport
// ============================================================================

/** 401 hook:由业务包自写的 auth Plugin 通过 _transportConfig.on401 注入(refresh + singleflight)。返回新 token 则重试。 */
export type On401Hook = () => Promise<string | null | undefined>;

export interface Transport {
  get<T = unknown>(path: string, query?: Record<string, unknown>): Promise<TransportResponse<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>;
  put<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>;
  delete<T = unknown>(path: string): Promise<TransportResponse<T>>;
  request<T = unknown>(opts: RequestOptions): Promise<TransportResponse<T>>;
}

export interface CreateTransportOptions {
  baseUrl?: string;
  errorOnStatus?: ErrorOnStatus;
  on401?: On401Hook;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  /** 401 刷新后的重试准备钩子；context 用它重跑所有 beforeRequest。 */
  beforeRetry?: (req: RequestOptions) => Promise<void>;
}

export function createTransport(opts: CreateTransportOptions = {}): Transport {
  async function request<T>(reqOpts: RequestOptions): Promise<TransportResponse<T>> {
    const merged: RequestOptionsInternal = {
      ...reqOpts,
      baseUrl: opts.baseUrl,
      headers: mergeHeaders(opts.defaultHeaders, reqOpts.headers),
      timeout: reqOpts.timeout ?? opts.timeout,
    };

    const first = await doFetch<T>(merged);

    // 401 处理:on401 hook 返回新 token → 重试一次;返回 null/undefined(refresh 失败)
    // → 抛 AuthenticationError(token_expired),不能透传 401 body 当成功数据(H4)。
    if (first.status === 401 && opts.on401) {
      const newToken = await opts.on401();
      if (newToken) {
        const retryOpts: RequestOptionsInternal = {
          ...merged,
          headers: { ...merged.headers },
        };
        applyRefreshedToken(retryOpts.headers!, newToken);
        await opts.beforeRetry?.(retryOpts);
        // 重试结果同样要走 errorOnStatus(否则重试仍是 401 时会被当成功数据返回)
        const retried = await doFetch<T>(retryOpts);
        if (retried.status === 401) {
          throw new AuthenticationError({
            subtype: "token_expired",
            code: 401,
            message: "Still rejected after refreshing credentials, please log in again",
            hint: "run `rxcli auth login` to log in again",
          });
        }
        return checkErrorOnStatus(retried);
      }
      // refresh 失败(无 refreshToken / refresh 失效):token 已失效,需重新登录
      throw new AuthenticationError({
        subtype: "token_expired",
        code: 401,
        message: "Authentication expired (token expired or refresh failed)",
        hint: "run `rxcli auth login` to log in again",
      });
    }

    if (first.status === 401) {
      const configured = matchErrorOnStatus(401, opts.errorOnStatus);
      if (configured) {
        throwBySubtype(configured, 401, extractErrorMessage(first.data) ?? "HTTP 401");
      }
      throw new AuthenticationError({
        subtype: "no_token",
        code: 401,
        message: extractErrorMessage(first.data) ?? "Request not authenticated",
        hint: "Please log in or provide valid credentials and retry",
      });
    }

    return checkErrorOnStatus(first);
  }

  /** errorOnStatus 自动 throw(仅匹配的 status 才 throw,其余原样返回给业务包判断)。 */
  function checkErrorOnStatus<T>(resp: TransportResponse<T>): TransportResponse<T> {
    if (opts.errorOnStatus && resp.status >= 400) {
      const subtype = matchErrorOnStatus(resp.status, opts.errorOnStatus);
      if (subtype) {
        throwBySubtype(
          subtype,
          resp.status,
          extractErrorMessage(resp.data) ?? `HTTP ${resp.status}`,
          resp.status === 429 ? extractRetryHint(resp.headers) : undefined,
        );
      }
    }
    return resp;
  }

  return {
    request,
    get: (path, query) => request({ method: "GET", path, query }),
    post: (path, body) => request({ method: "POST", path, body }),
    put: (path, body) => request({ method: "PUT", path, body }),
    patch: (path, body) => request({ method: "PATCH", path, body }),
    delete: (path) => request({ method: "DELETE", path }),
  };
}

// —— 辅助:从响应体提取错误消息 ——
function extractErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  return typeof obj.message === "string"
    ? obj.message
    : typeof obj.error === "string"
      ? obj.error
      : undefined;
}

// —— 辅助:429 Retry-After hint ——
function extractRetryHint(headers: Record<string, string>): string | undefined {
  const ra = headers["retry-after"];
  return ra ? `Retry-After: ${ra}s` : undefined;
}

/**
 * 按 subtype 隐含的 category throw 对应错误(errorOnStatus 用)。
 * subtype → category 由 SUBTYPE_REGISTRY 决定(见 errs/index.ts);
 * category → 构造器由本表覆盖全 9 类(H3:不再只处理 authorization/authentication/api 三类)。
 */
const CATEGORY_CONSTRUCTORS: Record<Category, typeof APIError> = {
  validation: ValidationError,
  authentication: AuthenticationError,
  authorization: PermissionError,
  config: ConfigError,
  network: NetworkError,
  api: APIError,
  policy: PolicyError,
  internal: InternalError,
  confirmation: ConfirmationRequiredError,
};

function throwBySubtype(subtype: string, status: number, message: string, hint?: string): never {
  const category: Category = categoryOfSubtype(subtype);
  const retryable = status === 429 || status >= 500;
  const common = { subtype, code: status, message, ...(hint ? { hint } : {}), retryable };
  const Ctor = CATEGORY_CONSTRUCTORS[category] ?? APIError;
  throw new Ctor(common);
}
