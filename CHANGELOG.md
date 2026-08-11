# Changelog

本文件记录 rxcli monorepo 中所有公开包的用户可见变更，格式参考 Keep a Changelog。

版本 PR 必须把对应内容从 `Unreleased` 整理到正式版本标题：

```text
## [@scope/package@1.2.3] - YYYY-MM-DD
```

一个 PR 更新多个包版本时，每个包都必须有独立的正式版本标题。

## [Unreleased]

### Added

- `defineCommand` 直接接受 Zod 4 `input.schema`，同一 Schema 提供结构化载荷类型推导、运行时校验和 JSON Schema 发现，并统一执行严格 JSON、脱敏、dry-run、确认和幂等策略。

### Fixed

- CRM 订单分页帮助、双语 README 和 Skill 统一使用实际 JSON wire 字段 `meta.pagination.next_token`，并同步 mock 订单金额示例。
- `cli-sdk` 深度 review 修复 14 个 bug(TDD):
  - `skills sync` 改用原子替换(拷到临时目录再 rename),拷贝中途失败不再丢失目标目录已有数据。
  - `skills gen --init` 对已存在的 `SKILL.md` 默认拒绝覆盖,需显式 `--force`(保护手写语义内容)。
  - `listSkills` 遇 broken symlink / 不可读条目改为 `lstatSync` + 单条 try/catch 跳过,不再整列崩溃。
  - 401 续期失败 / 重试仍 401 / 凭证不可刷新 三处统一走 `errorOnStatus[401]` 配置优先的出口,不再硬编码 `AuthenticationError(token_expired)` 绕过用户配置。
  - transport 新增 `onResponse` 回调,context 经它驱动 `afterRequest` 审计 —— 修复初次 401 响应不触发审计钩子的盲区。
  - 网络层失败时合成的 `{status:0}` 响应附带真实 `error` 对象,审计插件可诊断根因。
  - `runOnError` 观察者插件抛错时记 `ctx.log.warn`,不再静默吞掉(对齐 `afterRequest` 处理风格)。
  - `--no-<typo>`(拼错的 boolean)不再吞下一个 token 作值,改为抛 `unknown_flag` 提示可能拼写错误。
  - `errorOnStatus` 具体码(如 503)永远优先于通配(如 `5xx`),与对象键声明序/键形态无关(两遍扫描,不依赖 JS 引擎排序)。
  - `beforeOutput` 链中任一插件(含中间插件)返回 `undefined` 立即抛 `contract_violation`,不再静默串行。
  - `client_credentials` 的 `flow.refresh` 路径补 singleflight,并发 401 只换一次 token(与默认 `refresh_token` 路径行为对齐)。
  - `argsTable` 的 default/desc/flag 转义 `|` 与换行,不再撑破生成的 markdown 表格。
  - `BareError` 自带 `category`/`subtype` 只读字段,类型自洽,`toCliError`/`serializeError` 不再产出 `type:undefined`。
  - 补充 `qrcode` 命令契约、`pipe` `data:null` envelope、`callback-server` 超时路径的测试覆盖。

### Changed

- `@renxqoo/agent-data-cli` 发布产物改为 bundle、tree-shake、minify、声明文件和 source map，并通过真实 tarball 消费测试验证公开入口。
- 字段多或嵌套的命令统一使用 `defineCommand({ input: { schema } })`；业务包直接依赖 Zod 4，推荐 `zod/mini`。

- `cli-sdk` 模块化重构(行为不变,内部重组):
  - 从 `define.ts` 抽出 `package-detect.ts`(业务包 name/bin/version 探测)与 `help.ts`(help 文本渲染),`define.ts` 从 568 行降到约 360 行。
  - 新增 `meta.ts` 统一 meta 下划线内部标记剥离规则(`stripInternalKeys`),`pipeline` 与 `envelope` 共用单一真相源。
  - `_identity` ctx 隐藏通道从下划线字符串改为 `identityKey` Symbol(与 `credentialArgsKey` 一致),消除 `as unknown as` 类型撒谎。
  - `context.ts` 复用 `pipe.ts` 的 `emptyPipe`,删除重复实现。
  - `helpers.ts` 抽 `persistRefreshedToken`,两条 401 续期路径共用落盘逻辑。

### Removed

- 直接删除 `defineCommandFromArgs`、`defineStructuredCommand` 和 `@renxqoo/agent-data-cli/zod`，不提供兼容别名；所有命令统一使用 `defineCommand`。
- 删除 `@standard-schema/spec` 边界和 `zodInput` 包装层；结构化输入以 Zod 4 为唯一 Schema 标准。

## [@renxqoo/rxx-cli@0.2.0] - 2026-08-11

动态 agent-native CLI 运行时(manifest → 可执行 CLI + 多 agent 分发)。本次随 cli-sdk contracts 重构一并发布(rxx 依赖新的 `Plugin.prepareRequest` 与拆分后的 contract 模块)。

### Added
- 新 app `apps/rxx/`:`rxx init <url>` 拉取签名 manifest → `rxx run <service> <cmd>` 现场装配 `defineCli` App,新增服务零客户端改动。
- 安全:SSRF(`isPrivateHost` 覆盖 IPv4 十进制/十六进制/八进制 + IPv6 + IPv4-mapped)+ DNS rebinding 运行时解析校验(`assertSafeHost`);fetch URL 本身做 SSRF 校验(此前只校验 manifest 内容的 `api.baseUrl`);fetch 超时(AbortController 30s)+ body 大小限制(1MB);Ed25519 签名 + host 绑定 + TOFU pinning + key 变更 fallback。
- 数据完整性:安装事务化(compensating rollback);`listInstalled` 不再因非服务子目录崩溃;原子写 fsync。
- 契约修正:非交互安装抛 `ConfirmationRequiredError`(原为 success envelope 漏洞);`signature_failed` → `authentication`;`http_error` 按真实 status 映射;`rxxError` 总返回 `CliError`(不再吐裸 `error:` 文本)。
- AI 参数健壮性(fuzz 发现):`ManifestArgSpec` 增加 `min`/`max`/`integer`;`fillPath` 对空值/空格/引号/trim 给精确错误(原误报 "path traversal");`number` 参数默认整数校验。
- `docs/signing-spec.md` 固定签名协议规格(client/server 独立实现,e2e 守往返)。

## [@renxqoo/rxx-server@0.1.0] - 2026-08-11

`apps/rxx/server/` —— rxx 开发/测试用的 mock manifest 托管 + SaaS(独立签名实现,与 client 共享 `docs/signing-spec.md` 规格)。`/__admin/*` 端点支持 `RXX_ADMIN_TOKEN` 鉴权(防开放签名 oracle);分页 limit 范围校验;ID 碰撞修复(递增 counter);seedStore 注册即重置(测试隔离)。

## [@renxqoo/agent-data-cli@1.2.0] - 2026-08-10

### Added

- 新增 `defineCommandFromArgs`，根据参数 schema 推导必填、默认和可选字段。
- 新增公开的 `onUnauthorized` 插件 hook，以及绑定 `CommandContext` 的认证会话 API。
- 新增路由参数、并发认证、授权回调清理、Skill 路径安全和错误保真的回归测试。
- 新增 npm tarball 消费测试、公开类型负向测试、覆盖率门禁和 Markdown 链接检查，并在 CI 中接入 publint 与 Are the Types Wrong。

### Changed

- 全局 `--json`、`--no-json` 和 `--api-key` 现在可以位于命令路径之前或之后。
- `json`、`api-key`、`help`、`version` 成为框架保留参数，业务命令声明同名参数会在装配期失败。
- OAuth token 与 refresh 状态改为按命令上下文隔离；并发请求共享同一次 singleflight refresh，但不共享请求 token。
- `onError` 或 `afterRequest` 观察性 hook 失败时保留原始业务/传输结果。
- `skills sync` 任一目标写入失败时返回非零退出码和标准错误 envelope。
- Windows 浏览器启动改用 `FileProtocolHandler`，不再依赖不可直接执行的 `start` shell built-in。
- `CommandSpec`、`CommandGroup`、`defineCommands` 和 `defineCommandFromArgs` 现在完整传播 `State` 泛型；组件化命令组会在装配期拒绝不兼容状态。
- npm 包现在包含 License、设计文档和 TypeScript 源码，使 README 链接与 source map 都可解析。

### Fixed

- 修复命令路径前的 `--json` 被路由器丢弃。
- 修复并发 `App.run()` 串用认证 token，以及并发 401 重复刷新。
- 修复临时 API key 命中后错误读取磁盘 OAuth identity。
- 修复 `SKILL.md` 或 reference 软链接可逃逸 Skill 根目录。
- 修复 authorization-code 浏览器启动失败时本地回调服务器未关闭。
- 修复错误 hook 和请求观察 hook 掩盖真正业务错误。
- 修复可选参数在 `ParsedArgs` 中被错误标记为必有字段。
- 修复命令上下文状态被 `CommandContext<any>` 擦除，导致不存在的 state 字段也能通过类型检查。

### Removed

- 移除私有 `_transportConfig` 和 `_ownedRoutes` 运行时协议；插件改用公开 hook，路由 ownership 改为 App-local 状态。

### Documentation

- 重构中英文根 README 的信息架构，突出 agent-native 输出契约、Skill 自发现、可组合认证、schema 类型推导和真实业务 CLI 验证等项目优势。
- 同步更新中英文 `agent-cli-builder` Skill、认证模式、插件生命周期和核心 API 文档。
- 明确 ESM-only、State 泛型和 `defineAuth` 推荐用法，并补齐贡献、安全、支持、行为准则、Issue 模板和依赖更新策略。

## [@renxqoo/cli@1.2.0] - 2026-08-10

### Changed

- 使用 `defineCommandFromArgs` 迁移订单和商品命令，消除隐式 `any` 并正确表达可选参数。
- 适配 `@renxqoo/agent-data-cli@1.2.0` 的上下文隔离认证会话和公开插件协议。
- 订单列表新增 `--cursor` 续拉参数，并把服务端游标映射为统一的 `meta.pagination` 契约。
- 注册与登录共享显式的 CRM Scope 和 RFC 7591 客户端元数据，避免客户端权限声明漂移。

## [@renxqoo/rxcordys-cli@1.2.0] - 2026-08-10

### Changed

- 使用 `defineCommandFromArgs` 迁移账号、联系人、合同、发票、线索、商机、订单和统计命令，消除隐式 `any` 并正确表达可选参数。
- 静态双 Header 鉴权改用公开插件生命周期，不再依赖 SDK 私有运行时字段。

## [@renxqoo/rxstock@1.2.0] - 2026-08-10

### Changed

- 升级到 `@renxqoo/agent-data-cli@1.2.0`，继承新的参数、错误、Skill 安全和运行时隔离修复。

## [@renxqoo/rx60s-cli@1.2.0] - 2026-08-10

### Changed

- 升级到 `@renxqoo/agent-data-cli@1.2.0`，继承新的参数、错误、Skill 安全和运行时隔离修复。

## [@renxqoo/rxopen-cli@0.1.0] - 2026-08-10

### Added

- 首个公开版本：提供新闻、热搜、天气、生活数据、开发工具和媒体等 60 多个开放数据接口。
- 将能力拆分为六个领域 Skill，降低 Agent 发现和触发时的歧义。
