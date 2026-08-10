<div align="center">

# rxcli

**Agent-Native CLI 框架 + 业务包**

用声明式代码让 AI Agent 和人类结构化消费业务/公开数据。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220)](https://pnpm.io/)

[English](README.md) · [中文](README.zh-CN.md)

[这是什么](#这是什么) · [快速开始](#快速开始) · [业务包](#业务包) · [架构](#架构) · [用框架写自己的-cli](#用框架写自己的-cli)

</div>

---

## 这是什么

`rxcli` 是一个 monorepo,由一个 Agent-Native CLI 框架和多个开箱即用的业务包组成。

**核心思想**:把"数据交给 agent 的方式"收敛成框架能力——stdout 永远是结构化统一输出格式 `{ok, source, data, meta}`,stderr 是错误输出,exit code 按错误类别分类。Agent 可靠解析,人类可读表格,unix 管道自由组合。

业务包只声明"调哪个接口、字段怎么处理",就自动获得:鉴权、统一输出格式、9 类错误分类、凭证管理、管道支持、skill 自动发现等全套能力。

### 为什么需要

传统 CLI 给人看(表格/彩色输出),agent 调用时得解析非结构化文本,脆弱且易错。`rxcli` 让每个 CLI 天然 agent-native:

- **Agent 可靠消费**:统一 JSON 输出 + 类型化错误 + exit code 语义,agent 不靠正则猜
- **人类依然友好**:TTY 自动渲染表格(CJK 对齐),`--no-json` 强制人类模式
- **Unix 管道原生**:`a list | b generate`,上游 stdout 自动变成下游 PipeRecord
- **Skill 自服务**:CLI 内置 SKILL.md,Agent 读后知道何时触发、怎么调用

---

## 快速开始

### 用现成的业务包

四个业务包,按需选装。统一用 `npx <包名> install` 一键完成(装 CLI + 装 Skill + 配凭证),需 Node ≥ 20。

| 业务包 | 一键安装 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| **rxstock**(A 股数据) | `npx @renxqoo/rxstock install` | 无(公开数据) | 行情/K线/财务/板块/龙虎榜,多源 fallback |
| **rxopen**(开放数据) | `npx @renxqoo/rxopen-cli install` | 无(公开数据) | 新闻/热搜/天气/油价/翻译/密码等 60+ 接口,按数据域拆 6 个 skill |
| **rxcordys**(Cordys CRM) | `npx @renxqoo/rxcordys-cli install` | 静态双 header(API Key) | 线索/客户/商机/合同/回款/审批 |
| **rxcli**(公司业务) | `npx @renxqoo/cli install` | OAuth device flow | 订单/商品/发票/账号 |

> **rxcli 测试**:rxcli 依赖 OAuth 鉴权中间层,测试/开发前需先部署 [renxqoo/auth-proxy](https://github.com/renxqoo/auth-proxy)(OAuth device flow 代理 + 业务 API 网关 + mock 公司应用)。详见 [rxcli README](apps/crm/README.zh-CN.md#测试)。

> 也可分步:`npm install -g <包名>` → `<bin> skills sync` → 手动配凭证。详见各业务包 README。

**A 股数据(rxstock,无需登录):**

```bash
npx @renxqoo/rxstock quote 600519              # 实时行情
npx @renxqoo/rxstock stock diagnosis 300656    # 个股综合诊断
npx @renxqoo/rxstock kline indicator 600519    # 技术指标(MACD/RSI/KDJ)
```

**开放数据(rxopen,无需登录):**

```bash
npx @renxqoo/rxopen-cli install
rxopen daily                         # 今天有什么新闻
rxopen life weather 杭州              # 实时天气
rxopen tool fanyi "hello" --to zh-CHS # 有道翻译
rxopen hot weibo                      # 微博热搜
```

**Cordys CRM(rxcordys,需 API Key):**

```bash
npx @renxqoo/rxcordys-cli install
rxcordys accounts page               # 客户列表
rxcordys contracts stat              # 合同金额统计
```

---

## 业务包

| 包 | 目录 | 鉴权 | 数据源 |
| --- | --- | --- | --- |
| [`@renxqoo/agent-data-cli`](packages/cli-sdk) | `packages/cli-sdk` | — | 框架基础包(鉴权/统一输出/错误/凭证/管道/skill) |
| [`@renxqoo/rxstock`](apps/a-stock) | `apps/a-stock` | 无 | 公开行情接口(腾讯/东方财富/新浪/同花顺,多源 fallback) |
| [`@renxqoo/rxopen-cli`](apps/rxopen) | `apps/rxopen` | 无 | [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目(新闻/热搜/天气/工具等 60+ 接口,6 个域 skill) |
| [`@renxqoo/rx60s-cli`](apps/60s) | `apps/60s` | 无 | [vikiboss/60s](https://github.com/vikiboss/60s) —— 旧版单 skill(已被 `rxopen` 取代) |
| [`@renxqoo/rxcordys-cli`](apps/cordys-crm) | `apps/cordys-crm` | 静态双 header | Cordys CRM(线索/客户/商机/合同/审批/统计) |
| [`@renxqoo/cli`](apps/crm) | `apps/crm` | OAuth device flow | 公司业务网关(订单/商品/发票/账号) |

> **数据归属**:rxstock / rxopen 的数据分别来自公开行情接口和 [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目,版权归原始数据源所有,本项目仅做 CLI 化封装。

---

## 架构

```
agent / 终端用户
    │  rxstock quote 600519  /  rxopen life weather 杭州  /  rxcordys accounts page
    ▼
业务包(@renxqoo/rxstock / rxopen-cli / rxcordys-cli / cli)
    │  缓存 + 多源 fallback / 响应解包 / 静态密钥鉴权 / OAuth 鉴权 + 续期
    ▼
@renxqoo/agent-data-cli(框架)
    │  统一输出 {ok,source,data,meta} / 9 类错误 / exit code / 管道 / skill 发现
    ▼
数据源:公开行情接口 / 60s API / Cordys CRM / OAuth 中间层 + 业务网关
```

### 输出契约(框架保证)

| 流 | 内容 | 谁写 |
| --- | --- | --- |
| stdout | 成功输出 `{ok:true, source, data, meta}` | 框架(从业务 `return` 序列化) |
| stderr | 错误输出 `{ok:false, error:{type, subtype, ...}}` + 日志 | 框架(从 `throw errs.*` 渲染) |

**双模输出**:终端(TTY)→ 人类可读表格(自动 CJK 对齐);管道/CI → JSON 统一输出。`--json` / `--no-json` 强制覆盖。

### exit code 映射

| code | 类别 | 含义 |
| --- | --- | --- |
| 0 | — | 成功 |
| 1 | api | 服务端业务错误(404/500/429) |
| 2 | validation | 参数不合法 |
| 3 | authentication / authorization / config | 需登录 / 缺权限 / 配置缺失 |
| 4 | network | DNS / 超时 / 拒绝 |
| 5 | internal | SDK 内部错误(不该发生) |
| 6 | policy | 风控拦截 |
| 10 | confirmation | 高危写入需 `--yes` |

---

## Agent Skills

CLI 内置 AI Agent Skills(SKILL.md),教 Agent 何时、如何使用命令。两种发现方式:

```bash
# 方式一:命令发现(Agent 执行,无需安装)
rxstock skills list                  # 列出所有 skill
rxstock skills read rx-stock         # 读 skill 内容

# 方式二:安装到 Agent 扫描目录(推荐)
rxstock install                      # 一键装到 ~/.agents/skills/(30+ AI 工具发现路径)
rxopen install                        # 同上
```

装好后,Agent 启动时按 SKILL.md 的 `description` 语义匹配用户意图,自服务发现所有命令。

---

## 用框架写自己的 CLI

```bash
pnpm add @renxqoo/agent-data-cli
```

一个命令 < 30 行(详见 [cli-sdk 文档](packages/cli-sdk/README.zh-CN.md) 和 [agent-cli-builder skill](packages/cli-sdk/skills/agent-cli-builder/SKILL.md)):

```ts
import { defineCli, defineCommand } from "@renxqoo/agent-data-cli";

export default defineCli({
  name: "myapp",
  description: "我的数据 CLI",
  commands: {
    list: defineCommand({
      name: "list",
      description: "查询列表",
      args: { limit: { type: "number", desc: "返回数量上限" } },
      async run(args, ctx) {
        const res = await ctx.get<{ items: any[] }>("/items", { limit: args.limit });
        return { data: res.data.items };
      },
    }),
  },
});
```

框架给你的白送能力:请求层(带鉴权 + 401 续期)、统一输出格式、9 类类型化错误、参数解析与校验、`--json`/`--no-json` 双模、unix 管道、skill 自动发现。

---

## 开发

本仓是 pnpm monorepo:

```bash
pnpm install            # 装依赖
pnpm build              # 构建所有包
pnpm typecheck          # 类型检查
pnpm test               # 跑测试(vitest)
pnpm lint               # oxlint 检查
pnpm publish            # 一键发布所有包到 npm(交互确认)
pnpm publish:dry-run    # 预览会发布什么(不真发)
```

### 添加新业务包

1. `apps/<你的包>/` 下 `pnpm init`,依赖 `@renxqoo/agent-data-cli`
2. 写 `src/index.ts`(`defineCli`)+ `src/commands/*.ts`(`defineCommand`)
3. `pnpm build` + `<bin> skills gen <name> --init` 生成 skill 骨架(中文骨架加 `--lang zh`)
4. 手写 SKILL.md 语义部分(何时用 / 错误处理 / 前置条件)
5. 详见 [agent-cli-builder skill](packages/cli-sdk/skills/agent-cli-builder/SKILL.md)

---

## 致谢

- **[vikiboss/60s](https://github.com/vikiboss/60s)** —— rxopen / rx60s 的数据源,一系列高质量、开源的开放 API 集合,MIT License © Viki
- 公开行情接口(腾讯/东方财富/新浪/同花顺)—— rxstock 的数据源

---

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
