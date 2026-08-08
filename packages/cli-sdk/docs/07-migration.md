# 07 · v1 → v2 迁移指南

> 本文假设你熟悉 rxcli v1(`/Users/wrr/work/rxcli`)。v2 从零重写(v1 仓不动,只作只读参考),本文讲清楚:概念怎么映射、v1 代码哪些思路保留(重写)、哪些彻底改、orders 命令迁移前后对照。

---

## 核心概念映射表

| v1 概念 | v2 概念 | 变化 |
|---|---|---|
| `printGatewayJson(path)` | `const res = await ctx.get(path); return { data: res.data }` | 同步 print → run 返回值 |
| `ApiError` (status, body) | `errs.*` 类型化错误(9 类) | 裸 status → 结构化分类 |
| `process.exitCode = 1` + console.error | `throw errs.*` + cli-sdk 渲染信封 | 手动 exit → 自动 exit code |
| `loadCredentials()` 固定文件 | `ctx.credentials.get(ns)` + 自写 auth Plugin | 单文件 → provider chain |
| `refreshInflight` 401 singleflight | cli-sdk 内部保留(必须) | 逻辑保留,位置在请求层 |
| commander 命令注册 | `defineCli` + `defineCommand` 配置对象 | 命令式 → 声明式 |
| `createClient` 工厂 + client 对象 | **取消 client**;请求挂 `ctx`;认证用**自写 auth Plugin**(用 provider chain + injectAuthHeader 组装) | client 层消失 |
| 鉴权(authStyle 配置) | 自写 auth Plugin(`injectAuthHeader(req, token, authStyle)` 注入) | 鉴权做成插件(无封闭工厂) |
| 静态 SKILL.md | SKILL.md + `skills gen` 自动生成 | 全手写 → 机械自动 + 语义手写 |
| 单体 CLI | monorepo:cli-sdk + 业务包 | 一仓 → 多包 |

---

## v1 代码归属(基于代码分析)

v1 的 `src/` 分三层,迁移去向不同:

### A. 进 cli-sdk(可复用核心)

| v1 文件 | 处理方式 | 关键点 |
|---|---|---|
| `src/api.ts` | **思路保留,重写** | device flow / gateway / **401 singleflight refresh 必须保留**;改成 function 风格,请求方法挂 ctx |
| `src/skills/reader.ts` | **几乎原样搬**(已对齐 lark-cli) | list/read + 路径校验 + frontmatter 解析,零业务耦合 |
| `src/commands/skills.ts` | 原样搬 + 加自动生成 | `gen` 命令是 v2 新增 |
| `src/commands/qrcode.ts` | **升级为 cli-sdk 内置顶层命令** | v2:`rxcli qrcode <url>`(defineCli 自动注入),不再是 v1 的 `auth qrcode` 二级命令;ASCII 走 stderr、stdout 返回信封 |

### B. 进 cli-sdk(改造后搬)

| v1 文件 | 抽成什么 | 改造点 |
|---|---|---|
| `src/config.ts` | `ConfigStore` | 参数化:目录名、env 变量名、env 列表、default baseUrl |
| `src/commands/auth.ts` | auth 命令 + **auth Plugin 参考实现**(orders 包内) | device flow 骨架保留;scope/文案注入;**鉴权做成 Plugin,业务包用 cli-sdk 基础块(provider chain / injectAuthHeader / oauth)自己组装**(参考 `apps/crm/src/auth.ts` 的 `createCrmAuth`);cli-sdk 无封闭工厂 |
| `src/commands/register.ts` | `createRegisterCommand({messages})` | token 获取方式抽象;文案注入 |
| `src/index.ts` | `bootstrap({name, commands, gate, onFirstRun})` | commander 组装 + 首次引导 + install 拦截抽骨架 |
| `src/commands/gateway.ts` | 改造成 run 返回值模型 | `printGatewayJson` → `return { data }`;加 stdout/stderr 纪律 |

### C. 留业务包(rxcli 特定)

| v1 内容 | 留业务包原因 |
|---|---|
| `src/commands/orders.ts` `products.ts` `invoices.ts` `account.ts` | 纯业务,只拼 path |
| `skills/` 下的 SKILL.md + references | 业务技能文档 |
| prod baseUrl 硬编码 `http://120.26.219.32` | rxcli 自己的中间层地址 |
| `SCOPE = "company.api offline_access"` | rxcli 业务 scope |
| `src/install-wizard.ts` | 重品牌耦合;留 `@renxqoo/cli` meta 包 |

---

## orders 命令迁移前后对照(完整代码)

这是最干净的迁移示例:v1 的 orders 只拼 path + 委托 `printGatewayJson`,v2 改成 defineCommand + ctx + 信封。

### v1(`src/commands/orders.ts`)

```ts
// v1:commander 命令式 + printGatewayJson 委托
import { Command } from "commander";
import { printGatewayJson } from "./gateway";

export function registerOrdersCommand(program: Command): void {
  const orders = program.command("orders").description("查询订单");
  orders
    .command("list")
    .option("--limit <n>")
    .action(async (opts) => {
      const qs = opts.limit ? `?limit=${opts.limit}` : "";
      await printGatewayJson(`/api/orders${qs}`);
    });
  orders
    .command("get <id>")
    .action(async (id: string) => {
      await printGatewayJson(`/api/orders/${id}`);
    });
}
```

**v1 特征:**
- 鉴权/续期/exit code 全靠 `printGatewayJson` 黑盒
- 没有信封(裸 JSON body 美化打印)
- 没有分页 meta
- 错误只有 `exitCode=1` + message 字符串

### v2(`apps/crm/src/commands/orders.ts`)

```ts
// v2:function 风格 + defineCommand + ctx + 信封
import { defineCommands, defineCommand, errs } from '@renxqoo/cli-sdk'

export const ordersCommands = defineCommands({
  list: defineCommand({
    name: 'list',
    description: '查询订单列表',
    args: {
      limit:  { type: 'number', default: 30, desc: '返回数量上限' },
      offset: { type: 'number', default: 0, desc: '偏移量' },
      status: { type: 'string', desc: '状态: unpaid/paid/shipped' },
    },
    async run(args, ctx) {
      const res = await ctx.get('/api/orders', {
        limit: args.limit,
        offset: args.offset,
        ...(args.status && { status: args.status }),
      })
      return {
        data: res.data.items,
        meta: {
          count: res.data.items.length,
          pagination: { complete: !res.data.hasMore, nextToken: res.data.nextCursor },
        },
      }
    },
  }),

  get: defineCommand<{ id: string }>({
    name: 'get',
    description: '查询订单详情',
    args: { id: { type: 'string', required: true, positional: true, desc: '订单 ID' } },
    async run({ id }, ctx) {
      const res = await ctx.get(`/api/orders/${id}`)
      if (res.status === 404) throw new errs.NotFoundError(`订单 ${id} 不存在`)
      return { data: res.data }
    },
  }),
})
```

**v2 改进:**
- 鉴权由业务包自写的 auth Plugin(用 cli-sdk 基础块组装)+ cli-sdk 请求层处理(业务包命令无感,只调 `ctx.get`)
- 输出是信封(`{ok, data, meta}`),带分页信息
- 错误是类型化的(`NotFoundError`),exit code 自动正确
- 参数有 `desc`,自动生成进 SKILL.md
- 显式声明分页完整性(`complete`/`nextToken`)

### v2 入口(`apps/crm/src/index.ts`)

```ts
#!/usr/bin/env node
import { defineCli } from '@renxqoo/cli-sdk'
import { ordersCommands } from './commands/orders'
import { createCrmAuth } from './auth'

const auth = createCrmAuth<{ user: { userId: string } | null }>({
  namespace: 'orders',
  authStyle: 'bearer',
})

export default defineCli<{
  user: { userId: string } | null
}>({
  name: 'orders',
  description: '订单查询与管理',
  plugins: [auth],                // ← 业务包自写的 auth Plugin
  commands: ordersCommands,
  skillsDir: './skills',
})
```

> `createCrmAuth`(见 `src/auth.ts`)是业务包自己写的 auth Plugin 工厂——用 cli-sdk 的 `fileStore`/`defaultProviders`/`resolveWithChain`/`injectAuthHeader`/`createOn401Hook` 组装。**cli-sdk 不提供封闭的 `createAuthPlugin`**,v1 也没有——v2 是"业务包掌握认证全流程,框架只出可复用基础块"。

**对比 v1:** v1 的 `index.ts` 是几十行 commander 组装 + 首次运行拦截 + 顶层 catch;v2 业务包入口只剩 `defineCli({...})` 装配 + auth Plugin,框架逻辑全在 cli-sdk。

---

## 401 singleflight refresh(必须保留)

v1 `api.ts` 的 `refreshInflight` Map 是**并发安全的关键**——多个业务命令同时遇到 401 时,复用同一次 refresh,避免旧 refresh token 被多次复用触发吊销。

**v2 必须保留这个逻辑**,位置在 cli-sdk 请求层内部(业务包无感):

```ts
// cli-sdk 请求层内部(伪代码)
const refreshInflight = new Map<string, Promise<TokenInfo>>()

async function refreshTokenIfNeeded(): Promise<TokenInfo> {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) throw new errs.AuthenticationError({ subtype: 'no_refresh_token' })

  // singleflight:同一个 refreshToken 的并发 refresh 复用同一个 Promise
  if (!refreshInflight.has(refreshToken)) {
    const p = doRefresh(refreshToken).finally(() => refreshInflight.delete(refreshToken))
    refreshInflight.set(refreshToken, p)
  }
  return refreshInflight.get(refreshToken)!
}
```

**为什么不能丢**:如果两个命令并发请求都 401,各自 refresh,第二个 refresh 会用"已被第一个 refresh 作废"的旧 refresh token,触发服务端"refresh 重用检测"→ 吊销整个 session。singleflight 保证只 refresh 一次。

---

## device flow 登录(思路保留)

v1 `auth.ts` 的三分支 device flow 是 agent 友好的关键设计,v2 保留(由 auth Plugin 调 cli-sdk 的 `deviceAuthorization`/`pollDeviceToken` 等基础块实现):

| 分支 | 用途 | v2 位置 |
|---|---|---|
| `--no-wait --json` | split-flow 第一步(agent 用),立即返回 device_code + URL | auth Plugin / auth 命令 |
| `--device-code <code>` | split-flow 第二步,轮询完成登录 | 同上 |
| 默认(阻塞) | 人类直接用 | 同上 |

**v2 改进:** agent split-flow 的输出从裸 JSON 改成**信封**(`{ok, data: {device_code, verification_url}}`),统一格式。

---

## gateway 中间层(保留)

v1 的"CLI 不直接持有 company token,经中间层代理"安全模型,v2 保留:

```
CLI ──device flow──► 中间层(auth-proxy)──账号密码──► 公司应用
CLI ──/proxy/*────► 中间层 gateway ──company_token──► 公司应用
```

**v2 改进:** 这个中间层成为 auth Plugin 的 `defaultProviders()` 里**默认 `oauthProvider`** 的后端。业务包如果接的不是"rxcli 中间层"而是直连外部 SaaS,可以在自写 auth Plugin 里替换 provider(见 `05-credentials.md`)。中间层是 v1 rxcli 的特定实现,不是 cli-sdk 的强制假设。

---

## 配置迁移

v1 的 `~/.rxcli/config.json` + `credentials.json` v2 改成:

```
~/.rxcli/
├── config.json                  全局配置(baseUrl 等,单环境)
└── credentials/
    └── orders.json              ← 按业务包命名空间隔离(v1 是单文件)
```

| v1 | v2 |
|---|---|
| `config.json` 单文件含 dev/test/prod | `ConfigStore` 单环境(baseUrl 由业务包声明) |
| `credentials.json` 单文件按 env 分 | `credentials/<namespace>.json` 按业务包分 |
| `SUPERCLI_ENV` 硬编码切换环境 | 取消多环境(业务包各自声明 baseUrl) |
| prod baseUrl 硬编码 | 业务包在 defineCli 配置 baseUrl |

---

## 迁移检查清单

迁移一个 v1 业务命令到 v2,逐项确认:

- [ ] 命令改用 `defineCommand` 声明(不用 commander)
- [ ] `printGatewayJson(path)` → `const res = await ctx.get(path); return { data: res.data }`
- [ ] args 填 `desc`(自动生成文档用)
- [ ] 分页命令填 `meta.pagination.complete` / `nextToken`
- [ ] 错误用 `errs.*` 类型化(404 → `NotFoundError` 等)
- [ ] 不再手写 `process.exitCode`
- [ ] 日志用 `ctx.log`(stderr),不直接 console.log 到 stdout
- [ ] 认证用自写的 auth Plugin(用 cli-sdk 的 provider chain + injectAuthHeader 组装,见 `05-credentials.md`;不手写鉴权细节,不创建 client)
- [ ] SKILL.md 用 `skills gen --init` 生成,只手写语义部分
- [ ] package.json 加 `bin` + `"rxcli": {"plugin": true}`
- [ ] `files` 含 `dist` 和 `skills`

---

## 不迁移的部分(v1 有、v2 不要)

| v1 特性 | 为什么 v2 不要 |
|---|---|
| 美化打印 JSON(`JSON.stringify(body, null, 2)`) | 破坏管道(stdout 有空格);v2 用紧凑 JSON |
| client 对象 + createClient 工厂 | v2 取消 client,请求挂 ctx,认证用插件 |
| 业务命令直接调 `loadConfig`/`loadCredentials` | v2 由 auth Plugin(用 cli-sdk 基础块) + ctx.credentials 管,业务包命令不接触凭证存储 |
| `process.exitCode = 1` 散落各处 | v2 统一由 cli-sdk 按 Category 设 exit code |

---

## 迁移路线建议

1. **先 cli-sdk 核心**(device flow 基础块 + ctx 请求层 + 信封 + 错误 + skill reader + 认证基础块 provider chain / injectAuthHeader / on401)——这是所有业务包的基础
2. **迁 orders 做验证**——最简单的业务命令,验证整条链路通
3. **迁 products/invoices/account**——结构相同,批量迁
4. **建 `@renxqoo/cli` meta 包**(install 向导 + 跨包 skill 聚合)——最后做,依赖前面的包都就绪

**不要一次性全迁。** 先让 orders 在 v2 跑通端到端(登录 → 查询 → 管道 → 错误),再批量迁其它。每个业务包迁完都能独立验证。
