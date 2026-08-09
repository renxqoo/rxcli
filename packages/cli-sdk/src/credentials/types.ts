/**
 * @renxqoo/agent-data-cli/credentials —— 凭证与 provider chain 类型
 *
 * 设计依据:docs/05-credentials.md。
 * 两层 API 对照(方法名故意不同,避免混用):
 *   - 业务运行时:ctx.credentials.get/save/clear(走 provider chain;由业务包自写的 auth Plugin 填充)
 *   - provider 实现:configStore.loadCredentials/saveCredentials/...(直读文件)
 */

// ============================================================================
// 凭证存储(ConfigStore:provider 实现者用,直读磁盘)
// ============================================================================

/**
 * 配置/凭证存储抽象。由 fileStore / memoryStore 实现;业务包自写的 auth Plugin 持有一个实例。
 * provider 内部用它直读写磁盘(不走 provider chain);命令运行时用 ctx.credentials(走 chain)。
 */
export interface ConfigStore {
  /** 读命名空间的凭证文件;null = 文件不存在。 */
  loadCredentials(namespace: string): Promise<Record<string, unknown> | null>;
  /** 写命名空间的凭证文件(权限 0600)。 */
  saveCredentials(namespace: string, data: Record<string, unknown>): Promise<void>;
  /** 清命名空间的凭证。 */
  clearCredentials(namespace: string): Promise<void>;
  /** 读全局 config.json。 */
  loadConfig(): Promise<Record<string, unknown>>;
  /** 写全局 config.json。 */
  saveConfig(data: Record<string, unknown>): Promise<void>;
}

// ============================================================================
// Token 结果(provider 返回)
// ============================================================================

export interface TokenResult {
  token: string;
  type: "api-key" | "bearer" | "basic" | "custom";
  scopes?: string[];
  /** 来源描述(如 'env:ORDERS_API_KEY')。 */
  source: string;
  /** 过期时间戳(ms)。 */
  expiresAt?: number;
  /** OAuth 的刷新 token。 */
  refreshToken?: string;
}

export interface IdentityHint {
  /** user / bot。 */
  identity: "user" | "bot";
  userId?: string;
  name?: string;
}

// ============================================================================
// Provider 接口 + chain 上下文
// ============================================================================

export interface ProviderContext {
  /** 命名空间。 */
  namespace: string;
  /** cli-sdk 的配置存储(provider 内部直接读写文件,不走 chain)。 */
  configStore: ConfigStore;
  /** 命令参数(读 --api-key 等)。 */
  args: Record<string, unknown>;
  /** 环境变量。 */
  env: NodeJS.ProcessEnv;
}

/**
 * 凭证 provider:从某处取 token(flag/env/file/oauth)。
 * chain 按 priority 从小到大逐个调用,命中即停(返回非 null)。
 */
export interface CredentialProvider {
  /** provider 名(日志/溯源)。 */
  name(): string;
  /** 优先级,小值先试,默认 10。 */
  priority?(): number;
  /** null = 没有,chain 继续;非 null = 命中,用它的 token。 */
  resolveToken(pctx: ProviderContext): Promise<TokenResult | null>;
  /** 可选:推断 identity(user/bot)填统一输出格式顶层。 */
  resolveIdentity?(pctx: ProviderContext): Promise<IdentityHint | null>;
}

// ============================================================================
// 凭证文件结构(OAuth 场景)
// ============================================================================

/** OAuth 场景存盘的凭证形态(对齐 v1 StoredCredentials,字段转 camelCase)。 */
export interface StoredOAuthCredentials {
  token: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  user?: { userId: string; name: string };
  storedAt: number;
  authMethod: string; // "device" | "authorization_code" | "client_credentials"(开放,向后兼容 "oauth")
}
