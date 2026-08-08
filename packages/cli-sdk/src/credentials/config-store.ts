/**
 * @renxqoo/agentdatacli/credentials —— ConfigStore 实现
 *
 * 设计依据:docs/05-credentials.md "凭证存储"。
 * 实现,改造点:
 *   - 按 namespace 分文件(v1 是单 credentials.json,v2 每个业务包一个文件)
 *   - **取消多环境**(v1 单体 CLI 的遗留概念):v2 是框架,业务包各自声明 baseUrl,无 dev/test/prod
 *
 * 提供 fileStore(磁盘,0600)和 memoryStore(测试用)两个工厂。
 */

import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync } from 'node:fs'
import type { ConfigStore } from './types.js'

// ============================================================================
// fileStore:磁盘实现(移植 + 按 namespace 分文件)
// ============================================================================

export interface FileStoreOptions {
  /** 必填:根目录(业务包声明,如 ~/.rxcli)。 */
  dir: string
}

/**
 * 创建磁盘 ConfigStore。
 * 目录结构:
 *   <dir>/
 *   ├── config.json              全局配置(单环境,业务包 baseUrl 等)
 *   └── credentials/
 *       └── <namespace>.json     按业务包命名空间隔离(0600)
 */
export function fileStore(opts: FileStoreOptions): ConfigStore {
  const dir = opts.dir
  const credsDir = join(dir, 'credentials')
  const configPath = join(dir, 'config.json')

  const ensureDir = () => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (!existsSync(credsDir)) mkdirSync(credsDir, { recursive: true, mode: 0o700 })
  }

  const credsPath = (namespace: string) => join(credsDir, `${namespace}.json`)

  return {
    async loadCredentials(namespace) {
      ensureDir()
      const p = credsPath(namespace)
      if (!existsSync(p)) return null
      try {
        return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
      } catch {
        return null
      }
    },

    async saveCredentials(namespace, data) {
      ensureDir()
      const p = credsPath(namespace)
      writeFileSync(p, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
      try {
        chmodSync(p, 0o600)
      } catch {
        /* 非 POSIX 忽略 */
      }
    },

    async clearCredentials(namespace) {
      ensureDir()
      const p = credsPath(namespace)
      if (existsSync(p)) {
        // 删除凭证文件(unlinkSync 已在顶部静态导入,避免每次动态 import)
        try {
          unlinkSync(p)
        } catch {
          /* 忽略 */
        }
      }
    },

    async loadConfig() {
      ensureDir()
      if (!existsSync(configPath)) return {}
      try {
        return JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
      } catch {
        return {}
      }
    },

    async saveConfig(data) {
      ensureDir()
      writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
      try {
        chmodSync(configPath, 0o600)
      } catch {
        /* 非 POSIX 忽略 */
      }
    },
  }
}

// ============================================================================
// memoryStore:内存实现(测试用,隔离文件 IO)
// ============================================================================

/**
 * 创建内存 ConfigStore。测试用:不碰磁盘,可预设凭证。
 * ```ts
 * const store = memoryStore({
 *   credentials: { orders: { apiKey: 'sk_test' } },
 * })
 * ```
 */
export function memoryStore(initial: {
  credentials?: Record<string, Record<string, unknown>>
  config?: Record<string, unknown>
} = {}): ConfigStore & { _snapshot: () => { credentials: Record<string, Record<string, unknown>>; config: Record<string, unknown> } } {
  const creds: Record<string, Record<string, unknown>> = structuredClone(initial.credentials ?? {})
  const config: Record<string, unknown> = structuredClone(initial.config ?? {})

  const store: ConfigStore = {
    async loadCredentials(namespace) {
      return creds[namespace] ? structuredClone(creds[namespace]) : null
    },
    async saveCredentials(namespace, data) {
      creds[namespace] = structuredClone(data)
    },
    async clearCredentials(namespace) {
      delete creds[namespace]
    },
    async loadConfig() {
      return structuredClone(config)
    },
    async saveConfig(data) {
      for (const [k, v] of Object.entries(data)) config[k] = v
    },
  }

  return Object.assign(store, {
    _snapshot: () => ({
      credentials: structuredClone(creds),
      config: structuredClone(config),
    }),
  })
}
