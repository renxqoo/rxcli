/**
 * rxx —— 远程坏 manifest 的友好错误处理(端到端)
 *
 * 验证:服务端给各种坏配置,客户端给结构化、带 hint 的类型化错误,
 * 而不是一团 internal/unknown。agent 能据此恢复或求助。
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const RXX_ROOT = resolve(__dirname, "..", "..");
const RXX_BIN = join(RXX_ROOT, "dist", "index.js");

// server + RXX_HOME 由 globalSetup 起
const baseUrl = process.env.RXX_SERVER_BASE ?? "http://127.0.0.1:9966";

function runRxx(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [RXX_BIN, ...args], {
      env: { ...process.env }, // RXX_HOME 由 globalSetup 设
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

/** 向 server 注入任意 manifest(测试坏配置)。 */
async function injectManifest(name: string, manifest: any, sign = true): Promise<void> {
  await fetch(`${baseUrl}/__admin/raw-manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, manifest, sign }),
  });
}

/** 解析 stderr 的错误 envelope。 */
function parseErr(stderr: string): any {
  const lines = stderr
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("{"));
  return JSON.parse(lines[lines.length - 1]!);
}

// server 由 globalSetup 起,这里不再起/停

const COMMON_ARGS = ["--insecure", "--private-endpoints", "--auto-confirm"];

describe("坏 manifest 友好错误处理", () => {
  it("缺 api.baseUrl → validation/invalid_config + 字段定位 hint", async () => {
    await injectManifest("bad-1", {
      name: "bad-1",
      description: "x",
      version: "1.0.0",
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    });
    const { stderr, code } = await runRxx(["init", `${baseUrl}/manifests/bad-1`, ...COMMON_ARGS]);
    expect(code).toBe(2);
    const err = parseErr(stderr);
    expect(err.error.type).toBe("validation");
    expect(err.error.subtype).toBe("invalid_config");
    expect(err.error.param).toBe("api.baseUrl");
    expect(err.error.hint).toBeDefined();
  });

  it("非法 http.method → validation/invalid_config + 定位到具体命令", async () => {
    await injectManifest("bad-2", {
      name: "bad-2",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "http://127.0.0.1:9966" },
      namespaces: {
        x: {
          y: {
            description: "y",
            http: { method: "WHATEVER", path: "/y" },
            response: { data: "." },
          },
        },
      },
    });
    const { stderr, code } = await runRxx(["init", `${baseUrl}/manifests/bad-2`, ...COMMON_ARGS]);
    expect(code).toBe(2);
    const err = parseErr(stderr);
    expect(err.error.subtype).toBe("invalid_config");
    expect(err.error.param).toContain("http.method");
  });

  it("name 非法 → validation/invalid_config + name 修复提示", async () => {
    await injectManifest("bad-3", {
      name: "Bad Name",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "http://127.0.0.1:9966" },
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    });
    const { stderr, code } = await runRxx(["init", `${baseUrl}/manifests/bad-3`, ...COMMON_ARGS]);
    expect(code).toBe(2);
    const err = parseErr(stderr);
    expect(err.error.param).toBe("name");
    expect(err.error.hint).toMatch(/lowercase/);
  });

  it("缺命令(commands + namespaces 都空)→ validation/invalid_config", async () => {
    await injectManifest("bad-4", {
      name: "bad-4",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "http://127.0.0.1:9966" },
    });
    const { stderr, code } = await runRxx(["init", `${baseUrl}/manifests/bad-4`, ...COMMON_ARGS]);
    expect(code).toBe(2);
    const err = parseErr(stderr);
    expect(err.error.subtype).toBe("invalid_config");
  });

  it("不存在的 manifest(404) → api/not_found + 提示核对 URL", async () => {
    const { stderr, code } = await runRxx([
      "init",
      `${baseUrl}/manifests/nonexistent`,
      ...COMMON_ARGS,
    ]);
    expect(code).toBe(1);
    const err = parseErr(stderr);
    expect(err.error.type).toBe("api");
    expect(err.error.subtype).toBe("not_found");
    expect(err.error.hint).toBeDefined();
  });

  it("非法 URL → validation/invalid_argument + param:url", async () => {
    const { stderr, code } = await runRxx(["init", "not a url", "--auto-confirm"]);
    expect(code).toBe(2);
    const err = parseErr(stderr);
    expect(err.error.subtype).toBe("invalid_argument");
    expect(err.error.param).toBe("url");
  });

  it("HTTP(非 HTTPS) → validation/invalid_config + 提示 --insecure", async () => {
    const { stderr, code } = await runRxx([
      "init",
      `${baseUrl}/manifests/demo-orders`,
      "--private-endpoints",
      "--auto-confirm",
    ]);
    expect(code).toBe(2);
    const err = parseErr(stderr);
    expect(err.error.subtype).toBe("invalid_config");
    expect(err.error.hint).toMatch(/--insecure/);
  });

  it("run 未装服务 → validation/missing_config + 提示先 init", async () => {
    const { stderr, code } = await runRxx(["run", "ghost-service", "x", "y"]);
    expect(code).toBe(2);
    const err = parseErr(stderr);
    expect(err.error.subtype).toBe("missing_config");
    expect(err.error.hint).toMatch(/rxx init/);
  });

  it("所有错误都有 hint 字段(agent 可据此恢复)", async () => {
    // 抽查:每个错误 envelope 的 error.hint 必须非空
    await injectManifest("hint-check", {
      name: "hint-check",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "http://127.0.0.1:9966" },
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    });
    // 改坏 baseUrl 触发错误
    await injectManifest("hint-check", {
      name: "hint-check",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "not-a-url" },
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    });
    const { stderr } = await runRxx(["init", `${baseUrl}/manifests/hint-check`, ...COMMON_ARGS]);
    const err = parseErr(stderr);
    expect(err.error.hint).toBeTruthy();
    expect(typeof err.error.hint).toBe("string");
    expect(err.error.hint!.length).toBeGreaterThan(5);
  });
});

describe("remove/list 命令的错误契约(B2 修复:envelope + 正确 exit code)", () => {
  it("remove '../foo' → validation/invalid_argument/param:name/exit 2(非 internal/exit 5)", async () => {
    const { stderr, code } = await runRxx(["remove", "../foo"]);
    expect(code).toBe(2); // 当前 bug 是 5
    const err = parseErr(stderr);
    expect(err.ok).toBe(false);
    expect(err.error.type).toBe("validation");
    expect(err.error.subtype).toBe("invalid_argument");
    expect(err.error.param).toBe("name");
    expect(err.error.hint).toBeDefined();
  });

  it("remove 'bad_name'(下划线非法)→ validation/invalid_argument/exit 2", async () => {
    const { stderr, code } = await runRxx(["remove", "bad_name"]);
    expect(code).toBe(2);
    const err = parseErr(stderr);
    expect(err.error.type).toBe("validation");
    expect(err.error.subtype).toBe("invalid_argument");
    expect(err.error.param).toBe("name");
  });

  it("remove 不存在的服务 → exit 0(removed:false 是正常结果,不是错误)", async () => {
    const { stdout, code } = await runRxx(["remove", "nonexistent-svc"]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.ok).toBe(true);
    expect(out.data.removed).toBe(false);
  });
});
