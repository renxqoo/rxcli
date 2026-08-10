# @renxqoo/rxopen-cli (rxopen)

开放数据 agent 命令行工具 —— 基于 [`@renxqoo/agent-data-cli`](../../packages/cli-sdk/README.zh-CN.md) 框架,全量封装 [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目的公开接口。覆盖新闻、热搜、天气、油价、翻译、二维码、密码等 60+ 接口。无需登录、无需 API key。

[English](README.md) · [中文](README.zh-CN.md)

## 快速开始

### 一键安装(推荐)

```bash
npx @renxqoo/rxopen-cli install
```

自动完成两步:① 全局安装 CLI → ② 安装 Skill 到你的 AI 工具发现目录(`~/.agents` 始终写 + 已装工具 `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi` 自动探测)。需 Node ≥ 20。

> `npx` 无需预装,跑完即得全局 `rxopen` 命令 + 已就位的 skill。本工具**无鉴权**(全公开数据),无需配置凭证。

### 手动安装(分步,等价于一键安装)

如果一键安装某步失败或想单独执行:

**第 1 步:安装 CLI**

```bash
npm install -g @renxqoo/rxopen-cli
```

安装后跑 `rxopen --help` 确认可用。不想全局装?用 `npx @renxqoo/rxopen-cli <命令>` 临时执行。

**第 2 步:安装 Skill(让 AI 工具发现)**

把 8 个 skill 同步到你的 AI 工具发现目录(`~/.agents` 始终写 + 已装工具如 `~/.claude`/`~/.cursor`/`~/.zcode` 自动探测——覆盖 Claude Code / Cursor / Codex / ZCode / OpenClaw / Pi / Trae):

```bash
rxopen skills sync
```

同步后 AI 工具即可在用户提到新闻/热搜/天气/油价/翻译/密码等关键词时自动触发对应 skill。验证:

```bash
rxopen skills list                # 列出已装的 skill
ls ~/.agents/skills/              # 确认 skill 文件就位(rxopen-news / rxopen-hot / ...)
```

## 功能

覆盖 60+ 类公开数据，提供 6 个查询 skill 和 2 个编排 skill:

| Skill | 覆盖域 | 说明 |
|------|-------|------|
| `rxopen-news` | news / tech / daily / bing | 每日新闻速览 / AI 资讯 / IT 之家资讯与排行 / RSS / Hacker News / 必应壁纸 |
| `rxopen-hot` | hot / weibo / zhihu / toutiao | 微博 / 知乎 / 头条 / 抖音 / B站 / 小红书 / 百度 / 懂车帝 / 夸克 等热搜 |
| `rxopen-life` | life / health | 实时天气 / 预报 / 油价 / 金价 / 汇率 / 老黄历 / 历史上的今天 / 奥运 / BMI |
| `rxopen-tool` | tool / kb / beta | 有道翻译 / Hash / 二维码 / OG / WHOIS / IP / 密码 / 颜色 / 化学 / 百科 / JS题 / QQ |
| `rxopen-media` | music / movie | 网易云榜单 / 歌词 / 唱鸭 / 猫眼票房 / 豆瓣口碑 / Epic 免费游戏 |
| `rxopen-fun` | fun / hitokoto / moyu | 一言 / 段子 / 冷笑话 / 发病文学 / KFC 文案 / 答案之书 / 运势 / 摸鱼日历 |
| `rxopen-morning` | workflow | 天气 / 新闻 / 打工日历 / 黄历 / 历史事件综合晨报 |
| `rxopen-trending` | workflow | 多平台热搜共现与差异分析 |

顶层快捷命令:`daily` / `bing` / `weibo` / `zhihu` / `toutiao` / `hitokoto` / `moyu`(免去 namespace 前缀)。

## 常用命令

```bash
rxopen daily                                     # 今天有什么新闻(项目核心)
rxopen hot weibo                                 # 微博实时热搜
rxopen life weather 上海                         # 上海实时天气
rxopen life fuel-price --region 广东             # 广东今日油价
rxopen tool fanyi "hello" --to zh-CHS            # 有道翻译
rxopen tool password --length 20 --symbols       # 生成 20 位含符号密码
rxopen life lunar                                # 今日老黄历
rxopen hitokoto                                  # 随机一言
rxopen moyu                                      # 摸鱼日历(离放假还有几天)
```

加 `--json` 强制 JSON 输出(agent / 管道用);加 `--no-json` 强制人类可读(表格 / 卡片,被管道时仍 JSON 保护下游)。完整命令见 `rxopen --help`。

## 输出契约

遵循 agent-data-cli 统一输出格式:`{ ok, source, data, meta }`。`source` 恒为 `rxopen`;列表命令填 `meta.count` 与 `meta.pagination.complete`。

## 数据源

> **本项目是 [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目的命令行封装**。所有数据由原项目提供并归原作者所有,本项目仅做 CLI 化(命令行封装),不持有/缓存任何数据。原项目 MIT License © Viki。

默认公共实例 `https://60s.viki.moe`(每日请求额度有限,限流较严格,仅供开发调试)。生产建议自部署原项目后切换:

```bash
export RXOPEN_BASE_URL=https://your-60s.example.com/v2
```

## 开发

```bash
pnpm --filter @renxqoo/rxopen-cli build          # 编译
pnpm --filter @renxqoo/rxopen-cli test           # 测试
pnpm --filter @renxqoo/rxopen-cli typecheck      # 类型检查
```

Skill 文档:8 个 `skills/rxopen-*/SKILL.md`。6 个查询 skill 的命令块由 `rxopen skills gen <name>` 生成，2 个工作流 skill 只包含编排指令；共享安装说明由 build 生成到每个 skill 的 `references/install.md`。接口契约见 `docs/API.md`。

## 技术决策

- **命名**:npm 包 `@renxqoo/rxopen-cli` / bin 命令 `rxopen` / 8 个独立 skill / **无 credentialNamespace**(全公开数据,不挂 auth)。
- **无鉴权**:全部接口公开,`plugins: []`,不挂 auth 插件、无需凭证配置。
- **走 `ctx.get` + baseUrl**:标准 REST(统一响应 `{ code, message, data }`),用框架请求层 + `errorOnStatus`(400/404/429/5xx 自动 throw)。baseUrl 含 `/v2` 前缀。
- **业务码解包**:个别接口可能 HTTP 200 + `code≠200`,所有命令经 `unwrap()` 解包校验(`src/envelope.ts`)。
- **强制 json 编码**:所有请求自动带 `?encoding=json` 拿结构化数据;text/markdown 由 CLI 本地 `humanFormat` 渲染。
- **skill 分层**:`skillsScopes` 为 6 个查询 skill 生成域内命令表；`rxopen-morning` 和 `rxopen-trending` 保留工作流指令，不生成命令表。

## 数据来源与致谢

- **数据源 / 上游**:[vikiboss/60s](https://github.com/vikiboss/60s) —— 一系列高质量、开源、可靠、全球 CDN 加速的开放 API 集合,MIT License © Viki。本项目所有数据均来自该开源项目,版权归原项目及原始数据源所有。
- **本项目定位**:基于 `@renxqoo/agent-data-cli` 框架对上游 API 的 **CLI 化(命令行封装)**,便于 AI agent 与终端用户调用,不修改、不持有、不缓存任何上游数据。
- **CLI 框架**:[`@renxqoo/agent-data-cli`](../../packages/cli-sdk/README.zh-CN.md)(本 monorepo 的 cli-sdk)。
- **参考实现**:[`apps/a-stock`](../a-stock/README.zh-CN.md)(同为无鉴权公开数据 CLI)。
- 如上游接口有变动或问题,请至 [vikiboss/60s issues](https://github.com/vikiboss/60s/issues) 反馈;本项目 CLI 本身的问题请在 [本仓库 issues](https://github.com/renxqoo/rxcli/issues) 反馈。

## 免责声明

- **本项目仅供学习研究使用**,不提供、不存储、不缓存任何数据,所有数据来自上游 [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目及其数据源,版权归原始数据源所有。
- 上游 API 的部分接口通过抓取或调用第三方平台(微博、知乎、QQ音乐、有道翻译等)获取数据,可能涉及第三方服务条款(ToS)。**本 CLI 仅作为上游 API 的命令行客户端,不包含任何逆向、破解或绕过反爬的代码。** 因使用本工具获取的数据而产生的任何法律责任,由使用者自行承担。
- 本项目不对数据的准确性、完整性、时效性做任何保证。用户基于本工具数据做出的任何决策,风险自负。
- 如任何数据源方认为本项目侵犯了其合法权益,请向上游 [vikiboss/60s](https://github.com/vikiboss/60s) 项目提出,本项目将在收到通知后配合处理。
- 商业化使用(转售服务、集成到商业产品)可能放大法律风险,建议在法律顾问评估后进行。
