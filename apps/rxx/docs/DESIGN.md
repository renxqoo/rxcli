# rxxxx 技术实现设计文档

> **一句话定位**:让任何后端服务,出一份 manifest,就自动产出符合 [Agent Skills 开放标准](https://agentskills.io)的可执行 skill(含 CLI),并分发到 40+ agent 工具。

---

## 0. 文档定位与诚实声明

本文档是 `apps/rxxxx`(动态 CLI 运行时)的完整技术设计。它建立在多轮讨论收敛的结论之上,并整合了对 MCP 2026-07-28、Anthropic code-execution、Agent Skills 开放标准的实证调研。

**本文档必须如实记录的五件事:**

1. **"跨 agent skill 标准"不需要我们发明**——Agent Skills 已是 Anthropic 发起的开放标准,40+ 工具支持(Claude Code / Cursor / GitHub Copilot / VS Code / Codex / Gemini CLI / Roo Code / OpenHands / Goose / Spring AI 等,见 [agentskills.io](https://agentskills.io)),官方路径就是 `~/.agents/skills`。我们的 cli-sdk `targets.ts` 已经在同步这个路径。
2. **rxxxx 的定位因此收敛为"标准下最强的生产/分发工具链"**——不是做标准,是让"产出符合标准的 skill"这件事的成本降到最低(一份 manifest → 可执行 CLI + SKILL.md + 全 agent 分发)。
3. **rxxxx 是瘦客户端,控制点在 SaaS**——CLI 调的是已有 SaaS 接口,鉴权/权限/审计/合规/风控全在 SaaS 侧。rxxxx 只需保证"manifest 可信 + auth 正确透传",不重建治理。这把安全问题收敛成一条主轴:manifest 完整性。
4. **rxxxx 解决的是"agent 高效准确获取数据"**——不是"和 MCP 竞争"。它的价值是在 agent 获取数据的五个阶段(发现/选择/构造/解析/纠错)每一步提供确定性,降低 agent 的 token 消耗和出错率。
5. **动态 CLI 的覆盖力有天花板**——只有"参数 → HTTP → 字段映射"类命令能被 manifest 驱动;复杂逻辑(多步、分支、多源 fallback)必须回退静态。这不是缺陷,是必须写进文档的边界。

**企业级判断(第 7 章详述):rxxxx 当前是开发者工具,不是企业平台。但它接入"已有完善治理的 SaaS"时,企业不需要在 CLI 侧重建治理——控制点在 SaaS,这让企业采购逻辑比 MCP 更顺。**

---

## 1. 背景与竞品实况

### 1.1 已存在的、和我们重叠的东西

| 类别 | 代表 | 和 rxxxx 的关系 |
|------|------|----------------|
| **Agent Skills 标准** | [agentskills.io](https://agentskills.io) | **我们是它的工具链,不是竞争者**。SKILL.md 格式、`~/.agents/skills` 路径、progressive disclosure 三阶段,都已定义。rxxxx 产出的 skill 必须符合这个标准。 |
| **OpenAPI→CLI 生成器** | [danielgtaylor/openapi-cli-generator](https://github.com/danielgtaylor/openapi-cli-generator)、[Stainless](https://www.stainless.com/blog/stainless-cli-generator-your-api-now-with---help/)、[Fern](https://buildwithfern.com/post/generate-cli-from-openapi-spec) | **思路最近的前辈**。它们从 OpenAPI 生成静态 CLI 代码。rxxxx 的差异:① manifest 比 OpenAPI 高层(带分页/错误语义映射,对齐 envelope 契约);② 同时生成 skill + 分发,不只是 CLI;③ 运行时装配而非编译期生成。 |
| **MCP 2026-07-28** | [官方 RC](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) | **远程场景的进程税被无状态核心补上了**;本地 stdio 仍是 spawn-and-hold,但 Anthropic 的 code-execution 方向正在绕过常驻 server。rxxxx 不与 MCP 正面竞争,而是"给已有服务加 skill 壳"。 |
| **Anthropic code-execution** | [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) | **思路高度重叠**(工具是文件、agent 读 SKILL.md 发现、按需执行)。但它只在 Claude 平台内闭环。rxxxx 做的是跨 agent 通用版。 |
| **AgentFile** | [agentskills 讨论](https://github.com/agentskills/agentskills/discussions/179) | 声明式 agent 组合格式(Dockerfile for agents)。还在早期,值得观察但不构成竞争。 |

### 1.2 关键判断:rxxxx 的真实生态位

```
Agent Skills 标准(已存在,40+ agent 支持)
  ↓ 规定了 skill 长什么样、放哪里
  │
  ├── 手写 skill:开发者自己写 SKILL.md + 脚本(成本高,质量参差)
  ├── cli-sdk 静态路径:开发者写 TS → defineCli → gen.ts 生成 skill(质量高,门槛高)
  └── rxxxx 动态路径:开发者出 manifest → 一键生成可执行 skill + 分发(质量高,门槛低)← 这是我们
```

**rxxxx 是 Agent Skills 生态的"低门槛生产线"。** 它不发明标准,它让"按标准产出 skill"变得便宜。

### 1.3 rxxxx 相比 OpenAPI→CLI 生成器的差异(为什么不是直接用它们)

| 维度 | OpenAPI→CLI(Stainless/Fern) | rxxxx |
|------|------------------------------|-------|
| 输入 | OpenAPI(HTTP 接口描述) | manifest(命令 + HTTP 映射 + 分页/错误语义) |
| 输出 | 静态 CLI 源码(要编译/发版) | 运行时装配的 CLI + SKILL.md + 分发 |
| agent 发现 | 无(纯 CLI) | **核心能力**(SKILL.md + 40+ agent 目录分发) |
| 输出契约 | 各家自定义 | **对齐 cli-sdk envelope**(`{data,meta}` + 9 类错误) |
| 改服务 | 重新生成 + 发版 | 更新 manifest 即生效 |
| 鉴权 | 生成进代码 | 动态 `defineAuth`(复用 cli-sdk) |

**核心差异是"agent 发现"和"输出契约对齐"。** OpenAPI 生成器不为 agent 服务,rxxxx 是 agent-first 的。

### 1.4 skill+scripts vs skill+CLI(两种"让 agent 动手"的形态)

Agent Skills 标准允许 skill 目录带 `scripts/`(可执行脚本)。这是 skill+scripts。rxxxx/cli-sdk 走的是 skill+CLI(SKILL.md 指向独立 bin)。两者都能让 agent "动手",但本质不同。

| 维度 | skill + scripts | skill + CLI(rxxxx / cli-sdk) |
|------|----------------|------------------------------|
| 执行单元 | 一段脚本(python/node/bash) | 一个进程(独立 bin) |
| 依赖管理 | ❌ 谁来装 python?装哪些库? | ✅ CLI 自带依赖(npm 装一次) |
| 输出契约 | ❌ 脚本想输出什么就输出什么 | ✅ envelope `{data,meta}` 强制 |
| 错误契约 | ❌ exit code + stderr 各写各的 | ✅ 9 类 CliError 统一 |
| 参数校验 | ❌ 脚本自己解析 | ✅ parseArgs + validateArgsSpec |
| 鉴权 | ❌ 脚本自己处理 token | ✅ defineAuth 全套 OAuth |
| 管道 | ❌ 各脚本自己的 stdin/stdout | ✅ pipe.ts 统一 PipeRecord |
| 分页 | ❌ 每个脚本自己实现 | ✅ Pagination 契约 |
| agent 发现 | ✅ 同(都是 SKILL.md) | ✅ 同 |
| 人能用终端敲 | ⚠️ 别扭(`python scripts/x.py`) | ✅ 原生(`rxcrm orders list`) |
| 跨平台 | ❌ 脚本路径/换行/shebang 问题 | ✅ CLI 跨平台 |
| 可审计 | ⚠️ 逻辑藏在代码里 | ✅ manifest 声明式 |

**核心差异:一个是"程序",一个是"契约"。** skill+scripts 把任意代码塞给 agent 跑,输出/错误/行为全靠那段代码,没有契约约束。skill+CLI 给 agent 一个符合契约的接口——agent 知道传 `--limit 10` 一定校验成 number、输出一定是 `{data,meta}`、401 一定变成 `token_expired`。**这个"知道"是 agent 能可靠反复调用的前提。**

**两者的定位:不竞争,分层。**
- skill+scripts 是 skill 生态的**汇编层**——灵活、无契约,适合一次性脚本/纯本地操作/原型验证
- skill+CLI 是**应用层**——可靠、带契约,适合需要 agent 反复调用的业务接口

```
可靠性 低 ←────────────────────────────────→ 高
    skill+scripts(任意脚本) → skill+CLI(cli-sdk 静态) → skill+CLI(rxxxx 动态)
灵活性 高 ←────────────────────────────────→ 低
```

rxxxx 和 cli-sdk 静态包在可靠性上同档(都强制 envelope + 错误 + 校验),区别只是命令定义来源。**skill+scripts 是另一回事,不直接竞争,服务的场景不同。**

---

## 2. 系统架构

### 2.1 总体分层

```
┌─────────────────────────────────────────────────────────────────┐
│  rxxxx 静态 App(写死在代码里,defineCli 装配)                    │
│    rx init <url>   rx list   rx update <name>   rx remove <name> │
│    rx run <service> <...>                                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ rx run 时,按 argv 选服务
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  动态调度器(每次 rx run 现场 build 一个临时 defineCli App)        │
│    1. loadManifest(name)      读 ~/.rxcli/registry/<name>/...    │
│    2. buildAuthFromManifest   manifest.auth → defineAuth(...)    │
│    3. buildCommands           manifest → 通用执行器 → CommandSpec │
│    4. defineCli({...})        装配独立 App(原生 2 层路由)         │
│    5. app.run(serviceArgs)    转发剩余 argv                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         rxcrm App     rxerp App    rxfoo App
        (独立 auth)   (独立 auth)  (独立 auth)
```

### 2.2 为什么是"调度器 + 现场装配",不是"一个装了所有命令的 App"

**决定性约束**(来自 cli-sdk `define.ts` 源码验证):

- `defineCli` 是**启动期闭装配**——`commands`/`namespaces` 在调用那一刻收进闭包内的 `routed` 数组,运行时无法 push。
- `matchRoute`(`cli-argv.ts:85`)本身支持任意深度最长匹配,但 `defineCli` 的 options 只认 **2 层**(`namespace.cmd`)。
- 多服务叠加需要 3 层(service.namespace.cmd),defineCli 表达不了。

**所以架构选型:每个动态服务 = 一个独立的 defineCli App。** rxxxx 是调度器,`rx run rxcrm orders list` 剥成 `serviceArgs=['orders','list']`,现场为 rxcrm build App,内部就是原生 2 层路由。

**这个架构带来的好处:**
- auth 按服务隔离(每个服务自己的 `defineAuth`)
- baseUrl / errorOnStatus 按服务隔离
- 完整复用 cli-sdk 的 pipeline / transport / envelope / pretty / 管道
- 对 cli-sdk 零改动,纯上层公开 API

**代价(可接受):**
- 每次执行动态命令要冷装配(读 manifest + defineAuth + defineCommand,< 10ms,经源码验证 defineAuth 构造期不发网络请求)
- `rx run <service>` 的 `run` 是硬前缀(shim 层消化成 `rxcrm ...`)

### 2.3 模块划分

```
apps/rxxxx/
  src/
    index.ts                  入口:argv 分流(静态命令 vs rx run 调度)
    manifest/
      schema.ts               Manifest 的 TS 类型定义(开放契约)
      loader.ts               拉 manifest / 读缓存 / 验签 / 校验
      validator.ts            manifest 合法性校验(必填字段、http.method 合法等)
    executor/
      dynamic-command.ts      manifest 命令 → CommandSpec(manifestToCommand)
      placeholders.ts         {id}/{limit} 占位符替换 + encodeURIComponent
      response-map.ts         response.data / pagination 字段映射
    commands/
      init.ts                 rx init <url>
      list.ts                 rx list
      update.ts               rx update <name>
      remove.ts               rx remove <name>
      run.ts                  rx run <service> ...  调度入口
    shim.ts                   生成 ~/.rxcli/bin/<name> 转发脚本(跨平台)
    registry.ts               ~/.rxcli/registry 读写(已装服务索引)
  package.json                bin: { rx: ./dist/index.js }
  docs/DESIGN.md              本文档
```

---

## 3. Manifest Schema(开放标准,不绑 cli-sdk)

### 3.1 设计原则

1. **manifest 是 cli-sdk `CommandSpec` 的可序列化子集**——`run` 函数被拆成 `{http, response}` 两段可序列化描述。
2. **schema 独立于 cli-sdk**——manifest 的类型定义不 import cli-sdk 内部类型,只对齐结构。这样其他语言/工具也能实现。
3. **最小表达力**——只覆盖"参数 → HTTP → 字段映射"。刻意不做表达式 DSL,避免滑向"JSON 里的编程语言"。
4. **声明 `dynamic: false` 回退**——manifest 可以声明某命令无动态实现,提示安装静态包。

### 3.2 完整 schema(以 crm orders 为样例)

```jsonc
{
  // —— 服务元信息 ——
  "name": "rxcrm",                    // 必填,全局唯一,作为 bin 别名 / registry key / PipeRecord.type
  "description": "Cordys CRM 销售全流程",
  "version": "1.3.0",                 // 语义版本,update 时比对
  "minCliVersion": "1.2.0",           // 要求的 rxxxx 最低版本,不满足拒绝执行
  "homepage": "https://crm.example.com/cli",

  // —— 鉴权(全部可序列化,喂给 defineAuth)——
  "auth": {
    "type": "oauth2",                 // 目前只支持 oauth2
    "baseUrl": "https://auth.example.com",
    "scope": "orders:read products:read invoices:read",
    "grantTypes": ["device_code", "refresh_token"],
    "credentialNamespace": "crm",
    "flow": "device",                 // device | authorization_code | client_credentials
    "clientMetadata": {               // RFC 7591
      "client_name": "rxcrm",
      "token_endpoint_auth_method": "client_secret_basic"
    }
  },

  // —— API 端点 ——
  "api": {
    "baseUrl": "https://crm.example.com"
  },

  // —— HTTP 状态 → 错误子类型映射(对齐 cli-sdk errorOnStatus)——
  "errorOnStatus": {
    "401": "token_expired",
    "403": "forbidden",
    "404": "not_found",
    "5xx": "server_error"
  },

  // —— 命令(对齐 defineCli 的 namespaces 结构)——
  "namespaces": {
    "orders": {
      "list": {
        "description": "查询订单列表(仅本人订单)",
        "args": {                     // 直接就是 cli-sdk ArgsSpec 形态
          "limit":  { "type": "number", "desc": "返回数量上限" },
          "cursor": { "type": "string", "desc": "续拉游标" }
        },
        "http": {
          "method": "GET",
          "path": "/proxy/api/orders",
          "query": { "limit": "{limit}", "cursor": "{cursor}" }
        },
        "response": {
          "data": "orders",            // 从 res.data 里取 orders 字段当 data
          "pagination": {
            "complete":  { "field": "hasMore", "invert": true },
            "nextToken": { "field": "nextCursor" }
          }
        }
      },
      "get": {
        "description": "查询单个订单详情",
        "args": {
          "id": { "type": "string", "required": true, "positional": true, "desc": "订单 ID" }
        },
        "http": {
          "method": "GET",
          "path": "/proxy/api/orders/{id}"     // path 占位符
        },
        "response": { "data": "." }             // "." = 整个 res.data
      }
    },
    "products": {
      "create": {
        "description": "创建商品(写操作)",
        "args": {
          "name":  { "type": "string", "required": true, "desc": "商品名" },
          "price": { "type": "number", "required": true, "desc": "价格(分)" }
        },
        "http": {
          "method": "POST",
          "path": "/proxy/api/products",
          "body": { "name": "{name}", "price": "{price}" }
        },
        "response": { "data": "." }
      }
    }
  },

  // —— 回退声明:本服务有命令无法动态化 ——
  "fallback": {
    "quote": {
      "dynamic": false,
      "reason": "多源 fallback,需静态代码",
      "installHint": "npm i -g @renxqoo/a-stock"
    }
  }
}
```

### 3.3 字段规范

#### args(`ArgsSpec`)
与 cli-sdk `ArgsSpec` **结构完全一致**(零摩擦):
- `type`: `"string" | "number" | "boolean" | "array"`
- `required?`: boolean
- `positional?`: boolean
- `desc?`: string(进 SKILL.md 参数表)
- `default?`: unknown

#### http(HTTP 映射,替代 run 函数的"发请求"部分)
- `method`: `"GET" | "POST" | "PUT" | "PATCH" | "DELETE"`
- `path`: string,含 `{argName}` 占位符(替换前对值做 `encodeURIComponent`,且禁止含 `/`)
- `query?`: `Record<string, string>`,值含 `{argName}` 占位符;值为空字符串的键**省略**(不发)
- `body?`: `Record<string, unknown>`,值含 `{argName}` 占位符(仅 POST/PUT/PATCH)
- `headers?`: `Record<string, string>`,值含 `{argName}` 占位符

#### response(响应映射,替代 run 函数的"包成 CommandResult"部分)
- `data`: string,字段路径。`"."` = 整个 res.data;`"orders"` = res.data.orders;`"data.items"` 支持点号嵌套
- `pagination?`:
  - `complete`: `{ "field": "hasMore", "invert"?: true }` —— 读 res.data.hasMore,invert 后填入 `Pagination.complete`
  - `nextToken`: `{ "field": "nextCursor" }` —— 读 res.data.nextCursor
  - `items?`: `{ "field": "orders" }` —— 可选,记录数(通常从 data 数组长度推断)
- `meta?`: 额外 meta 字段映射(键 → field 路径)

### 3.4 占位符语法(刻意最小化)

- **唯一语法**:`{argName}`,替换为 args 中同名参数的字符串化值
- **path 占位符**:替换前强制 `encodeURIComponent`,且结果含 `/` 则拒绝(path traversal 防护)
- **query/body 占位符**:值转字符串后放进对应位置;空字符串/undefined 的键省略
- **不支持的**(刻意):条件表达式、循环、函数调用、模板运算。**这是边界,不是缺陷。**

### 3.5 与 OpenAPI 的关系

manifest 不是 OpenAPI 的替代,是**更高层的封装**:
- OpenAPI 描述"HTTP 接口长什么样"(path/method/schema)
- manifest 描述"命令怎么映射到 HTTP + 结果怎么对齐 envelope 契约"
- **未来可加 `rx init --from-openapi <url>`**:从 OpenAPI 自动生成 manifest 草稿(人再补 description/pagination)

---

## 4. 核心模块设计

### 4.1 通用执行器(`executor/dynamic-command.ts`)

把 manifest 的一个命令,包成 cli-sdk 的 `CommandSpec`:

```ts
import { defineCommand, errs, type CommandSpec, type CommandContext, type CommandResult } from "@renxqoo/agent-data-cli";
import { fillPath, fillMap } from "./placeholders.js";
import { extractData, mapPagination } from "./response-map.js";

interface ManifestCommand {
  description: string;
  args?: Record<string, any>;
  http: { method: string; path: string; query?: any; body?: any; headers?: any };
  response: { data: string; pagination?: any; meta?: any };
}

export function manifestToCommand(name: string, mc: ManifestCommand): CommandSpec {
  return defineCommand({
    name,
    description: mc.description,
    args: manifestArgsToZod(mc.args),  // manifest ManifestArgsSpec → Zod schema(cli-sdk 统一输入契约)
    async run(ctx, args): Promise<CommandResult | void> {
      // 1. 占位符替换 + 安全编码
      const path = fillPath(mc.http.path, args);
      const query = mc.http.query ? fillMap(mc.http.query, args) : undefined;
      const body = mc.http.body ? fillMap(mc.http.body, args) : undefined;
      const headers = mc.http.headers ? fillMap(mc.http.headers, args) : undefined;

      // 2. 调 ctx(鉴权 / 401 续期 / envelope 全部由 cli-sdk 接管)
      const res = await ctx.request({
        method: mc.http.method as any,
        path,
        query,
        body,
        headers,
      });

      // 3. 字段映射 → CommandResult(对齐 envelope 契约)
      const data = extractData(res.data, mc.response.data);
      const pagination = mc.response.pagination
        ? mapPagination(res.data, mc.response.pagination)
        : undefined;

      return {
        data,
        meta: pagination ? { pagination } : undefined,
      };
    },
  });
}
```

### 4.2 占位符替换(`executor/placeholders.ts`)

**这是安全关键模块**,path traversal 注入面就在这。

```ts
// path 占位符:强制 encodeURIComponent,禁含 /
export function fillPath(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => {
    const val = args[key];
    if (val === undefined || val === null) {
      throw new Error(`Missing path parameter: ${key}`);
    }
    const encoded = encodeURIComponent(String(val));
    if (encoded.includes("/")) {
      throw new Error(`Path parameter ${key} contains illegal '/' after encoding`);
    }
    return encoded;
  });
}

// query/body/headers 占位符:转字符串,空值省略
export function fillMap(
  template: Record<string, string>,
  args: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(template)) {
    if (typeof v !== "string") { out[k] = String(v); continue; }
    const filled = v.replace(/\{(\w+)\}/g, (m, key: string) => {
      const val = args[key];
      return val === undefined || val === null ? "" : String(val);
    });
    if (filled === "") continue;       // 空值省略(不发)
    out[k] = filled;
  }
  return out;
}
```

### 4.3 响应映射(`executor/response-map.ts`)

```ts
// 字段提取:"." = 整个对象;"orders" = obj.orders;"a.b" = obj.a.b
export function extractData(resData: unknown, path: string): unknown {
  if (path === ".") return resData;
  let cur: any = resData;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[seg];
  }
  return cur ?? null;
}

export function mapPagination(
  resData: any,
  spec: { complete?: { field: string; invert?: boolean }; nextToken?: { field: string } },
): { complete: boolean; nextToken?: string } {
  let complete = true;
  if (spec.complete) {
    const raw = resData?.[spec.complete.field];
    complete = spec.complete.invert ? !raw : !!raw;
  }
  let nextToken: string | undefined;
  if (spec.nextToken) {
    nextToken = resData?.[spec.nextToken.field];
  }
  return { complete, nextToken };
}
```

### 4.4 动态 auth(`buildAuthFromManifest`)

**已验证可行**——`defineAuth` 的 `DefineAuthOptions` 全部是可序列化配置,无业务必须传函数。manifest 的 `auth` 段直接喂:

```ts
import { defineAuth, type Plugin } from "@renxqoo/agent-data-cli";
import type { Manifest } from "../manifest/schema.js";

export async function buildAuthFromManifest<State>(m: Manifest): Promise<Plugin<State>> {
  if (!m.auth) {
    // 无 auth 的服务:返回一个 no-op plugin,api.baseUrl 直连
    return { name: "no-auth", enforce: "pre", beforeCommand: async () => {} };
  }
  return defineAuth<State>({
    credentialNamespace: m.auth.credentialNamespace,
    baseUrl: m.auth.baseUrl,
    scope: m.auth.scope,
    flow: m.auth.flow,
    clientMetadata: m.auth.clientMetadata,
    bearerToken: process.env[`${m.name.toUpperCase()}_BEARER_TOKEN`],  // env 注入(沙箱/CI)
  });
}
```

### 4.5 调度入口(`commands/run.ts`)

```ts
import { defineCli } from "@renxqoo/agent-data-cli";
import { loadManifest } from "../manifest/loader.js";
import { buildAuthFromManifest } from "../executor/dynamic-command.js";
import { manifestToCommand } from "../executor/dynamic-command.js";

export async function runService(serviceName: string, serviceArgs: string[]): Promise<void> {
  const manifest = await loadManifest(serviceName);      // 读缓存
  const auth = await buildAuthFromManifest(manifest);

  // manifest.namespaces → defineCli namespaces(通用执行器包每个命令)
  const namespaces: Record<string, CommandGroup> = {};
  for (const [nsName, group] of Object.entries(manifest.namespaces ?? {})) {
    namespaces[nsName] = {};
    for (const [cmdName, cmdManifest] of Object.entries(group)) {
      namespaces[nsName][cmdName] = manifestToCommand(cmdName, cmdManifest);
    }
  }

  const app = defineCli({
    name: manifest.name,
    binName: serviceName,               // help / SKILL 签名显示 rxcrm orders list
    description: manifest.description,
    plugins: [auth],
    commands: {},                       // 动态服务全部走 namespace
    namespaces,
    baseUrl: manifest.api.baseUrl,
    errorOnStatus: manifest.errorOnStatus,
    // skillsDir 不设:动态服务的 skill 由 init 时单独生成,不在此 App 内
  });

  await app.run(serviceArgs);           // ['orders','list'] → 原生 2 层路由
}
```

### 4.6 init 命令(`commands/init.ts`)

完整链路:

```
rx init https://crm.example.com/cli-manifest
  │
  ├─ 1. 拉取 manifest(HTTPS 强制)
  ├─ 2. 验签(如有签名)+ sha256 记录
  ├─ 3. manifest 合法性校验(必填字段、http.method 合法、name 合法)
  ├─ 4. 信任确认(展示 host / scope / 写操作数,用户 y/N)
  ├─ 5. 缓存:~/.rxcli/registry/<name>/manifest.json
  ├─ 6. 生成 SKILL.md(复用 cli-sdk generateSkillSkeleton + manifest 命令)
  ├─ 7. 分发 skill 到各 agent 目录(复用 cli-sdk syncSkills / DEFAULT_SKILL_TARGETS)
  ├─ 8. 生成 shim:~/.rxcli/bin/<name> (跨平台)
  └─ 9. 确保 ~/.rxcli/bin 在 PATH(必要时写 rc 文件,幂等)
```

---

## 5. 安全设计

**这是整个方案能不能上线的红线。** 从远程 URL 拉 manifest 并按其定义发起 HTTP,等于用户授权一个第三方服务代表自己发请求。

### 5.0 安全模型的根本转变:控制点在 SaaS,不在 CLI

**关键洞察:rxxxx 是瘦客户端,调的是已有完善治理的 SaaS 接口。** 鉴权/权限/审计/合规/风控全在 SaaS 侧,CLI 只是透传凭证。这把安全问题从"重建一套治理"收敛成**一条主轴:manifest 可信**。

| 企业级关注的控制点 | 谁负责 | 说明 |
|-------------------|--------|------|
| 鉴权(能调什么) | **SaaS** | OAuth scope 决定 token 能做什么 |
| 权限(RBAC,scope 之外) | **SaaS** | 服务端自己判,403 拒绝 |
| 审计(谁调了什么) | **SaaS** | 每次 API 调用服务端记日志 |
| 数据合规 | **SaaS** | 数据访问控制在服务端 |
| 限流/风控 | **SaaS** | 服务端网关 |
| **manifest 完整性** | **rxxxx** | **这是 rxxxx 唯一的核心安全责任** |
| auth token 正确透传 | rxxxx | 复用 cli-sdk defineAuth,已有 |
| manifest 指向合法 host | rxxxx | SSRF 防护 + host 绑定签名 |

**只要 manifest 可信 + auth 正确透传,所有业务安全由 SaaS 兜底。** rxxxx 不碰数据存储、不重建权限、不做二次审计——这些 SaaS 都做了。这让安全面从"开放系统到处漏风"收敛成"一个可做硬的窄面"。

**对企业采购方的意义:rxxxx 不引入新的控制面。** 企业已经信任自己的 SaaS(那套 auth/审计/合规已经过审),rxxxx 只是让 agent 用同一套凭证调同一个 SaaS,不绕过任何已有控制。"agent 调我的 SaaS 会绕过 auth 吗?" → 不会,CLI 透传 token。"agent 能调超出 scope 的接口吗?" → 不能,SaaS 卡死。这些答案对采购方是满意的。

### 5.1 威胁模型

| 威胁 | 攻击方式 | 后果 |
|------|---------|------|
| **manifest 中间人篡改** | HTTP 明文拉取,或 HTTPS 证书攻击 | 塞入恶意 endpoint,用户授权后中招 |
| **path traversal** | `{id}` 传 `../../etc/passwd` | 越权访问 path |
| **SSRF** | manifest 的 api.baseUrl 指向内网 | 借用户机器探测/攻击内网 |
| **scope 膨胀** | manifest 声明全量 scope | 过度授权 |
| **恶意写操作** | manifest 藏 DELETE/PUT,用户没注意 | 数据被删/改 |
| **shim 劫持** | shim 脚本被改写 | 任意命令执行 |
| **manifest 钓鱼** | 诱导用户 init 恶意 URL | 装入恶意服务 |

### 5.2 必须实现的安全控制

#### S1. HTTPS 强制(必做)
- manifest URL 必须 `https://`,明文 `http://` 直接拒绝
- 例外:显式 `--allow-insecure` flag(仅本地开发,文档警告)

#### S2. manifest 签名验证(必做,推荐默认开)
- manifest 可携带 `signature` 字段(服务端私钥签 sha256 of body)
- rxxxx 内置可信公钥集(或 `~/.rxcli/trusted-keys`)
- **无签名的 manifest**:`init` 时红色警告 + 必须二次确认,不能默认信任
- 这是对标 npm provenance / cosign 的做法

#### S3. 信任确认 UI(必做)
`init` 必须展示并要求显式 yes/no:
```
⚠️ 该服务将代表你发起请求:
  host:    https://crm.example.com (GET/POST)
  auth:    https://auth.example.com (OAuth device flow)
  scope:   orders:read products:read
  写操作:  1 个 (POST /proxy/api/products)
  签名:    ✅ 已验证 / ⚠️ 未签名
是否信任并安装? [y/N]
```

#### S4. SSRF 防护(必做)
- manifest 的 `api.baseUrl` / `auth.baseUrl` 禁止指向:
  - `127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`、`::1`、`fc00::/7`
  - `.local`、`localhost`
- 例外:`--allow-private-endpoints`(本地开发,警告)

#### S5. path traversal 防护(必做,见 4.2)
- path 占位符替换后 `encodeURIComponent`,且结果含 `/` 拒绝

#### S6. scope 最小化(必做)
- `init` 时显示 manifest 声明的全部 scope,让用户看见
- 如果 scope 含通配(`*` / `offline_access` 之外的全量),额外醒目警告

#### S7. shim 不可写保护(必做)
- `~/.rxcli/bin/<name>` 写入后 `chmod 500`(仅 owner 可执行)
- 每次 `rx run` 前可选校验 shim 的 sha256(防篡改,牺牲一点启动速度)

#### S8. registry 完整性(必做)
- `~/.rxcli/registry/<name>/manifest.json` 写入时原子写(临时文件 + rename)
- 记录 `source_url` / `fetched_at` / `sha256` / `signature_verified`
- `rx list` 展示这些,让用户审计

#### S9. remove 必须清理干净(必做)
- 删 manifest 缓存
- 删 shim 文件
- 删已分发的 skill(各 agent 目录里对应的)
- 不删 rc 文件的 PATH 行(标记块保留,幂等)

### 5.3 安全的"不做"边界

刻意不做、避免过度复杂:
- **不做 manifest 内容沙箱**:manifest 只声明 HTTP 调用,不执行任意代码,所以不需要沙箱
- **不做 per-call 权限二次确认**:init 时已确认,执行时不再每次问(否则失去 CLI 的快)
- **不做 manifest 漂移自动检测**:不每次执行都重新拉 manifest 验签(性能 + 离线),靠 `rx update` 手动
- **不重建 SaaS 已有的治理**:鉴权/权限/审计/合规全由 SaaS 兜底,rxxxx 不重复造轮子(见 5.0)

### 5.4 签名信任链(核心安全机制)

**既然安全收敛成"manifest 可信",manifest 签名就是整个方案的信任根基。** 必须做扎实。

#### 谁来签 manifest:三种信任模型

| 模型 | 机制 | 适用场景 | 第一版 |
|------|------|---------|--------|
| **A. Publisher 自签名(TOFU)** | SaaS 生成密钥对,私钥签 manifest,公钥首次 HTTPS 拉取后 pinning | 开源生态,任何 SaaS 都能发布 | ✅ 第一版 |
| **B. 中心 registry 签名** | SaaS 发布到 registry.rxcli.io,registry 签名,CLI 内置 registry 公钥 | 企业内部版(企业自己当 registry) | 企业版 |
| **C. TLS 证书绑定** | 签名 key = SaaS 域名证书 | 理论可行但验证成本高 | ❌ 不做 |

**决策:开源版走 A,企业版走 B。** A 让任何人都能发布,B 让企业能控制内部。

#### 签名方案:Ed25519

- **为什么选 Ed25519**:快(签名/验证都是微秒级)、小(公钥 32B / 签名 64B)、现代(无 RSA 的参数陷阱)、Node 内置 `crypto.sign/verify` 原生支持
- **不选 RSA**:兼容性广但慢、大、参数容易设错
- **不选 ECDSA**:可以但 Ed25519 更简单

#### 签名内容(host 绑定)

签名不只签 manifest body,**host 也要进签名内容**,防 host 篡改:

```
签名输入 = sha256(
  manifest.api.baseUrl 的 host +     // crm.example.com
  manifest.auth.baseUrl 的 host +    // auth.example.com
  canonicalJSON(manifest body)        // body 的规范化序列化
)
```

攻击者就算重签 manifest(用自己的私钥),host 对不上 CLI pinning 的期望,验签失败。

#### 验签流程

```
manifest 拉取后:
  1. 读 manifest.sig(签名,base64)
  2. 读 manifest.pubkey 或用本地 pinning 的公钥
  3. 重算签名输入(含 host 绑定)
  4. Ed25519 验证
  5. 验通过 → 缓存 + 记录 sha256 + signature_verified=true
  6. 验不过 → 拒绝,红色警告,不缓存

公钥来源:
  首次:从 manifest URL 同源 HTTPS 拉 /cli-pubkey.pem
  后续:用本地 pinning 的公钥(~/.rxcli/registry/<name>/pubkey.pem,防公钥被换)
```

#### TOFU(首次信任)窗口的缩小

首次拉公钥那一刻是唯一能被中间人攻击的窗口。缩小手段:
- **HTTPS 已挡绝大多数**(中间人要伪造证书)
- **CLI 展示公钥指纹**(SSH 模式):`公钥指纹: a1:b2:c3:...,请到 https://crm.example.com/.well-known/pubkey-fp 核对`
- **可选(后续迭代):DNS TXT 记录交叉验证**(`_rxcli.crm.example.com TXT "fp=..."`)
- 第一版不做 DNS,TOFU + HTTPS + 指纹展示已够用

#### 签名相关字段(manifest 扩展)

```jsonc
{
  // ... 其他字段
  "signature": "base64-ed25519-signature",
  "publicKey": "base64-ed25519-public-key",   // 首次发布用;后续 pinning
  "keyFingerprint": "sha256:...",              // 供用户肉眼核对
  "signedAt": "2026-08-11T00:00:00Z",
  "signedHosts": ["crm.example.com", "auth.example.com"]  // 进签名内容的 host
}
```

---

## 6. 必须实现 vs 可后续

### 6.1 MVP(最小可用,验证价值主张)

| 模块 | MVP 范围 |
|------|---------|
| manifest schema | GET 命令 + path/query 占位符 + response.data 映射 |
| 通用执行器 | 仅 GET,仅 path/data 映射 |
| init | 拉 + 缓存 + 生成 SKILL + shim(无签名,明文信任确认) |
| run | 调度 + defineCli 装配 |
| list / remove | 基础版 |
| auth | 暂用静态 defineAuth 或 bearerToken env,MVP 不做动态 auth |
| 分发 | 复用 cli-sdk syncSkills(已有) |

**MVP 目标**:能 `rx init <url>` → `rxcrm orders list` 跑通,skill 被 Claude Code 发现。

### 6.2 必须实现(产品上线前)

- **S1~S9 安全控制全部到位**(尤其签名、SSRF、path traversal)
- 动态 auth(defineAuth from manifest)
- POST/PUT/DELETE 支持(body 占位符)
- pagination 映射(complete/nextToken)
- errorOnStatus 映射
- update 命令(版本对比)
- 跨平台 shim(macOS/Linux `.sh` + Windows `.cmd`/`.ps1`)

### 6.3 可后续迭代

- 签名基础设施(公钥分发机制)
- OpenAPI → manifest 自动转换器
- 动态/静态混合(同一服务部分命令静态)
- 共享登录态(多服务一套身份)
- manifest marketplace / 发现服务
- per-skill scope 过滤(已有 `skillsScopes` 能力)

---

## 7. 成为产品的关键

### 7.0 核心价值命题:让 agent 高效准确获取数据

**rxxxx 的产品价值,不在于"和 MCP 竞争",而在于"在 agent 获取数据的全链路提供确定性"。** 这是比"打 MCP"更扎实的产品论证——不谈竞争,谈 agent 拿数据到底要什么。

#### agent 获取数据的五个阶段(每一步都有不确定性)

| 阶段 | 不确定性 | rxxxx / cli-sdk 的确定性机制 |
|------|---------|---------------------------|
| **1. 发现**(怎么知道有这个工具) | 极高(agent 可能幻觉不存在的接口) | SKILL.md + progressive disclosure(低 token 发现) |
| **2. 选择**(多个都能用,挑哪个) | 中(工具越多越易选错) | 命名空间域划分,降低选择空间 |
| **3. 构造**(怎么填对参数) | 高(agent 生成参数可能错) | args 类型/required/positional + 运行时校验 |
| **4. 解析**(拿到结果怎么理解) | 中(结构各异) | envelope `{data,meta}` 永远一致 |
| **5. 纠错**(出错了怎么办) | 高(瞎试或求助) | 9 类类型化错误,agent 能自纠 |

**"高效准确"= 这五步每一步的确定性。** 每加一层确定性,agent 的准确率上升、token 消耗下降。

#### 高效的两层含义

| 层面 | 机制 | rxxxx 贡献 |
|------|------|-----------|
| **token 高效**(上下文成本) | progressive disclosure:只读相关 skill 的 name+desc | SKILL.md AUTO-GEN 块只放命令索引,参数细节在 references 按需加载 |
| **轮次高效**(调用次数) | 分页契约清晰 + 批量参数 | manifest 声明 pagination,args 声明批量 |

**对比:MCP 把所有工具定义灌进 context(100 个工具可能 50k token);skill progressive disclosure 只读相关的(100 个 skill 的 name+desc 可能 2k token)。rxxxx 走的是 token 效率最高那档。**

#### 纠错环节的对比(决定 agent 能否自恢复)

| 错误场景 | 无契约(裸 shell/原生 API) | 有契约(rxxxx / cli-sdk) |
|---------|---------------------------|------------------------|
| 404 | 返回 HTML "Not Found" | `{subtype:"not_found"}`,agent 知道"换 ID 或先 list" |
| 401 | 返回 "Unauthorized" | `token_expired`,agent 知道重新登录 |
| 400 参数错 | 返回 "Bad Request" | `missing_required:{param:"limit"}`,agent 知道补哪个 |
| 网络错 | 超时无信息 | `network_error`,agent 知道稍后重试 |
| 403 权限 | 返回 "Forbidden" | `forbidden`,agent 纳手,告诉用户没权限 |

**这就是"手脚"为什么比"裸 shell"或"直接调 API"更让 agent 高效准确——五步全链路,每一步都有机制消除不确定性。** agent 不怕工具少,怕工具不可靠。

#### 两个必须承认的边界

- **description 质量是人定的**:manifest 的 description 写得好 agent 匹配准,写得烂选错。rxxxx 能提供 `rx manifest lint` 工具 + 模板,但不能强制。像 npm 包 README 质量,平台只能给工具。
- **复杂查询表达不了**:"查上个月销量前三的商品"这类聚合/排序/过滤,manifest 的"参数→单次 HTTP"模型覆盖不了。要么 SaaS 提供专门接口,要么 agent 调 list 拉原始数据自己算。**rxxxx 的强项是调现成接口,不是做复杂分析。**

### 7.1 三个"关键中的关键"

#### 关键 1:杀手级演示(决定冷启动成败)
> 一个真实服务,`rx init` 之后,Claude Code / Cursor / ZCode **三个 agent 同时发现并调用**。

这个演示如果做出来,比任何技术文档都有说服力。它是"一次定义,全 agent 覆盖"的直观证据。**这是产品冷启动最有力的武器。**

#### 关键 2:输出契约一致性(决定 agent 信任)
动态命令的输出必须和静态命令**逐字节契约一致**(envelope `{data,meta}` + 9 类错误 + 分页)。这是 agent 信任 CLI 的根基——agent 不能因为命令是动态的就拿到不同结构。**守不住这条,产品价值归零。** 这也是 7.0 讲的"五步确定性"的基础。

#### 关键 3:供给端冷启动(决定生态生死)
rxxxx 的成败不取决于技术,取决于"有没有人愿意把服务做成 manifest"。降低门槛:
- manifest 比 OpenAPI 简单(带语义映射)
- 比 MCP server 简单(不跑进程)
- 比 cli-sdk 静态包简单(不写 TS)
- **第一批 10-20 个有吸引力的 manifest 是生死线**

### 7.2 企业级判断(诚实评估)

#### 当前形态:rxxxx 是开发者工具,不是企业平台

企业级产品的真正门槛是"可控"而非"方便"。rxxxx 现在的设计卖的是"方便",企业 IT 关注的是"可控"——一个让开发者随便 `init` 任意 URL 就能代表自己发请求的工具,企业 IT 会直接拉黑。

**但因为 SaaS 兜底(见 5.0),这个判断要分情况:**

| 场景 | 能否企业用 | 理由 |
|------|-----------|------|
| 接入**已有完善治理的 SaaS**(OAuth/审计/合规齐备) | ✅ 能 | 控制点在 SaaS,rxxxx 只透传凭证。企业采购逻辑顺 |
| 接入**无治理的裸 API** | ❌ 不能 | 没有兜底,rxxxx 自己又没有治理,企业不敢用 |
| 作为**企业内部 agent 平台的组件** | ✅ 能(最有前景) | 嵌进 Backstage/内部 IDP,企业自己当 manifest registry |

**对企业采购方的好消息:rxxxx 不引入新的控制面。** 企业已信任自己的 SaaS(那套 auth/审计/合规已过审),rxxxx 让 agent 用同一套凭证调同一个 SaaS,不绕过任何已有控制。这比 MCP 的企业销售逻辑还顺——MCP 要企业额外跑 server 进程、额外做 server 侧治理;rxxxx 让企业复用 SaaS 已有治理,零额外建设。

#### 企业变现的三条路(按可行性排)

| 路径 | 企业变现 | 成功概率 | 适合 |
|------|---------|---------|------|
| **A. 开发者工具**(现在的 rxxxx) | 几乎不可能 | 小众活跃 20% | 不图钱,图技术乐趣和声誉 |
| **B. 内部开发者平台组件**(嵌进企业 IDP) | **有可能** | 中等 40% | 想企业变现,愿意做平台集成 |
| **C. 企业 agent 治理平台**(最重) | 最大但最难 | 低 20% | 愿意 all-in 创业且有资源 |

**建议走 B**:用 rxxxx 的技术,卖给"建内部 agent 平台"的企业团队。这群人真实存在且没人专门服务。rxxxx 做"企业内部 manifest registry + 治理钩子",嵌进 Backstage/内部门户。能用 rxxxx 80% 代码,只加治理层。

#### 企业版的关键思维转换

**企业不买"让开发者更方便"的东西,企业买"让 IT 能控制"的东西。** rxxxx 现在是前者,要变企业级,核心不是加功能,是**把控制权从开发者手里挪到企业 IT 手里**。企业版的第一行代码应该是"IT 批准这个 manifest,员工才能装"。

### 7.3 为什么没人做(历史经验判断)

#### 同类产品的历史命运

| 历史对照 | 命运 | 对 rxxxx 的启示 |
|---------|------|----------------|
| OpenAPI→CLI 生成器(danielgtaylor/Stainless/Fern) | 小众活跃,靠卖 SDK 活 | 纯"生成 CLI"从未大众化 |
| oclif(Salesforce/Heroku) | 成熟但受众固定(本要做 CLI 的公司) | CLI 框架市场容量有限 |
| Homebrew/APT(声明式分发) | 成功,因为是 OS 级标准 | rxxxx 不是 OS 级 |
| nvm/fnm/pyenv(PATH shim) | 成功,因为解决版本管理刚需 | "命令发现"刚需度低一档 |
| VS Code 扩展/Obsidian 插件(双边市场) | 头部活,长尾全死 | 双边市场死亡率极高 |

#### "没人做"的真实原因(四条,部分对冲)

1. **企业投 MCP 不投 CLI**:企业决策跟标准不挑技术最优。MCP 有 Anthropic 背书,选 MCP 是"安全选择"。选 rxxxx 出了事 CTO 要担责。
2. **CLI 框架市场历来小**:投入产出比不如 agent 编排/RAG/评估。不是没看见,是池子太浅。
3. **Agent Skills 标准太新(2025 下半年才开放)**:窗口才打开不到一年,大部分人在观望。**这对 rxxxx 有利——"没人做"部分是"太新",不全是"不值得"。**
4. **双边市场结构性死亡**:做"通用工具生成/分发平台"的,基本死在供给端冷启动。聪明人看过这个模式,判断"起不来"。

#### 核心判断:盲区还是死区?

**没人做,一半是"想通了的人还少"(思维盲区),一半是"真不值得"(死区)。** 整个 agent 工具圈都在往"建新控制层"想(MCP 建 server 治理、Anthropic 建 code-execution 治理、创业公司建 agent 治理平台),**没人想到"控制点本来就在 SaaS,做个不添层的瘦客户端就行"**。rxxxx 抓的是这个盲区。

但盲区能维持多久是问题——一旦有人想通,复制成本低(manifest schema + 签名机制别人一个月能做)。**所以"先发优势 + 持续迭代"是唯一护城河。** 12-18 个月内大概率会有人盯上"Agent Skills 企业工具链"这个位置。

### 7.4 产品风险的诚实清单

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| Agent Skills 标准被 Anthropic 收紧(只服务自家) | 高 | 我们同时覆盖 40+ agent,Anthropic 收紧不影响其余 |
| 供给端冷启动失败(没人发 manifest) | 高 | 先自己出 10 个高质量 manifest(rxcordys / rxopen 等改造) |
| MCP 生态碾压(开发者宁可付进程税也要 MCP 的丰富度) | 中 | 不正面竞争,做"给已有服务加 skill 壳"的互补层 |
| manifest 质量参差(description 烂 → agent 匹配不准) | 中 | 提供 `rx manifest lint` 工具 |
| OpenAPI 生成器加入 skill 支持 | 中 | 我们更高层(带 envelope 语义),且 agent-first |
| 安全漏洞(manifest 钓鱼/SSRF) | 高 | S1~S9 + 签名信任链全部到位,默认不信任未签名 manifest |
| "没人做"是死区不是盲区(做出来也没人用) | 中 | 阶段 0 零代码验证先打第一颗子弹,看响不响 |
| 被快速复制(无锁定护城河) | 中 | 先发 + 持续迭代 2-3 年;企业版走 registry 模式建立锁定 |

### 7.5 成功的标准(可衡量的)

- **冷启动**:发布 30 天内有 10 个非自维护的 manifest 被发布
- **使用**:某个 agent 工具的社区里有人自发推荐"用 rxxxx 装这个服务"
- **标准对齐**:产出的 skill 通过 Agent Skills 官方一致性检查(若有的话)
- **安全**:零 manifest 钓鱼 / SSRF 事故
- **企业**:至少 1 家企业把 rxxxx 嵌进内部 IDP 作为 agent 工具组件

---

## 8. 实施路线

### 阶段 0:验证(1-2 天,零代码)
- 手写一份 crm 的 manifest JSON
- 手写对应的 SKILL.md
- 手动放到 `~/.claude/skills`,验证 Claude Code 能发现并正确调用
- **目的**:证明"manifest → skill → agent 可用"的体验是真的,再投入写 runtime

### 阶段 1:MVP(1-2 周)
- 实现 schema + loader + GET 通用执行器 + init + run + list + remove
- 不做签名(明文信任确认),不做动态 auth(用 bearerToken env)
- 跑通一个真实服务

### 阶段 2:安全加固(1 周)
- S1~S9 全部实现
- 动态 auth(defineAuth from manifest)
- 跨平台 shim

### 阶段 3:分发验证(3-5 天)
- 生成 skill,分发到 7 个 agent 目录
- 在 Claude Code / Cursor / ZCode 三个 agent 实测发现 + 调用
- 录屏 / 截图,做杀手级演示素材

### 阶段 4:开放(持续)
- manifest schema 文档化(独立 README,不绑 cli-sdk)
- OpenAPI → manifest 转换器
- 自维护 10 个高质量 manifest 冷启动供给

---

## 9. 与 cli-sdk 的关系

### 9.1 零侵入原则
- rxxxx 只 import `@renxqoo/agent-data-cli` 的公开 API(见 `index.ts` 导出)
- **不修改 cli-sdk 任何文件**
- cli-sdk 的其他使用者(crm / a-stock / rxopen / 60s / cordys-crm)零影响

### 9.2 rxxxx 复用的 cli-sdk 能力

| cli-sdk 能力 | rxxxx 怎么用 |
|--------------|-------------|
| `defineCli` / `defineCommand` | 动态服务的 App 装配 |
| `defineAuth` | manifest.auth → 动态鉴权插件 |
| `ctx.request` / `ctx.get/post/...` | 通用执行器发请求 |
| envelope(serializeSuccess/Error) | 自动(走 defineCli) |
| `errs` 9 类错误 | errorOnStatus 映射 + 参数校验 |
| `parseArgs` / `validateArgsSpec` | manifest.args 直接复用 |
| `generateSkillSkeleton` / `refreshAutogen` | init 时生成 SKILL.md |
| `syncSkills` / `DEFAULT_SKILL_TARGETS` | init 时分发到 40+ agent |
| `runCommand` / pipeline | 自动(走 defineCli) |

### 9.3 反过来:cli-sdk 不依赖 rxxxx
- cli-sdk 保持"agent-native CLI 框架"的定位
- rxxxx 是 cli-sdk 的一个"动态入口"应用,不是 sdk 的一部分
- 两者可独立演进

---

## 10. 待决问题(Open Questions)

这些问题文档不强行定,留给实现时验证:

1. **manifest 的版本兼容策略**:`minCliVersion` 不满足时,是拒绝执行还是降级?
2. **同服务多版本**:用户能否同时装 rxcrm v1 和 v2?建议第一版禁止(避免复杂度)
3. **manifest 撤销**:服务端能否发布"撤销声明"让本地自动 remove?需不需要 CRL 机制?
4. **skill 与 manifest 的同步更新**:服务端改了 manifest(加了命令),本地 skill 何时更新?`rx update` 手动 vs 自动
5. **Agent Skills 标准的执行模型**:skill 内的 `scripts/` 由谁执行?各 agent 实现不一致,rxxxx 生成的 skill 是否要带可执行脚本,还是只带"调用 rx 命令"的指令?
6. **共享登录态**:多服务同一 IdP,能否共享 token?第一版建议独立,体验问题待真实场景验证
7. **签名基础设施的运营**:开源版 TOFU 够用,但 publisher 公钥的分发/撤销/轮换机制需要明确(公钥过期/泄漏怎么办)
8. **企业版 registry 的形态**:企业自己当 registry(模型 B)时,manifest 发布/审批/签名流程长什么样,怎么嵌进 Backstage
9. **"盲区窗口"的时间估计**:12-18 个月内大概率有人盯上"Agent Skills 企业工具链",rxxxx 怎么在窗口内建立先发优势——是靠技术深度、供给端数量、还是企业案例
10. **description 质量的量化标准**:`rx manifest lint` 该检查什么——description 长度/关键词覆盖/命名规范?需要实测 agent 匹配准确率反推标准

---

## 参考资料

**Agent Skills 标准(核心对齐)**
- [Agent Skills 开放标准](https://agentskills.io/home) —— rxxxx 对齐的核心标准,40+ agent 工具支持
- [Agent Skills 官方规范](https://agentskills.io/specification) —— SKILL.md 格式定义
- [Anthropic: Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) —— skill 含可执行代码的官方定义
- [Agent Skills GitHub](https://github.com/agentskills/agentskills) —— 标准开发仓库

**MCP 与竞品动态**
- [MCP 2026-07-28 RC](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) —— MCP 最大修订,无状态核心
- [MCP 2026-07-28 迁移指南](https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate) —— 具体变更
- [MCP Just Went Stateless — Microsoft](https://techcommunity.microsoft.com/blog/appsonazureblog/mcp-just-went-stateless-%25E2%2580%2594-what-the-2026-spec-changes-about-scaling-on-app-servic/4530222) —— Streamable HTTP + 无状态
- [MCP 本地 stdio 进程模型 — Truefoundry](https://www.truefoundry.com/blog/mcp-stdio-vs-streamable-http-enterprise) —— spawn + lifecycle coupled
- [MCP server 僵尸进程 — Cursor 论坛](https://forum.cursor.com/t/mcp-server-processes-are-not-terminated-and-accumulate-over-time-causing-memory-leaks/143181) —— 进程税实证
- [Everything Wrong with MCP](https://blog.sshh.io/p/everything-wrong-with-mcp) —— MCP 缺陷综述
- [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) —— 思路重叠的官方方向
- [Daniel Miessler: Anthropic downplays MCPs](https://danielmiessler.com/blog/anthropic-downplays-mcps) —— MCP 降级为功能目录的分析

**OpenAPI→CLI 前辈**
- [danielgtaylor/openapi-cli-generator](https://github.com/danielgtaylor/openapi-cli-generator) —— 最近的前辈
- [Stainless CLI Generator](https://www.stainless.com/blog/stainless-cli-generator-your-api-now-with---help/) —— 商业 OpenAPI→CLI
- [Fern: Generate CLI from OpenAPI](https://buildwithfern.com/post/generate-cli-from-openapi-spec) —— 商业方案
- [Nordic APIs: Auto-generating CLI from OpenAPI](https://nordicapis.com/auto-generating-a-cli-from-openapi-specification/) —— 技术综述

**学术与分析**
- [arXiv: Agent Skills 架构与挑战](https://arxiv.org/html/2602.12430v4) —— 学术视角的 7 个开放问题(含跨平台移植、权限模型)
- [AgentFile 讨论](https://github.com/agentskills/agentskills/discussions/179) —— 声明式 agent 组合

**安全参考**
- [Twelve Trust Boundaries: 供应链防御](https://dev.to/aws-builders/twelve-trust-boundaries-a-field-guide-to-supply-chain-defense-after-54ok) —— 信任边界设计
- [Red Hat: MCP 安全风险与控制](https://www.redhat.com/en/blog/model-context-protocol-mcp-understanding-security-risks-and-controls) —— MCP 安全分析(反面对照)
