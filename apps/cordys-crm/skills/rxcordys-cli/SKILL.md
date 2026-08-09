---
name: rxcordys-cli
description: |
  查询和管理 Cordys CRM 的销售全流程数据(线索→客户→商机→合同→回款→发票→订单)。当用户提到线索、客户、商机、合同、回款、发票、订单、报价单、联系人、跟进、审批、漏斗、统计、工商抬头、销售数据、CRM,或想查/改 Cordys 系统里的任何业务记录时使用——即使用户没说"Cordys"或"CRM"也要触发。
version: 1.0.0
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
# A. 持久化(推荐):写 ~/.rxcli/credentials/cordys.json
rxcordys auth login --accessKey <AccessKey> --secretKey <SecretKey>

# B. 环境变量(CI / 临时)
export CORDYS_ACCESS_KEY=<AccessKey>
export CORDYS_SECRET_KEY=<SecretKey>
# 可选:export CORDYS_CRM_DOMAIN=https://www.cordys.cn
```

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

响应 `meta.pagination`:`complete:true` 已拉完;`complete:false` 时 `nextToken` 是下一页页码,用 `--payload '{"current": <nextToken>}'` 续拉。

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
- **`--dryRun`** 仅校验不发请求(返回 `meta.dryRun:true`)——先验证 JSON 再正式提交
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

**大结果集**:

| 返回条数 | 展示方式 |
|---------|---------|
| 1-10 条 | 完整表格 |
| 11-30 条 | 前 10 条 + "还有 N 条,是否查看更多?" |
| 30 条以上 | 统计摘要 + 前 10 条 + "建议增加筛选条件" |

> 完整输出模板(列表/详情/写入确认/全局搜索/漏斗)+ emoji 状态规范 + 反模式 → 见 [references/output.md](references/output.md)。

## 安全边界

- **禁止任何删除操作**——不响应删除意图。`util raw` 虽能透传 `GET /approval-flow/delete/{id}` 等删除端点,但 agent 不应主动调用,除非用户明确点名该端点且确认后果。
- **禁止在输出暴露密钥**——`CORDYS_ACCESS_KEY`/`CORDYS_SECRET_KEY` 的值绝不出现;API 错误含密钥信息须脱敏。
- **写入必须经确认**——所有 `add`/`update`/`transition`/`transform`/`approvals action` 默认返回 exit 10,需 `--yes` 执行或 `--dryRun` 先校验。
- **角色不改查询范围**——角色推断只影响展示字段;切团队/全公司数据需用户显式要求(见 references/role.md)。

## 错误处理

| exit | 错误 | 处理 |
|:----:|------|------|
| 3 | `authentication/no_credentials` | 未配置凭证 → `rxcordys auth login` |
| 3 | `authentication/token_expired` | 凭证失效(401) → 检查密钥对,可能 demo 环境已回滚 |
| 3 | `authorization/forbidden` | 无权限(403) → 联系管理员开通数据权限 |
| 1 | `api/not_found` | 记录不存在 → 用 `page` 查有效 ID |
| 1 | `api/server_error` | 服务端错误(含业务码≠100200) → 看 message/messageDetail |
| 10 | `confirmation/high_risk_write` | 写入需确认 → 加 `--yes` |
| 2 | `validation/*` | 参数错误(JSON 不合法/缺必填字段) → 按 hint 修正 |
| 4 | `network/*` | 网络错误 → 检查 `CORDYS_CRM_DOMAIN` 可达性,稍后重试 |

> Cordys 业务错误可能是 HTTP 200 + `code≠100200`,CLI 已解包并映射为 `api/*`。

> ⚠️ **`get` 不存在的 ID 返回 `data:null` + exit 0**(不是 `not_found`)。这是 Cordys API 设计——查不到时返回 200 + `{code:100200, data:null}`,不报错。agent 判断时:**`get`/`quotation-get`/`payment-plan-get` 返回 `data:null` 即"记录不存在"**,应用 `page` 重新查有效 ID。

## 命令(按模块分组)

> 命令格式:`<x>` 必填位置参数、`[x]` 可选位置参数、`--x <t>` 可选 flag。所有写入命令额外支持 `--dryRun`(仅校验)、`--yes`(跳过确认)。需要某命令的参数详情时跑 `rxcordys <ns> <cmd> --help`。

**顶层快捷**:`whoami` / `qrcode <url>`

| 模块 | 命令 |
|------|------|
| `auth` | `login --accessKey <k> --secretKey <k>` · `status` · `logout` |
| `records`(跨模块通用) | `view <module> [--opts JSON]` · `get <module> <id>` · `page <module> [payload]` · `search <module> [payload]` · `contact <module> <id>` · `product [payload]` · `form <module>` |
| `leads` | `list` · `get <id>` · `page [payload]` · `search [payload]` · `form` · `add <data>` · `update <data>` · `batch-update <data>` · `transition <data>` · `transform <data>` |
| `accounts` | `list` · `get <id>` · `page [payload]` · `search [payload]` · `form` · `add <data>` · `update <data>` · `batch-update <data>` · `sub <type> <id> [payload]` |
| `opportunities` | `list` · `get <id>` · `page [payload]` · `search [payload]` · `form` · `add <data>` · `update <data>` · `quotation-get <id>` · `quotation-page [payload]` · `quotation-form` · `quotation-add <data>` · `quotation-update <data>` |
| `contacts` | `list` · `get <id>` · `page [payload]` · `search [payload]` · `form` · `add <data>` · `update <data>` · `batch-update <data>` |
| `contracts` | `list` · `get <id>` · `page [payload]` · `search [payload]` · `form` · `add <data>` · `update <data>` · `batch-update <data>` · `stat [--payload JSON]` · `payment-plan-{page,get,form,add,update,stat}` · `payment-record-{page,get,form,add,update,stat}` · `business-title-{page,form,add,update}` |
| `invoices` | `get <id>` · `page [payload]` · `form` · `add <data>` · `update <data>` |
| `orders` | `list` · `get <id>` · `page [payload]` · `search [payload]` · `form` · `add <data>` · `update <data>` · `batch-update <data>` · `stat [--payload JSON]` |
| `follows` | `plan <parent> [payload]` · `record <parent> [payload]` · `form <type>` · `plan-add <parent> <data>` · `plan-update <parent> <data>` · `record-add <parent> <data>` · `record-update <parent> <data>`(`<parent>` ∈ lead/account/opportunity) |
| `approvals` | `todo <kind>`(pending/processed/initiated/cc/count) · `action <action> <data>`(approve/reject/back/sign/revoke/batch-*) · `resource <action> [--arg]`(push/revoke/simple-detail/detail) · `flow <action> [--arg] [--payload]`(page/get/add/update/enable/disable/by-form/setting/webhook-test) |
| `stats` | `stat <module> [--payload]`(contract/payment-record/opportunity/order) · `home-lead [--payload]` · `home-opportunity [--type all\|success\|underway]` · `dept-tree` |
| `util` | `whoami` · `verify` · `org` · `members [payload]` · `glocount <keyword>` · `raw <method> <path> [--body JSON]` |

> 各模块端点对照(路径/方法)见 [references/modules.md](references/modules.md)。

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
