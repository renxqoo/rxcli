# 模块端点速查

> Cordys 核心设计:模块作为路径段。一级模块(lead/account/opportunity/contact/contract/order)有通用 view/get/page/search;斜杠模块代表子资源。

## 命令 → namespace 映射

| 模块 | namespace | 通用命令 |
|------|-----------|----------|
| 线索 lead | `leads` | list/get/page/search/form/add/update/batch-update + transition/transform |
| 客户 account | `accounts` | list/get/page/search/form/add/update/batch-update + sub(客户360) |
| 商机 opportunity | `opportunities` | list/get/page/search/form/add/update + quotation-*(报价单) |
| 联系人 account/contact | `contacts` | list/get/page/search/form/add/update/batch-update |
| 合同 contract | `contracts` | list/get/page/search/form/add/update/batch-update + stat + payment-plan-*/payment-record-*/business-title-* |
| 发票 invoice | `invoices` | get/page/form/add/update |
| 订单 order | `orders` | list/get/page/search/form/add/update/batch-update + stat |
| 跟进 follow | `follows` | plan/record/form + plan-add/plan-update/record-add/record-update |
| 审批 approval | `approvals` | todo/action/resource/flow |
| 统计 statistic | `stats` | stat/home-lead/home-opportunity/dept-tree |
| 跨模块通用 | `records` | view/get/page/search/contact/product/form |
| 工具 | `util` | whoami/verify/org/members/glocount/raw |

## 一级模块端点(通用模式)

以 `{m}` ∈ {lead, account, opportunity, contact, contract, order} 为例:

| 操作 | 方法 | 路径 | 命令 |
|------|------|------|------|
| 视图列表 | GET | `/{m}/view/list` | `<ns> list` 或 `records view <m>` |
| 详情 | GET | `/{m}/{id}` | `<ns> get <id>` 或 `records get <m> <id>` |
| 分页 | POST | `/{m}/page` | `<ns> page` 或 `records page <m>` |
| 全局搜索 | POST | `/global/search/{m}` | `<ns> search` 或 `records search <m>` |
| 表单 | GET | `/{m}/module/form` | `<ns> form` 或 `records form <m>` |
| 新增 | POST | `/{m}/add` | `<ns> add '<json>' --yes` |
| 更新 | POST | `/{m}/update` | `<ns> update '<json>' --yes`(需含 id) |
| 批量更新 | POST | `/{m}/batch/update` | `<ns> batch-update '<json>' --yes` |

> batch-update 仅 lead/account/opportunity/account-contact/contract/order 支持。

## 斜杠子模块(写入同构)

| 子模块 | 路径前缀 | 命令前缀 |
|--------|----------|----------|
| 回款计划 | `/contract/payment-plan` | `contracts payment-plan-*` |
| 回款记录 | `/contract/payment-record` | `contracts payment-record-*` |
| 工商抬头 | `/contract/business-title` | `contracts business-title-*` |
| 报价单 | `/opportunity/quotation` | `opportunities quotation-*` |
| 联系人 | `/account/contact` | `contacts *` |

子模块统一端点:`/{子模块}/page`、`/{子模块}/{id}`、`/{子模块}/module/form`、`/{子模块}/add`、`/{子模块}/update`。

## 特殊端点

| 操作 | 方法 | 路径 | 命令 |
|------|------|------|------|
| 线索转客户 | POST | `/lead/transition/account` | `leads transition '<json>'` |
| 线索转商机 | POST | `/lead/transform` | `leads transform '<json>'` |
| 报价单详情 | GET | `/opportunity/quotation/get/{id}` | `opportunities quotation-get <id>`(注意 /get/) |
| 报价单搜索 | POST | `/opportunity/quotation/page` | `opportunities quotation-page`(无全局搜索) |
| 客户联系人 | GET | `/{parent}/contact/list/{id}` | `records contact <parent> <id>` |
| 产品字段源 | POST | `/field/source/product` | `records product` |
| 合同统计 | POST | `/contract/statistic` | `contracts stat` |
| 回款统计 | POST | `/contract/payment-record/statistic` | `contracts payment-record-stat` |
| 商机统计 | POST | `/opportunity/statistic` | `stats stat opportunity` |
| 订单统计 | POST | `/order/statistic` | `orders stat` 或 `stats stat order` |

## 客户 360(accounts sub)

`rxcordys accounts sub <type> <accountId>`:

| type | 方法 | 路径 |
|------|------|------|
| contract | POST | `/account/contract/page` |
| contract-stat | GET | `/account/contract/statistic/{id}` |
| opportunity | POST | `/account/opportunity/page` |
| order | POST | `/account/order/page` |
| payment-plan | POST | `/account/contract/payment-plan/page` |
| payment-plan-stat | GET | `/account/contract/payment-plan/statistic/{id}` |
| payment-record | POST | `/account/contract/payment-record/page` |
| payment-record-stat | GET | `/account/contract/payment-record/statistic/{id}` → {totalAmount, receivedAmount, pendingAmount} |
| invoice | POST | `/account/invoice/page` |
| invoice-stat | GET | `/account/invoice/statistic/{id}` → {contractAmount, uninvoicedAmount, invoicedAmount} |

## 跟进(follows)

`rxcordys follows <cmd> <parent> ...`,parent ∈ {lead, account, opportunity}:

| 操作 | 方法 | 路径 |
|------|------|------|
| 计划分页 | POST | `/{parent}/follow/plan/page` |
| 记录分页 | POST | `/{parent}/follow/record/page` |
| 表单 | GET | `/follow/{plan\|record}/module/form`(模块无关) |
| 新增计划 | POST | `/{parent}/follow/plan/add`(必填 content/method/owner/type) |
| 新增记录 | POST | `/{parent}/follow/record/add`(必填 content/followMethod/owner/type) |

## 审批(approvals)

| 子命令 | 操作 | 路径 |
|--------|------|------|
| todo pending/processed/initiated/cc | POST | `/approval-todo/{kind}/page` |
| todo count | GET | `/approval-todo/pending/count` |
| action approve/reject/back/sign/revoke/batch-* | POST | `/approval-action/{action}` |
| resource push/revoke | POST | `/approval-resource/{action}` |
| resource simple-detail/detail | GET | `/approval-resource/{action}/{id}` |
| flow page | POST | `/approval-flow/page` |
| flow get | GET | `/approval-flow/get/{id}` |
| flow add/update/webhook-test | POST | `/approval-flow/{action}` |
| flow enable/disable | GET | `/approval-flow/enable/{id}?enable=true\|false` |
| flow by-form | GET | `/approval-flow/get-by-form-type/{formType}` |
| flow setting | GET | `/approval-flow/status-permission/setting/{formType}` |

## 首页看板统计(stats home-*)

| 命令 | 路径 | 返回 |
|------|------|------|
| `stats home-lead` | POST `/home/statistic/lead` | 今日/本周/本月/本年 + 环比 |
| `stats home-opportunity` | POST `/home/statistic/opportunity` | 商机计数 + 金额 |
| `stats home-opportunity --type success` | POST `/home/statistic/opportunity/success` | 成功商机 |
| `stats home-opportunity --type underway` | POST `/home/statistic/opportunity/underway` | 进行中商机 |
| `stats dept-tree` | GET `/home/statistic/department/tree` | 部门权限树 |

## 未单独建命令的端点(用 raw 透传)

| 端点 | 用途 |
|------|------|
| `GET /{m}/view/view` | 视图详情 |
| `POST /advanced/search/{account\|lead\|opportunity}` | 高级搜索 |
| `POST /dashboard/page` / `GET /dashboard/detail/{id}` | 仪表盘 |
| `GET /approval-flow/delete/{id}` | 删除审批流程 |
| `GET /settings/fields?module={m}` | 字段定义(筛选用) |

透传示例:`rxcordys util raw GET /approval-flow/delete/F1`
