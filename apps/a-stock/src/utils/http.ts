/**
 * HTTP 工具 —— 简单包装 fetch(去 context.ts 直接用,绕开 ctx.get 因为:
 *   1. 这些是公网数据源,不需要 baseUrl 相对路径
 *   2. 各数据源对 UA / Referer / 编码要求不同,需统一管理
 *   3. 数据源失败可单独抛错,与 cli-sdk 错误体系分离)
 *
 * 设计:
 *   - 真实超时(AbortSignal.timeout)
 *   - 重试(指数退避,默认 2 次)
 *   - 通用 User-Agent
 *   - JSON / GBK 自动识别(腾讯/东财接口部分返回 GBK)
 */

import { NetworkError, APIError } from "@renxqoo/agent-data-cli";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface HttpOptions {
  method?: "GET" | "POST";
  /** query(自动拼到 url) */
  query?: Record<string, string | number | boolean | undefined>;
  /** 请求头 */
  headers?: Record<string, string>;
  /** body(JSON.stringify 或原文) */
  body?: string | Record<string, unknown>;
  /** 超时(ms) */
  timeout?: number;
  /** 重试次数(默认 2) */
  retries?: number;
  /** 响应类型 */
  responseType?: "json" | "text" | "gbk";
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * HTTP 请求(带重试 + 超时)
 *
 * 失败策略:
 *   - 网络错误(timeout / fetch reject)→ 重试
 *   - 5xx / 429 → 重试
 *   - 4xx(非 429)→ 直接抛错
 */
export async function httpFetch<T = unknown>(
  url: string,
  opts: HttpOptions = {},
): Promise<HttpResponse<T>> {
  const {
    method = "GET",
    query,
    headers,
    body,
    timeout = 8000,
    retries = 2,
    responseType = "json",
  } = opts;

  const fullUrl = buildUrl(url, query);
  const reqHeaders: Record<string, string> = {
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: "*/*",
    ...headers,
  };

  let reqBody: string | undefined;
  if (body !== undefined) {
    if (typeof body === "string") {
      reqBody = body;
    } else {
      reqBody = JSON.stringify(body);
      reqHeaders["Content-Type"] = reqHeaders["Content-Type"] ?? "application/json";
    }
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(fullUrl, {
        method,
        headers: reqHeaders,
        body: reqBody,
        signal: AbortSignal.timeout(timeout),
      });

      // 4xx / 5xx
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          // 429 / 5xx → 重试
          lastErr = new APIError({
            subtype: res.status === 429 ? "rate_limited" : "server_error",
            code: res.status,
            message: `${res.status} ${res.statusText}`,
            retryable: true,
          });
          if (attempt < retries) {
            await sleep(backoff(attempt));
            continue;
          }
          throw lastErr;
        }
        // 4xx → 不重试
        throw new APIError({
          subtype: "bad_request",
          code: res.status,
          message: `${res.status} ${res.statusText} (${url})`,
          retryable: false,
        });
      }

      const respHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (respHeaders[k.toLowerCase()] = v));

      let data: unknown;
      if (responseType === "json") {
        const text = await res.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new APIError({
            subtype: "bad_response",
            message: `Non-JSON response: ${text.slice(0, 200)}`,
            retryable: false,
          });
        }
      } else if (responseType === "gbk") {
        const buf = await res.arrayBuffer();
        data = new TextDecoder("gbk").decode(buf);
      } else {
        data = await res.text();
      }

      return { status: res.status, data: data as T, headers: respHeaders };
    } catch (err) {
      if (err instanceof APIError) throw err; // 已分类的不重试
      lastErr = err;
      // 网络错误 / timeout → 重试
      const isNet =
        err instanceof Error && (err.name === "TimeoutError" || /fetch failed/i.test(err.message));
      if (isNet && attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new NetworkError({
        subtype:
          err instanceof Error && err.name === "TimeoutError" ? "timeout" : "connection_refused",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
  throw lastErr;
}

function backoff(attempt: number): number {
  // 200ms / 600ms / 1.4s
  return Math.min(200 * Math.pow(3, attempt), 3000);
}

function buildUrl(
  url: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const s = params.toString();
  if (!s) return url;
  return url.includes("?") ? `${url}&${s}` : `${url}?${s}`;
}

/** GET 简写 */
export async function httpGet<T = unknown>(
  url: string,
  opts: Omit<HttpOptions, "method" | "body"> = {},
): Promise<HttpResponse<T>> {
  return httpFetch<T>(url, { ...opts, method: "GET" });
}

/** POST 简写(JSON body) */
export async function httpPost<T = unknown>(
  url: string,
  body: unknown,
  opts: Omit<HttpOptions, "method"> = {},
): Promise<HttpResponse<T>> {
  return httpFetch<T>(url, { ...opts, method: "POST", body: body as Record<string, unknown> });
}
