/**
 * @renxqoo/agent-data-cli —— defineAuth:OAuth 鉴权工厂
 *
 * 把"OAuth device flow 鉴权"从业务包收编成框架层的一个工厂。返回一个 Plugin,
 * 同时通过 plugin.provides 自动贡献命令(login/status/logout/register),
 * defineCli 自动注入,业务零配置:
 *
 * ```ts
 * const auth = await defineAuth({
 *   credentialNamespace: 'crm',       // → credentials/crm.json
 *   baseUrl: AUTH_BASE_URL,            // OAuth 中间层
 *   scope: 'company.api offline_access', // 业务自定,无默认
 * })
 * defineCli({ plugins: [auth], ... })  // 钩子 + auth 命令全自动
 * ```
 *
 * 设计依据:apps/crm/src/auth.ts + commands/auth.ts + commands/register.ts(原 412 行)收编。
 * 精确豁免:auth plugin 贡献的命令(login/status/logout/register)自动跳过自身 beforeCommand,
 * 故 login 不会被"必须登录"拦截(internal 脚枪消除)。
 */

import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type {
  Plugin,
  CommandGroup,
  CommandContext,
  CommandResult,
  CredentialsApi,
} from "../types.js";
import { defineCommand } from "../define.js";
import { errs, AuthenticationError } from "../errs/index.js";
import {
  injectAuthHeader,
  deviceAuthorization,
  pollDeviceToken,
  getUserInfo,
  revokeToken,
  registerClient,
  createOn401Hook,
  refreshAccessToken,
  type AuthStyle,
  type OAuthClientConfig,
  type PollResult,
  type TokenInfo,
  type ClientMetadata,
  fetchScopesFromMetadata,
} from "../oauth.js";
import { deviceFlow, SplitFlowSignal } from "../flows/device.js";
import { authCodeFlow } from "../flows/authCode.js";
import { clientCredentialsFlow } from "../flows/clientCredentials.js";
import type { AuthFlow, FlowType, FlowDeps } from "../flows/types.js";
import { createLoginCommand } from "./commands/login.js";
import { createStatusCommand } from "./commands/status.js";
import { createLogoutCommand } from "./commands/logout.js";
import { createRegisterCommand } from "./commands/register.js";
import {
  fileStore,
  defaultProviders,
  resolveWithChain,
  resolveIdentityWithChain,
  type ConfigStore,
  type ProviderContext,
  type IdentityHint,
} from "../credentials/index.js";
import type { StoredOAuthCredentials, CredentialProvider } from "../credentials/types.js";
import { credentialArgsKey } from "../context.js";

// ============================================================================
// 工厂入参/出参类型
// ============================================================================

export interface DefineAuthOptions {
  /** 凭证隔离命名空间(决定 credentials/<ns>.json)。 */
  credentialNamespace: string;
  /** OAuth/auth 中间层地址(device flow / token / user_info / revoke / register 端点)。 */
  baseUrl: string;
  /**
   * OAuth scope。**业务自定,无默认值**。
   * 空/未传 = 不带 scope(有些鉴权不需要,如纯 token 交换)。
   */
  scope?: string;
  /** 命令命名空间(→ rxcli <ns> login)。默认 'auth'。 */
  commandNamespace?: string;
  /**
   * clientId/clientSecret:优先 env(RXCLI_CLIENT_ID/SECRET),回退 config.json(register 写入)。
   * 不传 = 空(向后兼容未注册态)。
   */
  clientId?: string;
  clientSecret?: string;
  /** token 注入方式。默认 'bearer'。 */
  authStyle?: AuthStyle;
  /** store 注入(测试用)。默认 fileStore({dir: ~/.rxcli})。 */
  store?: ConfigStore;
  /**
   * 测试用:注入轮询函数(pollAndPersist 用)。生产不传。
   * 让 M3 RFC 8628 轮询测试能 mock pollDeviceToken。
   */
  poller?: (oauth: OAuthClientConfig, deviceCode: string) => Promise<PollResult>;

  /**
   * 鉴权流程。默认 "device"。
   * - "device":设备授权流程(RFC 8628,CLI/无头设备)
   * - "authorization_code":授权码 + PKCE(RFC 6749 §4.1 + RFC 7636,Web/App)
   * - "client_credentials":客户端凭证(RFC 6749 §4.4,机器对机器)
   */
  flow?: FlowType;

  /**
   * RFC 7591 client_metadata(注册时声明)。
   * client_name 是各 app 自声明(如 "crm"、"webapp")。
   */
  clientMetadata?: ClientMetadata;

  /** authorization_code flow:本地回调端口(不传=随机)。 */
  redirectPort?: number;

  /**
   * 预注入的 Bearer token(sandbox/CI 场景,admin issue-token 返回的 JWT)。
   * 设了就直接用(priority=0,最高优先),跳过 provider chain + login。
   * 最简注入:defineAuth({ bearerToken: process.env.CRM_BEARER_TOKEN })
   */
  bearerToken?: string;

  /**
   * 自定义 provider chain。不传 = defaultProviders()。
   * 业务 app 可自定义 token 来源(如环境变量、文件、secret manager)。
   */
  providers?: CredentialProvider[];

  /**
   * 动态 scope:从服务端 metadata 端点(.well-known/oauth-authorization-server)
   * 读 scopes_supported,用全集请求。CLI 不写死 scope,服务端加减 scope 不用发新版。
   * 设了 true 就忽略 scope 参数(运行时动态获取)。
   */
  scopeFromMetadata?: boolean;
}

// ============================================================================
// defineAuth 工厂
// ============================================================================

/**
 * 创建 OAuth 鉴权 plugin(钩子 + 命令一捆)。
 *
 * @returns Plugin,塞进 defineCli 的 plugins[] 即:钩子生效 + auth 命令自动挂载。
 *          业务无需在 namespaces 里手挂 auth。
 */
export async function defineAuth<State = Record<string, never>>(
  opts: DefineAuthOptions,
): Promise<Plugin<State> & { _transportConfig?: { on401?: () => Promise<string | null> } }> {
  const cmdNs = opts.commandNamespace ?? "auth";
  const credNs = opts.credentialNamespace;
  const store = opts.store ?? fileStore({ dir: join(homedir(), ".rxcli") });
  const authStyle = opts.authStyle ?? "bearer";

  // env→config.json 回填 clientId/clientSecret(原 createAuthConfig 的 S3 逻辑)
  let clientId = opts.clientId ?? process.env.RXCLI_CLIENT_ID ?? "";
  let clientSecret = opts.clientSecret ?? process.env.RXCLI_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    try {
      const config = (await store.loadConfig()) as { clientId?: string; clientSecret?: string };
      if (!clientId && config.clientId) clientId = config.clientId;
      if (!clientSecret && config.clientSecret) clientSecret = config.clientSecret;
    } catch {
      /* config.json 读失败:保持空,向后兼容 */
    }
  }
  const oauth: OAuthClientConfig = { baseUrl: opts.baseUrl, clientId, clientSecret };
  // 构建 provider chain:bearerToken(注入)→ 自定义 providers → 默认 chain
  const providers: CredentialProvider[] = [];
  if (opts.bearerToken) {
    providers.push({
      name: () => "injected-bearer",
      priority: () => 2, // 低于 --api-key(1),高于 env(5),允许命令行覆盖
      async resolveToken() {
        return {
          token: opts.bearerToken!,
          type: "bearer" as const,
          source: "injected:bearerToken",
        };
      },
    });
  }
  providers.push(...(opts.providers ?? defaultProviders()));
  const flowType = opts.flow ?? "device";
  const flow = resolveFlow(flowType);

  // 401 续期:flow 有自定义 refresh(如 client_credentials)用它,否则用默认 refresh_token
  const defaultRefresh = createOn401Hook({ cfg: oauth, store, namespace: credNs });
  const flowDeps: FlowDeps = {
    cfg: oauth,
    scope: opts.scope,
    poller: opts.poller,
    callbackPort: opts.redirectPort,
  };
  let currentToken: string | undefined;
  const on401 = async () => {
    let refreshed: string | null | undefined;
    if (flow.refresh) {
      // client_credentials 等:没有 refresh_token,重新 login
      try {
        const token = await flow.refresh(flowDeps);
        refreshed = token.access_token;
        if (refreshed) {
          await store.saveCredentials(credNs, {
            token: token.access_token,
            refreshToken: token.refresh_token ?? "",
            expiresAt: Date.now() + token.expires_in * 1000,
            scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
            storedAt: Date.now(),
            authMethod: flowType,
          } as unknown as Record<string, unknown>);
        }
      } catch {
        refreshed = null;
      }
    } else {
      refreshed = await defaultRefresh();
    }
    if (refreshed) currentToken = refreshed;
    return refreshed;
  };

  // —— 构造 auth 命令组(login/status/logout/register)——
  const commands = createAuthCommands({
    oauth,
    store,
    credentialNamespace: credNs,
    commandNamespace: cmdNs,
    scope: opts.scope,
    baseUrl: opts.baseUrl,
    flow,
    clientMetadata: opts.clientMetadata,
    redirectPort: opts.redirectPort,
    poller: opts.poller,
    scopeFromMetadata: opts.scopeFromMetadata,
  });

  // —— 返回 plugin:钩子(beforeCommand 注入 token / beforeRequest 注入 header)+ 命令 ——
  return {
    name: `auth:${credNs}`,
    enforce: "pre",
    _transportConfig: { on401 },
    provides: { namespaces: { [cmdNs]: commands } },

    async beforeCommand(ctx: CommandContext<State>): Promise<void> {
      const credentialArgs = (
        ctx as CommandContext<State> & { [credentialArgsKey]?: Record<string, unknown> }
      )[credentialArgsKey];
      const pctx: ProviderContext = {
        namespace: credNs,
        configStore: store,
        args: { apiKey: credentialArgs?.apiKey },
        env: process.env,
      };

      const resolved = await resolveWithChain(providers, pctx);
      if (!resolved) {
        throw new AuthenticationError({
          subtype: "no_credentials",
          message: `${credNs} is not logged in`,
          hint: `run \`${cmdNs} login\` to log in`,
        });
      }

      // 填 ctx.credentials(store 包装)
      (ctx as { credentials: CredentialsApi }).credentials = {
        get: async (ns: string) => {
          const c = await store.loadCredentials(ns);
          if (!c) return null;
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(c)) {
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
              out[k] = String(v);
          }
          return out;
        },
        save: (ns: string, data: Record<string, unknown>) => store.saveCredentials(ns, data),
        clear: (ns: string) => store.clearCredentials(ns),
      };

      // identity(统一输出格式顶层 user/bot 用);业务权限不本地预检,交服务端 403(对齐 v1)
      const identity: IdentityHint | null = await resolveIdentityWithChain(providers, pctx);
      (ctx as unknown as { _identity?: IdentityHint })._identity = identity ?? undefined;
      // 若业务 State 声明了 user 字段,填进去(统一输出格式顶层展示)
      (ctx.state as Record<string, unknown>).user = identity
        ? {
            ...(identity.userId ? { userId: identity.userId } : {}),
            ...(identity.name ? { name: identity.name } : {}),
          }
        : (ctx.state as Record<string, unknown>).user;
      (ctx as unknown as { _authToken?: string })._authToken = resolved.token.token;
      currentToken = resolved.token.token;
    },

    async beforeRequest(ctx: CommandContext<State>, req): Promise<void> {
      const token = currentToken ?? (ctx as unknown as { _authToken?: string })._authToken;
      if (token) injectAuthHeader(req, token, authStyle);
    },
  };
}

// ============================================================================
// auth 命令组构造(原 createAuthCommands + registerCommand)
// ============================================================================

interface AuthCommandOpts {
  oauth: OAuthClientConfig;
  store: ConfigStore;
  credentialNamespace: string;
  commandNamespace: string;
  scope?: string;
  baseUrl: string;
  /** 鉴权流程策略。 */
  flow: AuthFlow;
  /** RFC 7591 client_metadata(register 用)。 */
  clientMetadata?: ClientMetadata;
  /** authorization_code flow 回调端口。 */
  redirectPort?: number;
  /** 测试用:注入轮询函数。 */
  poller?: (oauth: OAuthClientConfig, deviceCode: string) => Promise<PollResult>;
  /** 动态 scope:从 metadata 读 scopes_supported。 */
  scopeFromMetadata?: boolean;
}

/**
 * 根据 flow 类型选策略(参数传入,非全局 registry)。
 */
function resolveFlow(type: FlowType): AuthFlow {
  switch (type) {
    case "device":
      return deviceFlow;
    case "authorization_code":
      return authCodeFlow;
    case "client_credentials":
      return clientCredentialsFlow;
  }
}

/**
 * 统一落盘:login 成功后,框架调用此函数。
 * 从 TokenInfo 构造 StoredOAuthCredentials + 查 user_info(有 token 才查)+ 写盘。
 */
async function persistCredentials(
  store: ConfigStore,
  namespace: string,
  oauth: OAuthClientConfig,
  token: TokenInfo,
  flowType: FlowType,
  log?: { info(...args: unknown[]): void },
): Promise<{ loggedIn: boolean; user?: { id: string; name: string } }> {
  const creds: StoredOAuthCredentials = {
    token: token.access_token,
    refreshToken: token.refresh_token ?? "",
    expiresAt: Date.now() + token.expires_in * 1000,
    scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
    storedAt: Date.now(),
    authMethod: flowType,
  };

  // client_credentials 没有 user;device/authCode 查 user_info
  if (flowType !== "client_credentials") {
    try {
      const user = await getUserInfo(oauth, token.access_token);
      creds.user = { userId: user.open_id, name: user.name };
      await store.saveCredentials(namespace, creds as unknown as Record<string, unknown>);
      log?.info(`\n✓ Login successful: ${user.name} (${user.open_id})`);
      return { loggedIn: true, user: { id: user.open_id, name: user.name } };
    } catch {
      await store.saveCredentials(namespace, creds as unknown as Record<string, unknown>);
      log?.info("\n✓ Login successful (could not fetch user info)");
      return { loggedIn: true };
    }
  }

  await store.saveCredentials(namespace, creds as unknown as Record<string, unknown>);
  log?.info("\n✓ Login successful (client credentials)");
  return { loggedIn: true };
}

function createAuthCommands(o: AuthCommandOpts): CommandGroup {
  const credNs = o.credentialNamespace;
  const cmdNs = o.commandNamespace;

  return {
    login: createLoginCommand({
      oauth: o.oauth,
      store: o.store,
      credentialNamespace: credNs,
      commandNamespace: cmdNs,
      scope: o.scope,
      flow: o.flow,
      redirectPort: o.redirectPort,
      poller: o.poller,
      scopeFromMetadata: o.scopeFromMetadata,
    }),
    status: createStatusCommand({
      oauth: o.oauth,
      store: o.store,
      credentialNamespace: credNs,
      commandNamespace: cmdNs,
    }),
    logout: createLogoutCommand({
      oauth: o.oauth,
      store: o.store,
      credentialNamespace: credNs,
    }),
    register: createRegisterCommand({
      baseUrl: o.baseUrl,
      store: o.store,
      commandNamespace: cmdNs,
      clientMetadata: o.clientMetadata,
    }),
  };
}
