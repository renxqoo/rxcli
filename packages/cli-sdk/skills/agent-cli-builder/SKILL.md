---
name: agent-cli-builder
description: 用 @renxqoo/agent-data-cli 框架构建 agent-native CLI 的 skill——产物是供 AI agent 自服务发现并调用的命令行程序。何时触发:用户要新建/写一个 CLI 或命令行工具、把后端 API 或内部接口封装成命令行给 agent 用、把 API 包成 CLI、给已有 CLI 加鉴权/登录/统一输出/分页/skill 文档能力,或提到 agent-data-cli / cli-sdk 框架。覆盖"做个拉数据的命令""帮我写个 CLI""把这个 API 包一下"等说法——即使没说出 CLI / 框架名也触发。仅限用本框架构建 CLI;通用 skill 编写(不涉及 CLI/命令行)用 skill-creator。
---

# agent-cli-builder

`@renxqoo/agent-data-cli`(下称 **agent-data-cli**)是一个 agent-native CLI 框架。开发者声明"调哪个后端接口、字段怎么处理",框架提供请求层、统一输出格式、错误分类、参数解析、管道、skill 发现等实现。

---

## 1. 5 分钟上手:最小可运行 CLI(无鉴权,主路径)

> 无鉴权是默认推荐路径——公开 API / 内网服务都走这个。下面用 `rx-todos` 做例子。

```bash
mkdir rx-todos && cd rx-todos
pnpm init
pnpm add @renxqoo/agent-data-cli
mkdir -p src/commands
```

`package.json`(注意 `bin` 名要和你在 §2 确定的一致):

```json
{
  "name": "rx-todos",
  "version": "1.0.0",
  "type": "module",
  "bin": { "rx-todos": "./dist/index.js" },
  "main": "./dist/index.js",
  "files": ["dist", "skills"],
  "scripts": { "build": "tsc" },
  "dependencies": { "@renxqoo/agent-data-cli": "^1.0.0" }
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
      // 404 未配进 errorOnStatus → 在此手写 if 才可达(若已配则框架提前 throw,见 §5 模式 2)
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
  name: "rx-todos",          // 命名空间(与 §2 一致)
  binName: "rx-todos",       // 终端命令名(建议显式声明;不填则从 package.json bin 自动探测)
  description: "通过 CLI 查询和管理待办",
  baseUrl: process.env.TODOS_API ?? "https://api.example.com",
  commands: todosCommands,
  errorOnStatus: { "5xx": "server_error" }, // 5xx 自动 throw;404 留给命令自己处理(见上)
});

// npm 全局安装时 argv[1] 是 bin 软链,必须用 realpathSync 比对入口,否则命令不执行。
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
pnpm tsc
node dist/index.js list --json      # {"ok":true,"source":"rx-todos","data":[...]}   ← 给 agent
node dist/index.js list --no-json   # 表格(给人看)
```

此时请求层、错误分类、统一输出格式、退出码均已由框架实现。

> **需要登录?** 读 `references/auth-patterns.md`(`defineAuth` 工厂、OAuth split-flow 登录、register、install 向导)。鉴权为可选能力。

---

## 2. 动手前:问清 7 点 + 查命名

用户说"做个 CLI"但信息不全时,先问清再写代码。**行为决策**(auth / 分页)默认选最简单方案;**事实信息**(后端字段、分页约定、语言)不可猜测,须向用户确认——猜错会埋隐性 bug。

需要逐条向用户确认的问题:

1. **查什么数据 / 调哪个后端 API?**
   - 默认:无
   - 何时追问:没给 baseUrl 或数据源时必问

2. **命令名叫什么?**
   - 默认:给 `rx-<域>` 建议
   - 何时追问:见下命名检查,有冲突风险时必问

3. **需要登录吗?**
   - 默认:先无鉴权
   - 何时追问:涉及敏感/私有数据才追问;需登录则走 `references/auth-patterns.md`

4. **数据要分页吗?**
   - 默认:不分页
   - 何时追问:列表可能很大(>100 条)才追问

5. **单域还是多域?**
   - 默认:单域(`commands`)
   - 何时追问:有多个不相关资源类型(orders + products)才追问

6. **后端响应/分页字段长啥样?**
   - 默认:无
   - 何时追问:给了 API 但没给响应体结构时必问,列 2-3 个候选问;不要靠猜写全兼容(见 `references/patterns.md` §1)

7. **用什么语言?**(SKILL.md/错误信息/注释)
   - 默认:和用户提问的语言保持一致
   - 命令名/字段名/API path 始终用英文(程序接口)

### 命名检查(框架不查,你自己查)

> 框架**没有命名冲突检测**——两个 CLI 用同一个 `credentialNamespace` 会**静默共享凭证文件**,bin 名撞了 npm 全局安装会互相覆盖。

三个名字各管什么:

```
package.json "bin"      → 终端命令名(用户敲的,<bin> list)
defineCli({ name })     → 命名空间(PipeRecord.type、skill 标识、help 显示)
credentialNamespace     → 凭证文件名(~/.rxcli/credentials/<ns>.json,仅鉴权时)
```

三者可不同(框架不强制关联),**推荐 bin 与 name 一致**避免混乱。动手前查:

- [ ] **bin 名没被占**:`ls apps/` 看目录名;`npm ls -g <bin名>` 看全局有没有同名包
- [ ] **monorepo 目录没被占**:`apps/<你的目录名>/` 不存在
- [ ] **credentialNamespace 没冲突**(要登录才查):看 `~/.rxcli/credentials/` 下有没有同名 `.json`——有就换名,否则两个 CLI 共用一份凭证

---

## 3. 你必须知道的 5 个 API

### ① `defineCli(options)` —— 装配入口

```ts
defineCli({
  name: "rx-todos",       // 必填:命名空间(见 §2)
  binName: "rx-todos",    // 可选:终端命令名(建议显式;不填则从 package.json bin 自动探测)
  description: "...",     // 必填
  baseUrl: "https://api.x.com",          // 可选:后端地址
  commands: { list, get },               // 必填:顶层命令
  namespaces: { users: userCommands },   // 可选:子命名空间
  plugins: [auth],        // 可选:鉴权等扩展(无需登录则省略)
  errorOnStatus: { 404: "not_found" },   // 可选:status→自动 throw
  defaultFormat: "auto",  // 可选:'auto' | 'json' | 'human'(详见 §6)
  skillsDir: "./skills",  // 可选:启用 skill 系统
});
```

> **`plugins: [auth]` 中的 `auth` 必须是已 resolve 的 Plugin,不能是 Promise。**
> `defineAuth` 是 `async` 函数,必须 `await`:`const auth = await defineAuth({...})`。
> 缺 `await` 时 `plugins:[Promise]`,`beforeCommand` 不执行,鉴权失效,且无报错。详见 `references/auth-patterns.md`。

### ② `defineCommand(spec)` —— 声明单个命令

```ts
defineCommand({
  name: "list",          // 必填
  description: "...",    // 必填
  args: {
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

**`args` 类型 4 种**:`string` / `number` / `boolean` / `array`。`positional:true` 表示无 flag(直接 `<id>`)。**每个 arg 都填 `desc`**——进自动生成的命令文档。装配期拒绝矛盾 schema:不能同时 `required:true` 和 `default`;可选 positional 后不能再声明必填 positional。

> **boolean 默认值**:不带 `default` 的 boolean(如上 `dryRun`),用户未传 flag 时 `args.dryRun` 为 `undefined`,不是 `false`。应使用真值判断 `if (args.dryRun)`,避免 `=== false`。需要确定 `false` 时,显式声明 `default: false`。

### ③ `ctx` —— 命令运行时上下文

```ts
interface CommandContext<State> {
  get<T>(path, query?): Promise<{status, data: T, headers}>   // 自动带鉴权(若有 auth 插件)
  post / put / patch / delete 同上
  request<T>(opts): Promise<{status, data: T, headers}>        // 低层兜底
  state: State                          // 插件间共享数据(auth 填 user)
  log: { info, warn, error }            // 强制写 stderr,不污染 stdout
  pipe: { in(): AsyncIterable<PipeRecord>; isInPipe(): boolean }
  credentials: { get, save, clear }     // 运行时读写凭证(仅鉴权时)
}
```

### ④ `errs.*` —— 9 类类型化错误

业务命令抛错一律用 `errs.*`,不要 `throw new Error(...)`。裸 Error 被归类为 `internal/unknown`(exit 5),agent 会误判为 SDK 故障。

```ts
import { errs } from "@renxqoo/agent-data-cli";
throw new errs.ValidationError({ subtype: "invalid_argument", param: "--limit", message: "必须为正数", hint: "使用 --limit 30" });
throw new errs.NotFoundError(`订单 ${id} 不存在`); // 404 快捷写法
throw new errs.PermissionError({ subtype: "missing_scope", missingScopes: ["orders:read"], message: "...", hint: "..." });
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
| `internal`       |  5   | 框架内部错误(业务通常不抛此类别)   |
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

纯副作用命令可 `return` 或不 return(`void` 合法,框架输出 `data:null`)。其他返回值必须有自有 `data` 字段;`data:null` 合法,`{}` / `{ data: undefined }` 会得到 `internal/contract_violation`。

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

## 5. 模式速查(常用)

### 模式 1:多业务域(namespaces)

```ts
defineCli({
  name: "rx-shop",
  binName: "rx-shop",
  namespaces: {
    orders: ordersCommands,    // → rx-shop orders list
    products: productsCommands, // → rx-shop products search
  },
});
```

禁止用 spread 拍平命令组(`...ordersCommands`)——同名命令(`list`/`get`)会互相覆盖,丢失命名空间层级。应使用 `namespaces`。

### 模式 2:`errorOnStatus` 自动 throw

把常见 status→subtype 配在 defineCli 上,命令就不用手写 if:

```ts
defineCli({
  errorOnStatus: {
    404: "not_found",     // → 自动 throw NotFoundError
    429: "rate_limited",  // → 自动 throw APIError(retryable: true)
    "5xx": "server_error",// → 自动 throw APIError(retryable: true)
  },
});
```

> 已配进 `errorOnStatus` 的 status,框架在 `ctx.get` 返回前即 throw,命令 run 内对同一 status 的 `if` 分支不可达(死代码)。手写 `if` 仅用于 `errorOnStatus` 未配的 status(如 422,各命令语义不同)。

> **进阶模式**(分页 `pagination`、管道下游 `ctx.pipe`、`humanFormat` 自定义表格)见 `references/patterns.md`——列表要给 agent 续拉、下游消费上游输出、`--no-json` 精致化时才读。

---

## 6. 输出契约 —— 给 agent 看的 stdout/stderr

| 内容                                              | 流         | 谁写                             |
| ------------------------------------------------- | ---------- | -------------------------------- |
| 成功输出 `{ok:true, source, data, meta}`          | **stdout** | 框架(从你的 `return` 序列化)     |
| 错误输出 `{ok:false, error:{type, subtype, ...}}` | **stderr** | 框架(从你的 `throw errs.*` 渲染) |
| 日志(info/warn/error)                             | stderr     | `ctx.log.info(...)`              |
| SKILL.md 原文(`skills read` 输出)                 | stdout     | 框架(**例外**:不走统一输出格式)      |

**契约要点:**

- **业务命令禁止直接 `console.log` 到 stdout**——会破坏管道。输出数据用 `return { data }`,输出日志用 `ctx.log.info(...)`(写 stderr)。
- `source` 由 `defineCli.name` 写入,管道下游据此生成稳定的 `PipeRecord.type`。成功输出还可能带可选顶层 `identity: 'user' | 'bot'`(auth Plugin 填)和 `dry_run`(`--dry-run` 时)。业务包通常不用关心——只需 `return { data, meta }`,其余框架补。
- **`--json` / `--no-json`**:默认 `auto`(TTY→文本表格;管道/CI→JSON);`--json` 强制 JSON,`--no-json` 强制文本(被管道时仍 JSON,保护 agent)。
- **exit code**:业务包**不设**——框架按错误 category 自动设(0 成功;1 api;2 validation;3 auth/permission/config;4 network;5 internal;6 policy;10 confirmation)。

---

## 7. 写 SKILL.md —— 让 agent 自服务发现

加 `skillsDir: './skills'` 后,框架自动注入 4 个命令:`skills list` / `read` / `sync` / `gen`。

```bash
rx-todos skills gen rx-todos --init        # 首次:生成 SKILL.md 骨架(带 AUTO-GEN 命令表 + {{FILL}} 占位)
# 中文项目加 --lang zh:rx-todos skills gen rx-todos --init --lang zh
# 手工填语义部分(何时用、错误处理、前置条件)
rx-todos skills gen rx-todos               # 后续改命令:只刷 AUTO-GEN 块,语义部分不动
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

> 完整模板、AUTO-GEN 机制、frontmatter 规范(对齐官方 skill-creator,**不加 version** 等非官方字段)、签名规则见 `references/skill-gen.md`。**带鉴权的 CLI:生成的业务 SKILL.md 必须含 split-flow 登录指引**——否则 agent 直接 `auth login` 会卡死,模板见同文件。

发布:`package.json` 的 `"files"` 含 `["dist", "skills"]`。**CLI 发布前生成 README**(给人看;SKILL.md 是给 agent 的)——读 `references/readme-gen.md`。

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

> 完整用法(mock store / mock pipe / 端到端测试 / 发布前真实任务评估)见 `references/testing.md`。

---

## 9. 避坑

1. **`defineAuth` 缺 `await`**(鉴权最常见 bug)→ 见 §3①。
2. **spread 命令组**(`...ordersCommands`)→ 同名命令互相覆盖。用 `namespaces`。
3. **boolean 不带 default 用 `=== false` 判断** → 未传时是 `undefined`。用 `if (args.x)`(见 §3②)。
4. **配了 `errorOnStatus` 还手写 `if (res.status===404)`** → 死代码。见 §5 模式 2。
5. **返回 `{}` / `{ data: undefined }`** → 违反输出契约。纯副作用用 `return`,空结果用 `data:null`(见 §3⑤)。
6. **把 `skillsSource` 只写进 `defineCli`** → 当前不会触发安装。显式传给 `runInstallWizard({ skillsSource })`。
7. **frontmatter 加 `version` 等非官方字段** → 不符合 skill-creator 规范。`gen --init` 骨架已只放稳定字段;版本信息放 `package.json`。见 `references/skill-gen.md`。

> 鉴权相关坑(要登录才看):credentialNamespace 撞名(静默共用凭证)、业务 SKILL.md 教 agent 直接跑 `auth login`(会卡死)——见 §2 命名检查 + `references/auth-patterns.md`。

---

## 10. 进阶(读 references,按需)

- **`references/auth-patterns.md`** —— **需要登录时读**:defineAuth 工厂、register、split-flow 登录、install 向导、凭证路径隔离、手写 auth Plugin(HMAC/mTLS)、provider chain
- **`references/patterns.md`** —— **列表要分页 / 管道下游 / humanFormat 时读**:pagination 续拉、`ctx.pipe` 消费上游、`printTable` 自定义表格
- `references/plugin-patterns.md` —— 自定义插件(钩子选择、enforce 顺序、onError 链)
- `references/skill-gen.md` —— SKILL.md 完整模板(含 split-flow 占位)、AUTO-GEN 机制、frontmatter 规范、**与官方 skill-creator 规范对齐(§11)**
- `references/readme-gen.md` —— **生成 README 时读**:标准结构 + 模板(装CLI/装Skill/配凭证)+ 鉴权三分支 + 避坑
- `references/error-catalog.md` —— 全部 30+ subtype 速查 + errorOnStatus 推荐配置
- `references/testing.md` —— createTestCtx 完整用法(mock transport/store/pipe、端到端测试)、**真实任务评估第 3 层(skill-creator 集成,§9)**

---

## 11. 完成清单

- [ ] §2 命名检查通过(bin / credentialNamespace / apps 目录都不撞)
- [ ] `pnpm build` 编译通过
- [ ] 主要命令用 `createTestCtx` 测过
- [ ] 每个 `args` 都填了 `desc`
- [ ] 用了 `errs.*` 而非裸 Error
- [ ] `package.json` 的 `files` 含 `["dist", "skills"]`
- [ ] 跑 `skills gen <name> --init` 生成 SKILL.md 并填了语义部分
- [ ] **SKILL.md description 触发质量**:覆盖用户多种说法(不止命令名)、划清边界防误触发、明确鼓励触发(见 `references/skill-gen.md` §4)
- [ ] 按 `references/readme-gen.md` 生成 README(含安装步骤)
- [ ] **带鉴权的 CLI**:业务 SKILL.md 含 split-flow 登录指引;入口处理了 `install` 向导(拦截 `argv[0]==='install'`);`defineAuth` 已 `await`(见 §3①)
- [ ] 没往 stdout 写非统一输出格式内容
- [ ] 发布前至少跑过一轮 skill-creator 真实任务评估(见 `references/testing.md` §9)
