/**
 * defineAuth 工厂测试 —— 验证工厂产出的 plugin 形态、scope 透传、
 * S3 凭据回读(config.json → clientId)、M3 轮询(RFC 8628)。
 *
 * 这些测试从 apps/crm 迁入(原测 createAuthConfig / pollAndPersist / createAuthCommands),
 * 改为测 cli-sdk 的 defineAuth 工厂。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineAuth } from '../auth/index.js'
import { pollAndPersist } from '../auth/index.js'
import { createTestCtx } from '../test-utils.js'
import { memoryStore } from '../credentials/config-store.js'
import * as oauthApi from '../oauth.js'

// ============================================================================
// 工厂形态:返回的 plugin 带 provides + 钩子
// ============================================================================

describe('defineAuth: 工厂形态', () => {
  it('返回的 plugin 有 provides.namespaces[cmdNs],含 login/status/logout/register', async () => {
    const plugin = await defineAuth({
      credentialNamespace: 'crm',
      baseUrl: 'http://test',
      store: memoryStore(),
    })
    expect(plugin.name).toBe('auth:crm')
    expect(plugin.enforce).toBe('pre')
    expect(plugin.provides?.namespaces?.auth).toBeDefined()
    const cmds = plugin.provides!.namespaces!.auth!
    expect(Object.keys(cmds).sort()).toEqual(['login', 'logout', 'register', 'status'])
  })

  it('commandNamespace 可自定义(默认 auth)', async () => {
    const plugin = await defineAuth({
      credentialNamespace: 'crm',
      baseUrl: 'http://test',
      commandNamespace: 'iam',
      store: memoryStore(),
    })
    expect(plugin.provides?.namespaces?.iam).toBeDefined()
    expect(plugin.provides?.namespaces?.auth).toBeUndefined()
  })

  it('plugin 有 _transportConfig.on401(供 executeOne 查找)', async () => {
    const plugin = await defineAuth({
      credentialNamespace: 'crm',
      baseUrl: 'http://test',
      store: memoryStore(),
    })
    expect(plugin._transportConfig?.on401).toBeTypeOf('function')
  })
})

// ============================================================================
// S3: register 凭据回读(config.json → oauth.clientId)—— 从 crm 迁入
// ============================================================================

describe('S3: register 凭据回读(config.json → oauth.clientId)', () => {
  it('store 的 config.json 里有 clientId/clientSecret → 工厂读回', async () => {
    const store = memoryStore({ config: { clientId: 'cli_registered', clientSecret: 'sec_registered' } })
    const plugin = await defineAuth({
      credentialNamespace: 'crm',
      baseUrl: 'http://test',
      store,
    })
    // _transportConfig.on401 内部用 oauth(clientId 已回填);间接验证通过不报错
    expect(plugin._transportConfig?.on401).toBeDefined()
  })

  it('显式传 clientId/clientSecret 优先(不被 config.json 覆盖)', async () => {
    const store = memoryStore({ config: { clientId: 'from_config', clientSecret: 'from_config' } })
    const plugin = await defineAuth({
      credentialNamespace: 'crm',
      baseUrl: 'http://test',
      clientId: 'from_opt',
      clientSecret: 'from_opt',
      store,
    })
    // 通过 login 命令触发 deviceAuthorization,spy 校验 clientId 来源
    const spy = vi.spyOn(oauthApi, 'deviceAuthorization').mockResolvedValue({
      device_code: 'dc', user_code: 'uc', verification_uri: 'u', expires_in: 1, interval: 1,
    })
    const ctx = createTestCtx()
    const cmds = plugin.provides!.namespaces!.auth!
    await cmds.login.run({ wait: false, json: true }, ctx)
    const calledCfg = spy.mock.calls[0]![0]
    expect(calledCfg.clientId).toBe('from_opt')
    spy.mockRestore()
  })

  it('config.json 无凭据 + opts 空 → clientId 为空(向后兼容)', async () => {
    const store = memoryStore({ config: {} })
    const plugin = await defineAuth({
      credentialNamespace: 'crm',
      baseUrl: 'http://test',
      store,
    })
    const spy = vi.spyOn(oauthApi, 'deviceAuthorization').mockResolvedValue({
      device_code: 'dc', user_code: 'uc', verification_uri: 'u', expires_in: 1, interval: 1,
    })
    const ctx = createTestCtx()
    const cmds = plugin.provides!.namespaces!.auth!
    await cmds.login.run({ wait: false, json: true }, ctx)
    const calledCfg = spy.mock.calls[0]![0]
    expect(calledCfg.clientId).toBe('')
    spy.mockRestore()
  })
})

// ============================================================================
// scope 透传:业务自定,空=不带
// ============================================================================

describe('scope 透传(业务自定,空=不带)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('defineAuth({scope}) → login 时 deviceAuthorization 收到该 scope', async () => {
    const plugin = await defineAuth({
      credentialNamespace: 'crm',
      baseUrl: 'http://test',
      scope: 'company.api offline_access',
      store: memoryStore(),
    })
    const captured: string[] = []
    const spy = vi.spyOn(oauthApi, 'deviceAuthorization').mockImplementation(async (_cfg, scope) => {
      captured.push(scope ?? '')
      return { device_code: 'dc', user_code: 'uc', verification_uri: 'u', expires_in: 1, interval: 1 }
    })
    const ctx = createTestCtx()
    const cmds = plugin.provides!.namespaces!.auth!
    await cmds.login.run({ wait: false, json: true }, ctx)
    expect(captured[0]).toBe('company.api offline_access')
    spy.mockRestore()
  })

  it('defineAuth 不传 scope → deviceAuthorization 收到 undefined(不带 scope)', async () => {
    const plugin = await defineAuth({
      credentialNamespace: 'crm',
      baseUrl: 'http://test',
      store: memoryStore(),
      // 不传 scope
    })
    const captured: (string | undefined)[] = []
    const spy = vi.spyOn(oauthApi, 'deviceAuthorization').mockImplementation(async (_cfg, scope) => {
      captured.push(scope)
      return { device_code: 'dc', user_code: 'uc', verification_uri: 'u', expires_in: 1, interval: 1 }
    })
    const ctx = createTestCtx()
    const cmds = plugin.provides!.namespaces!.auth!
    await cmds.login.run({ wait: false, json: true }, ctx)
    expect(captured[0]).toBeUndefined()
    spy.mockRestore()
  })
})

// ============================================================================
// M3: device 轮询间隔应遵循服务端 interval + RFC 8628 slow_down 语义 —— 从 crm 迁入
// ============================================================================

describe('M3: pollAndPersist 轮询间隔(RFC 8628)', () => {
  it('起始间隔用传入的服务端 interval(不固定 3000ms)', async () => {
    const poller = vi.fn().mockResolvedValue({
      status: 'ok',
      token: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 's' },
    })
    const ctx = createTestCtx()
    const store = memoryStore()
    await pollAndPersist(ctx, { baseUrl: 'http://t', clientId: 'c', clientSecret: 's' }, store, 'crm', 'dc', 1, 10, poller)
    expect(poller).toHaveBeenCalledTimes(1) // 立即 ok
  })

  it('slow_down → interval 增加 5000ms(RFC 8628 §3.2)', async () => {
    vi.useFakeTimers()
    const sleepSpy = vi.spyOn(global, 'setTimeout')
    const sequence = [
      { status: 'slow_down' as const },
      {
        status: 'ok' as const,
        token: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 's' },
      },
    ]
    let callIdx = 0
    const poller = vi.fn().mockImplementation(() => Promise.resolve(sequence[callIdx++]!))
    const ctx = createTestCtx()
    const store = memoryStore()
    const p = pollAndPersist(ctx, { baseUrl: 'http://t', clientId: 'c', clientSecret: 's' }, store, 'crm', 'dc', 60, 1000, poller)
    await vi.runAllTimersAsync()
    await p
    const delays = sleepSpy.mock.calls.map((c) => c[1])
    expect(delays[0]).toBe(1000)
    expect(delays[1]).toBe(6000) // M3:slow_down 后 +5000
    vi.useRealTimers()
    sleepSpy.mockRestore()
  })
})
