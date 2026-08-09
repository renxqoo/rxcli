/**
 * @renxqoo/agent-data-cli —— OAuth device flow + 401 singleflight refresh
 *
 * 设计依据:docs/05-credentials.md "provider chain"。
 * 实现:deviceAuthorization/pollDeviceToken/refreshAccessToken/getUserInfo/revoke/registerClient。
 *
 * 关键修正 v1 坑:v1 的 singleflight 续期拿到新 token 后**没有写回 credentials.json**,
 * 导致连续多次 CLI 调用反复刷新、甚至触发 refresh_token 重用检测。
 * v2 在续期成功后**落盘**(调 ConfigStore.saveCredentials)。
 */

import type { ConfigStore, StoredOAuthCredentials } from "./credentials/types.js";
import type { RequestOptions } from "./types.js";
import { APIError, AuthenticationError, InternalError, NetworkError } from "./errs/index.js";

// ============================================================================
// header 注入工具(供开发者写 auth Plugin 用)
// ============================================================================

export type AuthStyle = "bearer" | "x-api-key" | "basic";

/**
 * 按 authStyle 把 token 注入请求 header(供开发者写 auth Plugin 的 beforeRequest 用)。
 *
 * ```ts
 * async beforeRequest(ctx, req) {
 *   injectAuthHeader(req, token, 'bearer')
 * }
 * ```
 */
export function injectAuthHeader(req: RequestOptions, token: string, style: AuthStyle): void {
  const headers = req.headers ?? {};
  switch (style) {
    case "bearer":
      headers.authorization = `Bearer ${token}`;
      break;
    case "x-api-key":
      headers["x-api-key"] = token;
      break;
    case "basic":
      headers.authorization = `Basic ${token}`;
      break;
  }
  req.headers = headers;
}

// ============================================================================
// OAuth 端点类型(字段保持 snake_case 对齐 wire)
// ============================================================================

export interface DeviceAuthInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface TokenInfo {
  access_token: string;
  /** refresh grant 的响应可以不轮换 refresh_token。 */
  refresh_token?: string;
  expires_in: number;
  /** 未返回表示沿用原 scope。 */
  scope?: string;
}

export interface UserInfo {
  open_id: string;
  name: string;
}

/** client 配置(device flow 需要的 baseUrl/clientId/clientSecret)。 */
export interface OAuthClientConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export type PollResult =
  | { status: "ok"; token: TokenInfo }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "error"; message: string };

// ============================================================================
// OAuth 端点函数(纯 fetch)
// ============================================================================

function basicAuth(cfg: OAuthClientConfig): string {
  return "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
}

async function oauthFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const timeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new NetworkError({
      subtype: timeout ? "timeout" : "connection_refused",
      message: timeout
        ? "OAuth request timed out (30000ms)"
        : `OAuth network error: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
      cause: err,
    });
  }
}

/**
 * 安全解析响应 JSON(M8)。
 * 非 JSON 响应(网关 HTML 错误页 / 空响应)→ 抛 InternalError(decode_failure),
 * 而非裸 SyntaxError(否则被 pipeline 兜底成语义不准的 internal/unknown)。
 * 空响应体返回 undefined(调用方按 !res.ok 分支处理)。
 */
async function safeJson(res: Response): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new NetworkError({
      subtype: "connection_refused",
      message: `Failed to read OAuth response: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
      cause: err,
    });
  }
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new InternalError({
      subtype: "decode_failure",
      message:
        "OAuth response is not valid JSON (the gateway may have returned an HTML error page)",
      cause: text.slice(0, 200),
    });
  }
}

function responseObject(body: unknown, endpoint: string): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InternalError({
      subtype: "contract_violation",
      message: `${endpoint} response has invalid structure: expected object`,
      cause: body,
    });
  }
  return body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, endpoint: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value) {
    throw new InternalError({
      subtype: "contract_violation",
      message: `${endpoint} response is missing string field ${key}`,
      cause: body,
    });
  }
  return value;
}

function requiredNumber(body: Record<string, unknown>, key: string, endpoint: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InternalError({
      subtype: "contract_violation",
      message: `${endpoint} response is missing number field ${key}`,
      cause: body,
    });
  }
  return value;
}

function parseTokenInfo(body: unknown, endpoint: string): TokenInfo {
  const obj = responseObject(body, endpoint);
  const token: TokenInfo = {
    access_token: requiredString(obj, "access_token", endpoint),
    expires_in: requiredNumber(obj, "expires_in", endpoint),
  };
  if (typeof obj.refresh_token === "string" && obj.refresh_token)
    token.refresh_token = obj.refresh_token;
  if (typeof obj.scope === "string") token.scope = obj.scope;
  return token;
}

/**
 * 从 metadata 端点动态获取 scopes_supported(RFC 8414)。
 *
 * CLI 不在代码里写死 scope,而是运行时从服务端读,这样服务端加减 scope 不用发 CLI 新版。
 * 失败时返回空数组(降级,不阻断登录——服务端会用默认 scope)。
 */
export async function fetchScopesFromMetadata(cfg: OAuthClientConfig): Promise<string[]> {
  try {
    const res = await oauthFetch(`${cfg.baseUrl}/.well-known/oauth-authorization-server`);
    const body = await safeJson(res);
    if (!res.ok) return [];
    const obj = responseObject(body, "metadata");
    const scopes = obj.scopes_supported;
    if (!Array.isArray(scopes)) return [];
    return scopes.filter((s: unknown): s is string => typeof s === "string");
  } catch {
    return []; // 网络错误/解析错误:降级
  }
}

/**
 * 申请设备码。
 * @param scope OAuth scope;空/未传 = 不带 scope(有些鉴权不需要 scope)。
 */
export async function deviceAuthorization(
  cfg: OAuthClientConfig,
  scope?: string,
): Promise<DeviceAuthInfo> {
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  const res = await oauthFetch(`${cfg.baseUrl}/device_authorization`, {
    method: "POST",
    headers: {
      authorization: basicAuth(cfg),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const body = await safeJson(res);
  if (!res.ok)
    throw new APIError({
      subtype: "server_error",
      code: res.status,
      message: "device_authorization failed",
      cause: body,
    });
  const obj = responseObject(body, "device_authorization");
  return {
    device_code: requiredString(obj, "device_code", "device_authorization"),
    user_code: requiredString(obj, "user_code", "device_authorization"),
    verification_uri: requiredString(obj, "verification_uri", "device_authorization"),
    ...(typeof obj.verification_uri_complete === "string"
      ? { verification_uri_complete: obj.verification_uri_complete }
      : {}),
    expires_in: requiredNumber(obj, "expires_in", "device_authorization"),
    interval: requiredNumber(obj, "interval", "device_authorization"),
  };
}

/**
 * 轮询 device token。返回:
 * - { status: 'ok', token }     成功
 * - { status: 'pending' }       用户还没登录,继续等
 * - { status: 'slow_down' }     太快了,加长间隔
 * - { status: 'error', message } 不可恢复
 */
export async function pollDeviceToken(
  cfg: OAuthClientConfig,
  deviceCode: string,
): Promise<PollResult> {
  const res = await oauthFetch(`${cfg.baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  });
  const rawBody = await safeJson(res);
  const body =
    rawBody && typeof rawBody === "object"
      ? (rawBody as { error?: string; error_description?: string })
      : {};
  if (res.ok) {
    return { status: "ok", token: parseTokenInfo(rawBody, "device token") };
  }
  switch (body.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "expired_token":
    case "access_denied":
    case "invalid_grant":
      return { status: "error", message: body.error_description ?? body.error };
    default:
      return { status: "error", message: body.error_description ?? `poll failed (${res.status})` };
  }
}

/** 用 refresh_token 续期(401 自动刷新时用)。 */
export async function refreshAccessToken(
  cfg: OAuthClientConfig,
  refreshToken: string,
): Promise<TokenInfo> {
  const res = await oauthFetch(`${cfg.baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  });
  const body = await safeJson(res);
  if (!res.ok) {
    throw new AuthenticationError({
      subtype: "token_expired",
      message: "Refresh token is invalid, please log in again",
      hint: "run `rxcli auth login` to log in again",
      cause: body,
    });
  }
  return parseTokenInfo(body, "refresh token");
}

/** 查当前用户。 */
export async function getUserInfo(cfg: OAuthClientConfig, accessToken: string): Promise<UserInfo> {
  const res = await oauthFetch(`${cfg.baseUrl}/user_info`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = await safeJson(res);
  if (res.status === 401) {
    throw new AuthenticationError({
      subtype: "token_expired",
      code: 401,
      message: "Authentication expired",
      cause: body,
    });
  }
  if (!res.ok)
    throw new APIError({
      subtype: "server_error",
      code: res.status,
      message: "user_info failed",
      cause: body,
    });
  const obj = responseObject(body, "user_info");
  return {
    open_id: requiredString(obj, "open_id", "user_info"),
    name: requiredString(obj, "name", "user_info"),
  };
}

/** 吊销 token(logout 用)。响应固定 200,不关心是否真实吊销。 */
export async function revokeToken(cfg: OAuthClientConfig, accessToken: string): Promise<void> {
  const res = await oauthFetch(`${cfg.baseUrl}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: accessToken,
      token_type_hint: "access_token",
    }).toString(),
  });
  if (!res.ok) {
    throw new APIError({
      subtype: "server_error",
      code: res.status,
      message: "revoke failed",
    });
  }
}

/**
 * RFC 7591 client_metadata(注册时声明,authorization_code / scope 校验用)。
 * 传给服务端;服务端回显 + 持久化。
 */
export interface ClientMetadata {
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
}

/**
 * 注册返回(RFC 7591 §3.2,snake_case)。
 */
export interface RegisteredClient {
  clientId: string;
  clientSecret: string;
  clientIdIssuedAt: number;
  clientSecretExpiresAt: number; // 0 = 永不过期
  clientMetadata: ClientMetadata;
}

/**
 * 动态注册(RFC 7591):用注册令牌 + client_metadata 换独立 client 凭据。
 * 响应是 snake_case(client_id / client_secret / client_id_issued_at / ...)。
 */
export async function registerClient(
  baseUrl: string,
  registrationToken: string,
  clientMetadata?: ClientMetadata,
): Promise<RegisteredClient> {
  const res = await oauthFetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ registrationToken, ...clientMetadata }),
  });
  const body = await safeJson(res);
  if (!res.ok) {
    throw new APIError({
      subtype: "server_error",
      code: res.status,
      message: (body as { error_description?: string })?.error_description ?? "register failed",
      cause: body,
    });
  }
  const obj = responseObject(body, "register");
  // RFC 7591 §3.2:snake_case 字段
  const clientId = requiredString(obj, "client_id", "register");
  const clientSecret = requiredString(obj, "client_secret", "register");
  const clientIdIssuedAt =
    typeof obj.client_id_issued_at === "number"
      ? obj.client_id_issued_at
      : Math.floor(Date.now() / 1000);
  const clientSecretExpiresAt =
    typeof obj.client_secret_expires_at === "number" ? obj.client_secret_expires_at : 0;
  // 回显的 metadata(服务端返回的)
  const echoed: ClientMetadata = {
    ...(typeof obj.client_name === "string" ? { client_name: obj.client_name } : {}),
    ...(Array.isArray(obj.redirect_uris) ? { redirect_uris: obj.redirect_uris } : {}),
    ...(Array.isArray(obj.grant_types) ? { grant_types: obj.grant_types } : {}),
    ...(Array.isArray(obj.response_types) ? { response_types: obj.response_types } : {}),
    ...(typeof obj.scope === "string" ? { scope: obj.scope } : {}),
    ...(typeof obj.token_endpoint_auth_method === "string"
      ? { token_endpoint_auth_method: obj.token_endpoint_auth_method }
      : {}),
  };
  return {
    clientId,
    clientSecret,
    clientIdIssuedAt,
    clientSecretExpiresAt,
    clientMetadata: echoed,
  };
}

// ============================================================================
// PKCE(RFC 7636)+ authorization_code(RFC 6749 §4.1)+ client_credentials(§4.4)
// ============================================================================

import { randomBytes, createHash } from "node:crypto";

/**
 * 生成 PKCE code_verifier(RFC 7636 §4.1)。
 * 32 字节随机 → base64url(43 字符,满足 43-128 范围)。
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 计算 PKCE code_challenge(RFC 7636 §4.2,S256 方法)。
 * base64url(SHA256(code_verifier))。
 */
export function computeCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * 构建 /authorize 端点 URL(RFC 6749 §4.1.1 + PKCE)。
 * 纯 URL 拼接,不发请求。OAuth 2.1 强制 code_challenge_method=S256。
 */
export function buildAuthorizeUrl(
  cfg: OAuthClientConfig,
  params: {
    redirectUri: string;
    scope?: string;
    codeChallenge: string;
    state?: string;
  },
): string {
  const u = new URL(`${cfg.baseUrl}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("code_challenge", params.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (params.scope) u.searchParams.set("scope", params.scope);
  if (params.state) u.searchParams.set("state", params.state);
  return u.toString();
}

/**
 * 用 authorization_code + PKCE code_verifier 换 token(RFC 6749 §4.1.3)。
 * 公开 client 用 PKCE 替代 client_secret 做认证。
 */
export async function exchangeCodeForToken(
  cfg: OAuthClientConfig,
  params: { code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenInfo> {
  const res = await oauthFetch(`${cfg.baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
      client_id: cfg.clientId,
      ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
    }).toString(),
  });
  const body = await safeJson(res);
  if (!res.ok) {
    throw new APIError({
      subtype: "server_error",
      code: res.status,
      message: "authorization_code exchange failed",
      cause: body,
    });
  }
  return parseTokenInfo(body, "authorization_code token");
}

/**
 * 用 client_credentials 换 token(RFC 6749 §4.4)。
 * 机器对机器:无用户参与,用 client_id + client_secret 认证。
 * 通常不发 refresh_token(到期重新换)。
 */
export async function clientCredentialsToken(
  cfg: OAuthClientConfig,
  scope?: string,
): Promise<TokenInfo> {
  const form = new URLSearchParams({ grant_type: "client_credentials" });
  if (scope) form.set("scope", scope);
  const res = await oauthFetch(`${cfg.baseUrl}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuth(cfg),
    },
    body: form.toString(),
  });
  const body = await safeJson(res);
  if (!res.ok) {
    throw new APIError({
      subtype: "server_error",
      code: res.status,
      message: "client_credentials token failed",
      cause: body,
    });
  }
  return parseTokenInfo(body, "client_credentials token");
}

// ============================================================================
// 401 singleflight refresh(移植 + 落盘修正)
// ============================================================================

/**
 * 创建 401 refresh hook(供 request.ts 的 on401 注入)。
 *
 * singleflight:同一 refreshToken 的并发 401 复用同一次 refresh,
 * 避免多请求各自用旧 refresh 触发"重用"误报。
 *
 * 修正 v1 坑:续期成功后落盘(调 store.saveCredentials),避免连续 CLI 调用反复刷新。
 *
 * @returns 返回新 token 字符串(供请求层重试);无 refreshToken / refresh 失败返回 null
 */
export function createOn401Hook(opts: {
  cfg: OAuthClientConfig;
  store: ConfigStore;
  namespace: string;
}): () => Promise<string | null> {
  // 进程内:refreshToken → 刷新并完成落盘的 Promise(singleflight)
  const refreshInflight = new Map<string, Promise<string | null>>();

  return async function on401(): Promise<string | null> {
    // 读当前凭证拿 refreshToken
    const creds = (await opts.store.loadCredentials(
      opts.namespace,
    )) as Partial<StoredOAuthCredentials> | null;
    const refreshToken = creds?.refreshToken;
    if (!refreshToken) return null;

    // singleflight 覆盖 refresh + save 的完整临界区。
    let p = refreshInflight.get(refreshToken);
    if (!p) {
      p = (async () => {
        try {
          const newToken = await refreshAccessToken(opts.cfg, refreshToken);
          const updated: StoredOAuthCredentials = {
            token: newToken.access_token,
            refreshToken: newToken.refresh_token ?? refreshToken,
            expiresAt: Date.now() + newToken.expires_in * 1000,
            scopes: newToken.scope
              ? newToken.scope.split(/\s+/).filter(Boolean)
              : (creds?.scopes ?? []),
            storedAt: Date.now(),
            authMethod: "oauth",
            ...(creds?.user ? { user: creds.user } : {}),
          };
          await opts.store.saveCredentials(
            opts.namespace,
            updated as unknown as Record<string, unknown>,
          );
          return newToken.access_token;
        } catch {
          return null;
        }
      })().finally(() => refreshInflight.delete(refreshToken));
      refreshInflight.set(refreshToken, p);
    }
    return p;
  };
}
