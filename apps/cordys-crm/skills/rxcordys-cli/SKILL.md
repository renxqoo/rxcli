---
name: rxcordys-cli
description: |
  查询和管理 Cordys CRM 的销售全流程数据(线索→客户→商机→合同→回款→发票→订单)。当用户提到线索、客户、商机、合同、回款、发票、订单、报价单、联系人、跟进、审批、漏斗、统计、工商抬头、销售数据、CRM,或想查/改 Cordys 系统里的任何业务记录时使用——即使用户没说"Cordys"或"CRM"也要触发。非 Cordys 的独立订单/发票/商品/账号演示服务用 rx-orders/rx-invoices/rx-products/rx-account,不在本 skill 范围。
metadata:
  requires:
    bins: ["rxcordys"]
  cliHelp: "rxcordys --help"
  category: business
---

# rxcordys

通过命令行操作 Cordys CRM,覆盖 L2C 全流程:线索 → 客户 → 商机 → 合同 → 回款 → 发票 → 订单,含跟进、审批、统计。

## 安装

先确认 `rxcordys` 命令是否可用:

```bash
which rxcordys && rxcordys --version
```

不可用时,一键安装(自动完成 CLI + Skill + 凭证):

```bash
npx @renxqoo/rxcordys-cli install
```

> 需 Node ≥ 20。也可分步:先 `npm install -g @renxqoo/rxcordys-cli`,再 `rxcordys skills sync` 安装 Skill 到 `~/.agents/skills/`(AI 工具发现路径)。

## 调用前先确认凭证

业务命令需要凭证,无凭证会返回 `authentication/no_credentials`(exit 3)。先检查:

```bash
rxcordys auth status
```

未配置时二选一(环境变量优先级更高):

```bash
# A. 持久化(推荐):写 ~/.rxcli/credentials/cordys.json(权限 0600,不进 shell 历史)
rxcordys auth login --accessKey <AccessKey> --secretKey <SecretKey>

# B. 环境变量(仅 CI / 临时,勿在本机 profile 长期 export 密钥)
export CORDYS_ACCESS_KEY=<AccessKey>
export CORDYS_SECRET_KEY=<SecretKey>
# 必填:Cordys CRM 部署地址(私有部署,无默认值,不敏感可放 profile)
export CORDYS_CRM_DOMAIN=https://crm.your-company.com
```

> **凭证安全**:密钥泄露 = 他人可读写你权限范围内的全部 CRM 数据。本机/agent 长期用选 A(`auth login` 落盘 0600),勿把明文密钥写进 `.env`/agent 配置/文档/git。详见 [references/auth.md](references/auth.md#凭证安全配置)。

> 密钥对从 Cordys 管理后台「个人中心 → API Keys」获取。鉴权细节见 [references/auth.md](references/auth.md)。

## 何时用什么

高频场景速查(完整命令表见文末「命令」):

| 用户意图 | 命令 |
|----------|------|
| 查列表 / 翻页 / 搜索(线索、客户、商机、合同、订单等) | `<ns> page [关键词或JSON]` / `<ns> search [关键词]` |
| 看某条详情 | `<ns> get <id>` |
| 查某客户名下的合同/商机/订单/回款/发票 | `accounts sub <type> <accountId>` |
| 合同/商机/订单的金额统计 | `stats stat <module>` 或 `contracts stat` / `orders stat` |
| 首页看板(今日/本周线索商机) | `stats home-lead` / `stats home-opportunity` |
| 待审批 / 审批通过/拒绝 | `approvals todo pending` / `approvals action approve '<json>' --yes` |
| 跟进计划/记录 | `follows plan <parent>` / `follows record <parent>` |
| 线索转客户/商机 | `leads transition '<json>' --yes` / `leads transform '<json>' --yes` |
| 我是谁 / 组织架构 | `whoami` / `util org` |
| 没有对应命令的端点 | `util raw <METHOD> <path> [--body '<json>']`(透传) |

`<ns>` 是模块命名空间:`leads` / `accounts` / `opportunities` / `contacts` / `contracts` / `invoices` / `orders` / `records`(跨模块通用) / `follows` / `approvals` / `stats` / `util`。

## 模糊工作指令

用户说"今天做什么""这周怎么样""有什么要注意的"这类**没有动词**的指令时,见 [references/intent.md](references/intent.md) 的意图映射表(含 L2C 全链路追踪、Customer 360)。

显式操作(查列表/看详情/创建)直接用上方速查表,不需要查 intent.md。

## 列表查询的分页与筛选

`page` / `search` 接收可选的 `[payload]` 位置参数:

- **裸字符串** → 当模糊搜索关键词:`rxcordys accounts page "张三"`
- **JSON** → 完整 page_payload(筛选/排序/分页):`rxcordys accounts page '{"current":2,"pageSize":50,"sort":{"createTime":"desc"}}'`
- **不传** → 默认第 1 页 30 条

响应 `meta.pagination`:`complete:true` 已拉完;`complete:false` 时 `nextToken` 是下一页页码,用对应命令的裸 `[payload]` 续拉,例如 `rxcordys accounts page '{"current": <nextToken>}'`。

复杂筛选(`combineSearch.conditions` 的字段类型/操作符)见 [references/pagination.md](references/pagination.md)。

## 角色适配(轻量)

调用业务命令前,如果未确认身份,先跑 `rxcordys util whoami` 拿 position:

```bash
rxcordys util whoami   # 返回姓名/岗位/部门/角色
```

按 position 推断角色(销售/经理/财务/商务/高管),**只影响「展示哪些字段」和「输出侧重」**。完整推断规则、ROLE_MAP 覆盖、输出适配见 [references/role.md](references/role.md)。

> **安全边界**:角色不改查询范围。默认看自己;要看团队/全公司数据,用户需显式要求(传 `searchType`/`viewId`)。

## 写入操作(高危,需确认)

所有 `add` / `update` / `transition` / `transform` / `approvals action` 命令默认需确认:

- **`--yes`** 直接执行
- **预览参数**:所有写入命令都支持 `--dry-run`,只校验/预览不执行写请求
- 都不加 → 返回 `confirmation/high_risk_write`(exit 10)

**写入前先查表单定义**了解必填字段:

```bash
rxcordys accounts form   # 客户必填字段
rxcordys leads form      # 线索必填字段
```

> 完整写入规范(两阶段写入、各模块必填字段、商机全量更新陷阱、批量约束、fieldId 陷阱、线索转化映射)→ 见 [references/write.md](references/write.md)。
>
> 某命令的参数细节(必填/默认/类型)见文末「命令」表签名,或跑 `rxcordys <ns> <cmd> --help`;端点速查见 [references/modules.md](references/modules.md)。

## 输出格式

成功返回标准统一输出格式 `{ ok, source:"rxcordys", data, meta }`。列表的 `data` 是数组,`meta.pagination` 标注是否拉完。加 `--json` 强制 JSON(默认 auto:终端→表格,管道→JSON)。

```bash
rxcordys leads page --json
# {"ok":true,"source":"rxcordys","data":[{"id":"L1","name":"潜在客户A"}],"meta":{"count":1,"pagination":{"complete":true}}}
```

## 输出判断原则

输出不是汇报数据,是帮用户做判断。每次查询结果展示后:

1. **关键结论**(如果有清晰发现)→
2. **核心数据**(表格 ≤5 列、≤10 条,角色关注字段优先)→
3. **异常提醒**(按 [references/risk.md](references/risk.md) 扫描)→
4. **建议动作**(具体到"做什么、谁做、优先级")

**判断比复述重要**:不说"有 3 条线索超期",要说"YYY 集团已 7 天未跟进,建议今日优先联系"。

**禁止的反模式**:

```
❌ 直接贴 JSON 响应
❌ 纯搬运不做判断("您有 13 条线索,创建时间是...")
❌ 抛给用户选择但不给建议("有 3 条超期,您想先看哪个?")
❌ 表格超过 5 列
```

> 大结果集分级展示规则(1-10/11-30/30+ 条)、完整输出模板(列表/详情/写入确认/全局搜索/漏斗)+ emoji 状态规范 → 见 [references/output.md](references/output.md)。

## 安全边界

- **禁止任何删除操作**——不响应删除意图。`util raw` 虽能透传 `GET /approval-flow/delete/{id}` 等删除端点,但 agent 不应主动调用,除非用户明确点名该端点且确认后果。
- **禁止在输出暴露密钥**——`CORDYS_ACCESS_KEY`/`CORDYS_SECRET_KEY` 的值绝不出现;API 错误含密钥信息须脱敏。
- **写入必须经确认**——所有 `add`/`update`/`transition`/`transform`/`approvals action` 默认返回 exit 10,需 `--yes` 执行;可先用 `--dry-run` 预览校验。
- **角色不改查询范围**——角色推断只影响展示字段;切团队/全公司数据需用户显式要求(见 references/role.md)。

## 错误处理

| exit | 错误 | 处理 |
|:----:|------|------|
| 3 | `authentication/no_credentials` | 未配置凭证 → `rxcordys auth login` |
| 3 | `authentication/token_expired` | 凭证失效(401) → 检查密钥对 |
| 3 | `authorization/forbidden` | 无权限(403) → 联系管理员开通数据权限 |
| 1 | `api/not_found` | 记录不存在 → 用 `page` 查有效 ID |
| 1 | `api/server_error` | 服务端错误(含业务码≠100200) → 看 message/messageDetail |
| 10 | `confirmation/high_risk_write` | 写入需确认 → 加 `--yes` |
| 2 | `validation/*` | 参数错误(JSON 不合法/缺必填字段) → 按 hint 修正 |
| 4 | `network/*` | 网络错误 → 检查 `CORDYS_CRM_DOMAIN` 可达性,稍后重试 |

> Cordys 业务错误可能是 HTTP 200 + `code≠100200`,CLI 已解包并映射为 `api/*`。

> ⚠️ **`get` 不存在的 ID 返回 `data:null` + exit 0**(不是 `not_found`)。这是 Cordys API 设计——查不到时返回 200 + `{code:100200, data:null}`,不报错。agent 判断时:**`get`/`payment-plan-get`/`payment-record-get` 返回 `data:null` 即"记录不存在"**,应用 `page` 重新查有效 ID。
>
> 例外:`opportunities quotation-get <不存在的 ID>` 服务端返回 **500「报价不存在!」**(exit 1,`api/server_error`,非 `data:null`)——这是 Cordys 服务端行为,CLI 如实透出;不要把它当 data:null 处理。

## 参考

| 文件 | 内容 | 何时查 |
|------|------|--------|
| [references/auth.md](references/auth.md) | 鉴权原理与故障排查 | 遇到凭证/权限/401/403 问题时 |
| [references/modules.md](references/modules.md) | 模块端点速查(路径/方法) | 需要确认某操作对应哪个端点时 |
| [references/pagination.md](references/pagination.md) | 分页与筛选深度(操作符 + 字段类型映射) | 构造复杂筛选/排序时(操作符必须用 EQUALS/CONTAINS,非 EQ/LIKE) |
| [references/output.md](references/output.md) | 输出格式规范(模板 + emoji + 反模式) | 需要确认列表/详情/写入/搜索怎么展示时 |
| [references/write.md](references/write.md) | 写入操作规范(两阶段写入/必填字段/批量约束/转化映射) | 创建/更新/转化前,避免盲写踩坑 |
| [references/intent.md](references/intent.md) | 模糊指令意图映射(含 L2C 全链路、Customer 360、漏斗分析) | 用户说"今天做什么""这周怎么样"等无动词指令时 |
| [references/role.md](references/role.md) | 角色适配 + 工作流时间表(晨会/周会/月会) | 需要按用户身份调整展示,或切换团队/全公司数据范围时 |
| [references/risk.md](references/risk.md) | 风险预警 + KPI 阈值 + L2C 断链检测 | 查询结果展示后扫描异常,或判断严重度时 |

> 命令格式:`<x>` 必填位置参数、`[x]` 可选位置参数、`--x <t>` 可选 flag。写入命令统一用 `<data>`(JSON 字符串)位置参数 + `--dry-run`(预览)+ `--yes`(确认执行)。某命令参数详情跑 `rxcordys <ns> <cmd> --help`;端点路径/方法见 [references/modules.md](references/modules.md)。

## 命令

| 操作 | 命令 |
|------|------|
| 查询当前用户信息(兼验证凭证是否有效) | `rxcordys whoami` |
| 保存 Cordys 密钥对到凭证文件(~/.rxcli/credentials/cordys.json) | `rxcordys auth login --accessKey <string> --secretKey <string>` |
| 显示当前凭证来源(环境变量 / 凭证文件 / 未配置) | `rxcordys auth status` |
| 清除已保存的凭证文件(不影响环境变量) | `rxcordys auth logout` |
| 按视图查询模块列表(支持 lead/account/opportunity/contact/contract/order) | `rxcordys records view <module> [--opts <string>]` |
| 查询单条记录详情 | `rxcordys records get <module> <id>` |
| 分页查询模块列表(带筛选/排序/关键词,POST page_payload) | `rxcordys records page <module> [payload]` |
| 全局关键词搜索模块(/global/search/{module}) | `rxcordys records search <module> [payload]` |
| 查询某客户/商机/线索下的联系人列表 | `rxcordys records contact <module> <id>` |
| 产品字段源查询(用于商机/合同选产品) | `rxcordys records product [payload]` |
| 查询模块表单字段定义(写入前必读,了解必填字段) | `rxcordys records form <module>` |
| 线索视图列表(/{module}/view/list) | `rxcordys leads list [--opts <string>]` |
| 线索详情 | `rxcordys leads get <id>` |
| 线索分页列表(带筛选/排序/关键词) | `rxcordys leads page [payload]` |
| 全局搜索线索 | `rxcordys leads search [payload]` |
| 线索表单字段定义(写入前必读) | `rxcordys leads form` |
| 新增线索(必填:name, phone, products[]) | `rxcordys leads add <data> [--dry-run] [--yes]` |
| 更新线索(全量更新,需含 id + 全部必填字段) | `rxcordys leads update <data> [--dry-run] [--yes]` |
| 批量更新线索(ids[], fieldId, fieldValue) | `rxcordys leads batch-update <data> [--dry-run] [--yes]` |
| 线索转客户(必填 clueId, name) | `rxcordys leads transition <data> [--dry-run] [--yes]` |
| 线索转商机(必填 clueId,可选 oppCreated/oppName) | `rxcordys leads transform <data> [--dry-run] [--yes]` |
| 客户视图列表 | `rxcordys accounts list [--opts <string>]` |
| 客户详情 | `rxcordys accounts get <id>` |
| 客户分页列表(viewId 可用 ALL/SELF/CUSTOMER_COLLABORATION) | `rxcordys accounts page [payload]` |
| 全局搜索客户 | `rxcordys accounts search [payload]` |
| 客户表单字段定义(写入前必读) | `rxcordys accounts form` |
| 新增客户(必填 name) | `rxcordys accounts add <data> [--dry-run] [--yes]` |
| 更新客户(全量更新,需含 id + 必填字段) | `rxcordys accounts update <data> [--dry-run] [--yes]` |
| 批量更新客户(ids[], fieldId, fieldValue) | `rxcordys accounts batch-update <data> [--dry-run] [--yes]` |
| 客户 360 子资源查询(合同/商机/订单/回款/发票列表 + 对应统计) | `rxcordys accounts sub <type> <id> [payload]` |
| 商机视图列表 | `rxcordys opportunities list [--opts <string>]` |
| 商机详情 | `rxcordys opportunities get <id>` |
| 商机会分页列表(带筛选/排序/关键词) | `rxcordys opportunities page [payload]` |
| 全局搜索商机 | `rxcordys opportunities search [payload]` |
| 商机表单字段定义(写入前必读) | `rxcordys opportunities form` |
| 新增商机(必填 name, customerId, contactId, amount, owner, products[]) | `rxcordys opportunities add <data> [--dry-run] [--yes]` |
| 更新商机(全量更新,需含 id + 必填字段) | `rxcordys opportunities update <data> [--dry-run] [--yes]` |
| 报价单详情(注意路径带 /get/ 前缀) | `rxcordys opportunities quotation-get <id>` |
| 报价单分页列表(报价单无全局搜索,用本命令) | `rxcordys opportunities quotation-page [payload]` |
| 报价单表单字段定义(含 moduleFields/moduleFormConfigDTO 配置) | `rxcordys opportunities quotation-form` |
| 新增报价单(必填 name, opportunityId, untilTime, products, moduleFields, moduleFormConfigDTO) | `rxcordys opportunities quotation-add <data> [--dry-run] [--yes]` |
| 更新报价单(需 id + approvalStatus,建议先 quotation-get 再合并单字段) | `rxcordys opportunities quotation-update <data> [--dry-run] [--yes]` |
| 联系人视图列表 | `rxcordys contacts list [--opts <string>]` |
| 联系人详情 | `rxcordys contacts get <id>` |
| 联系人分页列表 | `rxcordys contacts page [payload]` |
| 全局搜索联系人 | `rxcordys contacts search [payload]` |
| 联系人表单字段定义 | `rxcordys contacts form` |
| 新增联系人(必填 customerId, name) | `rxcordys contacts add <data> [--dry-run] [--yes]` |
| 更新联系人(全量更新,需含 id + 必填字段) | `rxcordys contacts update <data> [--dry-run] [--yes]` |
| 批量更新联系人(ids[], fieldId, fieldValue) | `rxcordys contacts batch-update <data> [--dry-run] [--yes]` |
| 合同视图列表 | `rxcordys contracts list [--opts <string>]` |
| 合同详情 | `rxcordys contracts get <id>` |
| 合同分页列表 | `rxcordys contracts page [payload]` |
| 全局搜索合同 | `rxcordys contracts search [payload]` |
| 合同表单字段定义 | `rxcordys contracts form` |
| 新增合同 | `rxcordys contracts add <data> [--dry-run] [--yes]` |
| 更新合同(全量更新,需含 id) | `rxcordys contracts update <data> [--dry-run] [--yes]` |
| 批量更新合同(ids[], fieldId, fieldValue) | `rxcordys contracts batch-update <data> [--dry-run] [--yes]` |
| 合同金额统计(返回 {amount, averageAmount}) | `rxcordys contracts stat [--payload <string>]` |
| 回款计划分页列表 | `rxcordys contracts payment-plan-page [payload]` |
| 回款计划详情 | `rxcordys contracts payment-plan-get <id>` |
| 回款计划表单字段定义 | `rxcordys contracts payment-plan-form` |
| 新增回款计划 | `rxcordys contracts payment-plan-add <data> [--dry-run] [--yes]` |
| 更新回款计划(需含 id) | `rxcordys contracts payment-plan-update <data> [--dry-run] [--yes]` |
| 回款计划金额统计 | `rxcordys contracts payment-plan-stat [--payload <string>]` |
| 回款记录分页列表 | `rxcordys contracts payment-record-page [payload]` |
| 回款记录详情 | `rxcordys contracts payment-record-get <id>` |
| 回款记录表单字段定义 | `rxcordys contracts payment-record-form` |
| 新增回款记录 | `rxcordys contracts payment-record-add <data> [--dry-run] [--yes]` |
| 更新回款记录(需含 id) | `rxcordys contracts payment-record-update <data> [--dry-run] [--yes]` |
| 回款记录金额统计 | `rxcordys contracts payment-record-stat [--payload <string>]` |
| 工商抬头分页列表 | `rxcordys contracts business-title-page [payload]` |
| 工商抬头表单字段定义 | `rxcordys contracts business-title-form` |
| 新增工商抬头 | `rxcordys contracts business-title-add <data> [--dry-run] [--yes]` |
| 更新工商抬头(需含 id) | `rxcordys contracts business-title-update <data> [--dry-run] [--yes]` |
| 发票视图列表 | `rxcordys invoices list [--opts <string>]` |
| 发票详情 | `rxcordys invoices get <id>` |
| 发票分页列表 | `rxcordys invoices page [payload]` |
| 发票表单字段定义 | `rxcordys invoices form` |
| 新增发票 | `rxcordys invoices add <data> [--dry-run] [--yes]` |
| 更新发票(全量更新,需含 id) | `rxcordys invoices update <data> [--dry-run] [--yes]` |
| 订单视图列表 | `rxcordys orders list [--opts <string>]` |
| 订单详情 | `rxcordys orders get <id>` |
| 订单分页列表 | `rxcordys orders page [payload]` |
| 全局搜索订单 | `rxcordys orders search [payload]` |
| 订单表单字段定义 | `rxcordys orders form` |
| 新增订单 | `rxcordys orders add <data> [--dry-run] [--yes]` |
| 更新订单(全量更新,需含 id) | `rxcordys orders update <data> [--dry-run] [--yes]` |
| 批量更新订单(ids[], fieldId, fieldValue) | `rxcordys orders batch-update <data> [--dry-run] [--yes]` |
| 订单金额统计(返回 {amount, averageAmount}) | `rxcordys orders stat [--payload <string>]` |
| 跟进计划分页查询(parent ∈ lead/account/opportunity) | `rxcordys follows plan <parent> [payload]` |
| 跟进记录分页查询(parent ∈ lead/account/opportunity) | `rxcordys follows record <parent> [payload]` |
| 跟进计划/记录的表单字段定义 | `rxcordys follows form <type>` |
| 新增跟进计划(必填 content, method, owner, type) | `rxcordys follows plan-add <parent> <data> [--dry-run] [--yes]` |
| 更新跟进计划(需含 id + 必填字段) | `rxcordys follows plan-update <parent> <data> [--dry-run] [--yes]` |
| 新增跟进记录(必填 content, followMethod, owner, type) | `rxcordys follows record-add <parent> <data> [--dry-run] [--yes]` |
| 更新跟进记录(需含 id + 必填字段) | `rxcordys follows record-update <parent> <data> [--dry-run] [--yes]` |
| 查询审批待办(pending/processed/initiated/cc/count) | `rxcordys approvals todo <kind> [--payload <string>]` |
| 执行审批动作(approve/reject/back/sign/revoke/batch-approve/batch-reject) | `rxcordys approvals action <action> <data> [--dry-run] [--yes]` |
| 审批资源操作(push/revoke/simple-detail/detail) | `rxcordys approvals resource <action> [--arg <string>]` |
| 审批流程配置-读(page/get/enable/disable/by-form/setting;写见下) | `rxcordys approvals flow <action> [--arg <string>] [--payload <string>]` |
| 新增审批流程配置(需确认) | `rxcordys approvals flow-add <data> [--dry-run] [--yes]` |
| 更新审批流程配置(需确认) | `rxcordys approvals flow-update <data> [--dry-run] [--yes]` |
| 触发审批流程 webhook 测试(需确认) | `rxcordys approvals flow-webhook-test <data> [--dry-run] [--yes]` |
| 模块金额统计(返回 {amount, averageAmount}) | `rxcordys stats stat <module> [--payload <string>]` |
| 首页线索统计(今日/本周/本月/本年 + 环比) | `rxcordys stats home-lead [--payload <string>]` |
| 首页商机统计(type ∈ all/success/underway) | `rxcordys stats home-opportunity [--type <string>] [--payload <string>]` |
| 查询当前用户可见的部门权限树 | `rxcordys stats dept-tree` |
| 查询当前用户信息(兼验证凭证是否有效) | `rxcordys util whoami` |
| 验证当前凭证是否有效(返回用户信息) | `rxcordys util verify` |
| 查询部门组织树 | `rxcordys util org` |
| 查询成员列表(分页) | `rxcordys util members [payload]` |
| 全局搜索模块计数(按关键词返回各模块命中数) | `rxcordys util glocount <keyword>` |
| 原始透传任意端点(相对路径拼 baseUrl,绝对 URL 直连) | `rxcordys util raw <method> <path> [--body <string>]` |

<!-- AUTO-GEN:START commands -->
<!-- This block is auto-generated by `rxcli skills gen`; do not edit by hand -->
## Commands

| Operation | Command |
|------|------|
| 查询当前用户信息(兼验证凭证是否有效) | `rxcordys whoami` |
| 保存 Cordys 密钥对到凭证文件(~/.rxcli/credentials/cordys.json) | `rxcordys auth login --access-key <string> --secret-key <string>` |
| 显示当前凭证来源(环境变量 / 凭证文件 / 未配置) | `rxcordys auth status` |
| 清除已保存的凭证文件(不影响环境变量) | `rxcordys auth logout` |
| 按视图查询模块列表(支持 lead/account/opportunity/contact/contract/order) | `rxcordys records view <module> [--opts <string>]` |
| 查询单条记录详情 | `rxcordys records get <module> <id>` |
| 分页查询模块列表(带筛选/排序/关键词,POST page_payload) | `rxcordys records page <module> [--payload <string>]` |
| 全局关键词搜索模块(/global/search/{module}) | `rxcordys records search <module> [--payload <string>]` |
| 查询某客户/商机/线索下的联系人列表 | `rxcordys records contact <module> <id>` |
| 产品字段源查询(用于商机/合同选产品) | `rxcordys records product [payload]` |
| 查询模块表单字段定义(写入前必读,了解必填字段) | `rxcordys records form <module>` |
| 线索视图列表(/{module}/view/list) | `rxcordys leads list [--opts <string>]` |
| 线索详情 | `rxcordys leads get <id>` |
| 线索分页列表(带筛选/排序/关键词) | `rxcordys leads page [payload]` |
| 全局搜索线索 | `rxcordys leads search [payload]` |
| 线索表单字段定义(写入前必读) | `rxcordys leads form` |
| 新增线索(必填:name, phone, products[]) | `rxcordys leads add <data> [--dry-run] [--yes]` |
| 更新线索(全量更新,需含 id + 全部必填字段) | `rxcordys leads update <data> [--dry-run] [--yes]` |
| 批量更新线索(ids[], fieldId, fieldValue) | `rxcordys leads batch-update <data> [--dry-run] [--yes]` |
| 线索转客户(必填 clueId, name) | `rxcordys leads transition <data> [--dry-run] [--yes]` |
| 线索转商机(必填 clueId,可选 oppCreated/oppName) | `rxcordys leads transform <data> [--dry-run] [--yes]` |
| 客户视图列表 | `rxcordys accounts list [--opts <string>]` |
| 客户详情 | `rxcordys accounts get <id>` |
| 客户分页列表(viewId 可用 ALL/SELF/CUSTOMER_COLLABORATION) | `rxcordys accounts page [payload]` |
| 全局搜索客户 | `rxcordys accounts search [payload]` |
| 客户表单字段定义(写入前必读) | `rxcordys accounts form` |
| 新增客户(必填 name) | `rxcordys accounts add <data> [--dry-run] [--yes]` |
| 更新客户(全量更新,需含 id + 必填字段) | `rxcordys accounts update <data> [--dry-run] [--yes]` |
| 批量更新客户(ids[], fieldId, fieldValue) | `rxcordys accounts batch-update <data> [--dry-run] [--yes]` |
| 客户 360 子资源查询(合同/商机/订单/回款/发票列表 + 对应统计) | `rxcordys accounts sub <type> <id> [--payload <string>]` |
| 商机视图列表 | `rxcordys opportunities list [--opts <string>]` |
| 商机详情 | `rxcordys opportunities get <id>` |
| 商机会分页列表(带筛选/排序/关键词) | `rxcordys opportunities page [payload]` |
| 全局搜索商机 | `rxcordys opportunities search [payload]` |
| 商机表单字段定义(写入前必读) | `rxcordys opportunities form` |
| 新增商机(必填 name, customerId, contactId, amount, owner, products[]) | `rxcordys opportunities add <data> [--dry-run] [--yes]` |
| 更新商机(全量更新,需含 id + 必填字段) | `rxcordys opportunities update <data> [--dry-run] [--yes]` |
| 报价单详情(注意路径带 /get/ 前缀) | `rxcordys opportunities quotation-get <id>` |
| 报价单分页列表(报价单无全局搜索,用本命令) | `rxcordys opportunities quotation-page [payload]` |
| 报价单表单字段定义(含 moduleFields/moduleFormConfigDTO 配置) | `rxcordys opportunities quotation-form` |
| 新增报价单(必填 name, opportunityId, untilTime, products, moduleFields, moduleFormConfigDTO) | `rxcordys opportunities quotation-add <data> [--dry-run] [--yes]` |
| 更新报价单(需 id + approvalStatus,建议先 quotation-get 再合并单字段) | `rxcordys opportunities quotation-update <data> [--dry-run] [--yes]` |
| 联系人视图列表 | `rxcordys contacts list [--opts <string>]` |
| 联系人详情 | `rxcordys contacts get <id>` |
| 联系人分页列表 | `rxcordys contacts page [payload]` |
| 全局搜索联系人 | `rxcordys contacts search [payload]` |
| 联系人表单字段定义 | `rxcordys contacts form` |
| 新增联系人(必填 customerId, name) | `rxcordys contacts add <data> [--dry-run] [--yes]` |
| 更新联系人(全量更新,需含 id + 必填字段) | `rxcordys contacts update <data> [--dry-run] [--yes]` |
| 批量更新联系人(ids[], fieldId, fieldValue) | `rxcordys contacts batch-update <data> [--dry-run] [--yes]` |
| 合同视图列表 | `rxcordys contracts list [--opts <string>]` |
| 合同详情 | `rxcordys contracts get <id>` |
| 合同分页列表 | `rxcordys contracts page [payload]` |
| 全局搜索合同 | `rxcordys contracts search [payload]` |
| 合同表单字段定义 | `rxcordys contracts form` |
| 新增合同 | `rxcordys contracts add <data> [--dry-run] [--yes]` |
| 更新合同(全量更新,需含 id) | `rxcordys contracts update <data> [--dry-run] [--yes]` |
| 批量更新合同(ids[], fieldId, fieldValue) | `rxcordys contracts batch-update <data> [--dry-run] [--yes]` |
| 合同金额统计(返回 {amount, averageAmount}) | `rxcordys contracts stat [--payload <string>]` |
| 回款计划分页列表 | `rxcordys contracts payment-plan-page [payload]` |
| 回款计划详情 | `rxcordys contracts payment-plan-get <id>` |
| 回款计划表单字段定义 | `rxcordys contracts payment-plan-form` |
| 新增回款计划 | `rxcordys contracts payment-plan-add <data> [--dry-run] [--yes]` |
| 更新回款计划(需含 id) | `rxcordys contracts payment-plan-update <data> [--dry-run] [--yes]` |
| 回款计划金额统计 | `rxcordys contracts payment-plan-stat [--payload <string>]` |
| 回款记录分页列表 | `rxcordys contracts payment-record-page [payload]` |
| 回款记录详情 | `rxcordys contracts payment-record-get <id>` |
| 回款记录表单字段定义 | `rxcordys contracts payment-record-form` |
| 新增回款记录 | `rxcordys contracts payment-record-add <data> [--dry-run] [--yes]` |
| 更新回款记录(需含 id) | `rxcordys contracts payment-record-update <data> [--dry-run] [--yes]` |
| 回款记录金额统计 | `rxcordys contracts payment-record-stat [--payload <string>]` |
| 工商抬头分页列表 | `rxcordys contracts business-title-page [payload]` |
| 工商抬头表单字段定义 | `rxcordys contracts business-title-form` |
| 新增工商抬头 | `rxcordys contracts business-title-add <data> [--dry-run] [--yes]` |
| 更新工商抬头(需含 id) | `rxcordys contracts business-title-update <data> [--dry-run] [--yes]` |
| 发票视图列表 | `rxcordys invoices list [--opts <string>]` |
| 发票详情 | `rxcordys invoices get <id>` |
| 发票分页列表 | `rxcordys invoices page [payload]` |
| 发票表单字段定义 | `rxcordys invoices form` |
| 新增发票 | `rxcordys invoices add <data> [--dry-run] [--yes]` |
| 更新发票(全量更新,需含 id) | `rxcordys invoices update <data> [--dry-run] [--yes]` |
| 订单视图列表 | `rxcordys orders list [--opts <string>]` |
| 订单详情 | `rxcordys orders get <id>` |
| 订单分页列表 | `rxcordys orders page [payload]` |
| 全局搜索订单 | `rxcordys orders search [payload]` |
| 订单表单字段定义 | `rxcordys orders form` |
| 新增订单 | `rxcordys orders add <data> [--dry-run] [--yes]` |
| 更新订单(全量更新,需含 id) | `rxcordys orders update <data> [--dry-run] [--yes]` |
| 批量更新订单(ids[], fieldId, fieldValue) | `rxcordys orders batch-update <data> [--dry-run] [--yes]` |
| 订单金额统计(返回 {amount, averageAmount}) | `rxcordys orders stat [--payload <string>]` |
| 跟进计划分页查询(parent ∈ lead/account/opportunity) | `rxcordys follows plan <parent> [--payload <string>]` |
| 跟进记录分页查询(parent ∈ lead/account/opportunity) | `rxcordys follows record <parent> [--payload <string>]` |
| 跟进计划/记录的表单字段定义 | `rxcordys follows form <type>` |
| 新增跟进计划(必填 content, method, owner, type) | `rxcordys follows plan-add <parent> <data> [--dry-run] [--yes]` |
| 更新跟进计划(需含 id + 必填字段) | `rxcordys follows plan-update <parent> <data> [--dry-run] [--yes]` |
| 新增跟进记录(必填 content, followMethod, owner, type) | `rxcordys follows record-add <parent> <data> [--dry-run] [--yes]` |
| 更新跟进记录(需含 id + 必填字段) | `rxcordys follows record-update <parent> <data> [--dry-run] [--yes]` |
| 查询审批待办(pending/processed/initiated/cc/count) | `rxcordys approvals todo <kind> [--payload <string>]` |
| 执行审批动作(approve/reject/back/sign/revoke/batch-approve/batch-reject) | `rxcordys approvals action <action> <data> [--dry-run] [--yes]` |
| 审批资源操作(push/revoke/simple-detail/detail) | `rxcordys approvals resource <action> [--arg <string>]` |
| 审批流程配置-读(page/get/enable/disable/by-form/setting;写见 flow-add/flow-update/flow-webhook-test) | `rxcordys approvals flow <action> [--arg <string>] [--payload <string>]` |
| 新增审批流程配置(原 flow add;独立命令以套用写入确认门) | `rxcordys approvals flow-add <data> [--dry-run] [--yes]` |
| 更新审批流程配置(原 flow update;独立命令以套用写入确认门) | `rxcordys approvals flow-update <data> [--dry-run] [--yes]` |
| 触发审批流程 webhook 测试(原 flow webhook-test;独立命令以套用写入确认门) | `rxcordys approvals flow-webhook-test <data> [--dry-run] [--yes]` |
| 模块金额统计(返回 {amount, averageAmount}) | `rxcordys stats stat <module> [--payload <string>]` |
| 首页线索统计(今日/本周/本月/本年 + 环比) | `rxcordys stats home-lead [--payload <string>]` |
| 首页商机统计(type ∈ all/success/underway) | `rxcordys stats home-opportunity [--type <string>] [--payload <string>]` |
| 查询当前用户可见的部门权限树 | `rxcordys stats dept-tree` |
| 查询当前用户信息(兼验证凭证是否有效) | `rxcordys util whoami` |
| 验证当前凭证是否有效(返回用户信息) | `rxcordys util verify` |
| 查询部门组织树 | `rxcordys util org` |
| 查询成员列表(分页) | `rxcordys util members [payload]` |
| 全局搜索模块计数(按关键词返回各模块命中数) | `rxcordys util glocount <keyword>` |
| 原始透传任意端点(相对路径拼 baseUrl,绝对 URL 直连) | `rxcordys util raw <method> <path> [--body <string>]` |
<!-- AUTO-GEN:END -->
