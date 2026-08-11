/**
 * rxx —— 全局配置:本地状态目录、rxx 版本。
 *
 * 目录布局(类似 npm/fnm 的 ~/.<tool> 模式):
 *   ~/.rxx/
 *     bin/                  shim 脚本(rxcrm → rxx run rxcrm ...)
 *       <service-name>      POSIX sh 脚本(chmod 500)
 *       <service-name>.cmd  Windows 批处理
 *     registry/             已装动态服务的 manifest 缓存
 *       <service-name>/
 *         manifest.json     服务端下发的 manifest
 *         pubkey.pem        publisher 公钥(pinning)
 *         meta.json         安装元信息(source_url/sha256/fetched_at/version)
 *     skills/               临时生成的 skill(同步到各 agent 发现路径前的中转)
 *     .staging/             安装事务的暂存目录(事务化安装用,与目标同 filesystem)
 *
 * 路径全部走函数(运行时读 RXX_HOME),消除 module-load 求值副作用——
 * 测试设 RXX_HOME 后立即生效,无需 dynamic import / resetModules。
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as posixJoin } from "node:path";

/** rxx 本地状态根目录(运行时读 RXX_HOME)。 */
export function getRxDir(): string {
  return process.env.RXX_HOME ?? join(homedir(), ".rxx");
}

/** shim 脚本目录(进 PATH)。 */
export function getRxBinDir(): string {
  return join(getRxDir(), "bin");
}

/** 已装动态服务 manifest 缓存目录。 */
export function getRxRegistryDir(): string {
  return join(getRxDir(), "registry");
}

/** 临时生成的 skill 目录(同步到各 agent 发现路径前的中转)。 */
export function getRxSkillsDir(): string {
  return join(getRxDir(), "skills");
}

/** 安装事务暂存目录(与目标同 filesystem,保证 rename 原子)。 */
export function getRxStagingDir(): string {
  return join(getRxDir(), ".staging");
}

/**
 * rxx 自身版本:从 package.json 读(运行时 import.meta.url 定位)。
 *
 * 不硬编码:package.json version 改了这里自动跟上。
 * 找不到(package.json 缺失/bun compile)回退 "0.0.0"。
 */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/config.js → 上溯找 package.json(包根)
    // src 下跑 tsx 时是 src/config.ts → 上溯也能找到
    let dir = here;
    for (let i = 0; i < 6; i++) {
      try {
        const pkgPath = posixJoin(dir, "package.json");
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
          version?: string;
        };
        // 跳过非本包(monorepo 根 / cli-sdk)
        if (pkg.name === "@renxqoo/rxx-cli" && pkg.version) return pkg.version;
      } catch {
        // 当前目录无 package.json,继续上溯
      }
      dir = dirname(dir);
    }
  } catch {
    /* 兜底 */
  }
  return "0.0.0";
}

export const RXX_VERSION = readVersion();
