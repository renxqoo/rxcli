# rxcli

> Agent-Native CLI 框架 + 业务包 —— 用声明式代码让 AI Agent 和人类结构化消费业务/公开数据。
>
> 一个框架(`cli-sdk`)+ 多个业务包(A 股行情 / Cordys CRM / 公司业务),开箱即用。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

[monorepo 组成](#monorepo-组成) · [快速开始](#快速开始) · [架构](#架构) · [Agent Skills](#agent-skills)

---

## 这是什么

`rxcli` 是一个 monorepo,提供:

1. **`@renxqoo/agent-data-cli`**(框架)—— Agent-Native CLI 框架。业务包只声明"调哪个接口、字段怎么处理",就获得鉴权、统一输出格式、错误分类、凭证、管道、skill 发现等全套能力。
2. **`@renxqoo/rxstock`**(业务包)—— A 股股票数据 CLI。行情/K 线/财务/财报三表/板块/龙虎榜/北向/技术指标/估值分位,多源 fallback,完全免费。
3. **`@renxqoo/rxcordys-cli`**(业务包)—— Cordys CRM L2C 全链路 CLI。线索/客户/商机/合同/回款/发票/订单/跟进/审批/统计,静态双 header 鉴权。
4. **`@renxqoo/cli`**(业务包)—— 通过 OAuth 鉴权中间层访问公司应用(订单/商品/发票/账号)的 CLI。

**核心思想**:把"数据交给 agent 的方式"收敛成框架能力 —— stdout 永远是结构化统一输出格式,stderr 是错误输出,exit code 分类。Agent 可靠解析,人类可读表格,unix 管道自由组合。

---

## monorepo 组成

```
rxcli/
├── packages/cli-sdk      @renxqoo/agent-data-cli  框架(鉴权/统一输出格式/错误/凭证/管道/skill)
├── apps/a-stock          @renxqoo/rxstock          A 股数据 CLI(公开数据,多源 fallback)
├── apps/cordys-crm       @renxqoo/rxcordys-cli     Cordys CRM CLI(静态双 header 鉴权)
└── apps/crm              @renxqoo/cli              公司业务 CLI(OAuth device flow 鉴权)
```

| 包 | 说明 | 鉴权 | 安装 |
| --- | --- | --- | --- |
| [`@renxqoo/agent-data-cli`](packages/cli-sdk) | 框架基础包 | — | `npm i @renxqoo/agent-data-cli` |
| [`@renxqoo/rxstock`](apps/a-stock) | A 股行情/财务/技术指标 | 无(公开数据) | `npx @renxqoo/rxstock quote 600519` |
| [`@renxqoo/rxcordys-cli`](apps/cordys-crm) | Cordys CRM(线索/客户/商机/合同/审批) | 静态双 header(API Key) | `npx @renxqoo/rxcordys-cli install` |
| [`@renxqoo/cli`](apps/crm) | 公司业务(订单/商品) | OAuth device flow | `npx @renxqoo/cli install` |

---

## 快速开始

### 安装业务包

三个业务包,按需选装。统一用 `npx <包名> install` 一键完成(装 CLI + 装 Skill + 配凭证),需 Node ≥ 18。

| 业务包 | 命令 | 鉴权 | 前置条件 |
| --- | --- | --- | --- |
| **rxstock**(A 股数据) | `npx @renxqoo/rxstock install` | 无(公开数据) | 无,开箱即用 |
| **rxcordys**(Cordys CRM) | `npx @renxqoo/rxcordys-cli install` | 静态双 header(API Key) | Cordys 管理后台「个人中心 → API Keys」获取密钥对 |
| **rxcli**(公司业务) | `npx @renxqoo/cli install` | OAuth device flow | 管理员提供的注册令牌(`auth register --token`) |

**一键安装做了什么**(三个包统一):

1. 全局安装 CLI(`npm install -g`)
2. 安装 Skill 到 `~/.agents/skills/`(AI 工具发现路径)
3. 配置凭证(rxstock 跳过此步)

> 也可分步:`npm install -g <包名>` → `<bin> skills sync` → 手动配凭证。详见各业务包 README。

### 用现成的业务包

**A 股数据(rxstock,无需登录):**

```bash
npx @renxqoo/rxstock quote 600519              # 实时行情
npx @renxqoo/rxstock stock diagnosis 300656    # 个股综合诊断
npx @renxqoo/rxstock kline indicator 600519    # 技术指标(MACD/RSI/KDJ)
```

**公司业务(rxcli,需登录):**

```bash
npx @renxqoo/cli install      # 向导:装 skills → 注册 → 登录
rxcli orders list             # 查询订单
rxcli products list           # 查询商品
```

**Cordys CRM(rxcordys,需 API Key):**

```bash
npx @renxqoo/rxcordys-cli install      # 向导:装 CLI → 装 Skill → 配凭证
rxcordys accounts page                 # 客户列表
rxcordys contracts stat                # 合同金额统计
rxcordys leads add '{"name":"新线索"}' --yes   # 新增线索
```

### 用框架写自己的业务包

```bash
pnpm add @renxqoo/agent-data-cli
```

一个命令 < 30 行(详见 [cli-sdk 文档](packages/cli-sdk/README.md)):

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

---

## 架构

```
agent / 终端用户
    │  rxstock quote 600519  /  rxcli orders list  /  rxcordys accounts page
    ▼
业务包(@renxqoo/rxstock / @renxqoo/rxcordys-cli / @renxqoo/cli)
    │  缓存 + 多源 fallback / 静态密钥鉴权 / OAuth 鉴权 + 续期
    ▼
@renxqoo/agent-data-cli(框架)
    │  统一输出格式 {ok,data,meta} / 9 类错误 / exit code / 管道 / skill
    ▼
数据源:公开行情接口(rxstock)/ Cordys CRM(rxcordys)/ OAuth 中间层 + 业务网关(rxcli)
```

**输出契约**(框架保证):

| 流 | 内容 | 谁写 |
| --- | --- | --- |
| stdout | 成功输出 `{ok:true, data, meta}` | 框架(从业务 `return` 序列化) |
| stderr | 错误输出 `{ok:false, error:{type, subtype, ...}}` + 日志 | 框架(从 `throw errs.*` 渲染) |

**双模输出**:终端(TTY)→ 人类可读表格(自动 CJK 对齐);管道/CI → JSON 统一输出。`--json` / `--no-json` 强制覆盖。

---

## Agent Skills

CLI 内置 AI Agent Skills(SKILL.md),教 Agent 何时、如何使用命令。两种发现方式:

```bash
# 方式一:命令发现(Agent 执行,无需安装)
rxstock skills list                  # 列出所有 skill
rxstock skills read rx-stock         # 读 skill 内容

# 方式二:安装到 Agent 扫描目录(推荐)
rxstock install                      # 一键装到 30+ AI 工具
rxcordys install                     # 同上
rxcli   install                      # 同上
```

装好后,Agent 启动时按 SKILL.md 的 description 语义匹配用户意图,自服务发现所有命令。

---

## exit code 映射

框架按错误类别自动设 exit code,Agent 可据此判断处理策略:

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

## 开发

本仓是 pnpm monorepo:

```bash
pnpm install            # 装依赖
pnpm build              # 构建所有包
pnpm typecheck          # 类型检查
pnpm test               # 跑测试(vitest)
pnpm lint               # oxlint 检查
```

### 添加新业务包

1. `apps/<你的包>/` 下 `pnpm init`,依赖 `@renxqoo/agent-data-cli`
2. 写 `src/index.ts`(`defineCli`)+ `skills/<name>/SKILL.md`
3. `pnpm build` + `skills gen <name> --init` 生成 skill 骨架
4. 详见 [cli-sdk README](packages/cli-sdk/README.md) 和 [agent-cli-builder skill](packages/cli-sdk/skills/agent-cli-builder/SKILL.md)

---

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
