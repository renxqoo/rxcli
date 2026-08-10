/**
 * defineAuth 辅助纯函数:配置解析、provider chain 构造、on401 handler 构造。
 * 从 defineAuth 主体提取,每个函数职责单一,独立可测。
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { createOn401Hook, type AuthStyle, type OAuthClientConfig } from "../oauth.js";
import { defaultProviders, type ConfigStore } from "../credentials/index.js";
import type { CredentialProvider } from "../credentials/types.js";
import type { AuthFlow, FlowDeps } from "../flows/types.js";

// ============================================================================
// 类型
// ============================================================================

export interface AuthConfig {
  oauth: OAuthClientConfig;
  authStyle: AuthStyle;
}

export interface ResolveAuthConfigInput {
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  authStyle?: AuthStyle;
}

export interface BuildProviderChainInput {
  bearerToken?: string;
  providers?: CredentialProvider[];
}

export interface BuildOn401Input {
  flow: AuthFlow;
  oauth: OAuthClientConfig;
  store: ConfigStore;
  namespace: string;
  flowDeps: FlowDeps;
}

// ============================================================================
// ① resolveAuthConfig:解析 clientId/secret(env → config.json → 空)
// ============================================================================

export async function resolveAuthConfig(
  input: ResolveAuthConfigInput,
  store: ConfigStore,
): Promise<AuthConfig> {
  let clientId = input.clientId ?? process.env.RXCLI_CLIENT_ID ?? "";
  let clientSecret = input.clientSecret ?? process.env.RXCLI_CLIENT_SECRET ?? "";

  if (!clientId || !clientSecret) {
    try {
      const config = (await store.loadConfig()) as { clientId?: string; clientSecret?: string };
      if (!clientId && config.clientId) clientId = config.clientId;
      if (!clientSecret && config.clientSecret) clientSecret = config.clientSecret;
    } catch {
      /* config.json 读失败:保持空 */
    }
  }

  return {
    oauth: { baseUrl: input.baseUrl, clientId, clientSecret },
    authStyle: input.authStyle ?? "bearer",
  };
}

// ============================================================================
// ② buildProviderChain:构造 provider chain(bearerToken 注入 + 自定义/默认)
// ============================================================================

export function buildProviderChain(input: BuildProviderChainInput): CredentialProvider[] {
  const chain: CredentialProvider[] = [];

  if (input.bearerToken) {
    chain.push({
      name: () => "injected-bearer",
      priority: () => 2,
      async resolveToken() {
        return {
          token: input.bearerToken!,
          type: "bearer" as const,
          source: "injected:bearerToken",
        };
      },
    });
  }

  chain.push(...(input.providers ?? defaultProviders()));
  return chain;
}

// ============================================================================
// ③ buildOn401Handler:构造 401 续期 handler
// ============================================================================

export function buildOn401Handler(input: BuildOn401Input): () => Promise<string | null> {
  const { flow, oauth, store, namespace, flowDeps } = input;

  // flow 有自定义 refresh(如 client_credentials)→ 用它;否则用默认 refresh_token
  if (flow.refresh) {
    return async () => {
      try {
        const token = await flow.refresh!(flowDeps);
        const newToken = token.access_token;
        if (newToken) {
          await store.saveCredentials(namespace, {
            token: newToken,
            refreshToken: token.refresh_token ?? "",
            expiresAt: Date.now() + token.expires_in * 1000,
            scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
            storedAt: Date.now(),
            authMethod: flow.type,
          } as unknown as Record<string, unknown>);
        }
        return newToken ?? null;
      } catch {
        return null;
      }
    };
  }

  // 默认:refresh_token 续期(含 singleflight + 落盘)
  const defaultRefresh = createOn401Hook({ cfg: oauth, store, namespace });
  return defaultRefresh;
}
