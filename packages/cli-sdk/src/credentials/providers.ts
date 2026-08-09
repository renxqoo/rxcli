/**
 * @renxqoo/agent-data-cli/credentials —— provider chain + 默认 4 个 provider
 *
 * 设计依据:docs/05-credentials.md "provider chain"。
 * chain 按 priority 从小到大逐个调用,命中即停(返回非 null)。
 * 默认 4 个 provider:flag(1)/env(5)/file(10)/oauth(20)。
 */

import type { CredentialProvider, ProviderContext, TokenResult, IdentityHint } from "./types.js";

// ============================================================================
// 默认 provider:defaultProviders() 返回 4 个,供业务包自写的 auth Plugin 用
// ============================================================================

/**
 * flagProvider(priority 1):从命令行 --api-key <key> 全局 flag 取。
 * 临时覆盖(单次命令),最高优先级。
 */
export function flagProvider(): CredentialProvider {
  return {
    name: () => "flag",
    priority: () => 1,
    async resolveToken(pctx: ProviderContext): Promise<TokenResult | null> {
      const key = pctx.args.apiKey;
      if (typeof key !== "string" || !key) return null;
      return {
        token: key,
        type: "api-key",
        source: "flag:--api-key",
      };
    },
  };
}

/**
 * envProvider(priority 5):从 $<NS>_API_KEY 环境变量取(NS = 命名空间大写)。
 * CI/容器场景。
 */
export function envProvider(): CredentialProvider {
  return {
    name: () => "env",
    priority: () => 5,
    async resolveToken(pctx: ProviderContext): Promise<TokenResult | null> {
      const envName = `${pctx.namespace.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      const key = pctx.env[envName];
      if (typeof key !== "string" || !key) return null;
      return {
        token: key,
        type: "api-key",
        source: `env:${envName}`,
      };
    },
  };
}

/**
 * fileProvider(priority 10):从 <namespace>.json 的 apiKey 字段取。
 * 持久化默认主路径。
 */
export function fileProvider(): CredentialProvider {
  return {
    name: () => "file",
    priority: () => 10,
    async resolveToken(pctx: ProviderContext): Promise<TokenResult | null> {
      const creds = await pctx.configStore.loadCredentials(pctx.namespace);
      if (!creds) return null;
      // API key 形态
      const apiKey = creds.apiKey;
      if (typeof apiKey === "string" && apiKey) {
        return {
          token: apiKey,
          type: "api-key",
          ...(Array.isArray(creds.scopes) ? { scopes: creds.scopes as string[] } : {}),
          source: `file:${pctx.namespace}.json#apiKey`,
        };
      }
      // 也支持直接 token 字段(bearer 场景但非 OAuth 流程)
      const token = creds.token;
      // OAuth 凭证(有 refreshToken 或 authMethod 是 OAuth 流程)交给 oauthProvider，
      // 避免在这里提前命中后丢失 refresh/expires 元数据。
      const isOAuthFlow =
        !creds.authMethod ||
        creds.authMethod === "oauth" ||
        creds.authMethod === "device" ||
        creds.authMethod === "authorization_code" ||
        creds.authMethod === "client_credentials";
      if (!isOAuthFlow && typeof token === "string" && token) {
        return {
          token,
          type: "bearer",
          ...(Array.isArray(creds.scopes) ? { scopes: creds.scopes as string[] } : {}),
          source: `file:${pctx.namespace}.json#token`,
        };
      }
      return null;
    },
  };
}

/**
 * oauthProvider(priority 20):从 <namespace>.json 的 OAuth token(含 refresh)取。
 * OAuth 流程(rxcli 中间层)。token 过期时由 auth Plugin 的 _transportConfig.on401(createOn401Hook)触发 refresh。
 *
 * 注意:oauthProvider 只负责"取已有 token";refresh 逻辑在 oauth.ts 的 singleflight。
 */
export function oauthProvider(): CredentialProvider {
  return {
    name: () => "oauth",
    priority: () => 20,
    async resolveToken(pctx: ProviderContext): Promise<TokenResult | null> {
      const creds = await pctx.configStore.loadCredentials(pctx.namespace);
      if (!creds) return null;
      const token = creds.token;
      const refreshToken = creds.refreshToken;
      if (typeof token !== "string" || !token) return null;

      const scopes = Array.isArray(creds.scopes) ? (creds.scopes as string[]) : undefined;
      const expiresAt = typeof creds.expiresAt === "number" ? creds.expiresAt : undefined;
      const result: TokenResult = {
        token,
        type: "bearer",
        source: `oauth:${pctx.namespace}.json`,
        ...(scopes ? { scopes } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(typeof refreshToken === "string" && refreshToken ? { refreshToken } : {}),
      };
      return result;
    },
    async resolveIdentity(pctx: ProviderContext): Promise<IdentityHint | null> {
      const creds = await pctx.configStore.loadCredentials(pctx.namespace);
      if (!creds || !creds.user || typeof creds.user !== "object") return null;
      const u = creds.user as { userId?: string; name?: string };
      return {
        identity: "user",
        ...(u.userId ? { userId: u.userId } : {}),
        ...(u.name ? { name: u.name } : {}),
      };
    },
  };
}

/** 默认 4 个 provider,按 priority 升序。 */
export function defaultProviders(): CredentialProvider[] {
  return [flagProvider(), envProvider(), fileProvider(), oauthProvider()];
}

// ============================================================================
// chain:按 priority 逐个尝试,命中即停
// ============================================================================

/**
 * 跑 provider chain:按 priority 升序逐个调用,第一个返回非 null 的即用。
 * 全都没命中返回 null。
 */
export async function resolveWithChain(
  providers: CredentialProvider[],
  pctx: ProviderContext,
): Promise<{ token: TokenResult; provider: CredentialProvider } | null> {
  // 按 priority 升序排序(未声明 priority 默认 10)
  const sorted = [...providers].sort((a, b) => (a.priority?.() ?? 10) - (b.priority?.() ?? 10));
  for (const provider of sorted) {
    const token = await provider.resolveToken(pctx);
    if (token) {
      return { token, provider };
    }
  }
  return null;
}

/** 用 chain 结果尝试推断 identity(调第一个能返回的 resolveIdentity)。 */
export async function resolveIdentityWithChain(
  providers: CredentialProvider[],
  pctx: ProviderContext,
): Promise<IdentityHint | null> {
  const sorted = [...providers].sort((a, b) => (a.priority?.() ?? 10) - (b.priority?.() ?? 10));
  for (const provider of sorted) {
    if (!provider.resolveIdentity) continue;
    const hint = await provider.resolveIdentity(pctx);
    if (hint) return hint;
  }
  return null;
}
