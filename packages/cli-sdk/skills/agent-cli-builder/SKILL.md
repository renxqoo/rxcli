---
name: agent-cli-builder
description: 用 @renxqoo/agent-data-cli 框架从零构建 agent-native 命令行数据查询工具(新的 CLI 业务包)——产物是供 AI agent 自服务调用的命令行程序,不是用已有 CLI 查数据。当用户要新建/做一个 CLI 或业务包、把某个后端 API 或内部接口封装成命令行给 AI agent 用、写命令行工具来拉取某接口的数据,或给已有 CLI 增加鉴权、登录、信封、分页、skill 文档等能力时触发。覆盖"做个拉数据的命令"、"给 agent 加个数据接口"、"把这个接口包成/封成命令行"、"写个工具调这个 API"等说法——即使用户没说出 cli / 业务包 / 框架名也要触发。
---

# agent-cli-builder

`@renxqoo/agent-data-cli`(下称 **agent-data-cli**)是一个 agent-native CLI 框架。你**只声明**"调哪个后端接口、字段怎么处理",框架就给你请求层、信封、错误分类、参数解析、管道、skill 发现等全套能力。鉴权是**可选**的(公开数据 CLI 不需要,见 `references/auth-patterns.md`)。

读完这个 skill,你会:

- 知道 agent-data-cli 给了你哪些"白送的"能力
- 5 分钟内写出一个能跑的无鉴权 CLI(单文件 <30 行)
- 输出符合 agent 解析的 `{ok,data,meta}` 信封
- 给 agent 写一份 SKILL.md 让它自服务发现
- 需要登录时,知道去哪读鉴权方案(渐进式披露)

---

## A. 先问清再动手(用户指令模糊时)

用户说"做个 CLI / 写个命令行"但信息不全时,**先问清这 6 点再动键盘**(不要猜着写——猜出来的代码看着能跑,但后端字段/分页约定猜错会埋隐性 bug):

| 必须问清                         | 默认(用户没明确时)                  | 怎么判断要追问                                                                                  |
| -------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| **查什么数据 / 调哪个后端 API?** | —                                   | 没给 baseUrl 或数据源 → 必问                                                                    |
| **命令名叫什么?**                | 给 2-3 个 `rx-<域>` 建议            | 见 §0 命名检查,有冲突风险必问                                                                   |
| **需要登录吗?**                  | **先无鉴权**(简单,多数数据查询够用) | 涉及敏感/私有数据才追问;要登录走 `references/auth-patterns.md`                                  |
| **数据要分页吗?**                | 不分页                              | 列表可能很大(>100 条)才追问                                                                     |
| **单域还是多域?**                | 单域(`commands`)                    | 有多个不相关资源类型(orders+products)才追问                                                     |
| **后端响应/分页字段长啥样?**     | —                                   | 给了 API 但没给响应体结构 → 必问,列 2-3 个候选问(别猜着写全兼容,见 `references/patterns.md` §1) |

**原则**:拿不准的(要不要 auth / 要不要分页)默认选**最简单方案**,做完再加。一条命令能跑通比一次性铺开重要。**但后端字段/分页约定不能猜**——猜错会埋隐性 bug,宁可多问一轮。

---

## 0. 命名前必查(框架不查,你自己查)

> 框架**没有任何命名冲突检测**——两个 CLI 用同一个 `credentialNamespace` 会**静默共享凭证文件**,bin 名撞了 npm 全局安装会互相覆盖。这些坑只能你在动手前人工查。

### 三个名字,各管什么

```
package.json "bin"     → 终端命令名(用户敲的,<bin> list)
defineCli({ name })    → 命名空间(PipeRecord.type、skill 标识、help 显示)
credentialNamespace    → 凭证文件名(~/.rxcli/credentials/<ns>.json,仅鉴权时)
```

三者**可不同**(框架不强制关联),但**推荐 bin 与 name 一致**避免混乱;`credentialNamespace` 用业务域名即可。

### 命名建议(基于业务域)

| 业务域             | 推荐 bin 名             | 推荐 credentialNamespace | 仓库已有                 |
| ------------------ | ----------------------- | ------------------------ | ------------------------ |
| 订单/CRM/公司应用  | `rxcli` 或 `rx-<域>`    | `<域>`(如 `crm`)         | `crm`(bin `rxcli`)       |
| 股票/行情/公开数据 | `rxstock` 等            | (无 auth 不用)           | `a-stock`(bin `rxstock`) |
| 通用建议           | `rx-<域>` 或 `<域>-cli` | `<域>`                   | —                        |

### 动手前 3 个必查项

- [ ] **bin 名没被占**:`ls apps/` 看目录名是否已存在;`npm ls -g <bin名>` 看全局有没有同名包
- [ ] **credentialNamespace 没冲突**(要登录才查):看 `~/.rxcli/credentials/` 下有没有同名 `.json`——有就换名,否则两个 CLI 会共用一份凭证
- [ ] **monorepo 目录没被占**:`apps/<你的目录名>/` 不存在

查完确定名字再进 §1。

---

## 1. 5 分钟上手:最小可运行 CLI(无鉴权,默认主路径)

> 下面用 `rx-todos` 做例子(命名检查已通过)。**无鉴权是默认推荐路径**——公开 API / 内网服务都走这个。

```bash
mkdir rx-todos && cd rx-todos
pnpm init
pnpm add @renxqoo/agent-data-cli
mkdir -p src/commands
```

`package.json`(注意 `bin` 名要和你在 §0 确定的一致):

```jsonc
{
  "name": "rx-todos",
  "version": "1.0.0",
  "type": "module",
  "bin": { "rx-todos": "./dist/index.js" },
  "main": "./dist/index.js",
  "files": ["dist", "skills"],
  "scripts": { "build": "tsc" },
  "dependencies": { "@renxqoo/agent-data-cli": "^1.0.0" },
}
```

`src/commands/todos.ts`:

```ts
import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";

export const todosCommands = defineCommands({
  list: defineCommand({
    name: "list",
    description: "查询待办列表",
    args: { limit: { type: "number", default: 20, desc: "返回数量上限" } },
    async run(args, ctx) {
      const res = await ctx.get<{ items: Array<{ id: string; title: string; done: boolean }> }>(
        "/todos",
        { limit: args.limit },
      );
      return { data: res.data.items };
    },
  }),

  complete: defineCommand<{ id: string }>({
    name: "complete",
    description: "把待办标记为完成",
    args: { id: { type: "string", required: true, positional: true, desc: "待办 ID" } },
    async run({ id }, ctx) {
      const res = await ctx.patch(`/todos/${id}`, { done: true });
      if (res.status === 404) throw new errs.NotFoundError(`待办 ${id} 不存在`);
      return { data: res.data };
    },
  }),
});
```

`src/index.ts`:

```ts
#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineCli } from "@renxqoo/agent-data-cli";
import { todosCommands } from "./commands/todos.js";

const app = defineCli({
  name: "rx-todos", // ★ 命名空间(与 §0 一致)
  binName: "rx-todos", // ★ 终端命令名(建议显式声明,别靠自动探测)
  description: "通过 CLI 查询和管理待办",
  baseUrl: process.env.TODOS_API ?? "https://api.example.com",
  commands: todosCommands,
  errorOnStatus: { 404: "not_found", "5xx": "server_error" },
});

// ★ 用 realpathSync 比对入口:npm 全局安装时 argv[1] 是 bin 软链,
//   简单的 `import.meta.url === file://${argv[1]}` 会失配导致命令不执行。
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

```bash
pnpm tsc                # 编译到 dist/
node dist/index.js list
# {"ok":true,"data":[...]}    ← 默认 JSON 信封(给 agent)
node dist/index.js list --no-json
# 表格(给人看)
```

**搞定。** 请求层、错误分类、信封、退出码全部白送。

> **需要登录?** 别在这里展开——读 `references/auth-patterns.md`(`defineAuth` 工厂、OAuth split-flow 登录、register、install 向导全在那)。鉴权是可选的进阶能力。

---

## 2. 心理模型:框架给了你什么

```
┌────────────────────────────────────────────────┐
│ 你写:defineCli + defineCommand(业务声明)        │
│      ↓                                          │
│ 框架给:                                          │
│   - 请求层 ctx.get/post/...(鉴权时带 401 续期) │
│   - 信封:stdout={ok,data,meta} / stderr=错误   │
│   - 9 类类型化错误 + exit code 映射             │
│   - 参数解析 + 类型校验 + 默认值                 │
│   - --json / --no-json 双模输出                 │
│   - 管道:上游 stdout 自动变 PipeRecord          │
│   - skill:list/read/sync/gen 命令自动注入       │
│   - qrcode 命令自动注入(登录扫码用)            │
└────────────────────────────────────────────────┘
```

**契约铁律:**

- stdout 永远只有信封 JSON(成功)或 SKILL.md 原文(成功侧的明示例外)
- stderr 是日志 + 错误信封
- 业务命令**不能**直接 `console.log` 到 stdout(会破坏管道)

---

## 3. 你必须知道的 5 个 API

### ① `defineCli(options)` —— 装配入口

```ts
defineCli({
  name: "rx-todos", // 必填:命名空间(见 §0)
  binName: "rx-todos", // 可选:终端命令名(建议显式声明;不填则从 package.json bin 自动探测)
  description: "...", // 必填
  baseUrl: "https://api.x.com", // 可选:后端地址
  commands: { list, get }, // 必填:顶层命令
  namespaces: { users: userCommands }, // 可选:子命名空间
  plugins: [auth], // 可选:鉴权等扩展(无需登录则空/省略)
  errorOnStatus: { 404: "not_found" }, // 可选:status→自动 throw
  defaultFormat: "auto", // 可选:'auto' | 'json' | 'human'(详见 §6)
  skillsDir: "./skills", // 可选:启用 skill 系统
  skillsSource: process.env.X_SKILLS_SOURCE, // 可选:install 向导用它决定 skills 来源
});
```

> ⚠️ **`plugins: [auth]` 里的 `auth` 必须是已 resolve 的 Plugin,不能是 Promise。**
> `defineAuth` 是 **`async`** 函数(返回 `Promise<Plugin>`),所以**永远 `await`**:
>
> ```ts
> // ✅ 正确
> const auth = await defineAuth({ credentialNamespace, baseUrl, scope })
> defineCli({ plugins: [auth], ... })
>
> // ❌ 错误(运行即崩,且无报错)
> const auth = defineAuth({ ... })   // 忘 await → auth 是 Promise
> defineCli({ plugins: [auth], ... }) // 挂了个 Promise → beforeCommand 不跑 → 鉴权全废
> ```
>
> 这是鉴权场景**最高频的 bug**——见 `references/auth-patterns.md` 所有示例都 `await`。

### ② `defineCommand(spec)` —— 声明单个命令

```ts
defineCommand({
  name: "list", // 必填
  description: "...", // 必填
  args: {
    // 可选:参数规范
    id: { type: "string", required: true, positional: true, desc: "订单 ID" },
    limit: { type: "number", default: 20, desc: "返回数量" },
    dryRun: { type: "boolean", desc: "只预览不执行" },
  },
  async run(args, ctx) {
    const res = await ctx.get<TResponse>("/path", args);
    return { data: res.data, meta: {/* 分页等 */} };
  },
});
```

**`args` 类型 4 种**:`string` / `number` / `boolean` / `array`。`positional:true` 表示无 flag(直接 `<id>`)。**每个 arg 都填 `desc`**——进自动生成的命令文档。

> **boolean 默认值坑**:不带 `default` 的 boolean(如上 `dryRun`),用户没传 flag 时 `args.dryRun` 是 **`undefined`,不是 `false`**。所以用 `if (args.dryRun)` 判断(真值检查),别写 `=== false`。要拿到确定的 `false`,加 `default: false`。

### ③ `ctx` —— 命令运行时上下文

```ts
interface CommandContext<State> {
  get<T>(path, query?): Promise<{status, data: T, headers}>   // 都自动带鉴权(若有 auth 插件)
  post / put / patch / delete 同上
  request<T>(opts): Promise<{status, data: T, headers}>        // 低层兜底
  state: State                          // 插件间共享数据(auth 填 user)
  log: { info, warn, error }            // 强制写 stderr,绝不污染 stdout
  pipe: { in(): AsyncIterable<PipeRecord>; isInPipe(): boolean }
  credentials: { get, save, clear }     // 运行时读写凭证(仅鉴权时)
}
```

### ④ `errs.*` —— 9 类类型化错误

**永远用 `errs.*`,绝不要 `throw new Error(...)`!** 裸 Error 被兜底成 `internal/unknown`(exit 5),agent 会误解成 SDK bug。

```ts
import { errs } from "@renxqoo/agent-data-cli";
throw new errs.ValidationError({
  subtype: "invalid_argument",
  param: "--limit",
  message: "必须为正数",
  hint: "使用 --limit 30",
});
throw new errs.NotFoundError(`订单 ${id} 不存在`); // 404 快捷写法
throw new errs.PermissionError({
  subtype: "missing_scope",
  missingScopes: ["orders:read"],
  message: "...",
  hint: "...",
});
```

| Category         | Exit | 何时用                             |
| ---------------- | :--: | ---------------------------------- |
| `validation`     |  2   | 参数不合法                         |
| `authentication` |  3   | 没登录                             |
| `authorization`  |  3   | 登录了但缺权限(scope)              |
| `config`         |  3   | 本地配置缺失                       |
| `network`        |  4   | DNS / 超时 / 拒绝                  |
| `api`            |  1   | 服务端业务错误(404/500/429)        |
| `policy`         |  6   | 风控拦截                           |
| `internal`       |  5   | SDK 不该发生的事(几乎不该你 throw) |
| `confirmation`   |  10  | 高危写入需要 --yes                 |

> 全部 30+ subtype 速查 + `errorOnStatus` 推荐配置见 `references/error-catalog.md`。

### ⑤ 返回值契约

```ts
async run(args, ctx): Promise<CommandResult | void> {
  return {
    data: <结构化数据>,                // 必填(有数据时)
    meta: { count?: number, pagination?: { complete, nextToken }, rollback?: string },
  }
}
```

纯副作用命令可 `return` 或不 return(`void` 合法)。**绝不直接 `console.log` 到 stdout**——要数据就 `return { data }`,要日志就 `ctx.log.info(...)`(写 stderr)。

---

## 4. 决策树:选对你的模式

```
你的 CLI 需要鉴权吗?
├─ 不需要(公开 API / 内网) → 直接 defineCli(本 skill 主路径,参考 a-stock)
└─ 需要 → 读 references/auth-patterns.md(defineAuth / split-flow / register / HMAC)

你的 CLI 有多个业务域吗?
├─ 单域(只有 todos) → commands = { ... }
└─ 多域(orders + products) → namespaces: { orders, products }

下游命令需要从管道读上游命令的输出吗?
├─ 不需要 → 忽略(多数场景)
└─ 需要 → 读 references/patterns.md(管道下游)
```

---

## 5. 模式速查(高频)

### 模式 1:多业务域(namespaces)

```ts
// src/index.ts
defineCli({
  name: "rx-shop",
  binName: "rx-shop",
  namespaces: {
    orders: ordersCommands, // → rx-shop orders list
    products: productsCommands, // → rx-shop products search
  },
});
```

**严禁**用 spread 把命令拍平(`...ordersCommands`)——同名命令(`list`/`get`)会互相覆盖,丢失命名空间层级。

### 模式 2:`errorOnStatus` 自动 throw

把常见 status→subtype 配在 defineCli 上,命令就不用手写 if:

```ts
defineCli({
  errorOnStatus: {
    404: "not_found", // → 自动 throw NotFoundError
    429: "rate_limited", // → 自动 throw APIError(retryable: true)
    "5xx": "server_error", // → 自动 throw APIError(retryable: true)
  },
});
```

> **配了 `errorOnStatus` 的 status,命令 run 里就别再手写 `if (res.status === 404)`** —— 框架在 `ctx.get` 返回**之前**就已 throw,你写的 404 分支**永远走不到**,是死代码。手写 if 只留给 `errorOnStatus` **没配**的 status(如 422 搜索语法错,各命令语义不同)。

> **进阶模式**(分页 `pagination`、管道下游 `ctx.pipe`、`humanFormat` 自定义表格)见 `references/patterns.md`——列表要给 agent 续拉、下游消费上游输出、`--no-json` 精致化时才读。

---

## 6. 输出契约 —— 给 agent 看的 stdout/stderr

| 内容                                              | 流         | 谁写                             |
| ------------------------------------------------- | ---------- | -------------------------------- |
| 成功信封 `{ok:true, data, meta}`                  | **stdout** | 框架(从你的 `return` 序列化)     |
| 错误信封 `{ok:false, error:{type, subtype, ...}}` | **stderr** | 框架(从你的 `throw errs.*` 渲染) |
| 日志(info/warn/error)                             | stderr     | `ctx.log.info(...)`              |
| SKILL.md 原文(`skills read` 输出)                 | stdout     | 框架(**明示例外**:不走信封)      |

> 成功信封还可能带可选顶层 `identity: 'user' \| 'bot'`(auth Plugin 填,标明调用者身份)和 `dry_run`(`--dry-run` 时)。业务包通常不用关心——只需 `return { data, meta }`,其余框架补。

**`--json` / `--no-json`**:默认 `auto`(TTY→文本表格;管道/CI→JSON);`--json` 强制 JSON,`--no-json` 强制文本(被管道时仍 JSON,保护 agent)。

**exit code**:业务包**不设**——框架按错误 category 自动设(0 成功;1 api;2 validation;3 auth/permission/config;4 network;5 internal;6 policy;10 confirmation)。

---

## 7. 写 SKILL.md —— 让 agent 自服务发现

加 `skillsDir: './skills'` 后,框架自动注入 4 个命令:`skills list` / `read` / `sync` / `gen`。

```bash
rx-todos skills gen rx-todos --init   # 首次:生成 SKILL.md 骨架(带 AUTO-GEN 命令表 + {{FILL}} 占位)
# 手工填语义部分(何时用、错误处理、前置条件)
rx-todos skills gen rx-todos          # 后续改命令:只刷 AUTO-GEN 块,语义部分不动
```

frontmatter `description` 决定 agent 何时触发——写清楚"何时用",别只写"是什么":

```yaml
---
name: rx-todos
description: 查询和管理待办。当用户需要查待办、看待办列表、标记待办完成时使用。
metadata:
  requires: { bins: ["rx-todos"] }
  category: business
---
```

**带鉴权的 CLI:生成的业务 SKILL.md 必须含 split-flow 登录指引**——否则 agent 直接 `auth login` 会卡死。模板见 `references/skill-gen.md`。

发布:`package.json` 的 `"files"` 含 `["dist", "skills"]`。

> 完整模板、AUTO-GEN 机制、签名规则见 `references/skill-gen.md`。

---

## 8. 测试

用 `createTestCtx` mock 请求层(mock 低层 `request`,高层 get/post 全覆盖),不需要起真实 server:

```ts
import { createTestCtx } from "@renxqoo/agent-data-cli";
const ctx = createTestCtx({
  request: async (opts) => ({ status: 200, data: { items: [{ id: "t_1" }] }, headers: {} }),
});
const result = await todosCommands.list.run({ limit: 20 }, ctx);
```

> 完整用法(mock store / mock pipe / 端到端测试)见 `references/testing.md`。

---

## 9. 开发者常犯的错(避坑)

1. **🔥 `defineAuth` 忘 `await`**(鉴权场景最高频、最致命)→ `auth` 变成 Promise,`plugins:[auth]` 挂的是 Promise 不是 Plugin,运行**即崩且无报错**(鉴权链全废)。**永远 `const auth = await defineAuth({...})`**。详见 §3①。
2. **`throw new Error(...)`** → 兜底成 `internal/unknown`(exit 5)。**永远用 `errs.*`**。
3. **`console.log` 到 stdout** → 破坏管道。用 `return { data }` 或 `ctx.log`(stderr)。
4. **不填 `pagination.complete`** → agent 误判已拉完。
5. **在 run 里处理鉴权** → 鉴权是 auth Plugin 的事,你只调 `ctx.get`。
6. **spread 命令组**(`...ordersCommands`) → 同名命令互相覆盖。用 `namespaces`。
7. **手写 SKILL.md 命令表** → 用 `skills gen <name>` 自动生成(语义部分手写)。
8. **boolean 不带 default 用 `=== false` 判断** → 未传时是 `undefined`。用 `if (args.x)`(见 §3②)。
9. **配了 `errorOnStatus` 还手写 `if (res.status===404)`** → 死代码(框架已 throw,走不到)。见 §5 模式 2。

> **鉴权相关坑**(要登录才看):credentialNamespace 撞名(静默共用凭证)、业务 SKILL.md 教 agent 直接跑 `auth login`(会卡死)——见 §0 命名必查 + `references/auth-patterns.md`。

---

## 10. 进阶(读 references,按需)

- **`references/auth-patterns.md`** —— **需要登录时读**:defineAuth 工厂、register、split-flow 登录、install 向导、凭证路径隔离、手写 auth Plugin(HMAC/mTLS)、provider chain
- **`references/patterns.md`** —— **列表要分页 / 管道下游 / humanFormat 时读**:pagination 续拉、`ctx.pipe` 消费上游、`printTable` 自定义表格
- `references/plugin-patterns.md` —— 自定义插件(钩子选择、enforce 顺序、onError 链)
- `references/skill-gen.md` —— SKILL.md 完整模板(含 split-flow 占位)、AUTO-GEN 机制、frontmatter 规范
- `references/error-catalog.md` —— 全部 30+ subtype 速查 + errorOnStatus 推荐配置
- `references/testing.md` —— createTestCtx 全套(mock transport/store/pipe、端到端测试)

---

## 11. 完成清单

- [ ] §0 命名检查通过(bin / credentialNamespace / apps 目录都不撞)
- [ ] `pnpm build` 编译通过
- [ ] 主要命令用 `createTestCtx` 测过
- [ ] 每个 `args` 都填了 `desc`
- [ ] 用了 `errs.*` 而非裸 Error
- [ ] 分页命令填了 `pagination.complete`
- [ ] `package.json` 的 `files` 含 `["dist", "skills"]`
- [ ] 跑 `skills gen <name> --init` 生成 SKILL.md 并填了语义部分
- [ ] **带鉴权的 CLI**:业务 SKILL.md 含 split-flow 登录指引
- [ ] **带鉴权的 CLI**:入口处理了 `install` 向导(拦截 `argv[0]==='install'`)
- [ ] **带鉴权的 CLI**:`defineAuth` 已 `await`(`const auth = await defineAuth(...)`,不是 `defineAuth(...)`)——见 §3① / §9 第 1 条
- [ ] 没往 stdout 写非信封内容
