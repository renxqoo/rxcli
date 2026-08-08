import { describe, it, expect } from 'vitest'
import { sortPlugins, runBeforeCommand, runBeforeOutput, runOnError } from '../plugin.js'
import type { Plugin, CommandContext, RequestOptions } from '../types.js'
import { createTestCtx } from '../test-utils.js'
import { NetworkError, APIError, ValidationError } from '../errs/index.js'

function makeCtx(): CommandContext<any> {
  return createTestCtx()
}

describe('plugin: enforce 三档排序', () => {
  it('pre → normal → post,档内注册序', () => {
    const calls: string[] = []
    const pre: Plugin = { name: 'p1', enforce: 'pre', async beforeCommand() { calls.push('pre1') } }
    const post: Plugin = { name: 'p3', enforce: 'post', async beforeCommand() { calls.push('post1') } }
    const normal1: Plugin = { name: 'p2', async beforeCommand() { calls.push('normal1') } }
    const normal2: Plugin = { name: 'p2b', async beforeCommand() { calls.push('normal2') } }
    const pre2: Plugin = { name: 'p1b', enforce: 'pre', async beforeCommand() { calls.push('pre2') } }

    // 注册序故意打乱
    const sorted = sortPlugins([post, normal1, pre, normal2, pre2])
    void sorted
    return runBeforeCommand([post, normal1, pre, normal2, pre2], makeCtx()).then(() => {
      expect(calls).toEqual(['pre1', 'pre2', 'normal1', 'normal2', 'post1'])
    })
  })
})

describe('plugin: beforeOutput 链式 transform', () => {
  it('每个插件拿到上一个输出', async () => {
    const p1: Plugin = { name: 't1', async beforeOutput(_ctx, data) { return { ...(data as object), t1: true } } }
    const p2: Plugin = { name: 't2', enforce: 'post', async beforeOutput(_ctx, data) { return { ...(data as object), t2: true } } }
    const out = await runBeforeOutput([p2, p1], makeCtx(), { base: true })
    expect(out).toEqual({ base: true, t1: true, t2: true })
  })
})

describe('plugin: onError 链式', () => {
  it('不处理的插件 return err 透传', async () => {
    const original = new APIError({ subtype: 'server_error', message: '500' })
    // 不处理应返回传入的 err(而非 undefined,否则会吞掉)
    const passThrough: Plugin = { name: 'pass', async onError(_ctx, err) { return err as Error } }
    const result = await runOnError([passThrough], makeCtx(), original)
    expect(result).toBe(original)
  })

  it('处理的插件返回新 err,传给下一个', async () => {
    const original = new NetworkError({ subtype: 'timeout', message: '超时' })
    const normalizer: Plugin = {
      name: 'norm',
      async onError(_ctx, err) {
        if (err instanceof NetworkError) return new APIError({ subtype: 'server_error', message: '降级' })
        return err as Error
      },
    }
    const result = await runOnError([normalizer], makeCtx(), original)
    expect(result).toBeInstanceOf(APIError)
    expect((result as APIError).subtype).toBe('server_error')
  })

  it('返回 undefined 吞掉错误(链结果为 undefined)', async () => {
    const swallower: Plugin = { name: 'swallow', async onError() { return undefined } }
    const result = await runOnError([swallower], makeCtx(), new ValidationError({ subtype: 'invalid_argument', message: 'x' }))
    expect(result).toBeUndefined()
  })
})

describe('plugin: beforeRequest 改 req', () => {
  it('插件能修改 req.headers', async () => {
    const addHeader: Plugin = {
      name: 'add-h',
      enforce: 'pre',
      async beforeRequest(_ctx, req: RequestOptions) {
        req.headers = { ...req.headers, 'X-Client': 'rxcli' }
      },
    }
    const req: RequestOptions = { method: 'GET', path: '/orders', headers: {} }
    const ctx = makeCtx()
    // 直接测 runBeforeRequest
    const { runBeforeRequest } = await import('../plugin.js')
    await runBeforeRequest([addHeader], ctx, req)
    expect(req.headers?.['X-Client']).toBe('rxcli')
  })
})
