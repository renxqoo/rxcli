/**
 * rxx —— 测试全局 setup:唯一 server 实例,所有 e2e 测试文件共用
 *
 * 消除"每个测试文件各自起 server 占 9966 端口"的竞争。
 * vitest globalSetup 起一次 server,所有测试文件通过环境变量拿到端口。
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const RXX_ROOT = resolve(__dirname, "..", "..");
const SERVER_ROOT = join(RXX_ROOT, "server");
const SERVER_BIN = join(SERVER_ROOT, "dist", "index.js");

let serverProc: ChildProcess | null = null;
let tmpHome: string;

/**
 * 确保 server 已编译:server/dist/ 被 gitignore(不入库),
 * CI 干净环境需要先 build。本地已 build 则跳过(零开销)。
 */
function ensureServerBuilt(): void {
  if (existsSync(SERVER_BIN)) return;
  const result = spawnSync("pnpm", ["run", "build"], {
    cwd: SERVER_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0 || !existsSync(SERVER_BIN)) {
    throw new Error(
      `Failed to build rxx-server (tsc exited ${result.status}).\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

export async function setup(): Promise<void> {
  // CI 干净环境:server dist 不存在,先 build(本地已 build 则跳过)
  ensureServerBuilt();

  // 唯一的 RXX_HOME(测试隔离)
  tmpHome = mkdtempSync(join(tmpdir(), "rxx-global-"));
  process.env.RXX_HOME = tmpHome;
  process.env.RXX_SERVER_BASE = "http://127.0.0.1:9966";

  serverProc = spawn("node", [SERVER_BIN], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });
  // 保留 server 日志便于诊断启动失败(不静默丢弃)
  let serverStderr = "";
  serverProc.stderr?.on("data", (d) => {
    serverStderr += d;
  });
  serverProc.stdout?.on("data", () => {});

  // 轮询健康端点(替代固定 800ms sleep,消除慢机 flaky)
  const healthUrl = "http://127.0.0.1:9966/";
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (serverProc.exitCode !== null) {
      throw new Error(
        `rxx-server exited early (code ${serverProc.exitCode}). stderr:\n${serverStderr}`,
      );
    }
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return;
    } catch {
      // 还没起来,继续轮询
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`rxx-server did not become healthy within 10s. stderr:\n${serverStderr}`);
}

export async function teardown(): Promise<void> {
  try {
    if (serverProc) {
      serverProc.kill("SIGKILL");
      serverProc = null;
    }
  } finally {
    if (tmpHome) {
      try {
        rmSync(tmpHome, { recursive: true, force: true });
      } catch {
        /* 忽略 */
      }
    }
  }
}
