/**
 * @renxqoo/agentdatacli —— defineAuth:OAuth 鉴权工厂
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

import { homedir } from 'node:os'
import { join } from 'node:path'
import * as readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import type {
  Plugin,
  CommandGroup,
  CommandContext,
  CommandResult,
  CredentialsApi,
} from '../types.js'
import { defineCommand } from '../define.js'
import { errs, AuthenticationError } from '../errs/index.js'
import {
  injectAuthHeader,
  deviceAuthorization,
  pollDeviceToken,
  refreshAccessToken,
  getUserInfo,
  revokeToken,
  registerClient,
  createOn401Hook,
  type AuthStyle,
  type OAuthClientConfig,
  type PollResult,
} from '../oauth.js'
import {
  fileStore,
  defaultProviders,
  resolveWithChain,
  resolveIdentityWithChain,
  type ConfigStore,
  type ProviderContext,
  type IdentityHint,
} from '../credentials/index.js'
import type { StoredOAuthCredentials } from '../credentials/types.js'

// ============================================================================
// 工厂入参/出参类型
// ============================================================================

export interface DefineAuthOptions {
  /** 凭证隔离命名空间(决定 credentials/<ns>.json)。 */
  credentialNamespace: string
  /** OAuth/auth 中间层地址(device flow / token / user_info / revoke / register 端点)。 */
  baseUrl: string
  /**
   * OAuth scope。**业务自定,无默认值**。
   * 空/未传 = 不带 scope(有些鉴权不需要,如纯 token 交换)。
   */
  scope?: string
  /** 命令命名空间(→ rxcli <ns> login)。默认 'auth'。 */
  commandNamespace?: string
  /**
   * clientId/clientSecret:优先 env(RXCLI_CLIENT_ID/SECRET),回退 config.json(register 写入)。
   * 不传 = 空(向后兼容未注册态)。
   */
  clientId?: string
  clientSecret?: string
  /** token 注入方式。默认 'bearer'。 */
  authStyle?: AuthStyle
  /** store 注入(测试用)。默认 fileStore({dir: ~/.rxcli})。 */
  store?: ConfigStore
  /**
   * 测试用:注入轮询函数(pollAndPersist 用)。生产不传。
   * 让 M3 RFC 8628 轮询测试能 mock pollDeviceToken。
   */
  poller?: (oauth: OAuthClientConfig, deviceCode: string) => Promise<PollResult>
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
  const cmdNs = opts.commandNamespace ?? 'auth'
  const credNs = opts.credentialNamespace
  const store = opts.store ?? fileStore({ dir: join(homedir(), '.rxcli') })
  const authStyle = opts.authStyle ?? 'bearer'

  // env→config.json 回填 clientId/clientSecret(原 createAuthConfig 的 S3 逻辑)
  let clientId = opts.clientId ?? process.env.RXCLI_CLIENT_ID ?? ''
  let clientSecret = opts.clientSecret ?? process.env.RXCLI_CLIENT_SECRET ?? ''
  if (!clientId || !clientSecret) {
    try {
      const config = (await store.loadConfig()) as { clientId?: string; clientSecret?: string }
      if (!clientId && config.clientId) clientId = config.clientId
      if (!clientSecret && config.clientSecret) clientSecret = config.clientSecret
    } catch {
      /* config.json 读失败:保持空,向后兼容 */
    }
  }
  const oauth: OAuthClientConfig = { baseUrl: opts.baseUrl, clientId, clientSecret }
  const providers = defaultProviders()
  const on401 = createOn401Hook({ cfg: oauth, store, namespace: credNs })

  // —— 构造 auth 命令组(login/status/logout/register)——
  const commands = createAuthCommands<State>({
    oauth,
    store,
    credentialNamespace: credNs,
    commandNamespace: cmdNs,
    scope: opts.scope,
    baseUrl: opts.baseUrl,
    poller: opts.poller,
  })

  // —— 返回 plugin:钩子(beforeCommand 注入 token / beforeRequest 注入 header)+ 命令 ——
  return {
    name: `auth:${credNs}`,
    enforce: 'pre',
    _transportConfig: { on401 },
    provides: { namespaces: { [cmdNs]: commands } },

    async beforeCommand(ctx: CommandContext<State>): Promise<void> {
      const pctx: ProviderContext = {
        namespace: credNs,
        configStore: store,
        args: {},
        env: process.env,
      }

      const resolved = await resolveWithChain(providers, pctx)
      if (!resolved) {
        throw new AuthenticationError({
          subtype: 'no_credentials',
          message: `${credNs} 未登录`,
          hint: `run \`${cmdNs} login\` 登录`,
        })
      }

      // 填 ctx.credentials(store 包装)
      ;(ctx as { credentials: CredentialsApi }).credentials = {
        get: async (ns: string) => {
          const c = await store.loadCredentials(ns)
          if (!c) return null
          const out: Record<string, string> = {}
          for (const [k, v] of Object.entries(c)) {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
          }
          return out
        },
        save: (ns: string, data: Record<string, unknown>) => store.saveCredentials(ns, data),
        clear: (ns: string) => store.clearCredentials(ns),
      }

      // identity(信封顶层 user/bot 用);业务权限不本地预检,交服务端 403(对齐 v1)
      const identity: IdentityHint | null = await resolveIdentityWithChain(providers, pctx)
      ;(ctx as unknown as { _identity?: IdentityHint })._identity = identity ?? undefined
      // 若业务 State 声明了 user 字段,填进去(信封顶层展示)
      ;(ctx.state as Record<string, unknown>).user = identity
        ? {
            ...(identity.userId ? { userId: identity.userId } : {}),
            ...(identity.name ? { name: identity.name } : {}),
          }
        : (ctx.state as Record<string, unknown>).user
      ;(ctx as unknown as { _authToken?: string })._authToken = resolved.token.token
    },

    async beforeRequest(ctx: CommandContext<State>, req): Promise<void> {
      const token = (ctx as unknown as { _authToken?: string })._authToken
      if (token) injectAuthHeader(req, token, authStyle)
    },
  }
}

// ============================================================================
// auth 命令组构造(原 createAuthCommands + registerCommand)
// ============================================================================

interface AuthCommandOpts {
  oauth: OAuthClientConfig
  store: ConfigStore
  credentialNamespace: string
  commandNamespace: string
  scope?: string
  baseUrl: string
  /** 测试用:注入轮询函数。 */
  poller?: (oauth: OAuthClientConfig, deviceCode: string) => Promise<PollResult>
}

function createAuthCommands<State>(o: AuthCommandOpts): CommandGroup {
  const { oauth, store, scope, baseUrl } = o
  const credNs = o.credentialNamespace
  const cmdNs = o.commandNamespace

  return {
    // —— 登录(device flow 三分支)——
    login: defineCommand<any, unknown>({
      name: 'login',
      description: '通过中间层登录(OAuth device flow)',
      // 不标 internal:靠 plugin 精确豁免(_ownedRoutes 自动跳自身 beforeCommand)
      args: {
        wait: { type: 'boolean', desc: '阻塞轮询(默认;--no-wait 立即返回)' },
        json: { type: 'boolean', desc: '输出 JSON(配合 --no-wait,agent split-flow)' },
        'device-code': { type: 'string', desc: '用已有 device_code 完成登录(split-flow 第二步)' },
      },
      async run(args, ctx): Promise<CommandResult> {
        // 分支二:split-flow 第二步 —— 用已有 device_code 轮询
        const deviceCode = args['device-code'] as string | undefined
        if (deviceCode) {
          return pollAndPersist(ctx, oauth, store, credNs, deviceCode, 15 * 60, 5000, o.poller)
        }

        // 申请设备码(scope 业务自定,空=不带)
        const info = await deviceAuthorization(oauth, scope)

        // 分支一:--no-wait → 立即返回 device_code + URL,不轮询
        const noWait = args.wait === false
        if (noWait) {
          const verificationUrl = info.verification_uri_complete ?? info.verification_uri
          if (args.json) {
            return {
              data: {
                device_code: info.device_code,
                user_code: info.user_code,
                verification_url: verificationUrl,
                verification_uri_complete: info.verification_uri_complete,
                verification_uri: info.verification_uri,
                expires_in: info.expires_in,
                interval: info.interval,
              },
            }
          }
          ctx.log.info(`\n请在浏览器中完成登录:\n  ${verificationUrl}\n  用户码:${info.user_code}\n\ndevice_code: ${info.device_code}\n(未轮询。完成授权后运行:${cmdNs} login --device-code ${info.device_code})`)
          return { data: { device_code: info.device_code, verification_url: verificationUrl } }
        }

        // 默认分支:阻塞轮询(人类用)
        const verificationUrl = info.verification_uri_complete ?? info.verification_uri
        ctx.log.info(`\n请在浏览器中完成登录:\n  ${verificationUrl}\n  用户码:${info.user_code}\n\n等待登录完成...`)
        // 用服务端返回的 interval 作为轮询间隔(RFC 8628)
        return pollAndPersist(ctx, oauth, store, credNs, info.device_code, info.expires_in, info.interval * 1000, o.poller)
      },
    }),

    // —— 状态 ——
    status: defineCommand<any, unknown>({
      name: 'status',
      description: '查看当前登录状态',
      async run(_args, ctx): Promise<CommandResult> {
        const creds = (await store.loadCredentials(credNs)) as Partial<StoredOAuthCredentials> | null
        if (!creds?.token) {
          ctx.log.info(`未登录。运行 \`${cmdNs} login\` 登录。`)
          return { data: { loggedIn: false } }
        }
        try {
          const user = await getUserInfo(oauth, creds.token)
          const expired = creds.expiresAt ? Date.now() >= creds.expiresAt : false
          ctx.log.info(`已登录:${user.name} (${user.open_id})\n中间层:${oauth.baseUrl}\ntoken ${expired ? '已过期(下次调用会自动刷新)' : '有效'}`)
          return { data: { loggedIn: true, user: { id: user.open_id, name: user.name }, expired } }
        } catch {
          ctx.log.info('登录态已失效。请重新登录。')
          throw new errs.AuthenticationError({ subtype: 'token_expired', message: '登录态已失效', hint: `run \`${cmdNs} login\` 重新登录` })
        }
      },
    }),

    // —— 登出 ——
    logout: defineCommand<any, unknown>({
      name: 'logout',
      description: '退出登录(吊销 session + 清本地凭证)',
      async run(_args, ctx): Promise<CommandResult> {
        const creds = (await store.loadCredentials(credNs)) as Partial<StoredOAuthCredentials> | null
        if (creds?.token) {
          try {
            await revokeToken(oauth, creds.token)
          } catch {
            /* 离线/服务不可用仍清本地 */
          }
        }
        await store.clearCredentials(credNs)
        ctx.log.info('已退出登录。')
        return { data: { loggedOut: true } }
      },
    }),

    // —— 注册:用注册令牌换独立 clientId/clientSecret ——
    register: defineCommand<any, unknown>({
      name: 'register',
      description: '注册本机的 CLI client(用注册令牌换取独立凭据)',
      args: {
        token: { type: 'string', desc: '注册令牌(不传则交互输入)' },
      },
      async run(args, ctx): Promise<CommandResult> {
        let token = args.token as string | undefined
        if (!token) {
          if (!stdin.isTTY) {
            throw new errs.ValidationError({
              subtype: 'missing_required',
              param: '--token',
              message: '非交互环境需要 --token',
              hint: `run \`${cmdNs} register --token <注册令牌>\``,
            })
          }
          const rl = readline.createInterface({ input: stdin, output: stdout })
          try {
            token = (await rl.question('请输入注册令牌: ')).trim()
          } finally {
            rl.close()
          }
        }
        if (!token) {
          throw new errs.ValidationError({ subtype: 'missing_required', param: '--token', message: '未输入令牌' })
        }

        const { clientId, clientSecret } = await registerClient(baseUrl, token)
        const config = (await store.loadConfig()) as Record<string, unknown>
        config.clientId = clientId
        config.clientSecret = clientSecret
        await store.saveConfig(config)

        ctx.log.info(`\n✓ 注册成功。clientId=${clientId}`)
        return { data: { registered: true, clientId } }
      },
    }),
  }
}

// ============================================================================
// 轮询 + 落盘(从 v1 pollAndPersist + persistLogin 移植)
// ============================================================================

/**
 * 轮询 device token 直到拿到/超时/失败,成功则查身份 + 落盘。
 *
 * RFC 8628:
 *   - 起始用服务端 device_authorization 返回的 interval(不再固定 3000ms)
 *   - 收到 slow_down 时,interval 增加 5 秒(§3.2)
 */
export async function pollAndPersist(
  ctx: CommandContext,
  oauth: OAuthClientConfig,
  store: ConfigStore,
  namespace: string,
  deviceCode: string,
  ttlSec: number,
  /** 起始轮询间隔(ms),来自服务端 interval。默认 5000(RFC 8628 推荐兜底)。 */
  intervalMs = 5000,
  /** 测试用:注入轮询函数。默认真实 pollDeviceToken。 */
  poller: (oauth: OAuthClientConfig, deviceCode: string) => Promise<PollResult> = pollDeviceToken,
): Promise<CommandResult> {
  let interval = intervalMs
  const deadline = Date.now() + ttlSec * 1000
  while (Date.now() < deadline) {
    await sleep(interval)
    const r = await poller(oauth, deviceCode)
    if (r.status === 'ok') {
      // 查身份 → 落盘
      const base: StoredOAuthCredentials = {
        token: r.token.access_token,
        refreshToken: r.token.refresh_token,
        expiresAt: Date.now() + r.token.expires_in * 1000,
        scopes: r.token.scope.split(/\s+/).filter(Boolean),
        storedAt: Date.now(),
        authMethod: 'oauth',
      }
      try {
        const user = await getUserInfo(oauth, r.token.access_token)
        base.user = { userId: user.open_id, name: user.name }
        await store.saveCredentials(namespace, base as unknown as Record<string, unknown>)
        ctx.log.info(`\n✓ 登录成功:${user.name} (${user.open_id})`)
        return { data: { loggedIn: true, user: { id: user.open_id, name: user.name } } }
      } catch {
        await store.saveCredentials(namespace, base as unknown as Record<string, unknown>)
        ctx.log.info('\n✓ 登录成功(未能获取用户信息)')
        return { data: { loggedIn: true } }
      }
    }
    if (r.status === 'slow_down') {
      // RFC 8628 §3.2 —— slow_down 时 interval 增加 5 秒
      interval += 5000
      continue
    }
    if (r.status === 'pending') continue
    // error
    throw new errs.AuthenticationError({ subtype: 'token_revoked', message: `登录失败:${r.message}` })
  }
  throw new errs.AuthenticationError({ subtype: 'token_expired', message: '登录超时,请重试' })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
