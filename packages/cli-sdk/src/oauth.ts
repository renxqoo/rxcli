/** Public OAuth façade. Protocol implementation lives in OAuthClient. */
import { createHash, randomBytes } from "node:crypto";
import type { ConfigStore } from "./credentials/types.js";
import type { RequestOptions } from "./types.js";
import { OAuthClient } from "./oauth-client.js";
import { OAuthFlowCoordinator } from "./auth/flow-coordinator.js";
import type {
  AuthStyle,
  ClientMetadata,
  OAuthClientConfig,
  PollResult,
} from "./oauth-contracts.js";

export type {
  AuthStyle,
  ClientMetadata,
  DeviceAuthInfo,
  OAuthClientConfig,
  PollResult,
  RegisteredClient,
  TokenInfo,
  UserInfo,
} from "./oauth-contracts.js";
export { OAuthClient, type OAuthFetch } from "./oauth-client.js";

export function injectAuthHeader(request: RequestOptions, token: string, style: AuthStyle): void {
  const headers = request.headers ?? {};
  headers[style === "x-api-key" ? "x-api-key" : "authorization"] =
    style === "bearer" ? `Bearer ${token}` : style === "basic" ? `Basic ${token}` : token;
  request.headers = headers;
}

export async function fetchScopesFromMetadata(config: OAuthClientConfig): Promise<string[]> {
  return new OAuthClient(config).scopes();
}

export async function deviceAuthorization(config: OAuthClientConfig, scope?: string) {
  return new OAuthClient(config).authorizeDevice(scope);
}

export async function pollDeviceToken(
  config: OAuthClientConfig,
  deviceCode: string,
): Promise<PollResult> {
  return new OAuthClient(config).pollDevice(deviceCode);
}

export async function refreshAccessToken(config: OAuthClientConfig, refreshToken: string) {
  return new OAuthClient(config).refresh(refreshToken);
}

export async function getUserInfo(config: OAuthClientConfig, accessToken: string) {
  return new OAuthClient(config).userInfo(accessToken);
}

export async function revokeToken(config: OAuthClientConfig, accessToken: string): Promise<void> {
  return new OAuthClient(config).revoke(accessToken);
}

export async function registerClient(
  baseUrl: string,
  registrationToken: string,
  metadata?: ClientMetadata,
) {
  return new OAuthClient({ baseUrl, clientId: "", clientSecret: "" }).register(
    registrationToken,
    metadata,
  );
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function computeCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(
  config: OAuthClientConfig,
  params: { redirectUri: string; scope?: string; codeChallenge: string; state?: string },
): string {
  const url = new URL(`${config.baseUrl}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (params.scope) url.searchParams.set("scope", params.scope);
  if (params.state) url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeCodeForToken(
  config: OAuthClientConfig,
  params: { code: string; codeVerifier: string; redirectUri: string },
) {
  return new OAuthClient(config).exchangeCode(params);
}

export async function clientCredentialsToken(config: OAuthClientConfig, scope?: string) {
  return new OAuthClient(config).clientCredentials(scope);
}

export function createOn401Hook(options: {
  cfg: OAuthClientConfig;
  store: ConfigStore;
  namespace: string;
}): () => Promise<string | null> {
  return new OAuthFlowCoordinator({
    store: options.store,
    namespace: options.namespace,
    refresh: (refreshToken) => new OAuthClient(options.cfg).refresh(refreshToken),
  }).refreshStoredSession;
}
