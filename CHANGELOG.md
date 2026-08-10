# Changelog

本文件记录 rxcli monorepo 中所有公开包的用户可见变更，格式参考 Keep a Changelog。

版本 PR 必须把对应内容从 `Unreleased` 整理到正式版本标题：

```text
## [@scope/package@1.2.3] - YYYY-MM-DD
```

一个 PR 更新多个包版本时，每个包都必须有独立的正式版本标题。

## [Unreleased]

## [@renxqoo/agent-data-cli@1.2.0] - 2026-08-10

### Added

- 新增 `defineCommandFromArgs`，根据参数 schema 推导必填、默认和可选字段。
- 新增公开的 `onUnauthorized` 插件 hook，以及绑定 `CommandContext` 的认证会话 API。
- 新增路由参数、并发认证、授权回调清理、Skill 路径安全和错误保真的回归测试。

### Changed

- 全局 `--json`、`--no-json` 和 `--api-key` 现在可以位于命令路径之前或之后。
- `json`、`api-key`、`help`、`version` 成为框架保留参数，业务命令声明同名参数会在装配期失败。
- OAuth token 与 refresh 状态改为按命令上下文隔离；并发请求共享同一次 singleflight refresh，但不共享请求 token。
- `onError` 或 `afterRequest` 观察性 hook 失败时保留原始业务/传输结果。
- `skills sync` 任一目标写入失败时返回非零退出码和标准错误 envelope。
- Windows 浏览器启动改用 `FileProtocolHandler`，不再依赖不可直接执行的 `start` shell built-in。

### Fixed

- 修复命令路径前的 `--json` 被路由器丢弃。
- 修复并发 `App.run()` 串用认证 token，以及并发 401 重复刷新。
- 修复临时 API key 命中后错误读取磁盘 OAuth identity。
- 修复 `SKILL.md` 或 reference 软链接可逃逸 Skill 根目录。
- 修复 authorization-code 浏览器启动失败时本地回调服务器未关闭。
- 修复错误 hook 和请求观察 hook 掩盖真正业务错误。
- 修复可选参数在 `ParsedArgs` 中被错误标记为必有字段。

### Removed

- 移除私有 `_transportConfig` 和 `_ownedRoutes` 运行时协议；插件改用公开 hook，路由 ownership 改为 App-local 状态。

### Documentation

- 重构中英文根 README 的信息架构，突出 agent-native 输出契约、Skill 自发现、可组合认证、schema 类型推导和真实业务 CLI 验证等项目优势。
- 同步更新中英文 `agent-cli-builder` Skill、认证模式、插件生命周期和核心 API 文档。

## [@renxqoo/cli@1.2.0] - 2026-08-10

### Changed

- 使用 `defineCommandFromArgs` 迁移订单和商品命令，消除隐式 `any` 并正确表达可选参数。
- 适配 `@renxqoo/agent-data-cli@1.2.0` 的上下文隔离认证会话和公开插件协议。

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
