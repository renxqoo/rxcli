/**
 * defineAuth 辅助纯函数:配置解析、provider chain 构造、on401 handler 构造。
 * 从 defineAuth 主体提取,每个函数职责单一,独立可测。
 */
import { OAuthClient, type AuthStyle, type OAuthClientConfig } from "../oauth.js";
import { defaultProviders, type ConfigStore } from "../credentials/index.js";
import type { CredentialProvider } from "../credentials/types.js";
import type { AuthFlow, FlowDeps } from "../flows/types.js";
import { OAuthFlowCoordinator } from "./flow-coordinator.js";

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
    const config = (await store.loadConfig()) as { clientId?: string; clientSecret?: string };
    if (!clientId && config.clientId) clientId = config.clientId;
    if (!clientSecret && config.clientSecret) clientSecret = config.clientSecret;
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
      priority: () => 0,
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
// ③ buildOn401Handler:构造 401 续期 handler(两条路径统一 singleflight)
// ============================================================================

export function buildOn401Handler(input: BuildOn401Input): () => Promise<string | null> {
  const { flow, oauth, store, namespace, flowDeps } = input;
  const coordinator = new OAuthFlowCoordinator({
    store,
    namespace,
    strategy: flow.refresh
      ? {
          type: flow.type,
          acquire: () => flow.refresh!(flowDeps),
        }
      : {
          requiresRefreshToken: true,
          acquire: (refreshToken) => new OAuthClient(oauth).refresh(refreshToken!),
        },
  });
  return coordinator.refreshStoredSession;
}
