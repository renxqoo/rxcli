# @renxqoo/rx60s-cli (rx60s)

每天 60 秒读懂世界 · 开放数据 agent 命令行工具 —— 基于 [`@renxqoo/agent-data-cli`](../../packages/cli-sdk) 框架,全量封装 [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目的公开接口。无需登录、无需 API key。

## 快速开始

### 一键安装(推荐)

```bash
npx @renxqoo/rx60s-cli install
```

自动完成两步:① 全局安装 CLI → ② 安装 Skill 到 `~/.agents/skills/`(AI 工具发现路径)。需 Node ≥ 20。

> `npx` 无需预装,跑完即得全局 `rx60s` 命令 + 已就位的 skill。本工具**无鉴权**(全公开数据),无需配置凭证。

### 手动安装(分步,等价于一键安装)

如果一键安装某步失败或想单独执行:

**第 1 步:安装 CLI**

```bash
npm install -g @renxqoo/rx60s-cli
```

安装后跑 `rx60s --help` 确认可用。不想全局装?用 `npx @renxqoo/rx60s-cli <命令>` 临时执行。

**第 2 步:安装 Skill(让 AI 工具发现)**

把 skill 同步到 `~/.agents/skills/`(Claude Code / Cursor / Trae 等 AI 工具的通用发现路径):

```bash
rx60s skills sync
```

同步后 AI 工具即可在用户提到新闻/热搜/天气/油价/翻译/密码等关键词时自动触发本 skill。验证:

```bash
rx60s skills list                # 列出已装的 skill
ls ~/.agents/skills/rx60s/       # 确认 skill 文件就位
```

## 功能

覆盖新闻资讯、热搜榜单、生活服务、开发者工具等 60+ 类公开数据:

| 模块 | 说明 |
|------|------|
| `news` | 每天 60 秒读懂世界 / AI 资讯 / IT 之家资讯与排行 / RSS |
| `hot` | 微博 / 知乎 / 头条 / 抖音 / B站 / 小红书 / 百度 / 懂车帝 / 夸克 等热搜 |
| `tech` | Hacker News(top / best) |
| `fun` | 一言 / 段子 / 冷笑话 / 发病文学 / KFC 文案 / 答案之书 / 今日运势 / 摸鱼日历 |
| `music` | 网易云榜单 / 歌词搜索 / 唱鸭翻唱 |
| `movie` | 猫眼票房 / 豆瓣口碑榜 / Epic 免费游戏 |
| `life` | 实时天气 / 天气预报 / 油价 / 金价 / 汇率 / 老黄历 / 历史上的今天 / 奥运 |
| `tool` | 有道翻译 / Hash / 二维码 / OG 解析 / WHOIS / IP / 密码 / 颜色 / 化学 |
| `kb` | 百度百科 / JS 面试题 |
| `health` | BMI / 健康评估 |
| `beta` | 酷安热门 / QQ 信息(实验性) |

顶层快捷命令:`60s` / `bing` / `weibo` / `zhihu` / `toutiao` / `hitokoto` / `moyu`(免去 namespace 前缀)。

## 常用命令

```bash
rx60s 60s                                       # 今天有什么新闻(项目核心)
rx60s hot weibo                                 # 微博实时热搜
rx60s life weather 上海                         # 上海实时天气
rx60s life fuel-price --region 广东             # 广东今日油价
rx60s tool fanyi "hello" --to zh-CHS            # 有道翻译
rx60s tool password --length 20 --symbols       # 生成 20 位含符号密码
rx60s life lunar                                # 今日老黄历
rx60s hitokoto                                  # 随机一言
rx60s moyu                                      # 摸鱼日历(离放假还有几天)
```

加 `--json` 强制 JSON 输出(agent / 管道用);加 `--no-json` 强制人类可读(表格 / 卡片,被管道时仍 JSON 保护下游)。完整命令见 `rx60s --help`。

## 输出契约

遵循 agent-data-cli 统一输出格式:`{ ok, source, data, meta }`。`source` 恒为 `rx60s`;列表命令填 `meta.count` 与 `meta.pagination.complete`。

## 数据源

> **本项目是 [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目的命令行封装**。所有数据由原项目提供并归原作者所有,本项目仅做 CLI 化(命令行封装),不持有/缓存任何数据。原项目 MIT License © Viki。

默认公共实例 `https://60s.viki.moe`(每日请求额度有限,限流较严格,仅供开发调试)。生产建议自部署原项目后切换:

```bash
export RX60S_BASE_URL=https://your-60s.example.com/v2
```

## 开发

```bash
pnpm --filter @renxqoo/rx60s-cli build          # 编译
pnpm --filter @renxqoo/rx60s-cli test           # 测试(17 用例)
pnpm --filter @renxqoo/rx60s-cli typecheck      # 类型检查
```

Skill 文档:`skills/rx60s/SKILL.md`(frontmatter 手写符合 skill-creator 规范,AUTO-GEN 命令块由 `rx60s skills gen` 生成)。接口契约见 `docs/API.md`(68 接口完整字段级文档)。

## 技术决策

- **命名**:npm 包 `@renxqoo/rx60s-cli` / bin 命令 `rx60s` / skill `rx60s` / **无 credentialNamespace**(全公开数据,不挂 auth)。
- **无鉴权**:60s 全部接口公开,`plugins: []`,不挂 auth 插件、无需凭证配置。
- **走 `ctx.get` + baseUrl**:60s 是标准 REST(统一响应 `{ code, message, data }`),用框架请求层 + `errorOnStatus`(400/404/429/5xx 自动 throw)。baseUrl 含 `/v2` 前缀。
- **业务码解包**:个别接口可能 HTTP 200 + `code≠200`,所有命令经 `unwrap()` 解包校验(`src/envelope.ts`)。
- **强制 json 编码**:所有请求自动带 `?encoding=json` 拿结构化数据;text/markdown 由 CLI 本地 `humanFormat` 渲染。
- **双 SKILL.md 规范协调**:`agent-cli-builder` 的 `skills gen` 生成的 frontmatter 含 `version` 字段,但 `skill-creator` 的 `quick_validate.py` 拒绝 `version`。解法:用 `gen` 生成 AUTO-GEN 机械块,frontmatter + 语义内容手写到符合 skill-creator 规范(已通过校验)。

## 数据来源与致谢

- **数据源 / 上游**:[vikiboss/60s](https://github.com/vikiboss/60s) —— 一系列高质量、开源、可靠、全球 CDN 加速的开放 API 集合,MIT License © Viki。本项目所有数据均来自该开源项目,版权归原项目及原始数据源所有。
- **本项目定位**:基于 `@renxqoo/agent-data-cli` 框架对 60s API 的 **CLI 化(命令行封装)**,便于 AI agent 与终端用户调用,不修改、不持有、不缓存任何上游数据。
- **CLI 框架**:[`@renxqoo/agent-data-cli`](../../packages/cli-sdk)(本 monorepo 的 cli-sdk)。
- **参考实现**:[`apps/a-stock`](../a-stock)(同为无鉴权公开数据 CLI)。
- 如上游接口有变动或问题,请至 [vikiboss/60s issues](https://github.com/vikiboss/60s/issues) 反馈;本项目 CLI 本身的问题请在 [本仓库 issues](https://github.com/renxqoo/rxcli/issues) 反馈。
