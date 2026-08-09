# @renxqoo/cordys-crm (rxcordys)

Cordys CRM L2C 全链路 agent 命行行工具 —— 基于 [`@renxqoo/agent-data-cli`](../../packages/cli-sdk) 框架,全量覆盖 CordysCRM 接口。

## 功能

覆盖线索 → 客户 → 商机 → 合同 → 回款 → 发票 → 订单的 L2C 全流程:

| 模块 | 说明 |
|------|------|
| `leads` | 线索 CRUD + 转客户(transition)/ 转商机(transform) |
| `accounts` | 客户 CRUD + 客户 360(合同/商机/订单/回款/发票子资源 + 统计) |
| `opportunities` | 商机 CRUD + 报价单(quotation) |
| `contacts` | 联系人 CRUD |
| `contracts` | 合同 + 回款计划/记录 + 工商抬头 + 统计 |
| `invoices` | 发票 |
| `orders` | 订单 + 统计 |
| `follows` | 跟进计划/记录(跨 lead/account/opportunity) |
| `approvals` | 审批待办/动作/资源/流程配置 |
| `stats` | 模块金额统计 + 首页看板 |
| `records` | 跨模块通用(view/get/page/search/contact/product/form) |
| `util` | whoami/org/members/glocount/raw 透传 |

## 鉴权

静态双 header(`X-Access-Key` / `X-Secret-Key`)。两种配置方式:

```bash
# 方式 A:持久化(推荐)
rxcordys auth login --access-key <AK> --secret-key <SK>

# 方式 B:环境变量
export CORDYS_ACCESS_KEY=<AK>
export CORDYS_SECRET_KEY=<SK>
```

## 安装与使用

```bash
# 构建
pnpm --filter @renxqoo/cordys-crm build

# 查看全部命令
node dist/index.js --help

# 查询线索(分页)
rxcordys leads page --json

# 新增客户(高危操作,需 --yes)
rxcordys accounts add '{"name":"客户A"}' --yes

# 统计合同金额
rxcordys contracts stat --payload '{}'
```

## 输出契约

遵循 agent-data-cli 信封:`{ ok, source, data, meta }`。列表命令自动计算 `meta.pagination.complete`。

## 开发

```bash
pnpm --filter @renxqoo/cordys-crm build       # 编译
pnpm --filter @renxqoo/cordys-crm test         # 测试(61 用例)
pnpm --filter @renxqoo/cordys-crm typecheck    # 类型检查
```

SKILL.md 的命令表由 `rxcordys skills gen rxcordys` 自动生成(AUTO-GEN 块),语义部分手写。

## 技术决策

- **手写 auth plugin**(非 `defineAuth`):Cordys 用静态双 header,框架 `injectAuthHeader` 只支持单 header,故手写 `beforeRequest` 注入。
- **业务码解包**:Cordys 业务错误可能 HTTP 200 + `code≠100200`,所有命令经 `unwrap()` 解包校验。
- **credentialNamespace = `cordys`**:避免与 `apps/crm` 的 `crm` namespace 撞名共用凭证。
