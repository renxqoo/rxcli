# rxcli v2

> agent-native CLI 框架 —— `@renxqoo/agentdatacli` 基础包 + 业务包独立 npm。
> 业务包依赖 cli-sdk,只声明"调哪个后端接口、字段怎么处理",就获得鉴权、信封、错误分类、凭证、管道、skill 发现等全套能力。

[架构总览](packages/cli-sdk/docs/00-overview.md) · [命令使用](packages/cli-sdk/docs/01-cli-usage.md) · [SDK 指南](packages/cli-sdk/docs/02-sdk-guide.md) · [信封契约](packages/cli-sdk/docs/03-envelopes.md) · [错误](packages/cli-sdk/docs/04-errors.md) · [凭证](packages/cli-sdk/docs/05-credentials.md) · [skill](packages/cli-sdk/docs/06-skills.md) · [迁移](packages/cli-sdk/docs/07-migration.md)

---

## 这是什么

rxcli v2 把 v1 的单体 CLI 演进成 **monorepo + SDK 框架**:

```
┌──────────────────────────────────────────────────────────┐
│  @renxqoo/agentdatacli   基础包(本仓维护)                     │
│  鉴权 / 请求 / 信封 / 错误分类 / 凭证 / 管道 / skill      │
├──────────────────────────────────────────────────────────┤
│  @org/rxcli-xxx     业务包(独立 npm,别人写)            │
│  依赖 cli-sdk,只对接业务接口                            │
├──────────────────────────────────────────────────────────┤
│  agent / 终端用户                                         │
│  用 unix 管道组合命令,读 skill 自服务发现                │
└──────────────────────────────────────────────────────────┘
```

**核心矛盾它解决的是:** 后端接口千差万别(REST/GraphQL/RPC、OAuth/API-key/mTLS、各种字段命名),但"把数据交给 agent 的方式"是通用的。cli-sdk 把前者交给业务包,后者收敛成框架能力。

---

## 当前状态

**已实现 cli-sdk 基础库 + apps/crm 业务应用。**

- `packages/cli-sdk/` —— 基础库已实现(types/define/ctx 请求层/信封/错误/插件/provider chain/oauth/skills/qrcode/管道/测试)
- `apps/crm/` —— 示例业务应用已落地(orders/products/invoices/account + auth login/status/logout + register,多业务域 namespaces 聚合)
- **全套中文设计文档**(`packages/cli-sdk/docs/`,8 份,随包发布)

文档是实现的依据;写代码时不允许偏离 `00-overview.md` 的决策清单。

---

## 文档索引(读这 8 份就够了)

| 文档 | 给谁看 | 内容 |
|---|---|---|
| [`00-overview.md`](packages/cli-sdk/docs/00-overview.md) | 所有人 | 架构、分层、**全局决策清单**(锚点) |
| [`01-cli-usage.md`](packages/cli-sdk/docs/01-cli-usage.md) | 终端用户 / agent | 怎么调用命令、管道、分页、exit code |
| [`02-sdk-guide.md`](packages/cli-sdk/docs/02-sdk-guide.md) | 业务包开发者 | 怎么用 SDK 写业务包、ctx 接口、钩子 |
| [`03-envelopes.md`](packages/cli-sdk/docs/03-envelopes.md) | 实现者 / agent | 成功/错误信封的字段契约 |
| [`04-errors.md`](packages/cli-sdk/docs/04-errors.md) | 业务包开发者 | 9 类错误、何时 throw、hint 怎么写 |
| [`05-credentials.md`](packages/cli-sdk/docs/05-credentials.md) | 业务包开发者 | provider chain、自定义凭证、首次引导 |
| [`06-skills.md`](packages/cli-sdk/docs/06-skills.md) | 业务包开发者 | skill 系统、命令文档自动生成 |
| [`07-migration.md`](packages/cli-sdk/docs/07-migration.md) | v1 迁移者 | v1 → v2 概念映射、代码归属、重写对照 |

---

## 快速看一眼(v2 长什么样)

**终端用户:**
```bash
rxcli-orders list | jq '.data[] | select(.status=="paid") | .total' | sort -n
```

**业务包开发者(< 100 行写完一个命令):**
```ts
import { defineCli, defineCommand, errs } from '@renxqoo/agentdatacli'

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
rxcli-v2/
├── pnpm-workspace.yaml              packages: ['packages/*', 'apps/*']
├── tsconfig.base.json
├── README.md                        本文件
├── packages/
│   └── cli-sdk/                     @renxqoo/agentdatacli(基础库)
│       ├── src/                     实现(types/define/oauth/credentials/skills/qrcode/...)
│       ├── docs/                    ★ 全套设计文档(8 份)
│       └── package.json
└── apps/
    └── crm/                         @renxqoo/cli(示例业务应用:多业务域 + auth)
        ├── src/                     命令 + 自写 auth Plugin + 入口
        ├── skills/                  skill 文档(给 agent 读)
        └── package.json             bin: rxcli;"rxcli":{plugin:true}
```

后续阶段会加:
- `@renxqoo/cli` meta 包(install 向导 + 跨包 skill 聚合 + 插件发现)

---

## 设计依据

v2 借鉴了两个工业级 agent-first CLI:

- **mmx**(MiniMax CLI, TS):SDK/CLI 共享请求层、凭证解析优先级链、exit code 体系 → 业务包形态参考
- **lark-cli**(飞书 CLI, Go):结构化错误信封(RFC 7807)、成功信封 + pagination meta、provider chain、skill 系统、stdout/stderr 纪律 → 框架治理参考

每个借鉴点都在专题文档里标注了来源和改造方式。详见 `00-overview.md` 的"三个参考实现"。

---

## 开发(实现阶段用)

```bash
pnpm install            # 装依赖
pnpm build              # 构建所有包
pnpm typecheck          # 类型检查
pnpm test               # 跑测试(vitest)
```

License: MIT
