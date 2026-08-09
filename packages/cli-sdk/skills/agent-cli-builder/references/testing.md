# 测试进阶:createTestCtx 完整用法

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

## 6. 端到端测试(整 CLI + 统一输出格式渲染)

测试**完整链路**(parseArgs → 路由 → 插件钩子 → run → 统一输出序列化 → exit code),用 `app.run(argv)`:

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
  it("list 输出 JSON 统一输出", async () => {
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
      source: "todos",
      data: [{ id: "t_1" }],
    });
  });

  it("未知命令 → exit 2 + stderr 错误输出", async () => {
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
6. **只测 `command.run`** —— 会绕过 argv/schema、plugin lifecycle、统一输出格式与 source。参数、401、route ownership、输出契约至少各保留一个 `app.run(argv)` 端到端测试。
7. **返回 `{}` 仍断言成功** —— runtime 会报 `internal/contract_violation`；纯副作用返回 `void`，空业务结果返回 `{ data: null }`。

---

## 9. 真实任务验证(skill-creator 集成)

前 8 节均为不联网测试(mock transport / mock fetch),验证代码能否运行,但无法验证 skill 质量——agent 是否在该触发时触发?能否靠 SKILL.md 自发完成真实任务?输出是否正确?这些只能由真实任务评估回答。

### 测试三层分工

| 层 | 验证什么 | 是否联网 | 何时跑 |
| -- | -------- | :------: | ------ |
| 第 1 层 `createTestCtx` mock 单测 | 命令逻辑、参数透传、错误抛出 | 否 | CI(必需) |
| 第 2 层 `app.run(argv)` 端到端 | 装配/路由/统一输出格式/exit code | 否(mock fetch) | CI(必需) |
| 第 3 层 skill-creator 真实任务评估 | **skill 触发准确率 + agent 自发完成能力** | **是**(真实 API) | **发布前做一次,不进 CI** |

> 前两层进 CI 保证不退化;第三层慢、依赖网络/外部 API,只在发版前人工跑一轮。三层均不可省略——只做前两层,skill 可能"代码全对但 agent 用不起来"。

### 第 3 层:用官方 skill-creator 评估闭环

完整流程基于 [skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator)。

> 下文给的是**方法论**(evals 怎么设计、expectations 怎么写、 analyst 看什么)——这些是稳定的评估套路。具体的脚本名、命令参数、文件结构(如 grading.json 的字段名)**以 skill-creator 当前实现为准**,官方会演进,不在此写死。

**① 写 evals.json**(3-5 个真实场景,每个含 prompt + 可客观验证的 expectations):

```json
{
  "skill_name": "rx-todos",
  "evals": [
    {
      "id": 1,
      "prompt": "帮我看看今天的待办有哪些",
      "expected_output": "列出当前用户的待办",
      "expectations": [
        "调用了 rx-todos CLI",
        "输出包含至少 1 条待办",
        "数据是真实的(非占位符)"
      ]
    }
  ]
}
```

**② 子代理并行跑 with-skill + baseline(无 skill)**:

每个 eval 同时起两个子代理——一个带着 SKILL.md(走你的 CLI),一个不给 skill(只能靠 --help 或其它方式)。两者都真实调 CLI → 真实 API,输出存到工作区按 eval/config 分目录。

```bash
# with-skill 子代理:先读 SKILL.md,再真实调 CLI
# baseline 子代理:不给 skill,只给 CLI 路径 + --help,看能否自发完成
```

**③ grading + 聚合 + 可视化**:

用 skill-creator 自带的脚本完成:评分(每个 expectation 判 pass/fail + evidence)→ 聚合统计(benchmark)→ 可视化(Outputs + Benchmark 两 tab 的 viewer)。具体脚本与参数见 skill-creator 的 `scripts/` 与 `eval-viewer/` 目录。

**④ analyst pass**:读 benchmark 找隐藏问题——
- **断言非区分性**:某 expectation 在 with/baseline 都通过(没区分出 skill 价值),说明断言太弱
- **高方差 eval**:同配置多次跑 pass 率波动大(可能 flaky)
- **耗时/token 权衡**:skill 是否值得多花的开销

### 设计 expectations 的关键:区分性

经验提示——不要只测「调用了 CLI」。若 CLI 的 `--help` 足够完善,baseline 不靠 skill 也能通过(它会探索 --help 找到命令)。此类断言 with/baseline 均通过,无法区分 skill 价值。

能区分 skill 价值的断言示例:
- 正例 "输出了正确的非显然参数值"(如翻译的目标语言代码 `zh-CHS`,光靠 --help 猜不到)
- 正例 "避免了默认值陷阱"(如 `--symbols` 默认关,skill 提醒了,baseline 可能漏)
- 正例 "多步串联"(先 `rank` 拿 ID 再 `rank-detail`,需要 skill 教工作流)
- 正例 "模糊意图映射"('离放假还有几天' → `moyu`,光看命令名猜不到)
- 反例 "调用了 CLI"(太弱,baseline 靠 --help 也能过)
- 反例 "返回了 N 条数据"(太弱,只要调通就有)

### 何时不必跑第 3 层

- 命令极少(<3 个)且参数都直白的简单 CLI:mock + 端到端够用
- 纯内部工具、无 agent 调用场景:skill 质量无所谓

但凡 skill 要给 AI agent 用(发布出去让别人装),发布前至少跑一轮第 3 层。
