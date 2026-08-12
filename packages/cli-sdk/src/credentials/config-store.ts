/**
 * @renxqoo/agent-data-cli/credentials —— ConfigStore 实现
 *
 * 设计依据:docs/05-credentials.md "凭证存储"。
 *   - 按 namespace 分文件(每个业务包一个文件)
 *   - 单环境(框架,业务包各自声明 baseUrl,无 dev/test/prod)
 *
 * 安全契约(POSIX):凭证文件以 0600、目录以 0700 写入。Windows 不支持 chmod/mode,
 * 文件 ACL 继承父目录 —— 因此 0600 的保密保证仅在 POSIX 成立(见 docs/05)。
 * 凭证以明文 at-rest 存储(仅依赖文件系统权限保护),不做混淆/加密。
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
  readdirSync,
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
import { withFileLock } from "../infra/file-lock.js";

// ============================================================================
// fileStore:磁盘实现
// ============================================================================

export interface FileStoreOptions {
  /** 必填:根目录(由业务 app 决定,cli-sdk 不内置默认)。 */
  dir: string;
  /**
   * withLock 获取跨进程锁的最长等待(ms),用于 OAuth refresh 的读→改→写事务。
   * 默认 10_000。拿不到锁(另一进程持有且未释放)时抛错。
   */
  lockTimeoutMs?: number;
}

/**
 * 创建磁盘 ConfigStore。
 * 目录结构:
 *   <dir>/
 *   ├── config.json              全局配置(业务包 baseUrl 等)
 *   └── credentials/
 *       └── <namespace>.json     按业务包命名空间隔离(0600)
 */
export function fileStore(opts: FileStoreOptions): ConfigStore {
  const dir = opts.dir;
  const credsDir = join(dir, "credentials");
  const configPath = join(dir, "config.json");

  // C11: directories are a write-side concern. Reads tolerate a missing dir.
  const ensureDirs = () => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!existsSync(credsDir)) mkdirSync(credsDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
      chmodSync(credsDir, 0o700);
    } catch {
      /* 非 POSIX(Windows)忽略:见模块安全契约。 */
    }
  };

  // B4: sweep stale temp files left by a process killed mid-write. Called once per
  // store; the common recovery case is the next CLI run after a crash.
  const sweepStaleTemps = (targetDir: string) => {
    if (!existsSync(targetDir)) return;
    let entries: string[];
    try {
      entries = readdirSync(targetDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.endsWith(".tmp")) {
        try {
          rmSync(join(targetDir, entry), { force: true });
        } catch {
          /* best-effort */
        }
      }
    }
  };
  sweepStaleTemps(credsDir);
  sweepStaleTemps(dir);

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

  const readCredentials = (path: string): Record<string, unknown> | null => {
    if (!existsSync(path)) return null;
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

  const readConfig = (): Record<string, unknown> => {
    if (!existsSync(configPath)) return {};
    try {
      return decodeJsonDocument(readFileSync(configPath, "utf8"), configPath);
    } catch (cause) {
      throw new ConfigError({
        subtype: "invalid_config",
        message: `Config file corrupted or unreadable: ${configPath}`,
        cause,
      });
    }
  };

  return {
    async loadCredentials(namespace) {
      assertCredentialNamespace(namespace);
      const p = join(credsDir, `${namespace}.json`);
      return readCredentials(p);
    },

    async saveCredentials(namespace, data) {
      assertCredentialNamespace(namespace);
      ensureDirs();
      const p = join(credsDir, `${namespace}.json`);
      writeJsonAtomic(p, data);
    },

    async clearCredentials(namespace) {
      assertCredentialNamespace(namespace);
      const p = join(credsDir, `${namespace}.json`);
      if (existsSync(p)) {
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
      return readConfig();
    },

    async saveConfig(data) {
      ensureDirs();
      writeJsonAtomic(configPath, data);
    },

    async withLock<T>(namespace: string, fn: () => Promise<T>): Promise<T> {
      assertCredentialNamespace(namespace);
      ensureDirs();
      return withFileLock(credsDir, namespace, fn, { timeoutMs: opts.lockTimeoutMs ?? 10_000 });
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

  // In-process mutex per namespace (single-process equivalent of withLock).
  const mutexes = new Map<string, Promise<unknown>>();
  const runLocked = async <T>(namespace: string, fn: () => Promise<T>): Promise<T> => {
    const prev = mutexes.get(namespace) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    mutexes.set(
      namespace,
      prev.then(() => next),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

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
    async withLock<T>(namespace: string, fn: () => Promise<T>): Promise<T> {
      assertCredentialNamespace(namespace);
      return runLocked(namespace, fn);
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
