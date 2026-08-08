# 00 · 架构总览

> 本文档是 rxcli 的设计锚点。所有后续文档(命令使用、SDK 指南、信封、错误、凭证、skill)都以本文档的全局决策为准,实现阶段不允许偏离。

---

## 一句话定位

**`@renxqoo/agent-data-cli` 是一个 agent-native CLI 框架包:业务包依赖它,只用声明"调哪个后端接口、字段怎么处理",就能获得鉴权、脱敏、信封、错误分类、管道组合、skill 发现等全套能力。**

它解决的核心矛盾是:**后端接口千差万别(REST/GraphQL/RPC、OAuth/API-key/mTLS、各种字段命名),但"把数据交给 agent 的方式"是通用的。** 框架把前者交给业务包,后者收敛成框架能力。

---

## 设计要点

| 维度       | 做法                                                         |
| ---------- | ------------------------------------------------------------ |
| 形态       | **monorepo + SDK 框架**:agentdatacli 框架包 + 业务包独立 npm |
| 业务包接入 | 别人写独立 npm 包,依赖 agentdatacli                          |
| 编程风格   | **function 风格 + 配置对象声明**(defineCli/defineCommand)    |
| 输出       | **统一信封**(成功 stdout / 错误 stderr)                      |
| 错误       | **9 类类型化错误 + exit code 映射 + 结构化信封**             |
| 凭证       | **provider chain**,可扩展任意鉴权方式                        |
| 管道       | **unix 管道**,传引用+ID,本地过滤交 jq                        |
| 上百接口   | **拆文件组装**(按业务域 namespaces 聚合)                     |
| skill      | **从 defineCommands 自动生成命令文档** + 人工语义区          |

---

## 三层架构

```
┌──────────────────────────────────────────────────────────────┐
│  agent / 终端用户                                              │
│  ─ 用 unix 管道组合命令                                         │
│  ─ 读 skill 自服务发现命令                                      │
│  ─ 解析 stdout 信封拿数据,看 stderr 信封处理错误               │
├──────────────────────────────────────────────────────────────┤
│  业务包(独立 npm,@org/rxcli-xxx)                            │
│  ─ 写 function 风格命令(defineCommand,带 <Args,Result> 泛型)│
│  ─ 用 ctx.get/post 请求(无 client 层)                       │
│  ─ 写插件(认证也是 Plugin,用 cli-sdk 基础块自己组装)        │
│  ─ 写 SKILL.md(语义部分,命令表自动生成)                     │
│  ─ 业务知识全在这层,cli-sdk 不懂业务                          │
├──────────────────────────────────────────────────────────────┤
│  @renxqoo/cli-sdk(基础包,本仓维护)                          │
│  ─ ctx 请求方法(get/post/...,带鉴权 + 401 自动续期)         │
│  ─ 信封:成功/失败的统一输出契约                                │
│  ─ 错误分类:9 类 + exit code + 类型化构造器                   │
│  ─ 认证:auth 是 Plugin,cli-sdk 出基础块(fileStore /        │
│    defaultProviders / injectAuthHeader / createOn401Hook 等),│
│    开发者用基础块组装;无封闭工厂                              │
│  ─ 插件系统:vite 式 Plugin + 5 钩子 + enforce 三档            │
│  ─ 管道:PipeRecord 类型 + stdin/stdout                       │
│  ─ skill:list/read/sync + 命令文档自动生成                    │
│  ─ 配置:ConfigStore(按 namespace 隔离凭证,业务包各自 baseUrl) │
└──────────────────────────────────────────────────────────────┘
```

**关键边界:cli-sdk 不懂业务,业务包不懂框架细节。** 两者的契约面是 `ctx`(命令运行时上下文)和"信封"。

---

## 三个参考实现

设计借鉴了两个工业级 CLI,每个借鉴的方面不同:

| 参考                          | 借鉴点                                                                                                                 | 为什么                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **mmx**(MiniMax CLI, TS)      | client 能力复用、SDK/CLI 共享请求层、凭证解析优先级链、exit code 体系                                                  | 单一后端的 SDK 形态范本        |
| **lark-cli**(飞书 CLI, Go)    | 结构化错误信封(RFC 7807)、成功信封 + pagination meta、provider chain、skill 系统、stdout/stderr 纪律、命令文档自动生成 | agent-first CLI 框架的治理范本 |
| ** rxcli 前版**(本作者前一版) | device flow 登录、401 singleflight refresh、gateway 中间层代理、skill reader                                           | 直接演进基础,迁移而非重发明    |

**注意:借鉴的是模式,不是复制代码。** lark-cli 是 Go,我们是 TS;mmx 是单一后端产品,我们是框架。每个借鉴点都按 TS 框架场景做了改造(详见各专题文档)。

---

## monorepo 结构

```
 rxcli/
├── pnpm-workspace.yaml          packages: ['packages/*', 'apps/*']
├── tsconfig.base.json           共享 TS 配置
├── package.json                 根(私有,只放脚本和共享 devDeps)
├── README.md                    仓库总览
│
├── packages/
│   └── cli-sdk/                 ★ @renxqoo/cli-sdk(基础库,本仓维护)
│       ├── src/                 实现代码(types/define/oauth/credentials/skills/qrcode/...)
│       ├── docs/                ★ 设计文档(本目录,随包发布)
│       └── package.json
│
└── apps/                        业务应用(独立 npm,用 cli-sdk 构建)
    └── crm/                     ★ 示例应用(多业务域:orders/products/invoices/account + auth)
        ├── src/                 命令 + 自写 auth Plugin + 入口
        ├── skills/              skill 文档(给 agent 读)
        └── package.json         bin: rxcli;"rxcli":{plugin:true}
```

**装载方式(同一套业务代码,两种用法):**

- **独立 bin**:`npm i @renxqoo/rxcli-crm` 后直接 `rxcli orders list`
- **装进 rxcli 主包**:带 `"rxcli": {"plugin": true}` 标记的全局包,被 `rxcli` 自动发现为子命令 → `rxcli orders list`

详见 `02-sdk-guide.md` 的"装载方式"章节。

---

## 全局决策清单

这是整个项目讨论后定稿的决策表。**后续所有文档和实现都必须遵守,改动需重新讨论。**

| #   | 维度      | 决策                                                                                                                                                              | 详见文档            |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | 架构      | pnpm monorepo;`@renxqoo/cli-sdk` 基础包 + 业务包独立 npm                                                                                                          | 本文档              |
| 2   | 装载      | 独立 bin 为主 + 可被 rxcli 主包装载为子命令                                                                                                                       | `02-sdk-guide.md`   |
| 3   | 编程风格  | **function 风格 + 配置对象声明**(不用 class 继承)                                                                                                                 | `02-sdk-guide.md`   |
| 4   | 请求      | **取消 client 概念**(无 createClient/Client);请求方法 `get/post/...` 全挂 `ctx`;鉴权归 cli-sdk 内部 + auth 插件                                                   | `02-sdk-guide.md`   |
| 5   | transport | 低层 `ctx.request` + 高层便利方法(`ctx.get` 等);**REST 先行**                                                                                                     | `02-sdk-guide.md`   |
| 6   | 横切机制  | **vite 式插件**(钩子是 Plugin 接口,defineCli 用 `plugins: []`,不做内联钩子)                                                                                       | `02-sdk-guide.md`   |
| 7   | 错误      | 类型化错误 + 结构化信封到 stderr + **9 类 exit code**;throw 进 onError 插件链                                                                                     | `04-errors.md`      |
| 8   | 信封      | 成功也信封 `{ok, data, meta}`;**stdout=数据 / stderr=一切**                                                                                                       | `03-envelopes.md`   |
| 9   | 分页      | 信封 `meta.pagination` + `complete` + `nextToken`,**agent 自决续拉**                                                                                              | `03-envelopes.md`   |
| 10  | 认证      | **auth 是 Plugin**,开发者用 cli-sdk 基础块(provider chain / injectAuthHeader / oauth)自己组装;**无封闭工厂**(无 `createAuthPlugin`);取消 `credentials.register()` | `05-credentials.md` |
| 11  | 管道      | unix 管道;**传引用+ID**;本地过滤交 jq                                                                                                                             | `01-cli-usage.md`   |
| 12  | 过滤      | `--limit/--offset` 透传后端;`--filter`/选字段**交 jq**                                                                                                            | `01-cli-usage.md`   |
| 13  | 全局 flag | `--json` + 服务端查询参数;其余交 jq/sort                                                                                                                          | `01-cli-usage.md`   |
| 14  | 脱敏      | 前版不做特性;以后经 beforeOutput 插件实现                                                                                                                         | `02-sdk-guide.md`   |
| 15  | skill     | list/read/sync + **defineCommands 自动生成命令文档**                                                                                                              | `06-skills.md`      |
| 16  | 测试      | vitest + `createTestCtx`                                                                                                                                          | `02-sdk-guide.md`   |
| 17  | 类型      | 命令三泛型 `<Args, Result>` + 业务包级 `<State>`;`ctx.state` 强类型防乱塞;请求泛型 `ctx.get<T>()` 可选                                                            | `02-sdk-guide.md`   |
| 18  | 插件钩子  | 5 个:beforeCommand/beforeRequest/afterRequest/beforeOutput/onError;**enforce 三档**(pre/normal/post);onError 链式                                                 | `02-sdk-guide.md`   |
| 19  | 前版不做  | resource() 生成器、写入确认、OpenAPI 自动注册                                                                                                                     | 本文档              |

### 几个决策的"为什么"(简版,详见专题文档)

- **function 而非 class**:框架场景要组合(管道)、要 tree-shaking(发 npm)、要好测(mock 参数),class 继承在这三方面都劣于 function。
- **取消 client**:client 同时承担"请求能力"和"业务自定义参数"两个职责会混淆;请求挂 ctx 更直接,鉴权归 auth 插件,业务状态归 `ctx.state`(强类型)。少一层间接,少一个混乱源。
- **vite 式插件而非内联钩子**:插件是独立可复用模块(可发 npm),钩子是插件接口;内联需求写匿名插件。统一一个扩展机制,避免"逻辑该放 run 还是钩子"的困惑。
- **认证做成 Plugin(用基础块组装,无封闭工厂)**:provider chain 的优先级链语义(逐个尝试、命中即停)由 cli-sdk 的基础块(`defaultProviders`/`resolveWithChain`/`injectAuthHeader`/`createOn401Hook`)提供,开发者自己写 `beforeCommand` + `beforeRequest` 组装 auth Plugin。取消全局 register,也取消封闭的 `createAuthPlugin` 工厂——业务包掌握认证全流程,框架只出可复用基础块(参见 `apps/crm/src/auth.ts` 的 `createCrmAuth` 参考实现)。
- **命令三泛型**:类似 axios 声明请求/响应类型——一个命令把参数类型、返回类型、state 类型都声明清楚,TS 全面检查;渐进式(不写泛型默认 unknown/{}),不强制。
- **ctx.state 强类型**:`defineCli<State>` 声明才能访问,未声明报错。从结构上消灭"乱塞"——不是开放 bag,是强类型共享渠道(插件间传递数据)。
- **enforce 三档**:解决"加 header 的先跑、签名最后跑"的顺序问题(pre 加基础参数 → normal 业务 → post 签名收尾)。
- **agent 自决续拉分页**:不假设"必须拉全量",给 agent `complete:false + nextToken`,让它按场景决定续不续。
- **本地过滤交 jq**:cli-sdk 不重复造 jq。stdout 是结构化 JSON,右边的过滤/选字段/排序全用 unix 工具链。
- **stdout/stderr 铁律**:管道能组合的根是 stdout 纯净。日志/进度/错误提示全 stderr,否则 `rxcli a | jq` 混进一行"加载中"整个管道就废了。

---

## 文档索引

| 文档                | 给谁看           | 内容                                                                                      |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `00-overview.md`    | 所有人           | 架构、分层、决策清单(本文档)                                                              |
| `01-cli-usage.md`   | 终端用户 / agent | 怎么调用命令、管道、分页、exit code                                                       |
| `02-sdk-guide.md`   | 业务包开发者     | 怎么写业务包、ctx 接口、**插件系统**、auth 插件、命令三泛型                               |
| `03-envelopes.md`   | 实现者 / agent   | 成功/错误信封的字段契约                                                                   |
| `04-errors.md`      | 业务包开发者     | 9 类错误、何时 throw、hint、onError 插件链                                                |
| `05-credentials.md` | 业务包开发者     | **写 auth Plugin**(provider chain / injectAuthHeader / oauth)、provider chain、自定义凭证 |
| `06-skills.md`      | 业务包开发者     | skill 系统、命令文档自动生成                                                              |

---

## 实现阶段路线(本次只做第一阶段)

1. **第一阶段(本次)**:仓库脚手架 + 全套设计文档(本目录)
2. 第二阶段:实现 cli-sdk 代码(types → ctx 请求层 + 认证基础块(provider chain / injectAuthHeader / on401) → 命令框架 + 插件系统 → 输出信封层 → skills → 错误层)
3. 第三阶段:建示例业务包(迁 orders)做端到端验证 + vitest
4. 第四阶段:`@renxqoo/cli` meta 包(install 向导 + 跨包 skill 聚合 + 插件发现)

**文档先行:第一阶段文档评审通过后,才进入代码实现。写代码时不允许偏离本文档的决策清单。**
