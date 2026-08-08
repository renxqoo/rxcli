/**
 * config.ts 地址拆分测试 —— AUTH_BASE_URL / API_BASE_URL 两个独立地址配置。
 *
 * 背景:此前单一地址同时用于 OAuth 中间层(device flow/token/user_info/revoke/register)
 * 和业务 API 网关(/api/*)。拆成两个独立地址后,auth-proxy 与 API gateway 可分别部署/配置。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 动态导入,每个测试前重置模块缓存以重新读 process.env
async function loadConfig() {
  vi.resetModules()
  return (await import('../config.js')) as {
    AUTH_BASE_URL: string
    API_BASE_URL: string
  }
}

const ORIG_ENV = { ...process.env }
beforeEach(() => {
  // 清掉相关 env,每个测试自己设
  delete process.env.RXCLI_AUTH_BASE_URL
  delete process.env.RXCLI_API_BASE_URL
})
afterEach(() => {
  for (const k of ['RXCLI_AUTH_BASE_URL', 'RXCLI_API_BASE_URL']) delete process.env[k]
  Object.assign(process.env, ORIG_ENV)
  vi.resetModules()
})

describe('地址拆分: AUTH_BASE_URL / API_BASE_URL', () => {
  it('两个独立 env 分别配置两个地址', async () => {
    process.env.RXCLI_AUTH_BASE_URL = 'https://auth.example.com'
    process.env.RXCLI_API_BASE_URL = 'https://api.example.com'
    const cfg = await loadConfig()
    expect(cfg.AUTH_BASE_URL).toBe('https://auth.example.com')
    expect(cfg.API_BASE_URL).toBe('https://api.example.com')
  })

  it('AUTH_BASE_URL 供 OAuth 中间层(register/login/refresh/user_info)', async () => {
    process.env.RXCLI_AUTH_BASE_URL = 'https://auth-proxy.internal'
    const cfg = await loadConfig()
    expect(cfg.AUTH_BASE_URL).toBe('https://auth-proxy.internal')
  })

  it('API_BASE_URL 供业务 API 网关(/api/* 命令)', async () => {
    process.env.RXCLI_API_BASE_URL = 'https://gateway.internal'
    const cfg = await loadConfig()
    expect(cfg.API_BASE_URL).toBe('https://gateway.internal')
  })

  it('只设其中一个,另一个用各自默认值(互不影响)', async () => {
    process.env.RXCLI_AUTH_BASE_URL = 'https://auth.new'
    // API_BASE_URL 没设 → 用默认值 3000(不被 AUTH 影响)
    const cfg = await loadConfig()
    expect(cfg.AUTH_BASE_URL).toBe('https://auth.new')
    expect(cfg.API_BASE_URL).toBe('http://120.26.219.32')
    expect(cfg.API_BASE_URL).not.toBe('https://auth.new')
  })

  it('全未设 → 各自默认值(AUTH=API=3000,同址中间层)', async () => {
    const cfg = await loadConfig()
    // AUTH/OAuth 与业务 /proxy 都在中间层(3000);业务请求经 /proxy 转发公司应用
    expect(cfg.AUTH_BASE_URL).toBe('http://120.26.219.32')
    expect(cfg.API_BASE_URL).toBe('http://120.26.219.32')
  })
})
