import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveWithChain,
  flagProvider,
  envProvider,
  fileProvider,
  defaultProviders,
} from '../credentials/providers.js'
import { memoryStore } from '../credentials/config-store.js'
import type { ProviderContext, CredentialProvider } from '../credentials/types.js'

function makePctx(store = memoryStore(), args: Record<string, unknown> = {}, env: Record<string, string | undefined> = {}): ProviderContext {
  return {
    namespace: 'orders',
    configStore: store,
    args,
    env,
  }
}

describe('provider chain: 命中即停', () => {
  it('flag provider(priority 1)命中后不再调后续', async () => {
    const calls: string[] = []
    const flag = flagProvider()
    const env = envProvider()
    // 包装记录调用
    const wrap = (p: CredentialProvider): CredentialProvider => ({
      name: p.name,
      priority: p.priority,
      async resolveToken(pctx) {
        calls.push(p.name())
        return p.resolveToken(pctx)
      },
    })
    const pctx = makePctx(memoryStore(), { apiKey: 'sk_flag' })
    const result = await resolveWithChain([wrap(flag), wrap(env)], pctx)
    expect(result?.token.token).toBe('sk_flag')
    expect(result?.token.source).toBe('flag:--api-key')
    // env 不该被调用(flag 命中即停)
    expect(calls).toEqual(['flag'])
  })

  it('flag 没命中 → env(5)命中', async () => {
    const pctx = makePctx(memoryStore(), {}, { ORDERS_API_KEY: 'sk_env' })
    const result = await resolveWithChain(defaultProviders(), pctx)
    expect(result?.token.token).toBe('sk_env')
    expect(result?.token.source).toBe('env:ORDERS_API_KEY')
  })

  it('env 没命中 → file(10)命中', async () => {
    const store = memoryStore({ credentials: { orders: { apiKey: 'sk_file' } } })
    const pctx = makePctx(store, {}, {})
    const result = await resolveWithChain(defaultProviders(), pctx)
    expect(result?.token.token).toBe('sk_file')
    expect(result?.token.source).toBe('file:orders.json#apiKey')
  })

  it('全没命中 → null', async () => {
    const pctx = makePctx(memoryStore(), {}, {})
    const result = await resolveWithChain(defaultProviders(), pctx)
    expect(result).toBeNull()
  })

  it('priority 小值先试(自定义 provider 排序)', async () => {
    const calls: string[] = []
    const low: CredentialProvider = {
      name: () => 'low',
      priority: () => 2,
      async resolveToken() {
        calls.push('low')
        return null
      },
    }
    const high: CredentialProvider = {
      name: () => 'high',
      priority: () => 100,
      async resolveToken() {
        calls.push('high')
        return { token: 't', type: 'bearer', source: 'high' }
      },
    }
    // 注册序颠倒(low 后注册),但 priority 小的先试
    const result = await resolveWithChain([high, low], makePctx())
    expect(calls).toEqual(['low', 'high']) // low 先试(没命中),high 后试(命中)
    expect(result?.provider.name()).toBe('high')
  })
})

// ============================================================================
// M6: flagProvider 在真实流程中是死代码(确认测试,不修 Plugin 接口)
// ============================================================================
// 根因:auth 插件的 beforeCommand 构造 ProviderContext 时恒传 args: {}(见 apps/crm/src/auth.ts:84),
// 而 Plugin.beforeCommand 签名只收 ctx、拿不到解析后的 args(parsed args 只传给 spec.run)。
// 所以 flagProvider 读 pctx.args.apiKey 恒为 undefined → 永远返回 null。
// 本测试固化这个已知缺口:真实流程下 flag provider 永不命中,需改 Plugin 接口才能根治(留待设计决策)。
describe('M6: flagProvider 在真实 ProviderContext(args:{})下永不命中(死代码确认)', () => {
  it('args 为空对象时 → flagProvider 返回 null', async () => {
    const flag = flagProvider()
    // 模拟 auth 插件构造的真实 pctx(args:{},无 apiKey)
    const pctx = makePctx(memoryStore(), {}, {})
    const result = await flag.resolveToken(pctx)
    expect(result).toBeNull()
  })

  it('即便 env 有 token,flag 在 chain 里也恒跳过(因 args.apiKey 缺失)', async () => {
    // 真实流程:--api-key 从命令行传不进 pctx.args,所以 flag 永远不命中
    const pctx = makePctx(memoryStore(), {}, { ORDERS_API_KEY: 'sk_env' })
    const result = await resolveWithChain(defaultProviders(), pctx)
    // 落到 env provider,而非 flag
    expect(result?.token.source).toBe('env:ORDERS_API_KEY')
    expect(result?.token.source).not.toBe('flag:--api-key')
  })
})

describe('memoryStore: 隔离文件 IO', () => {
  it('save → load 往返', async () => {
    const store = memoryStore()
    await store.saveCredentials('orders', { apiKey: 'sk1', scopes: ['read'] })
    const loaded = await store.loadCredentials('orders')
    expect(loaded).toEqual({ apiKey: 'sk1', scopes: ['read'] })
  })

  it('clear 后 load 返回 null', async () => {
    const store = memoryStore({ credentials: { orders: { apiKey: 'sk1' } } })
    await store.clearCredentials('orders')
    expect(await store.loadCredentials('orders')).toBeNull()
  })

  it('load 不存在的 namespace 返回 null', async () => {
    const store = memoryStore()
    expect(await store.loadCredentials('nope')).toBeNull()
  })

  it('save/load 互不影响(深拷贝隔离)', async () => {
    const store = memoryStore({ credentials: { orders: { apiKey: 'sk1' } } })
    const a = await store.loadCredentials('orders')
    if (a) a.apiKey = 'tampered'
    const b = await store.loadCredentials('orders')
    expect(b?.apiKey).toBe('sk1') // 不被外部篡改影响
  })

  it('_snapshot 看内部状态', async () => {
    const store = memoryStore()
    await store.saveConfig({ baseUrl: 'http://x' })
    expect(store._snapshot().config).toEqual({ baseUrl: 'http://x' })
  })
})

describe('env provider: namespace → env 变量名', () => {
  it('带连字符的 namespace 转下划线大写', async () => {
    const env = envProvider()
    const pctx: ProviderContext = {
      namespace: 'hr-system',
      configStore: memoryStore(),
      args: {},
      env: { HR_SYSTEM_API_KEY: 'sk_hr' },
    }
    const result = await env.resolveToken(pctx)
    expect(result?.token).toBe('sk_hr')
    expect(result?.source).toBe('env:HR_SYSTEM_API_KEY')
  })
})
