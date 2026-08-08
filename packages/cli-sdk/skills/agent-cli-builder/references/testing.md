# 测试进阶:createTestCtx 全套用法

> 主 SKILL.md 给了基础用法,这里讲 mock transport / mock store / 测 auth 插件 / 测错误 / 端到端(端到端跑整 CLI)。

---

## 1. createTestCtx 的本质

```ts
import { createTestCtx } from '@renxqoo/agent-data-cli'

const ctx = createTestCtx({
  request: async (opts) => { /* mock transport */ },
  state: {},       // 初始 state
  log: ...,        // 可选:默认静默
  pipe: ...,       // 可选:默认空管道
})
```

**它做的事**:

- 包装 mock 的 `request` 函数成 Transport
- 把 Transport 注入 `createContext`(请求方法都走 mock 的 request)
- 返回完整 `CommandContext`(业务包直接拿来调 `run(args, ctx)`)

**为什么 mock request 而不是 mock get/post** —— 高层 get/post/put 都走低层 request,mock 一个就覆盖全部业务逻辑。

---

## 2. mock request 的模式

### 2.1 按 path 分发

```ts
const ctx = createTestCtx({
  request: async (opts) => {
    if (opts.path === "/todos")
      return { status: 200, data: { items: [{ id: "t_1" }] }, headers: {} };
    if (opts.path.startsWith("/todos/"))
      return { status: 200, data: { id: "t_1", done: false }, headers: {} };
    throw new Error(`unexpected ${opts.method} ${opts.path}`);
  },
});
```

### 2.2 捕获请求参数

```ts
it("--limit 透传 query", async () => {
  let captured: {
    method?: string;
    path?: string;
    query?: Record<string, unknown>;
    body?: unknown;
  } = {};
  const ctx = createTestCtx({
    request: async (opts) => {
      captured = opts;
      return { status: 200, data: { items: [] }, headers: {} };
    },
  });
  await todosCommands.list.run({ limit: 5 }, ctx);
  expect(captured.query).toEqual({ limit: 5 });
});
```

### 2.3 模拟错误(status 非 2xx)

```ts
it("404 → NotFoundError", async () => {
  const ctx = createTestCtx({
    request: async () => ({ status: 404, data: { message: "not found" }, headers: {} }),
  });
  // 注意:如果命令 run 里没手写 if (status===404) → 不会自动 throw,需要 errorOnStatus
  // 这里测的是命令自己抛错的逻辑
  await expect(todosCommands.get.run({ id: "x" }, ctx)).rejects.toMatchObject({
    category: "api",
    subtype: "not_found",
  });
});
```

**注意**:createTestCtx 的 mock transport **不跑** `errorOnStatus`(那是 defineCli 装配时的逻辑)。要测 errorOnStatus 行为,需要用 `defineCli` 装配 + 端到端测试(见 §6)。

---

## 3. mock store(测 auth 插件用)

```ts
import { memoryStore } from "@renxqoo/agent-data-cli";

const store = memoryStore({
  credentials: {
    "my-cli": { apiKey: "sk_test_123" },
  },
  config: { clientId: "test_client" },
});

// 把 store 注入 auth Plugin
const auth = createMyAuth({ namespace: "my-cli", store, authStyle: "bearer" });

// 跑 beforeCommand 验证状态被填
const ctx = createTestCtx({ state: {} as { user?: unknown } });
await auth.beforeCommand!(ctx);
expect((ctx as any)._authToken).toBe("sk_test_123");
expect((ctx.state as any).user).toEqual({ userId: "u_test" });
```

---

## 4. mock pipe(测下游命令)

```ts
import type { PipeApi, PipeRecord } from "@renxqoo/agent-data-cli";

function mockPipe(records: PipeRecord[]): PipeApi {
  return {
    async *in() {
      for (const r of records) yield r;
    },
    isInPipe() {
      return true;
    },
  };
}

it("从管道读上游记录", async () => {
  const ctx = createTestCtx({
    pipe: mockPipe([
      { type: "orders", id: "o_1001", data: { id: "o_1001" } },
      { type: "orders", id: "o_1002", data: { id: "o_1002" } },
    ]),
    request: async (opts) => {
      if (opts.path === "/invoices") return { status: 200, data: { id: "inv_1" }, headers: {} };
      throw new Error(`unexpected ${opts.path}`);
    },
  });
  const result = await invoicesCommands.generate.run({}, ctx);
  expect(result!.data).toEqual({ generated: 2 });
});
```

---

## 5. mock log(检查日志输出)

```ts
const logs: string[] = [];
const ctx = createTestCtx({
  log: {
    info: (m) => logs.push(`info:${m}`),
    warn: (m) => logs.push(`warn:${m}`),
    error: (m) => logs.push(`error:${m}`),
  },
});

await myCommand.run({}, ctx);
expect(logs).toContain("info:开始查询");
```

---

## 6. 端到端测试(整 CLI + 信封渲染)

测试**完整链路**(parseArgs → 路由 → 插件钩子 → run → 信封序列化 → exit code),用 `app.run(argv)`:

```ts
import { defineCli } from "@renxqoo/agent-data-cli";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let stdoutBuf = "";
let stderrBuf = "";
beforeEach(() => {
  stdoutBuf = "";
  stderrBuf = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    stdoutBuf += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    stderrBuf += typeof chunk === "string" ? chunk : chunk.toString();
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("CLI 端到端", () => {
  it("list 输出 JSON 信封", async () => {
    const app = defineCli({
      name: "todos",
      description: "x",
      commands: {
        list: defineCommand({
          name: "list",
          description: "x",
          async run(args, ctx) {
            const res = await ctx.get<{ items: any[] }>("/todos");
            return { data: res.data.items };
          },
        }),
      },
      baseUrl: "https://test",
    });

    // mock 全局 fetch
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ items: [{ id: "t_1" }] })),
      headers: new Headers(),
    } as any);

    await app.run(["list"]);
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(stdoutBuf)).toEqual({
      ok: true,
      data: [{ id: "t_1" }],
    });
  });

  it("未知命令 → exit 2 + stderr 错误信封", async () => {
    const app = defineCli({
      name: "todos",
      description: "x",
      commands: {
        list: defineCommand({
          name: "list",
          description: "x",
          async run() {
            return { data: 1 };
          },
        }),
      },
    });
    await app.run(["bogus"]);
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(stderrBuf.trim()).error.subtype).toBe("invalid_argument");
  });
});
```

---

## 7. vitest 推荐配置

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false, // 用 import,不用 globals
  },
});
```

---

## 8. 测试常见错

1. **mock request 但忘了设 status** —— 默认 undefined,断言 status 字段会 fail。返回 `{ status: 200, data, headers }`。
2. **测命令 run 期望 throw 但用了 errorOnStatus** —— mock transport 不跑 errorOnStatus,要在命令 run 里手写 if 判断,或者端到端测试。
3. **createTestCtx 不传 state 但访问 ctx.state.X** —— TS 编译报错(`{}` 类型没 X)。传 `state: {} as MyState`。
4. **测试后没恢复 process.exitCode** —— 影响后续测试。加 `afterEach(() => { process.exitCode = undefined })`。
5. **mock fetch 没返回 headers 对象** —— 框架读 headers 会抛。用 `new Headers()` 或 `{}`。
