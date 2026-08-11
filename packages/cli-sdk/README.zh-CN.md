# @renxqoo/agent-data-cli

[English](README.md) · [中文](README.zh-CN.md)

> Agent-native CLI framework —— 让 AI agent 结构化获取业务数据的命令行框架。
>
> 业务包只声明"调哪个后端接口、字段怎么处理",就获得鉴权、统一输出格式、错误分类、凭证、管道、skill 发现等全套能力。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![CI](https://github.com/renxqoo/rxcli/actions/workflows/ci.yml/badge.svg)](https://github.com/renxqoo/rxcli/actions/workflows/ci.yml)

---

## 为什么需要它

让 AI agent(或脚本、管道)消费你的业务数据时,有个核心矛盾:**后端接口千差万别**(REST/GraphQL/RPC、OAuth/API-key/mTLS、各种字段命名),但"把数据交给 agent 的方式"是通用的。

`agent-data-cli` 把前者交给业务包,后者收敛成框架能力:

```
┌─────────────────────────────────────────────────────────┐
│  @renxqoo/agent-data-cli  (本包,框架)                      │
│  鉴权 / 请求 / 统一输出 / 错误分类 / 凭证 / 管道 / skill │
├─────────────────────────────────────────────────────────┤
│  你的业务包  (依赖本包,只对接业务接口)                    │
│  例:@renxqoo/rxstock(A 股行情/财务/技术指标,公开数据)   │
│     @renxqoo/cli(订单/商品/发票,OAuth 鉴权)            │
├─────────────────────────────────────────────────────────┤
│  agent / 终端用户                                        │
│  unix 管道组合命令,读 skill 自服务发现                   │
└─────────────────────────────────────────────────────────┘
```

---

## 特性

- **🔐 鉴权工厂 `defineAuth`** —— OAuth 2.0 device flow(RFC 8628)+ 401 singleflight 自动刷新。一行配置,login/status/logout/register 命令自动注入。
- **📦 结构化统一输出** —— JSON 模式输出 `{ok, source, data, meta}`,stderr 是错误输出,exit code 分类；`defaultFormat` 可选择 JSON、人类文本或 TTY 自动模式。
- **🏷️ 9 类类型化错误** —— validation/authentication/permission/config/network/api/not_found/policy/internal,每类映射 exit code。
- **🔌 vite 式插件** —— prepare/observe/handle/transform 职责分离的生命周期钩子 + `provides` 自动贡献命令。
- **🔑 provider chain** —— flag/env/file/oauth 四级凭证解析优先级,业务自定义凭证源。
- **🚇 unix 管道** —— `rxcli orders list | rxcli report` 自动把上游统一输出格式拆成记录流。
- **📖 skill 系统** —— SKILL.md 命令文档自动生成,同步到用户已装的 AI agent 发现目录(`~/.agents` 始终写 + 探测到的 `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi`),供 AI agent 自服务发现。
- **🖥️ 双模输出** —— 默认 `auto`(TTY 文本、脚本/管道 JSON);`--json` / `--no-json` 显式覆盖；`defaultFormat` 可固定默认。
- **🧙 install 向导** —— 全局安装 + skills 装载 + 注册 + 登录引导,业务包拦截 `install` 命令即可。

### 实际业务包(基于本框架)

| 业务包                                           | 场景                       | 鉴权模式          | 看点                                                                  |
| ------------------------------------------------ | -------------------------- | ----------------- | --------------------------------------------------------------------- |
| [`@renxqoo/rxstock`](../../apps/a-stock)         | A 股行情/财务/技术指标     | 无(公开数据)      | 多源 fallback、统一 fallback 执行器、技术指标本地计算                 |
| [`@renxqoo/rx60s-cli`](../../apps/60s)           | 日常资讯(新闻/热搜/天气)   | 无(公开数据)      | rxopen 的旧版单 skill                                                 |
| [`@renxqoo/rxopen-cli`](../../apps/rxopen)       | 开放数据(新闻/热搜/天气)   | 无(公开数据)      | 60+ 接口来自 vikiboss/60s,通过 `skillsScopes` 按 6 个数据域拆分 skill |
| [`@renxqoo/rxcordys-cli`](../../apps/cordys-crm) | Cordys CRM(线索/合同/订单) | 静态双 header     | L2C 全流程,手写 auth 插件                                             |
| [`@renxqoo/cli`](../../apps/crm)                 | 公司业务(订单/商品)        | OAuth device flow | 中间层鉴权、split-flow 登录、install 向导                             |

---

## 安装

```bash
npm install @renxqoo/agent-data-cli
# 或
pnpm add @renxqoo/agent-data-cli
```

> **要求** Node.js >= 20
>
> 本包仅提供 ESM。请在 ESM 项目中使用 `import`/动态 `import()`；不支持 CommonJS `require()`。

---

## 快速开始(写一个业务包)

一个命令 < 30 行(无鉴权场景,如公开数据):

```ts
import { defineCli, defineCommand } from "@renxqoo/agent-data-cli";
import * as z from "zod";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = defineCli({
  name: "myapp",
  description: "我的数据 CLI",
  commands: {
    list: defineCommand({
      name: "list",
      description: "查询列表",
      args: {
        schema: z.object({
          limit: z.coerce.number().min(1).max(100).default(20),
        }),
      },
      async run(ctx, args) {
        const res = await ctx.get<{ items: Array<{ id: string; title: string }> }>("/items", {
          limit: args.limit,
        });
        return { data: res.data.items, meta: { count: res.data.items.length } };
      },
    }),
  },
});

// bin 入口检测(realpathSync 避免 npm 全局安装软链失配)
function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isMainEntry()) app.run(process.argv.slice(2));
export default app;
```

> 完整无鉴权示例见实际业务包 [`@renxqoo/rxstock`](../../apps/a-stock)(A 股数据,多源 fallback)。
> 鉴权场景(对接 OAuth 后端)见 [`@renxqoo/cli`](../../apps/crm)。

加鉴权(一行):

```ts
import { defineCli, defineAuth } from "@renxqoo/agent-data-cli";

const auth = await defineAuth({
  credentialNamespace: "orders",
  baseUrl: "https://auth.example.com",
  scope: "orders.read offline_access", // 业务自定,无默认值
});

export default defineCli({
  name: "orders",
  plugins: [auth], // ← 钩子 + login/status/logout/register 全自动注入
  commands: {},
  // ...
});
```

→ `rxcli auth login` / `rxcli auth status` / `rxcli auth logout` / `rxcli auth register` 自动可用,无需手挂命令。

---

## 核心 API

### `defineCli(options)` — 装配业务包

```ts
defineCli({
  name: 'orders',                  // 必填:命名空间
  description: '...',              // 必填
  plugins: [authPlugin],           // 可选:插件(auth/日志/审计...)
  commands: { list, get },         // 必填:顶层命令 → rxcli list
  namespaces: { orders: {...} },   // 可选:子命名空间 → rxcli orders list
  baseUrl: 'https://api.x.com',    // 可选:后端地址
  errorOnStatus: { 404: 'not_found', '5xx': 'server_error' },  // 可选
  defaultFormat: 'auto',           // 可选:'auto'(默认)|'json'|'human'
  skillsDir: './skills',           // 可选:skill 目录
  skillsTargets: [...],            // 可选:skill 同步目标(省略=默认 7 个 agent 目录)
})
```

### `defineCommand(spec)` — 声明命令

```ts
import * as z from "zod";

defineCommand({
  name: "get",
  description: "查询单个订单",
  args: {
    schema: z.object({
      id: z.string().min(1).describe("订单 ID"),
      verbose: z.boolean().describe("详细输出").default(false),
    }),
    pos: ["id"],
  },
  humanFormat: (data, meta) => `订单: ${data.id}`, // 可选:--no-json 自定义文本
  async run(ctx, args) {
    // ctx.get/post/put/patch/delete —— 请求方法直接挂 ctx
    const res = await ctx.get(`/orders/${args.id}`);
    return { data: res.data };
  },
});
```

`args` 可省略；省略表示命令没有业务参数。声明 `args` 时，Zod object 是唯一的校验和
类型来源。`type` 省略时默认 `"argv"`，`pos` 只列出作为原生命令行位置参数读取的
schema 字段，不同时接受同名长 flag。组件化命令组可用 `defineCommands<State>({...})`
共享应用状态类型。

#### Zod JSON 参数

创建、更新或批量命令字段很多时，直接把 Zod 4 Schema 放入同一个 `defineCommand`：

```ts
import * as z from "zod";

const CreateOrder = z.strictObject({
  customerId: z.string(),
  amount: z.number().positive(),
});

defineCommand({
  name: "create",
  description: "创建订单",
  args: {
    type: "json",
    schema: CreateOrder,
  },
  policy: {
    mode: "write",
    dryRun: true,
    confirmation: "required",
    idempotency: "required",
  },
  async run(ctx, args) {
    return { data: (await ctx.post("/orders", args)).data };
  },
});
```

JSON 命令只能通过 `--input`、`--input-file` 或原生 stdin 提供一个完整 JSON 文档，不能与
业务 flags 混用。同一个 Zod Schema 提供类型推导、运行时校验和 `--input-schema` 发现，
不存在适配器或第二套校验协议。完整来源、安全限制和写策略见
[`docs/07-structured-input.md`](docs/07-structured-input.md)。

### `defineAuth(opts)` — OAuth 鉴权工厂

```ts
const auth = await defineAuth({
  credentialNamespace: "crm", // → credentials/crm.json
  baseUrl: AUTH_BASE_URL, // OAuth 中间层
  scope: "company.api offline_access", // 业务自定,空=不带 scope
  // commandNamespace: 'auth',      // 默认 'auth' → rxcli auth login
  // authStyle: 'bearer',           // 默认 'bearer' | 'x-api-key' | 'basic'
});
```

返回一个 Plugin,塞进 `plugins: [auth]` 即:钩子生效 + auth 命令自动挂载。

### Plugin(钩子 + provides)

```ts
const myPlugin: Plugin = {
  name: "audit",
  enforce: "pre", // 'pre' | 'post'(默认 normal)
  provides: {
    // 可选:贡献命令,defineCli 自动注入
    namespaces: { admin: { users: userCmd } },
    commands: { telemetry: telemetryCmd },
  },
  async beforeCommand(ctx) {
    /* 填 state */
  },
  async beforeRequest(ctx, req) {
    return { ...req, headers: { ...req.headers, "x-client": "my-cli" } };
  },
  async observeRequest(ctx, event) {
    /* 等待审计落盘；event.outcome 区分 response / network-error */
  },
  async handleUnauthorized(ctx, event) {
    /* 先刷新上下文会话，再显式要求重试 */
    return { action: "decline" };
  },
  async transformOutput(ctx, data) {
    return transformedData;
  },
  async observeError(ctx, err) {
    /* 只做 telemetry；void 永远不会吞掉错误 */
  },
  async handleError(ctx, err) {
    return { action: "replace", error: normalizedErr };
  },
};
```

> plugin `provides` 贡献的命令**自动豁免该 plugin 自身的 beforeCommand**(精确豁免),不豁免别的 plugin。无需手写 `internal: true`。

---

## 输出契约

**成功**(stdout):

```json
{"ok":true,"identity":"user","data":{"orders":[...]},"meta":{"count":2,"pagination":{"complete":true}}}
```

**错误**(stderr):

```json
{
  "ok": false,
  "error": { "type": "api", "subtype": "not_found", "message": "订单不存在", "hint": "检查 ID" }
}
```

**exit code 映射**(框架按错误类别自动设,agent 可据此判断处理策略):

| code | 类别                                    | 含义                           |
| ---- | --------------------------------------- | ------------------------------ |
| 0    | —                                       | 成功                           |
| 1    | api                                     | 服务端业务错误(404/500/429 等) |
| 2    | validation                              | 参数不合法                     |
| 3    | authentication / authorization / config | 需登录 / 缺权限 / 配置缺失     |
| 4    | network                                 | DNS / 超时 / 拒绝              |
| 5    | internal                                | SDK 内部错误(几乎不该发生)     |
| 6    | policy                                  | 风控拦截                       |
| 10   | confirmation                            | 高危写入需 `--yes`             |

9 类类型化错误:`ValidationError` / `AuthenticationError` / `PermissionError` / `ConfigError` / `NetworkError` / `APIError`(`NotFoundError` 子类)/ `PolicyError` / `InternalError` / `ConfirmationRequiredError`。永远用 `errs.*` 构造,不要 `throw new Error()`(会被降级成 internal/unknown)。

---

## `--json` / `--no-json` 输出模式

| 模式                     | 行为                                              |
| ------------------------ | ------------------------------------------------- |
| 默认(`auto`)             | stdout 是 TTY(终端)→ 文本;非 TTY(管道/脚本)→ JSON |
| `--json`                 | 强制 JSON 统一输出                                |
| `--no-json`              | 强制文本(管道保护:stdin 非 TTY 时仍 JSON)         |
| `defaultFormat: 'human'` | 业务设默认文本                                    |
| `defaultFormat: 'json'`  | 业务设默认 JSON                                   |

`--no-json` 文本模式:框架自动识别数据结构出表格(对象数组→表格 / 单对象→key:value / scalar 数组→序号列表),命令可选 `humanFormat` 精致化(¥/中文列名/翻译)。CJK 字符按显示宽度对齐。

---

## 文档

### 设计文档(随包发布,`docs/` 目录)

| 文档                                          | 内容                                    |
| --------------------------------------------- | --------------------------------------- |
| [`00-overview.md`](docs/00-overview.md)       | 架构、分层、决策清单                    |
| [`01-cli-usage.md`](docs/01-cli-usage.md)     | 命令调用、管道、分页、exit code         |
| [`02-sdk-guide.md`](docs/02-sdk-guide.md)     | SDK 用法、ctx 接口、钩子                |
| [`03-envelopes.md`](docs/03-envelopes.md)     | 统一输出字段契约                        |
| [`04-errors.md`](docs/04-errors.md)           | 9 类错误、何时 throw                    |
| [`05-credentials.md`](docs/05-credentials.md) | provider chain、自定义凭证              |
| [`06-skills.md`](docs/06-skills.md)           | skill 系统、命令文档自动生成(`--lang en | zh`) |

### Agent Skill:agent-cli-builder

npm 包默认发布英文版 [`agent-cli-builder`](skills/agent-cli-builder/SKILL.md)，指导 AI Agent 完成事实确认、最小 CLI 设计、鉴权、结构化输出、类型化错误、Skill 分发、测试、打包和生产验收。

中文版源码保存在 [`agent-cli-builder-zh-CN`](agent-cli-builder-zh-CN/SKILL.md)，仅提交到 GitHub，不参与 TypeScript 构建，也不进入 npm 包。

包含进阶参考:

- [`core-api.md`](agent-cli-builder-zh-CN/references/core-api.md) — 项目结构、核心 API、入口和输出契约
- [`auth-patterns.md`](agent-cli-builder-zh-CN/references/auth-patterns.md) — defineAuth / split-flow 登录 / 注册
- [`patterns.md`](agent-cli-builder-zh-CN/references/patterns.md) — 分页续拉 / 管道下游 / humanFormat
- [`skill-optimization.md`](agent-cli-builder-zh-CN/references/skill-optimization.md) — TRACE 生产审查
- [`testing.md`](agent-cli-builder-zh-CN/references/testing.md) — 单测、端到端、打包和前向评测

---

## 开发

```bash
pnpm install        # 装依赖
pnpm build          # 构建
pnpm typecheck      # 类型检查
pnpm test           # 跑测试(vitest)
```

提交 PR 或问题前，请阅读[贡献指南](https://github.com/renxqoo/rxcli/blob/main/CONTRIBUTING.md)、[安全策略](https://github.com/renxqoo/rxcli/blob/main/SECURITY.md)和[支持说明](https://github.com/renxqoo/rxcli/blob/main/SUPPORT.md)。

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
