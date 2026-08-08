# 02 · SDK 开发指南

> 给**业务包开发者**看。讲清楚怎么用 `@renxqoo/cli-sdk` 写一个业务包:目录结构、ctx、命令、插件、auth、分页、测试。这是开发者最常翻的文档。

---

## 快速开始:一个最小业务包

### 1. 创建项目

```bash
mkdir rxcli-orders && cd rxcli-orders
pnpm init
pnpm add @renxqoo/cli-sdk
```

### 2. 目录结构

```
rxcli-orders/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          ← 入口:defineCli 装配(plugins + commands)
│   └── commands/
│       ├── orders.ts     ← 命令组(可拆多个文件)
│       └── invoices.ts
└── skills/
    └── orders/
        └── SKILL.md      ← 教 agent 怎么用(命令表自动生成)
```

> 注意:没有 `client.ts`。cli-sdk 取消了 client 概念,请求方法直接挂在 `ctx` 上,鉴权由业务包自写的 auth Plugin 处理(用 cli-sdk 基础块组装)。

### 3. package.json

```jsonc
{
  "name": "@org/rxcli-orders",
  "version": "1.0.0",
  "type": "module",
  "bin": { "rxcli-orders": "./dist/index.js" },   // 独立 bin
  "main": "./dist/index.js",
  "files": ["dist", "skills"],                     // skills 随包发布
  "scripts": {
    "build": "tsc",
    "test": "vitest"
  },
  "dependencies": { "@renxqoo/cli-sdk": "^0.1.0" },
  "rxcli": { "plugin": true }                       // ★ 标记可被 rxcli 主包发现
}
```

`"rxcli": {"plugin": true}` 这个标记让 `@renxqoo/cli` meta 包启动时自动发现它,注册成 `rxcli orders ...` 子命令。不写这个标记就只能用独立 bin。

### 4. 入口 src/index.ts

```ts
#!/usr/bin/env node
import { defineCli } from '@renxqoo/cli-sdk'
import { ordersCommands } from './commands/orders'
import { createCrmAuth } from './auth'

// ① auth Plugin:开发者用 cli-sdk 基础块自己组装(见 src/auth.ts)
const auth = createCrmAuth<{
  user: { userId: string } | null
}>({
  namespace: 'orders',
  authStyle: 'bearer',          // 默认;API key 用 'x-api-key'
})

// ② 装配:<State> 泛型声明 ctx.state 的形状
export default defineCli<{
  user: { userId: string } | null   // ctx.state.user 的类型
}>({
  name: 'orders',
  description: '订单查询与管理',
  plugins: [auth],                   // ★ 所有扩展统一成插件(见"插件系统")
  commands: ordersCommands,
  skillsDir: './skills',
})
```

> `src/auth.ts` 里是 `createCrmAuth`——业务包自己写的 auth Plugin 工厂(用 cli-sdk 的 `fileStore`/`defaultProviders`/`resolveWithChain`/`injectAuthHeader`/`createOn401Hook` 组装)。完整写法见本文档"如何写 auth Plugin"和 `05-credentials.md`。cli-sdk **不提供**封闭的 `createAuthPlugin`,只提供基础块。

**就这些。** 下面逐块讲 `ctx`、`defineCommand`、插件系统、auth。

---

## 编程风格:function,不是 class

cli-sdk 采用 **function 风格 + 配置对象声明**(决策清单 #3)。理由:

- **组合 > 继承**:框架场景要组合(管道)、要 tree-shaking(发 npm)、要好测(mock 参数)。class 继承在这三方面都劣于 function。
- **依赖注入而非隐式 this**:命令 `run(args, ctx)` 通过 `ctx` 拿到框架注入的能力(`ctx.get`、`ctx.log` 等),不靠 class 继承链的隐式 `this`。agent 读代码时无歧义。

对比:

```ts
// ❌ class 风格(不用):强耦合、隐式 this、难组合
class Orders extends Client {
  async list() { return this.request(...) }   // this 哪来的?测试要 mock 整个继承链?
}

// ✅ function 风格(采用):命令 run 内通过 ctx 拿能力,纯函数好测
async run(args, ctx) {
  const res = await ctx.get('/orders', args)        // ctx.get 直接挂 ctx
  return { data: res.data.items }                   // return 数据,框架调序列化
}
```

**两种 function 写法**:命令的 `run` 内直接用 `ctx.get`(注入);若把"调后端"逻辑抽成独立纯函数(便于单测复用),则显式传一个能请求的对象:

```ts
// 抽成独立函数:显式传能请求的对象,纯函数,脱离 ctx 也能测
async function listOrders(requester: { get: (...)=>... }, params: Record<string, unknown>) {
  const res = await requester.get('/orders', params)
  return res.data.items
}

// run 里调用它(把 ctx 传进去,ctx 本身就有 get 方法)
async run(args, ctx) {
  const items = await listOrders(ctx, args)   // ctx 有 get,直接传
  return { data: items }
}
```

**约定:简单命令直接用 `ctx.get`;复杂/复用逻辑抽独立函数并显式传 `ctx`(或能请求的对象)。** 两种都是 function 风格。不存在 class 继承,也不存在 client 对象。

---

## TS 类型规范(用类型卡死约束)

cli-sdk 用 TS 类型系统强制规范结构约束。下表是"能用 TS 卡住的"和"卡不住需运行时补"的区分:

| 约束 | 卡住方式 | TS 还是运行时 |
|---|---|---|
| `name`/`description`/`run` 必填 | CommandSpec 必填字段 | TS 编译报错 |
| `args.type` 只能 4 种 | ArgType 联合字面量 | TS |
| `args` 解析后强类型 | ParsedArgs 推导 **或** interface 显式声明 | TS |
| `ctx.state` 强类型(防乱塞) | `defineCli<State>` 泛型,未声明访问报错 | TS |
| `commands`/`namespaces` 类型分离 | 顶层命令 vs 子命名空间组用独立字段,无联合类型歧义 | TS |
| `ctx.get<T>()` 响应类型 | 请求泛型(可选) | TS |
| `beforeOutput` 不返回 string | 返回 StructuredData | TS |
| `run` 输出数据 | return CommandResult | TS(漏 return 运行时警告) |
| 禁 console.log 到 stdout | — | 运行时/lint(TS 管不了) |

### 命令三泛型 `<Args, Result>` + 业务包级 `<State>`

这是类型规范的核心。**一个命令把它的参数类型、返回类型都声明清楚**(类似 axios 声明请求/响应类型);**state 类型业务包级声明一次**:

```ts
// 业务包先定义类型
interface OrdersState {
  user: { userId: string } | null
}

interface OrderListArgs {
  limit?: number
  status?: 'paid' | 'unpaid' | 'shipped'   // 联合字面量,spec 推导不出来
}

interface OrderItem { id: string; total: number; status: string }
interface OrderListPayload { items: OrderItem[]; hasMore: boolean; nextCursor?: string }

// 命令:<Args, Result>(State 在 defineCli 声明)
// Result 是 run 返回 data 字段的类型。list 命令 data 放数组 → Result = OrderItem[]
list: defineCommand<OrderListArgs, OrderItem[]>({
  name: 'list',
  description: '查询订单列表',
  args: { limit: { type: 'number', default: 30 }, status: { type: 'string' } },
  async run(args, ctx) {
    // args: OrderListArgs(强类型,有补全;args.foo 报错)
    // ctx.state.user: { userId } | null(从 defineCli<State> 推导)
    const res = await ctx.get<OrderListPayload>('/orders', args)   // 泛型是响应 body 类型
    return {
      data: res.data.items,                                         // ← data 放数组(OrderItem[])
      meta: { pagination: { complete: !res.data.hasMore, nextToken: res.data.nextCursor } },
    }
  },
})

// 业务包:<State>(声明 ctx.state 形状)
defineCli<OrdersState>({ ... })
```

| 泛型 | 声明位置 | 职责 |
|---|---|---|
| `State` | `defineCli<State>` | `ctx.state` 的类型,业务包级(所有命令共享) |
| `Args` | `defineCommand<Args, Result>` | run 的 `args` 参数类型(命令级) |
| `Result` | `defineCommand<Args, Result>` | run 返回的 `data` 类型(命令级) |

**渐进式:泛型可选。** 不写泛型时 args 默认按 spec 推导(ParsedArgs)、state 默认 `{}`、返回默认 `unknown`——能跑但无补全;写了全类型安全。简单命令可不写,复杂命令才声明。

### ArgsSpec + ArgSpec:参数解析规范

```ts
type ArgType = 'string' | 'number' | 'boolean' | 'array'

interface ArgSpec {
  type: ArgType                   // 字面量联合,'strin'(拼错)报错
  required?: boolean
  positional?: boolean
  desc?: string                   // 填了进自动生成的命令文档(见 06-skills.md)
  default?: unknown               // 简化版:不跟 type 联动
}

type ArgsSpec = Record<string, ArgSpec>
```

**args 类型两种来源:**
- **interface 显式声明**(推荐,精确):写 `defineCommand<OrderListArgs, ...>`,args 按 interface 类型;spec 只管命令行解析。能写联合字面量 `'paid'|'unpaid'`、可选 `?`、复杂类型。
- **spec 自动推导**(简单命令):不写泛型,cli-sdk 从 spec 推导出 ParsedArgs(`{limit: number|undefined, ...}`)。够用但不够精确(推导不出联合字面量)。

### CommandSpec:命令结构必填

```ts
// 命令级只有 Args/Result 两个泛型;State 由 defineCli<State> 统一注入(见下)
interface CommandSpec<Args = any, Result = unknown> {
  name: string                    // 必填,缺了编译报错
  description: string             // 必填
  args?: ArgsSpec                 // 可选(解析规范)
  requiresScope?: string          // 可选
  run: (args: Args, ctx: CommandContext) => Promise<CommandResult<Result> | void>
  // ctx 的 state 类型由 defineCli<State> 推导注入,命令定义时不写 State
}
```

### CommandResult + StructuredData

```ts
interface CommandResult<T = unknown> {
  data: T                         // 结构化数据
  meta?: Meta                     // 可选(分页等)
}
// run 返回 CommandResult 或 void(纯副作用命令)

type StructuredData = Record<string, unknown> | unknown[] | null
// beforeOutput 返回 StructuredData,string 不匹配 → 编译报错
// 注意:不能用 object(object 在 strict 下太宽,拦不住 string)
```

### defineCli 泛型:ctx.state 的强类型来源

```ts
// defineCli<State> 的 State 推导到 ctx.state
defineCli<OrdersState>({ ... })
// → 所有命令和插件的 ctx.state 是 OrdersState 强类型
```

业务包不写泛型时,State 默认 `{}`(`ctx.state` 是空对象,访问任何字段报错)。写了泛型,`ctx.state` 就是业务包声明的强类型。**纯增强,不强制。**

---

## ctx:请求与上下文

`ctx` 是 cli-sdk 注入给每个 `run(args, ctx)` 的上下文。**请求方法直接挂在 ctx 上(无 client 层);鉴权由 auth 插件 + cli-sdk 内部处理,业务包无感。**

```ts
interface CommandContext<State = {}> {
  // —— 请求方法(直接挂 ctx,无 client 层)——
  // T 是响应 body 类型,可选(不写则 data 是 unknown)
  get<T = unknown>(path: string, query?: Record<string, unknown>): Promise<TransportResponse<T>>
  post<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>
  put<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>
  patch<T = unknown>(path: string, body?: unknown): Promise<TransportResponse<T>>
  delete<T = unknown>(path: string): Promise<TransportResponse<T>>
  request<T = unknown>(opts: RequestOptions): Promise<TransportResponse<T>>   // 低层兜底

  // —— state:插件间共享数据,强类型(defineCli<State> 声明)——
  state: State

  // —— 日志:强制 stderr(绝不污染 stdout/管道)——
  log: { info(msg: unknown): void; warn(msg: unknown): void; error(msg: unknown): void }

  // —— 管道:作为下游时读上游记录 ——
  pipe: { in(): AsyncIterable<PipeRecord>; isInPipe(): boolean }

  // —— 凭证(运行时读写,见 05-credentials.md)——
  credentials: {
    get(namespace: string): Promise<Record<string, string> | null>
    save(namespace: string, creds: Record<string, unknown>): Promise<void>
    clear(namespace: string): Promise<void>
  }

  // —— 鉴权状态 ——
  auth: { status(): AuthStatus; requireScope(scope: string): void }
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
  timeout?: number
}

interface TransportResponse<T> {
  status: number
  data: T                              // T 默认 unknown
  headers: Record<string, string>
}
```

### 请求泛型(可选,axios 式)

`ctx.get<T>()` 的 T 是响应 body 的类型。**写不写都行**:
- **写了**:`res.data` 是你声明的类型,有补全、拼错报错
- **不写**:退化为 `unknown`,业务包自己断言

```ts
// 写泛型:res.data 强类型
const res = await ctx.get<OrderListResult>('/orders', { limit: 30 })
res.data.items      // ✅ 有补全

// 不写泛型:res.data 是 unknown
const res = await ctx.get('/orders', { limit: 30 })
res.data            // unknown
```

**泛型纯增强,不强制。**

### 鉴权:由 auth 插件 + cli-sdk 请求层处理

业务包**不接触**鉴权细节(token/refresh/header 注入)。这些由两部分自动完成:
1. **auth 插件**(业务包自己写,用 cli-sdk 基础块组装):beforeCommand 填 `ctx.state.user`、缓存 token,beforeRequest 注入 token header
2. **cli-sdk 请求层**:401 自动 refresh(singleflight,见 `07-migration.md`)——前提是 auth 插件把 `createOn401Hook` 的结果挂到 `_transportConfig.on401`

业务包只管 `ctx.get(...)` 发请求,token/header 自动带上。详见 `05-credentials.md`。

### state:插件间共享数据(强类型)

`ctx.state` 是**插件之间、插件与命令之间共享运行时数据**的渠道。强类型——`defineCli<State>` 声明什么,才能读写什么:

```ts
defineCli<{ user: { userId: string } | null }>({ ... })

// auth 插件(生产者):beforeCommand 时填 state.user
async beforeCommand(ctx) {
  ctx.state.user = { userId: 'u1' }   // ✅ 类型对
}
```

> 实际项目里 auth 插件会用 provider chain 取 token 再填 state.user,见 `05-credentials.md`。

// 命令 run(消费者):读 state.user
async run(args, ctx) {
  ctx.state.user?.userId              // ✅ 强类型
  ctx.state.foo                       // ❌ 报错,没声明
}
```

**读写纪律**:生产者插件(如 auth)声明并写自己负责的字段;消费者(其它插件、命令 run)只读。靠命名约定 + 文档(如 auth 插件写 `user` 字段),TS 不强制读写区分。

> 为什么 state 要保留:插件 A(认证)算出的数据(user),插件 B(审计)或命令 run 要用,必须有共享渠道。没有 state 只能靠全局变量(更糟)。state 强类型化后,不再是"开放 bag 乱塞"——未声明访问直接编译报错。

### 输出机制:run 返回数据,框架调序列化

**命令通过 `return` 输出数据,不调用任何 out 方法。** run 返回 `CommandResult`,框架负责包信封 + 序列化到 stdout。

```ts
async run(args, ctx): Promise<CommandResult | void> {
  const res = await ctx.get<OrderListResult>('/orders', args)
  return {
    data: res.data.items,
    meta: { pagination: { complete: !res.data.hasMore, nextToken: res.data.nextCursor } },
  }
}
```

框架内部执行顺序:
```
1. 跑插件 beforeCommand(填 state)
2. 跑命令 run(args, ctx),拿返回值
3. 若有返回值:跑插件 beforeOutput(transform data)
4. 框架包信封 + 序列化到 stdout
```

**关键纪律:**
- 业务命令**永远不能直接往 stdout 写**。要输出就 `return { data, meta }`,要日志就 `ctx.log`(stderr)。
- 纯副作用命令(如管道下游边读边写)可不 return(void 合法),但建议 return 个汇总。

---

## 命令:defineCommand

每个命令用 `defineCommand` 声明。命令可以单独定义,也可以组装成命令组对象。

### 单个命令(带三泛型)

```ts
import { defineCommand, errs } from '@renxqoo/cli-sdk'

interface GetOrderArgs { id: string }
interface Order { id: string; total: number; status: string }

export const getOrder = defineCommand<GetOrderArgs, Order>({
  name: 'get',
  description: '查询订单详情',
  args: { id: { type: 'string', required: true, positional: true, desc: '订单 ID' } },
  requiresScope: 'orders:read',
  async run({ id }, ctx) {
    const res = await ctx.get<Order>(`/orders/${id}`)
    if (res.status === 404) throw new errs.NotFoundError(`订单 ${id} 不存在`)
    return { data: res.data }
  },
})
```

### 命令组(组装多个命令)

```ts
// src/commands/orders.ts
import { defineCommands, defineCommand, errs } from '@renxqoo/cli-sdk'

interface OrderListArgs { limit?: number; offset?: number; status?: string }
interface OrderListResult { items: Order[]; hasMore: boolean; nextCursor?: string }

export const ordersCommands = defineCommands({
  list: defineCommand<OrderListArgs, OrderListResult>({
    name: 'list',
    description: '查询订单列表',
    args: {
      limit:  { type: 'number', default: 30, desc: '返回数量上限' },
      offset: { type: 'number', default: 0, desc: '偏移量' },
      status: { type: 'string', desc: '状态: unpaid/paid/shipped' },
    },
    async run(args, ctx) {
      const res = await ctx.get<OrderListResult>('/orders', {
        limit: args.limit, offset: args.offset, ...(args.status && { status: args.status }),
      })
      return {
        data: res.data.items,
        meta: { count: res.data.items.length, pagination: {
          complete: !res.data.hasMore, nextToken: res.data.nextCursor,
        } },
      }
    },
  }),

  get: defineCommand<{ id: string }, Order>({
    name: 'get', description: '查询订单详情',
    args: { id: { type: 'string', required: true, positional: true } },
    async run({ id }, ctx) {
      const res = await ctx.get<Order>(`/orders/${id}`)
      if (res.status === 404) throw new errs.NotFoundError(`订单 ${id} 不存在`)
      return { data: res.data }
    },
  }),

  update: defineCommand({
    name: 'update', description: '更新订单',
    requiresScope: 'orders:write',
    args: { id: { type: 'string', required: true, positional: true }, status: { type: 'string' } },
    async run({ id, status }, ctx) {
      const res = await ctx.patch(`/orders/${id}`, { status })
      return { data: res.data }
    },
  }),
})
```

### args 字段规范

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `'string' \| 'number' \| 'boolean' \| 'array'` | 参数类型 |
| `required` | `boolean` | 是否必填(默认 false) |
| `positional` | `boolean` | 是否位置参数(默认 flag;true 则 `<id>` 而非 `--id`) |
| `desc` | `string` | **可选**描述(进自动生成的命令文档) |
| `default` | 同 type | 默认值 |

**args 完全是业务包自己解释的参数对象**,cli-sdk 只负责解析 + 校验类型 + 填默认值,不参与参数语义。后端要 `page/pageSize` 还是 `cursor`,业务包在 `run` 里自己翻译。

### 权限检查:声明式 `requiresScope` vs 命令式 `ctx.auth.requireScope()`

| 方式 | 用法 | 适合 |
|---|---|---|
| `requiresScope`(声明式) | 命令配置项 | **默认用它**。scope 固定、静态 |
| `ctx.auth.requireScope()`(命令式) | run 内调用 | scope 取决于运行时条件 |

两者等价抛 `PermissionError`(exit 3)。声明式更清晰、进文档"权限"列,优先用。

---

## 插件系统(vite 式)

横切关注点(认证/格式/固定参数/错误处理/审计)通过**插件**实现。插件是带 name 的独立对象,可组合、可复用、可分发(独立 npm)。**钩子是插件的接口,不是 defineCli 的内联配置。**

### Plugin 接口

```ts
interface Plugin<State = {}> {
  name: string                                // 必填:插件名(日志/溯源)
  enforce?: 'pre' | 'post'                    // 可选:执行优先级,省略 = 'normal' 档(三档:pre/normal/post)
  beforeCommand?(ctx: CommandContext<State>): Promise<void>
  beforeRequest?(ctx: CommandContext<State>, req: RequestOptions): Promise<void>
  afterRequest?(ctx: CommandContext<State>, res: TransportResponse): Promise<void>
  beforeOutput?(ctx: CommandContext<State>, data: unknown): Promise<StructuredData>
  onError?(ctx: CommandContext<State>, err: CliError): Promise<CliError | void>
}
```

### 5 个钩子的职责

| 钩子 | 何时触发 | 能改什么 | 典型用途 |
|---|---|---|---|
| `beforeCommand` | 命令 run 前 | `ctx.state`(填数据) | auth 填 user、参数预处理 |
| `beforeRequest` | 每次 `ctx.get/post` 前 | `req`(method/path/query/body/headers/timeout 全能改) | 加固定 header、HMAC 签名、注入 tenantId |
| `afterRequest` | 每次请求返回后 | `res` 只读,主要用于副作用 | 审计、metric、请求日志 |
| `beforeOutput` | run 返回后、序列化前 | 返回新 `data`(StructuredData) | 转换、脱敏、删内部字段、自定义格式 |
| `onError` | 任何钩子或 run 抛错时 | 返回新 error 或原样 | 错误归一化、特定错误重试、上报 |

### 执行顺序:enforce 三档

每个钩子内,插件按 `enforce` 三档执行:

```
pre 插件(注册序)    ← 基础设置(加基础 header、auth 注入 token)
  ↓
normal 插件(注册序) ← 业务相关
  ↓
post 插件(注册序)   ← 最终包装(签名、收尾)
  ↓
(真正执行:发请求 / 序列化输出)
```

**onError 特殊**:链式——每个插件都跑一遍,不处理的返回原 error,处理的返回新 error。第一个能处理的插件改完后,结果传给下一个。

### beforeRequest:统一处理请求参数

beforeRequest 收到的 `req` 是完整请求描述,改它 = 改所有接口的请求:

```ts
// 插件:给所有接口的 query 加固定参数
const tenantPlugin = {
  name: 'tenant',
  enforce: 'pre',
  async beforeRequest(ctx, req) {
    req.query = { ...req.query, tenantId: 'acme' }   // 所有接口自动带
  },
}

// 插件:给所有接口的 header 加固定值
const headerPlugin = {
  name: 'fixed-headers',
  enforce: 'pre',
  async beforeRequest(ctx, req) {
    req.headers['X-Client'] = 'rxcli'
    req.headers['X-Trace-Id'] = ctx.state.traceId     // 从 state 读
  },
}

// 插件:HMAC 签名(post:等所有 header/body 定型后算)
const hmacPlugin = {
  name: 'hmac',
  enforce: 'post',
  async beforeRequest(ctx, req) {
    req.headers['X-Sig'] = sign(req.headers, req.body)   // 最后签名
  },
}
```

beforeRequest 还能改 path(重写请求)、throw 中断(进 onError 链)。改 path 是高风险操作,文档警告。

### 用法:在 defineCli 注册插件

```ts
defineCli<{
  user: { userId: string } | null
  traceId: string
}>({
  name: 'orders',
  plugins: [
    auth,                    // 业务包自写的 auth 插件(createCrmAuth,enforce:'pre')
    tenantPlugin,            // 加固定 query
    headerPlugin,            // 加固定 header
    hmacPlugin,              // 签名(post)
    auditPlugin,             // afterRequest 审计
  ],
  commands: ordersCommands,
})
```

**所有扩展统一成插件——defineCli 没有 `beforeRequest` 等内联钩子字段,只有 `plugins` 数组。** 业务包想内联一个简单逻辑,写匿名插件:

```ts
plugins: [
  { name: 'inline', enforce: 'pre', async beforeRequest(ctx, req) { req.headers['X-Foo'] = 'bar' } },
]
```

### 插件是独立可复用模块

插件可以发成独立 npm 包,多个业务包复用:

```ts
// @org/rxcli-plugin-tenant(独立 npm)
export const tenantPlugin = (tenantId: string): Plugin => ({
  name: 'tenant',
  enforce: 'pre',
  async beforeRequest(ctx, req) { req.query = { ...req.query, tenantId } },
})

// 任意业务包用它
import { tenantPlugin } from '@org/rxcli-plugin-tenant'
defineCli({ plugins: [tenantPlugin('acme')], ... })
```

### 认证插件:auth 是 Plugin,用基础块自己写

**auth 不是特殊机制,就是一个普通的 `Plugin`。** cli-sdk **不提供**封闭的 `createAuthPlugin` 工厂——它只导出可复用的基础块,开发者自己写 `beforeCommand` + `beforeRequest` 组装。

cli-sdk 出的基础块(从主包 `@renxqoo/cli-sdk` import):

| 基础块 | 作用 |
|---|---|
| `fileStore({ dir })` / `memoryStore()` | 凭证存储(ConfigStore 实现) |
| `defaultProviders()` / `flagProvider` / `envProvider` / `fileProvider` / `oauthProvider` | provider chain 的默认 provider |
| `resolveWithChain(providers, pctx)` / `resolveIdentityWithChain(providers, pctx)` | 跑 chain 取 token / identity |
| `injectAuthHeader(req, token, style)` | 按 authStyle(bearer/x-api-key/basic)注入 header |
| `createOn401Hook({cfg, store, namespace})` | 401 singleflight refresh hook(返回的函数挂 Plugin 的 `_transportConfig.on401`) |
| `deviceAuthorization` / `pollDeviceToken` / `refreshAccessToken` / `getUserInfo` / `revokeToken` / `registerClient` | OAuth device flow 端点 |

#### 如何写 auth Plugin(参考 `apps/crm/src/auth.ts` 的 `createCrmAuth`)

下面是一个完整的 auth Plugin 工厂示例。业务包照着这个骨架写,可换 provider、换 header 注入、换 identity 来源:

```ts
import {
  type Plugin, type CredentialsApi, type CommandContext,
  type ProviderContext, type IdentityHint,
  fileStore, defaultProviders, resolveWithChain, resolveIdentityWithChain,
  injectAuthHeader, createOn401Hook, AuthenticationError,
} from '@renxqoo/cli-sdk'

export function createCrmAuth<State extends { user?: unknown }>(opts: {
  namespace: string
  dir: string                     // 必填:凭证目录(业务包声明,如 ~/.rxcli)
  authStyle?: 'bearer' | 'x-api-key' | 'basic'
  oauth?: { baseUrl: string; clientId: string; clientSecret: string }
}): Plugin<State> & { _transportConfig?: { on401?: () => Promise<string | null> } } {
  const store = fileStore({ dir: opts.dir })  // dir 必填,无默认
  const providers = defaultProviders()
  const authStyle = opts.authStyle ?? 'bearer'
  // 401 singleflight refresh hook(有 oauth 配置才创建)
  const on401 = opts.oauth
    ? createOn401Hook({ cfg: opts.oauth, store, namespace: opts.namespace })
    : undefined

  return {
    name: `auth:${opts.namespace}`,
    enforce: 'pre',
    _transportConfig: on401 ? { on401 } : undefined,   // ★ 挂这里 cli-sdk 请求层才会用

    async beforeCommand(ctx) {
      // ① provider chain 取 token(命中即停)
      const pctx: ProviderContext = { namespace: opts.namespace, configStore: store, args: {}, env: process.env }
      const resolved = await resolveWithChain(providers, pctx)
      if (!resolved) throw new AuthenticationError({ subtype: 'no_credentials', message: '未配置凭证', hint: '设置 XXX_API_KEY 环境变量' })

      // ② 把 store 包装成 ctx.credentials(命令运行时 API)
      ;(ctx as any).credentials = {
        get: async ns => { /* 透传到 store.loadCredentials */ },
        save: (ns, d) => store.saveCredentials(ns, d),
        clear: ns => store.clearCredentials(ns),
      }

      // ③ scopes(让 ctx.auth.requireScope 工作;api-key 场景无 scopes → 不检查)
      ctx.auth._setScopes?.(resolved.token.scopes)

      // ④ identity(填信封顶层 + state.user)
      const identity = await resolveIdentityWithChain(providers, pctx)
      ;(ctx as any)._identity = identity ?? undefined
      if (identity) ctx.state.user = { userId: identity.userId, name: identity.name }

      // ⑤ 缓存 token 供 beforeRequest 用(挂 ctx,避免并发命令串)
      ;(ctx as any)._authToken = resolved.token.token
    },

    async beforeRequest(ctx, req) {
      const token = (ctx as any)._authToken
      if (token) injectAuthHeader(req, token, authStyle)   // ★ 按 authStyle 注入 header
    },
  }
}
```

**三个钩子的职责:**

| 出口 | 在 auth Plugin 里做什么 |
|---|---|
| `beforeCommand` | 跑 provider chain 取 token;包装 `store` 成 `ctx.credentials`;调 `ctx.auth._setScopes` 注入 scopes;跑 `resolveIdentityWithChain` 填 identity + `ctx.state.user`;缓存 token |
| `beforeRequest` | 用 `injectAuthHeader(req, token, authStyle)` 按 authStyle 注入 `Authorization: Bearer xxx` / `X-Api-Key: xxx` / `Authorization: Basic xxx` |
| `_transportConfig.on401` | `createOn401Hook(...)` 返回的 hook 挂这里;cli-sdk 请求层遇到 401 时调它,singleflight refresh 后自动重试 |

**关键纪律:**
- 认证用 `beforeCommand` + `beforeRequest` 两个标准钩子,不发明新机制。
- token 缓存挂在 `ctx`(`_authToken`)而非闭包变量,避免并发命令间串。
- 401 refresh 是请求层(框架)的能力,但**执行能力**(怎么 refresh、怎么落盘)由 auth Plugin 通过 `on401` 提供。没挂 `on401` 的 auth Plugin 不支持 401 自动续期。
- 业务包可以完全不参考 `createCrmAuth` 骨架,自己写——只要遵守 `Plugin` 接口和上面的契约。

详见 `05-credentials.md`。

### transform vs format 的分层

`beforeOutput`(transform)和输出格式化(format)是**两层,不能合并**:

```
run() 返回结构化数据
  ↓ beforeOutput 插件(业务包定义)→ 改 payload,但仍是结构化(StructuredData)
  ↓ cli-sdk 包成信封 + 序列化(format:JSON/table)
  ↓ stdout
```

| 层 | 谁定义 | 输入→输出 | 例子 |
|---|---|---|---|
| transform (`beforeOutput`) | 业务包插件 | 结构化→StructuredData | 删字段、改字段名、(以后)脱敏 |
| format | cli-sdk | 结构化→字节流 | `{...}`→JSON 文本 或 表格 |

**transform 永远不能返回 string**(StructuredData 类型排除),否则破坏管道契约。

### 生命周期总图

```
插件 beforeCommand(pre→normal→post)    填 state、改 args
  ↓
命令 run(args, ctx)                     业务逻辑,ctx.get 发请求,return {data,meta}
  ├ 每次 ctx.get/post:
  │    插件 beforeRequest(pre→normal→post)  改 req(加 header/签名/改 path)
  │    → 真正发请求(cli-sdk 内部,带鉴权)
  │    插件 afterRequest(pre→normal→post)   审计/日志(只读 res)
  ↓
插件 beforeOutput(pre→normal→post)      transform data(返回 StructuredData)
  ↓
框架序列化 → stdout                       信封(框架调,业务包不调)

任意阶段抛错 → 插件 onError 链(每个都跑)→ 渲染错误信封到 stderr + exit code
```

---

## 分页实现

业务命令在 `run` 里手动驱动,`meta.pagination` 自己填(决策清单 #9:agent 自决续拉,不强制流式)。

### 简单分页(透传后端的 page/pageSize)

```ts
list: defineCommand({
  name: 'list', description: '查询订单列表',
  args: { limit: { type: 'number', default: 30 }, offset: { type: 'number', default: 0 } },
  async run(args, ctx) {
    const res = await ctx.get('/orders', { limit: args.limit, offset: args.offset })
    return {
      data: res.data.items,
      meta: {
        count: res.data.items.length,
        pagination: {
          complete: !res.data.hasMore,
          pages: 1,
          items: res.data.items.length,
          nextToken: res.data.hasMore ? String(args.offset + args.limit) : undefined,
        },
      },
    }
  },
})
```

### 游标分页(GraphQL/现代 API)

```ts
list: defineCommand({
  name: 'list', description: '查询订单列表',
  args: { cursor: { type: 'string', desc: '分页游标(从 nextToken 取)' } },
  async run(args, ctx) {
    const res = await ctx.get('/orders', { cursor: args.cursor })
    return {
      data: res.data.edges.map(e => e.node),
      meta: { pagination: {
        complete: !res.data.pageInfo.hasNextPage,
        nextToken: res.data.pageInfo.endCursor,
      } },
    }
  },
})
```

**关键:`complete` 和 `nextToken` 必须如实填。** agent 靠它们判断是否续拉。详见 `03-envelopes.md`。

---

## 上百接口怎么办:拆文件组装

接口多时,按业务域拆文件,在入口组装(决策清单 #19:v1 不做 resource 生成器)。组装规则用**显式 `namespaces` 字段**:

- **顶层命令**放 `commands`(其 key 就是命令名)→ `rxcli-crm <cmd>`
- **子命名空间组**放 `namespaces`(其 key 即子命名空间)→ `rxcli-crm <ns> <cmd>`

```ts
// src/commands/orders.ts
export const ordersCommands = defineCommands({ list: ..., get: ..., update: ... })

// src/commands/invoices.ts
export const invoicesCommands = defineCommands({ list: ..., generate: ... })

// src/index.ts —— 入口组装
export default defineCli<...>({
  name: 'crm',
  plugins: [auth],
  commands: {
    health: healthCmd,           // 顶层命令(可选)→ rxcli-crm health
  },
  namespaces: {
    orders:   ordersCommands,    // 子命名空间 → rxcli-crm orders list
    invoices: invoicesCommands,  // 子命名空间 → rxcli-crm invoices generate
  },
})
```

> **为什么用显式 `namespaces` 而非 spread/nested-duck-typing:** spread(`...ordersCommands`)会把 `list`/`get` 拍平,多业务域同名的 `list`/`get` 会键名冲突互相覆盖,且丢失子命名空间层级;duck-typing(value 有没有 `run` 来猜命令还是命名空间)则引入 TS 联合类型歧义。显式字段让 `commands` 和 `namespaces` 类型清晰分离,无歧义、无冲突。

**单业务域(独立 bin)无需 namespaces**:`defineCli({ name: 'orders', commands: ordersCommands })`,命名空间是 `name`(PipeRecord.type 兜底);终端命令名 `binName` 从 package.json 的 bin 自动探测,无需手写。

### defineCli 完整配置项参考

```ts
defineCli<State>({
  name: 'orders',                  // 必填:命名空间(PipeRecord.type 兜底、skill 标识用)
  binName?: 'rxcli-orders',        // 可选:终端 bin 名(help/SKILL.md 签名);自动从 package.json 探测,一般不用写
  description: '...',              // 必填
  plugins: Plugin[],               // 必填:所有扩展(含 auth,见下)
  commands: { ... },               // 必填:顶层命令组(key=命令名)→ rxcli-<name> <cmd>
  namespaces?: { ... },            // 可选:子命名空间组(key=子命名空间)→ rxcli-<name> <ns> <cmd>;单业务域不填
  skillsDir?: './skills',          // 可选:skill 目录(默认 ./skills)
  errorOnStatus?: Record<number | `${number}xx`, string>,  // 可选:status→错误自动 throw
  messages?: { ... },              // 可选:引导文案 i18n
})
```

**认证**:不在 defineCli 顶层配置,而是业务包自己写 auth Plugin(用 `fileStore`/`defaultProviders`/`injectAuthHeader` 等基础块组装)塞进 `plugins`(见 `05-credentials.md`)。cli-sdk 不提供封闭的 `createAuthPlugin`。

---

## 装载方式(同一套代码,两种用法)

### 方式 A:独立 bin(默认)

业务包 `package.json` 的 `bin` 字段决定 bin 名:

```json
{ "bin": { "rxcli-orders": "./dist/index.js" } }
```

装包后:`rxcli-orders list`。

### 方式 B:装进 rxcli 主包(成为子命令)

加 `"rxcli": {"plugin": true}` 标记,`@renxqoo/cli` meta 包启动时自动发现并注册为子命令:

```bash
npm i -g @org/rxcli-orders
rxcli orders list             # ← 自动注册(命名空间 = defineCli.name)
```

**业务包代码不变。**

### 方式 C:管道里组合

```bash
rxcli-orders list --status unpaid | rxcli-invoices generate
rxcli-orders list | rxcli-customers get
```

下游命令自动检测 stdin 是否管道调用(`ctx.pipe.isInPipe()`),无需声明 flag。

---

## 管道:作为下游命令

下游命令用 `ctx.pipe.in()` 读上游记录:

```ts
generate: defineCommand({
  name: 'generate', description: '生成发票',
  args: { orderId: { type: 'string' } },
  async run(args, ctx) {
    if (ctx.pipe.isInPipe()) {
      let count = 0
      for await (const rec of ctx.pipe.in()) {     // 异步迭代上游记录(PipeRecord)
        if (rec.type && rec.type !== 'orders') continue   // 按来源过滤(可选)
        await ctx.post('/invoices', { orderId: rec.id })
        count++
      }
      return { data: { generated: count } }
    }
    if (!args.orderId) throw new errs.ValidationError({ param: 'orderId', message: '需要 orderId 或管道输入' })
    const res = await ctx.post('/invoices', { orderId: args.orderId })
    return { data: res.data }
  },
}),
```

**管道传引用+ID**(决策清单 #11):链中传脱敏值 + 稳定 ID,下游用 ID 关联。详见 `01-cli-usage.md`。

---

## 测试:vitest + createTestCtx

cli-sdk 提供 `createTestCtx`,业务包用它 mock ctx 测 run 逻辑:

```ts
// src/commands/orders.test.ts
import { describe, it, expect } from 'vitest'
import { createTestCtx, errs } from '@renxqoo/cli-sdk'
import { ordersCommands } from './orders'

describe('orders list', () => {
  it('返回订单列表', async () => {
    // ① 造 mock ctx:mock request 方法(高层 get/post 都走 request,mock 它即可覆盖)
    const ctx = createTestCtx({
      request: async (opts) => {
        if (opts.path === '/orders') {
          return { status: 200, data: { items: [{ id: 'o_1', total: 100 }] }, headers: {} }
        }
        throw new Error(`unexpected ${opts.path}`)
      },
      state: {},            // 初始 state
    })
    // ② 直接调 run(args, ctx),拿返回值断言
    const result = await ordersCommands.list.run({ limit: 30, offset: 0 }, ctx)
    expect(result.data).toEqual([{ id: 'o_1', total: 100 }])
  })

  it('404 抛 NotFoundError', async () => {
    const ctx = createTestCtx({ request: async () => ({ status: 404, data: {}, headers: {} }) })
    await expect(ordersCommands.get.run({ id: 'x' }, ctx)).rejects.toBeInstanceOf(errs.NotFoundError)
  })
})
```

**纯函数测试**:`run(args, ctx)` 是普通函数,ctx 是注入的,mock `request` 就能测全部业务逻辑,不需要起真实 server。`createTestCtx` 还可注入 mock 的 `log`/`pipe` 等。

---

## 完整业务包示例(orders)

```ts
// src/commands/orders.ts
import { defineCommands, defineCommand, errs } from '@renxqoo/cli-sdk'

interface Order { id: string; total: number; status: string }
interface OrderListResult { items: Order[]; hasMore: boolean; nextCursor?: string }

export const ordersCommands = defineCommands({
  list: defineCommand({
    name: 'list', description: '查询订单列表',
    args: { limit: { type: 'number', default: 30 }, status: { type: 'string' } },
    async run(args, ctx) {
      const res = await ctx.get<OrderListResult>('/orders', { limit: args.limit, ...(args.status && { status: args.status }) })
      return {
        data: res.data.items,
        meta: { pagination: { complete: !res.data.hasMore, nextToken: res.data.nextCursor } },
      }
    },
  }),
  get: defineCommand<{ id: string }, Order>({
    name: 'get', description: '查询订单详情',
    args: { id: { type: 'string', required: true, positional: true } },
    async run({ id }, ctx) {
      const res = await ctx.get<Order>(`/orders/${id}`)
      if (res.status === 404) throw new errs.NotFoundError(`订单 ${id} 不存在`)
      return { data: res.data }
    },
  }),
})

// src/index.ts
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
  plugins: [auth],
  commands: ordersCommands,
  skillsDir: './skills',
})
```

---

## 开发者常犯的错(避坑)

1. **直接 `console.log` 到 stdout** → ❌ 破坏管道。用 `ctx.log`(stderr)记日志;要输出数据就 `return { data, meta }`。
2. **在 run 里处理鉴权** → ❌ 鉴权是 auth 插件的事(业务包自己写 auth Plugin,用 `defaultProviders`/`injectAuthHeader` 组装,见 `05-credentials.md`)。你只调 `ctx.get`。
3. **`beforeOutput` 返回字符串** → ❌ 破坏管道契约。返回 StructuredData(object/array/null)。
4. **不填 `pagination.complete`** → ❌ agent 会误以为拉完了。如实填。
5. **throw 裸 Error** → ❌ 用 `errs.*` 类型化错误。裸 Error 会被兜底成 `internal/unknown`,exit code 错、agent 会误解。throw 后会进 onError 链(插件可拦截),再渲染 stderr。
6. **把运行时状态乱塞 ctx** → ❌ ctx 没有开放扩展点(state 强类型,未声明访问报错)。运行时状态(user/traceId)由 auth 插件填到 `ctx.state`(声明过的字段),业务数据走 args 和返回值。
7. **手写 SKILL.md 命令表** → ❌ 用 `rxcli skills gen` 自动生成(见 `06-skills.md`),只手写语义部分。
8. **defineCli 写内联钩子** → ❌ 所有扩展统一成插件。内联需求写匿名插件塞 `plugins`。
