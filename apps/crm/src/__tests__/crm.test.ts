import { describe, it, expect } from 'vitest'
import { createTestCtx } from '@renxqoo/agentdatacli'
import { ordersCommands } from '../commands/orders.js'
import { productsCommands } from '../commands/products.js'
import { invoicesCommands } from '../commands/invoices.js'
import { accountCommands } from '../commands/account.js'

// 所有业务命令都经 gateway GET,用 createTestCtx mock request
function mockCtx(responseByPath: Record<string, { status?: number; data: unknown }>) {
  return createTestCtx({
    request: async (opts) => {
      const key = opts.path
      const mock = responseByPath[key]
      if (mock) return { status: mock.status ?? 200, data: mock.data, headers: {} }
      // 通配:路径前缀匹配
      for (const [pattern, res] of Object.entries(responseByPath)) {
        if (pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1))) {
          return { status: res.status ?? 200, data: res.data, headers: {} }
        }
      }
      throw new Error(`unexpected ${opts.method} ${opts.path}`)
    },
  })
}

describe('orders', () => {
  it('list 返回订单数组', async () => {
    const ctx = mockCtx({ '/proxy/api/orders': { data: { orders: [{ id: 'o_1001', total: 199 }] } } })
    const result = await ordersCommands.list.run({}, ctx)
    expect(result!.data).toEqual({ orders: [{ id: 'o_1001', total: 199 }] })
  })

  it('list --limit 透传 query', async () => {
    let capturedQuery: Record<string, unknown> = {}
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedQuery = opts.query ?? {}
        return { status: 200, data: { orders: [] }, headers: {} }
      },
    })
    await ordersCommands.list.run({ limit: 5 }, ctx)
    expect(capturedQuery.limit).toBe(5)
  })

  it('get 404 → NotFoundError', async () => {
    const ctx = mockCtx({ '/proxy/api/orders/o_x': { status: 404, data: {} } })
    await expect(ordersCommands.get.run({ id: 'o_x' }, ctx)).rejects.toMatchObject({
      category: 'api',
      subtype: 'not_found',
    })
  })
})

describe('products', () => {
  it('list --category 透传', async () => {
    let capturedQuery: Record<string, unknown> = {}
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedQuery = opts.query ?? {}
        return { status: 200, data: { products: [] }, headers: {} }
      },
    })
    await productsCommands.list.run({ category: '电脑外设' }, ctx)
    expect(capturedQuery.category).toBe('电脑外设')
  })

  it('get 返回商品详情', async () => {
    const ctx = mockCtx({ '/proxy/api/products/p_002': { data: { id: 'p_002', name: '机械键盘' } } })
    const result = await productsCommands.get.run({ id: 'p_002' }, ctx)
    expect(result!.data).toMatchObject({ id: 'p_002', name: '机械键盘' })
  })
})

describe('invoices', () => {
  it('list 返回发票列表', async () => {
    const ctx = mockCtx({ '/proxy/api/invoices': { data: { invoices: [{ id: 'inv_2001' }] } } })
    const result = await invoicesCommands.list.run({}, ctx)
    expect(result!.data).toEqual({ invoices: [{ id: 'inv_2001' }] })
  })
})

describe('account', () => {
  it('profile 返回当前用户资料', async () => {
    const ctx = mockCtx({ '/proxy/api/profile': { data: { id: 'u_alice', email: 'alice@example.com' } } })
    const result = await accountCommands.profile.run({}, ctx)
    expect(result!.data).toMatchObject({ id: 'u_alice' })
  })

  it('admin-users 返回全量用户(权限由服务端 403 拦截,本地不预检)', async () => {
    const ctx = mockCtx({ '/proxy/api/admin/users': { data: { users: [{ id: 'u_alice' }] } } })
    const result = await accountCommands['admin-users'].run({}, ctx)
    expect(result!.data).toEqual({ users: [{ id: 'u_alice' }] })
  })
})
