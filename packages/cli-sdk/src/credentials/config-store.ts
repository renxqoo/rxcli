/**
 * @renxqoo/agent-data-cli/credentials —— ConfigStore 实现
 *
 * 设计依据:docs/05-credentials.md "凭证存储"。
 * 实现,改造点:
 *   - 按 namespace 分文件(v1 是单 credentials.json,v2 每个业务包一个文件)
 *   - **取消多环境**(v1 单体 CLI 的遗留概念):v2 是框架,业务包各自声明 baseUrl,无 dev/test/prod
 *
 * 提供 fileStore(磁盘,0600)和 memoryStore(测试用)两个工厂。
 */

import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
  unlinkSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { ConfigStore } from "./types.js";
import { ConfigError } from "../errs/index.js";
import {
  assertCredentialNamespace,
  decodeJsonDocument,
  encodeJsonDocument,
  roundTripJsonDocument,
} from "./codec.js";

// ============================================================================
// fileStore:磁盘实现(移植 + 按 namespace 分文件)
// ============================================================================

export interface FileStoreOptions {
  /** 必填:根目录(业务包声明,如 ~/.rxcli)。 */
  dir: string;
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
  const dir = opts.dir;
  const credsDir = join(dir, "credentials");
  const configPath = join(dir, "config.json");

  const ensureDir = () => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!existsSync(credsDir)) mkdirSync(credsDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
      chmodSync(credsDir, 0o700);
    } catch {
      /* 非 POSIX 忽略 */
    }
  };

  const writeJsonAtomic = (path: string, data: Record<string, unknown>) => {
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, encodeJsonDocument(data, path), { mode: 0o600 });
      try {
        chmodSync(temp, 0o600);
      } catch {
        /* 非 POSIX 忽略 */
      }
      renameSync(temp, path);
    } catch (cause) {
      rmSync(temp, { force: true });
      throw new ConfigError({
        subtype: "invalid_config",
        message: `Failed to write config: ${path}`,
        cause,
      });
    }
  };

  const readJson = <T extends null | Record<string, never>>(
    path: string,
    missing: T,
  ): Record<string, unknown> | T => {
    if (!existsSync(path)) return missing;
    try {
      return decodeJsonDocument(readFileSync(path, "utf8"), path);
    } catch (cause) {
      throw new ConfigError({
        subtype: "invalid_config",
        message: `Config file corrupted or unreadable: ${path}`,
        cause,
      });
    }
  };

  const credsPath = (namespace: string) => {
    assertCredentialNamespace(namespace);
    return join(credsDir, `${namespace}.json`);
  };

  return {
    async loadCredentials(namespace) {
      ensureDir();
      const p = credsPath(namespace);
      return readJson(p, null);
    },

    async saveCredentials(namespace, data) {
      ensureDir();
      const p = credsPath(namespace);
      writeJsonAtomic(p, data);
    },

    async clearCredentials(namespace) {
      ensureDir();
      const p = credsPath(namespace);
      if (existsSync(p)) {
        // 删除凭证文件(unlinkSync 已在顶部静态导入,避免每次动态 import)
        try {
          unlinkSync(p);
        } catch (cause) {
          throw new ConfigError({
            subtype: "invalid_config",
            message: `Failed to clear credentials: ${p}`,
            cause,
          });
        }
      }
    },

    async loadConfig() {
      ensureDir();
      return readJson(configPath, {});
    },

    async saveConfig(data) {
      ensureDir();
      writeJsonAtomic(configPath, data);
    },
  };
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
export function memoryStore(
  initial: {
    credentials?: Record<string, Record<string, unknown>>;
    config?: Record<string, unknown>;
  } = {},
): ConfigStore & {
  _snapshot: () => {
    credentials: Record<string, Record<string, unknown>>;
    config: Record<string, unknown>;
  };
} {
  const creds: Record<string, Record<string, unknown>> = {};
  for (const [namespace, data] of Object.entries(initial.credentials ?? {})) {
    assertCredentialNamespace(namespace);
    creds[namespace] = roundTripJsonDocument(data, `credentials:${namespace}`);
  }
  let config = roundTripJsonDocument(initial.config ?? {}, "config");

  const store: ConfigStore = {
    async loadCredentials(namespace) {
      assertCredentialNamespace(namespace);
      return creds[namespace]
        ? roundTripJsonDocument(creds[namespace], `credentials:${namespace}`)
        : null;
    },
    async saveCredentials(namespace, data) {
      assertCredentialNamespace(namespace);
      creds[namespace] = roundTripJsonDocument(data, `credentials:${namespace}`);
    },
    async clearCredentials(namespace) {
      assertCredentialNamespace(namespace);
      delete creds[namespace];
    },
    async loadConfig() {
      return roundTripJsonDocument(config, "config");
    },
    async saveConfig(data) {
      config = roundTripJsonDocument(data, "config");
    },
  };

  return Object.assign(store, {
    _snapshot: () => ({
      credentials: roundTripJsonDocument(creds, "credentials snapshot") as Record<
        string,
        Record<string, unknown>
      >,
      config: roundTripJsonDocument(config, "config"),
    }),
  });
}
