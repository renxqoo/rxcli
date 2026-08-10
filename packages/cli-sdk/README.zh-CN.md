# @renxqoo/agent-data-cli

[English](README.md) · [中文](README.zh-CN.md)

> Agent-native CLI framework —— 让 AI agent 结构化获取业务数据的命令行框架。
>
> 业务包只声明"调哪个后端接口、字段怎么处理",就获得鉴权、统一输出格式、错误分类、凭证、管道、skill 发现等全套能力。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

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
- **🔌 vite 式插件** —— beforeCommand/beforeRequest/afterRequest/beforeOutput/onError 钩子 + `provides` 自动贡献命令。
- **🔑 provider chain** —— flag/env/file/oauth 四级凭证解析优先级,业务自定义凭证源。
- **🚇 unix 管道** —— `rxcli orders list | rxcli report` 自动把上游统一输出格式拆成记录流。
- **📖 skill 系统** —— SKILL.md 命令文档自动生成,同步到用户已装的 AI agent 发现目录(`~/.agents` 始终写 + 探测到的 `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi`),供 AI agent 自服务发现。
- **🖥️ 双模输出** —— 默认 `auto`(TTY 文本、脚本/管道 JSON);`--json` / `--no-json` 显式覆盖；`defaultFormat` 可固定默认。
- **🧙 install 向导** —— 全局安装 + skills 装载 + 注册 + 登录引导,业务包拦截 `install` 命令即可。

### 实际业务包(基于本框架)

| 业务包                                   | 场景                   | 鉴权模式          | 看点                                                  |
| ---------------------------------------- | ---------------------- | ----------------- | ----------------------------------------------------- |
| [`@renxqoo/rxstock`](../../apps/a-stock) | A 股行情/财务/技术指标 | 无(公开数据)      | 多源 fallback、统一 fallback 执行器、技术指标本地计算 |
| [`@renxqoo/rx60s-cli`](../../apps/60s)   | 日常资讯(新闻/热搜/天气) | 无(公开数据)    | 60+ 接口来自 vikiboss/60s,自动缓存 |
| [`@renxqoo/rxcordys-cli`](../../apps/cordys-crm) | Cordys CRM(线索/合同/订单) | 静态双 header | L2C 全流程,手写 auth 插件 |
| [`@renxqoo/cli`](../../apps/crm)         | 公司业务(订单/商品)    | OAuth device flow | 中间层鉴权、split-flow 登录、install 向导             |

---

## 安装

```bash
npm install @renxqoo/agent-data-cli
# 或
pnpm add @renxqoo/agent-data-cli
```

> **要求** Node.js >= 20

---

## 快速开始(写一个业务包)

一个命令 < 30 行(无鉴权场景,如公开数据):

```ts
import { defineCli, defineCommand } from "@renxqoo/agent-data-cli";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = defineCli({
  name: "myapp",
  description: "我的数据 CLI",
  commands: {
    list: defineCommand({
      name: "list",
      description: "查询列表",
      args: { limit: { type: "number", default: 20, desc: "返回数量上限" } },
      async run(args, ctx) {
        const res = await ctx.get<{ items: any[] }>("/items", { limit: args.limit });
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
defineCommand({
  name: "get",
  description: "查询单个订单",
  args: {
    id: { type: "string", required: true, positional: true, desc: "订单 ID" },
    verbose: { type: "boolean", desc: "详细输出" },
  },
  humanFormat: (data, meta) => `订单: ${data.id}`, // 可选:--no-json 自定义文本
  async run(args, ctx) {
    // ctx.get/post/put/patch/delete —— 请求方法直接挂 ctx
    const res = await ctx.get(`/orders/${args.id}`);
    return { data: res.data };
  },
});
```

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
    /* 加 header */
  },
  async afterRequest(ctx, res) {
    /* 审计 */
  },
  async beforeOutput(ctx, data) {
    return transformedData;
  },
  async onError(ctx, err) {
    return normalizedErr;
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
| `--json`                 | 强制 JSON 统一输出                                    |
| `--no-json`              | 强制文本(管道保护:stdin 非 TTY 时仍 JSON)         |
| `defaultFormat: 'human'` | 业务设默认文本                                    |
| `defaultFormat: 'json'`  | 业务设默认 JSON                                   |

`--no-json` 文本模式:框架自动识别数据结构出表格(对象数组→表格 / 单对象→key:value / scalar 数组→序号列表),命令可选 `humanFormat` 精致化(¥/中文列名/翻译)。CJK 字符按显示宽度对齐。

---

## 文档

### 设计文档(随包发布,`docs/` 目录)

| 文档                                          | 内容                            |
| --------------------------------------------- | ------------------------------- |
| [`00-overview.md`](docs/00-overview.md)       | 架构、分层、决策清单            |
| [`01-cli-usage.md`](docs/01-cli-usage.md)     | 命令调用、管道、分页、exit code |
| [`02-sdk-guide.md`](docs/02-sdk-guide.md)     | SDK 用法、ctx 接口、钩子        |
| [`03-envelopes.md`](docs/03-envelopes.md)     | 统一输出字段契约                    |
| [`04-errors.md`](docs/04-errors.md)           | 9 类错误、何时 throw            |
| [`05-credentials.md`](docs/05-credentials.md) | provider chain、自定义凭证      |
| [`06-skills.md`](docs/06-skills.md)           | skill 系统、命令文档自动生成(`--lang en|zh`)    |

### Agent Skill:agent-cli-builder

框架自带一个 AI Agent Skill([`skills/agent-cli-builder`](skills/agent-cli-builder/SKILL.md)),教 AI 如何用本框架从零构建 agent-native CLI 业务包。AI Agent 读它即可学会:5 分钟写出无鉴权 CLI、配置 OAuth 鉴权、多源 fallback、写 SKILL.md 让 Agent 自服务发现。这是"用 AI 做 CLI"的关键能力。

包含进阶参考:

- [`auth-patterns.md`](skills/agent-cli-builder/references/auth-patterns.md) — defineAuth / split-flow 登录 / register / HMAC
- [`patterns.md`](skills/agent-cli-builder/references/patterns.md) — 分页续拉 / 管道下游 / humanFormat
- [`error-catalog.md`](skills/agent-cli-builder/references/error-catalog.md) — 30+ subtype 速查 + errorOnStatus 配置
- [`testing.md`](skills/agent-cli-builder/references/testing.md) — createTestCtx 全套 mock

---

## 开发

```bash
pnpm install        # 装依赖
pnpm build          # 构建
pnpm typecheck      # 类型检查
pnpm test           # 跑测试(vitest)
```

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
