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

import type { Plugin, CommandGroup, CommandContext } from "../types.js";
import {
  type ClientMetadata,
  type OAuthClientConfig,
  type PollResult,
  type AuthStyle,
} from "../oauth.js";
import { deviceFlow } from "../flows/device.js";
import { authCodeFlow } from "../flows/authCode.js";
import { clientCredentialsFlow } from "../flows/clientCredentials.js";
import type { AuthFlow, FlowType, FlowDeps } from "../flows/types.js";
import { createLoginCommand } from "./commands/login.js";
import { createStatusCommand } from "./commands/status.js";
import { createLogoutCommand } from "./commands/logout.js";
import { createRegisterCommand } from "./commands/register.js";
import type { ConfigStore } from "../credentials/index.js";
import type { CredentialProvider } from "../credentials/types.js";
import { credentialArgsKey } from "../context.js";
import { resolveAuthConfig, buildProviderChain, buildOn401Handler } from "./helpers.js";
import { AuthSessionManager } from "./session-manager.js";

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
   * 不传 = 空；未注册客户端可先运行 register 命令写入配置。
   */
  clientId?: string;
  clientSecret?: string;
  /** token 注入方式。默认 'bearer'。 */
  authStyle?: AuthStyle;
  /**
   * 凭证/配置存储。**必填** —— cli-sdk 是底层 SDK,不内置任何目录默认;
   * 由业务 app 决定落盘位置(如 fileStore({ dir: '~/.rxcli' }))。
   */
  store: ConfigStore;
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
): Promise<Plugin<State>> {
  // —— 基础配置 ——
  const cmdNs = opts.commandNamespace ?? "auth";
  const credNs = opts.credentialNamespace;
  const store = opts.store;

  // —— ① 解析 client 凭证(env → config.json → 空)——
  const { oauth, authStyle } = await resolveAuthConfig(opts, store);

  // —— ② 构造 provider chain ——
  const providers = buildProviderChain(opts);

  // —— ③ 选 flow + 构造 on401 handler ——
  const flowType = opts.flow ?? "device";
  const flow = resolveFlow(flowType);
  // C2: build the type-discriminated FlowDeps variant matching the selected flow.
  const flowDeps: FlowDeps = buildFlowDeps(flowType, {
    cfg: oauth,
    scope: opts.scope,
    poller: opts.poller,
    callbackPort: opts.redirectPort,
  });
  // handler 只创建一次，内部 singleflight map 才能覆盖并发 401。
  const refresh = buildOn401Handler({
    flow,
    oauth,
    store,
    namespace: credNs,
    flowDeps,
  });
  const sessions = new AuthSessionManager({
    namespace: credNs,
    commandNamespace: cmdNs,
    store,
    providers,
    authStyle,
    refresh,
  });

  // —— 构造 auth 命令组 ——
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

  // —— 返回 plugin ——
  return {
    name: `auth:${credNs}`,
    enforce: "pre",
    provides: { namespaces: { [cmdNs]: commands } },

    async beforeCommand(ctx: CommandContext<State>): Promise<void> {
      const credentialArgs = (
        ctx as CommandContext<State> & { [credentialArgsKey]?: Record<string, unknown> }
      )[credentialArgsKey];
      await sessions.authenticate(ctx, credentialArgs);
    },

    async beforeRequest(ctx: CommandContext<State>, request) {
      return sessions.prepare(ctx, request);
    },

    async handleUnauthorized(ctx: CommandContext<State>) {
      return sessions.handleUnauthorized(ctx);
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

interface FlowDepsInputs {
  cfg: OAuthClientConfig;
  scope?: string;
  poller?: DefineAuthOptions["poller"];
  callbackPort?: number;
}

/** Construct the discriminated FlowDeps variant for the given flow type. */
function buildFlowDeps(type: FlowType, input: FlowDepsInputs): FlowDeps {
  switch (type) {
    case "device":
      return { type: "device", cfg: input.cfg, scope: input.scope, poller: input.poller };
    case "authorization_code":
      return {
        type: "authorization_code",
        cfg: input.cfg,
        scope: input.scope,
        callbackPort: input.callbackPort,
      };
    case "client_credentials":
      return { type: "client_credentials", cfg: input.cfg, scope: input.scope };
  }
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
