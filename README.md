# rxcli

> Agent-native CLI framework —— 让 AI agent 结构化获取业务数据的命令行框架。
>
> `@renxqoo/agentdatacli` 框架包 + `@renxqoo/cli` 业务包,业务包只声明"调哪个后端接口、字段怎么处理",就获得鉴权、信封、错误分类、凭证、管道、skill 发现等全套能力。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

[架构总览](packages/cli-sdk/docs/00-overview.md) · [命令使用](packages/cli-sdk/docs/01-cli-usage.md) · [SDK 指南](packages/cli-sdk/docs/02-sdk-guide.md) · [信封契约](packages/cli-sdk/docs/03-envelopes.md) · [错误](packages/cli-sdk/docs/04-errors.md) · [凭证](packages/cli-sdk/docs/05-credentials.md) · [skill](packages/cli-sdk/docs/06-skills.md)

---

## 这是什么

rxcli 是一个 **monorepo + SDK 框架**,把"对接后端接口"和"把数据交给 agent"两件事解耦:

```
┌──────────────────────────────────────────────────────────┐
│  @renxqoo/agentdatacli   框架包(本仓维护)                  │
│  鉴权 / 请求 / 信封 / 错误分类 / 凭证 / 管道 / skill      │
├──────────────────────────────────────────────────────────┤
│  @renxqoo/cli   业务包(订单/商品/发票/账号,本仓示例)     │
│  依赖 agentdatacli,只对接业务接口                        │
├──────────────────────────────────────────────────────────┤
│  agent / 终端用户                                         │
│  用 unix 管道组合命令,读 skill 自服务发现                │
└──────────────────────────────────────────────────────────┘
```

**核心矛盾它解决的是:** 后端接口千差万别(REST/GraphQL/RPC、OAuth/API-key/mTLS、各种字段命名),但"把数据交给 agent 的方式"是通用的。框架把前者交给业务包,后者收敛成框架能力。

---

## 安装

### 方式一:全局安装(推荐)

```bash
npm install -g @renxqoo/cli
```

安装后 `rxcli` 命令全局可用:

```bash
rxcli orders list
rxcli auth login
```

### 方式二:npx 即用即跑(不污染全局)

```bash
npx @renxqoo/cli orders list
npx @renxqoo/cli auth login
```

### 首次使用

```bash
rxcli install          # 引导:装 skills + 注册 + 登录
# 或手动分步:
rxcli auth register    # 用注册令牌注册(从管理员获取)
rxcli auth login       # 浏览器登录
```

> npx 用户把 `rxcli` 替换成 `npx @renxqoo/cli` 即可。

---

## 文档索引(读这 7 份就够了)

| 文档 | 给谁看 | 内容 |
|---|---|---|
| [`00-overview.md`](packages/cli-sdk/docs/00-overview.md) | 所有人 | 架构、分层、**全局决策清单**(锚点) |
| [`01-cli-usage.md`](packages/cli-sdk/docs/01-cli-usage.md) | 终端用户 / agent | 怎么调用命令、管道、分页、exit code |
| [`02-sdk-guide.md`](packages/cli-sdk/docs/02-sdk-guide.md) | 业务包开发者 | 怎么用 SDK 写业务包、ctx 接口、钩子 |
| [`03-envelopes.md`](packages/cli-sdk/docs/03-envelopes.md) | 实现者 / agent | 成功/错误信封的字段契约 |
| [`04-errors.md`](packages/cli-sdk/docs/04-errors.md) | 业务包开发者 | 9 类错误、何时 throw、hint 怎么写 |
| [`05-credentials.md`](packages/cli-sdk/docs/05-credentials.md) | 业务包开发者 | provider chain、自定义凭证、首次引导 |
| [`06-skills.md`](packages/cli-sdk/docs/06-skills.md) | 业务包开发者 | skill 系统、命令文档自动生成 |

---

## 快速看一眼

**终端用户:**
```bash
rxcli orders list | jq '.data[] | select(.status=="paid") | .total' | sort -n
```

**业务包开发者(< 100 行写完一个命令):**
```ts
import { defineCli, defineCommand } from '@renxqoo/agentdatacli'

export default defineCli({
  name: 'orders',
  commands: {
    list: defineCommand({
      args: { limit: { type: 'number', default: 30, desc: '返回数量上限' } },
      async run(args, ctx) {
        const res = await ctx.get<{ items: Order[]; hasMore: boolean; nextCursor?: string }>('/orders', { limit: args.limit })
        return {
          data: res.data.items,
          meta: { pagination: { complete: !res.data.hasMore, nextToken: res.data.nextCursor } },
        }
      },
    }),
  },
})
```

---

## 目录结构

```
rxcli/
├── pnpm-workspace.yaml              packages: ['packages/*', 'apps/*']
├── tsconfig.base.json
├── LICENSE                          MIT
├── README.md                        本文件
├── packages/
│   └── cli-sdk/                     @renxqoo/agentdatacli(框架包)
│       ├── src/                     实现(types/define/oauth/credentials/skills/qrcode/auth/...)
│       ├── docs/                    ★ 全套设计文档(7 份)
│       └── package.json
└── apps/
    └── crm/                         @renxqoo/cli(业务包:多业务域 + auth)
        ├── src/                     命令 + 入口(defineAuth + defineCli)
        ├── skills/                  skill 文档(给 agent 读)
        └── package.json             bin: rxcli
```

---

## 设计依据

rxcli 借鉴了两个工业级 agent-first CLI:

- **mmx**(MiniMax CLI, TS):SDK/CLI 共享请求层、凭证解析优先级链、exit code 体系 → 业务包形态参考
- **lark-cli**(飞书 CLI, Go):结构化错误信封(RFC 7807)、成功信封 + pagination meta、provider chain、skill 系统、stdout/stderr 纪律 → 框架治理参考

每个借鉴点都在专题文档里标注了来源和改造方式。详见 `00-overview.md` 的"参考实现"。

---

## 开发

```bash
pnpm install            # 装依赖
pnpm build              # 构建所有包(改了 cli-sdk 源码必须先 build,业务包读 dist)
pnpm typecheck          # 类型检查
pnpm test               # 跑测试(vitest)
```

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
