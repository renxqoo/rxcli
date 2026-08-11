/**
 * rxx —— 真实 CLI 端到端测试
 *
 * 起 rxx-server → child_process 跑 `node dist/index.js init/run/list/remove`
 * → 验证真实命令行的完整链路。
 *
 * 这是"用户真实跑的命令"测试,不是程序内 import 调用。
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const RXX_ROOT = resolve(__dirname, "..", ".."); // apps/rxx
const RXX_BIN = join(RXX_ROOT, "dist", "index.js");

// server 由 globalSetup 起,RXX_HOME 也由 globalSetup 设
const tmpHome = process.env.RXX_HOME!;
const baseUrl = process.env.RXX_SERVER_BASE ?? "http://127.0.0.1:9966";

/** 跑 rxx CLI 命令,返回 { stdout, stderr, code }。 */
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

// server 由 globalSetup 起,这里不再起/停

describe("端到端:init + run + list + remove", () => {
  it("init demo-orders(验签 + 缓存 + skill + shim)", async () => {
    const { stdout, code } = await runRxx([
      "init",
      `${baseUrl}/manifests/demo-orders`,
      "--insecure",
      "--private-endpoints",
      "--yes",
    ]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim().split("\n").pop()!);
    expect(out.ok).toBe(true);
    expect(out.data.installed).toBe(true);
    expect(out.data.name).toBe("demo-orders");
    expect(out.data.commands).toBe(3);
    expect(out.data.skillSynced).toBeGreaterThan(0);
  });

  it("list 显示已装服务", async () => {
    const { stdout, code } = await runRxx(["list"]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.data.count).toBe(1);
    expect(out.data.services[0].name).toBe("demo-orders");
    expect(out.data.services[0].signatureVerified).toBe(true);
  });

  it("run orders list(标准分页 hasMore/nextCursor)", async () => {
    const { stdout, code } = await runRxx(["run", "demo-orders", "orders", "list", "--limit", "3"]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.ok).toBe(true);
    expect(out.source).toBe("demo-orders");
    expect(Array.isArray(out.data)).toBe(true);
    expect(out.data.length).toBe(3);
    expect(out.meta.pagination.complete).toBe(false);
    expect(out.meta.pagination.next_token).toBeDefined();
  });

  it("续拉分页(用 next_token)", async () => {
    // 先拿 next_token
    const first = await runRxx(["run", "demo-orders", "orders", "list", "--limit", "5"]);
    const nextToken = JSON.parse(first.stdout.trim()).meta.pagination.next_token;
    const { stdout, code } = await runRxx([
      "run",
      "demo-orders",
      "orders",
      "list",
      "--cursor",
      nextToken,
    ]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.data[0].id).toBe("ord_006"); // 第二页从第 6 条开始
  });

  it("run orders get <id>(path 占位符)", async () => {
    const { stdout, code } = await runRxx(["run", "demo-orders", "orders", "get", "ord_001"]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.data.id).toBe("ord_001");
  });

  it("404 映射成 not_found 错误", async () => {
    const { stderr, code } = await runRxx(["run", "demo-orders", "orders", "get", "ord_999"]);
    expect(code).toBe(1);
    const out = JSON.parse(stderr.trim());
    expect(out.ok).toBe(false);
    expect(out.error.subtype).toBe("not_found");
    expect(out.error.code).toBe(404);
  });

  it("path traversal 攻击被拒", async () => {
    const { stderr, code } = await runRxx([
      "run",
      "demo-orders",
      "orders",
      "get",
      "../../etc/passwd",
    ]);
    expect(code).toBe(2);
    const out = JSON.parse(stderr.trim());
    expect(out.ok).toBe(false);
    expect(out.error.subtype).toBe("missing_required");
    expect(out.error.message).toMatch(/path traversal/);
  });

  it("写操作:create order(POST + body 映射)", async () => {
    const { stdout, code } = await runRxx([
      "run",
      "demo-orders",
      "orders",
      "create",
      "--amount",
      "8888",
      "--customer",
      "alice",
    ]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.data.amount).toBe(8888);
    expect(out.data.customer).toBe("alice");
  });

  it("异构分页:demo-products(data.items + paging.next)", async () => {
    await runRxx([
      "init",
      `${baseUrl}/manifests/demo-products`,
      "--insecure",
      "--private-endpoints",
      "--yes",
    ]);
    const { stdout, code } = await runRxx([
      "run",
      "demo-products",
      "products",
      "list",
      "--limit",
      "2",
    ]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.data.length).toBe(2);
    expect(out.data[0].id).toMatch(/^prod_/);
    expect(out.meta.pagination.complete).toBe(false);
  });

  it("skill 已生成到 skills 目录", () => {
    const skillMd = join(tmpHome, "skills", "demo-orders", "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
  });

  it("remove 清理干净", async () => {
    const { stdout, code } = await runRxx(["remove", "demo-orders"]);
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim());
    expect(out.data.removed).toBe(true);

    // list 里没了
    const listOut = await runRxx(["list"]);
    const list = JSON.parse(listOut.stdout.trim());
    expect(list.data.count).toBe(1); // 还剩 demo-products
    expect(list.data.services.find((s: any) => s.name === "demo-orders")).toBeUndefined();
  });

  it("run 未装服务给正确提示", async () => {
    const { stderr, code } = await runRxx(["run", "demo-orders", "orders", "list"]);
    expect(code).toBe(2); // validation/missing_config
    expect(stderr).toMatch(/not installed/);
  });
});

// ============================================================================
// 动态注册:服务端运行时新增一个 rxx 代码里完全不存在的服务,客户端零改动可用
// ============================================================================

/** 向 server 注册一个全新服务。 */
async function registerDynamicService(spec: Record<string, unknown>): Promise<void> {
  await fetch(`${baseUrl}/__admin/manifests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
}

describe("动态注册:运行时新增服务,客户端零改动", () => {
  it("注册 demo-tasks → init → list → get → create 全流程", async () => {
    // 1. 服务端动态注册一个全新服务(rxx 代码里不存在 demo-tasks)
    await registerDynamicService({
      service: "demo-tasks",
      description: "任务管理(运行时动态注册)",
      version: "0.3.0",
      resources: {
        tasks: {
          description: "查询任务列表",
          fields: {
            title: { type: "string", required: true, desc: "任务标题" },
            done: { type: "boolean", desc: "是否完成" },
          },
          seed: [
            { id: "task_001", title: "写文档", done: false },
            { id: "task_002", title: "修bug", done: true },
            { id: "task_003", title: "发版", done: false },
          ],
        },
      },
    });

    // 2. 客户端 init(不重新 build,零改动)
    const initOut = await runRxx([
      "init",
      `${baseUrl}/manifests/demo-tasks`,
      "--insecure",
      "--private-endpoints",
      "--yes",
    ]);
    expect(initOut.code).toBe(0);
    const initData = JSON.parse(initOut.stdout.trim().split("\n").pop()!);
    expect(initData.data.installed).toBe(true);
    expect(initData.data.name).toBe("demo-tasks");
    expect(initData.data.commands).toBe(3); // list + get + create

    // 3. list(seed 数据)
    const listOut = await runRxx(["run", "demo-tasks", "tasks", "list"]);
    expect(listOut.code).toBe(0);
    const listData = JSON.parse(listOut.stdout.trim());
    expect(listData.data.length).toBe(3);
    expect(listData.data[0].id).toBe("task_001");
    expect(listData.meta.pagination.complete).toBe(true);

    // 4. get(path 占位符,动态命令)
    const getOut = await runRxx(["run", "demo-tasks", "tasks", "get", "task_002"]);
    expect(getOut.code).toBe(0);
    const getData = JSON.parse(getOut.stdout.trim());
    expect(getData.data.title).toBe("修bug");

    // 5. create(动态字段 title/done)
    const createOut = await runRxx([
      "run",
      "demo-tasks",
      "tasks",
      "create",
      "--title",
      "新任务",
      "--done=true",
    ]);
    expect(createOut.code).toBe(0);
    const createData = JSON.parse(createOut.stdout.trim());
    expect(createData.data.title).toBe("新任务");

    // 6. 再 list 验证 create 生效
    const list2Out = await runRxx(["run", "demo-tasks", "tasks", "list"]);
    const list2Data = JSON.parse(list2Out.stdout.trim());
    expect(list2Data.data.length).toBe(4);
  });

  it("动态服务的 skill 也正确生成", () => {
    const skillMd = join(tmpHome, "skills", "demo-tasks", "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
  });

  it("动态服务的 404 也正确映射(错误契约一致)", async () => {
    const { stderr, code } = await runRxx(["run", "demo-tasks", "tasks", "get", "nonexistent"]);
    expect(code).toBe(1);
    const err = JSON.parse(stderr.trim());
    expect(err.error.subtype).toBe("not_found");
  });

  it("动态服务的 path traversal 也被拦(安全契约一致)", async () => {
    const { stderr, code } = await runRxx([
      "run",
      "demo-tasks",
      "tasks",
      "get",
      "../../etc/passwd",
    ]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/path traversal/);
  });
});

// ============================================================================
// update 命令:对齐 init 的 --unsigned / --lang flags(B3 修复)
// ============================================================================

describe("update flags 对齐 init(--unsigned / --lang)", () => {
  it("update 接受 --unsigned flag(不再报 unknown flag)", async () => {
    // 先 init demo-orders(已签名)
    await runRxx([
      "init",
      `${baseUrl}/manifests/demo-orders`,
      "--insecure",
      "--private-endpoints",
      "--yes",
    ]);
    // update 带 --unsigned —— flag 被接受,不会因 unknown flag 报错
    const updateOut = await runRxx([
      "update",
      "demo-orders",
      "--insecure",
      "--private-endpoints",
      "--unsigned",
      "--yes",
    ]);
    expect(updateOut.code).toBe(0);
    const updateData = JSON.parse(updateOut.stdout.trim().split("\n").pop()!);
    expect(updateData.data.updated).toBe(true);
  });

  it("update --lang zh 生成的 skill 是中文(标题 ## 命令)", async () => {
    const updateOut = await runRxx([
      "update",
      "demo-orders",
      "--insecure",
      "--private-endpoints",
      "--lang",
      "zh",
      "--yes",
    ]);
    expect(updateOut.code).toBe(0);
    // 读生成的 skill 文件,验证含 zh 模板的中文标题(cli-sdk gen.ts zh 模板用 "## 命令")
    const skillMd = join(tmpHome, "skills", "demo-orders", "SKILL.md");
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(skillMd, "utf8");
    expect(content).toMatch(/## 命令/); // zh 模板的 commandsHeading
  });

  it("update --lang en 生成的 skill 是英文(标题 ## Commands)", async () => {
    const updateOut = await runRxx([
      "update",
      "demo-orders",
      "--insecure",
      "--private-endpoints",
      "--lang",
      "en",
      "--yes",
    ]);
    expect(updateOut.code).toBe(0);
    const skillMd = join(tmpHome, "skills", "demo-orders", "SKILL.md");
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(skillMd, "utf8");
    expect(content).toMatch(/## Commands/); // en 模板的 commandsHeading
  });
});
