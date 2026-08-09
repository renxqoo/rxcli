# 风险预警

> 查询结果展示后,按本文件规则**主动扫描并预警**。目标:让输出从"数据搬运"变成"业务判断"。

> ⚠️ **字段说明**:下文字段名已在 demo 环境实测确认(demo.cordys.cn)。不同部署的字段可能因配置不同而异,以 `rxcordys <ns> form` 或实际返回为准。已验证的关键字段:
> - 线索:`followTime`(跟进时间)/ `latestFollowUpTime`(最近跟进)/ `createTime` / `stage`(如 `NEW`)/ `ownerName`
> - 商机:`stage`(赢单=`SUCCESS`,输单见下文枚举)/ `stageName`(中文)/ `amount` / `customerId` / `expectedEndTime` / `followTime`
> - 合同:`createTime`(创建即签约时间点)/ `startTime` / `endTime` / `approvalStatus`(如 `APPROVED`)/ `stage`+`stageName`(如 `PENDING_SIGNING`/待签署)/ `amount` / `alreadyPayAmount`(已回款)/ `number`(合同编号)

---

## 核心原则

- **不重复提醒**:同一异常仅在首次发现时提示,别每次都报
- **不堆砌**:一次最多报 3 条最严重的,再多说"还有 N 项异常,是否展开"
- **判断比复述重要**:不说"有 3 条线索超期",要说"YYY 集团已 7 天未跟进,建议今日优先联系"
- **区分真正的零和数据失败**:API 报错(`api/*`、`network/*`)时不产出预警判断,只报错

---

## 触发时机(何时扫哪类)

不要每次查询都全量扫描。按触发点精准扫:

| 触发点 | 扫描类别 |
|--------|---------|
| 查线索/商机列表后 | §销售预警 |
| 查客户详情/客户 360 后 | §L2C 断链(客户活跃度 + 链路健康) |
| 查合同/回款/发票后 | §L2C 断链(合同→回款/发票) |
| 查待审批列表后 | §审批预警 |
| 任何列表返回空 | §通用预警(区分零 vs 失败) |
| 用户说"有什么要注意的/有什么风险" | 全量扫描(线索+商机+合同+审批) |

---

## 销售预警

用户查自己的线索/商机列表时,自动扫描:

| 条件 | 提醒文案 | 查询命令(参考字段) |
|------|---------|-------------------|
| 线索 `followTime` 为 0/null(从未跟进) | `🚨 {客户名} 从未跟进,请立即处理` | `rxcordys leads page`,筛 `followTime` 缺失或为 0 的 |
| 线索 `followTime` 超 3 天未跟进(有值时) | `⚠️ {客户名} 已 {N} 天未跟进` | `rxcordys leads page` 按 `followTime` 升序,取有值的最早记录 |
| 商机在 `stage` 停留 > 7 天未更新 | `⚠️ 商机 {名称} 在 {阶段} 停留 {N} 天` | `rxcordys opportunities page`(筛 `stage` 非 `SUCCESS`/失败) |
| 今日跟进计划未完成 | `📋 今日还有 {N} 条跟进计划未完成` | `rxcordys follows plan lead` 看未完成项 |
| 线索积压 > 20 条 | `📊 未处理线索已达 {N} 条,建议优先消化` | `rxcordys leads page` 看 `meta.count` |

> **followTime 判定要点**(实测):demo 数据里大量线索 `followTime` 为 `0` 或 `null`(即 1970-01-01)。这类要判为"从未跟进"(🚨 高危),不能算成"超期 20675 天"。计算天数前先判空:`followTime > 0` 才算超期天数,否则标记"从未跟进"。

**判断要点**:结合 `follows plan`(今日计划)和 `leads page`(线索列表),算出"该跟没跟"的具体清单,而不是只报数字。

---

## 审批预警

| 条件 | 提醒文案 | 查询命令 |
|------|---------|---------|
| 当前用户待审批 ≥ 5 条 | `📋 您有 {N} 条待审批,建议尽快处理` | `rxcordys approvals todo count`(返回 `{total, quotation, contract, order, invoice}`,看 `total`) |
| 某待审批超 3 天未处理 | `⚠️ "{名称}"的审批已等待 {N} 天` | `rxcordys approvals todo pending --payload '{"pageSize":20}'` 看创建时间 |

> `approvals todo count` 返回对象(非纯数字):`{total, quotation, contract, order, invoice}`,按资源类型拆分。判断总数用 `total`。`pending` 命令的分页载荷用 `--payload` flag(不是位置参数)。
>
> 📋 **待验证**:驳回次数依赖 `approvals flow get` 的历史字段,demo 环境无审批数据,部署后实测补充"驳回≥2次"预警。

---

## L2C 断链检测(链断裂)

> 以下检测依赖 `accounts sub`(客户子资源)的关联查询,该命令会自动注入 `body.customerId`(accounts.ts:186),用户不必手传。关联字段 caveat 同上。

### 线索→客户断链

| 条件 | 提醒文案 | 查询命令 |
|------|---------|---------|
| 线索创建 > 30 天未转化 | `⚠️ {N} 条线索超 30 天未转化,建议评估` | `rxcordys leads page` 按 `createTime` 升序 |
| 线索创建 > 90 天未转化 | `🚨 {N} 条线索超 90 天未转化,长期占用线索池` | 同上 |

### 商机→合同断链

| 条件 | 提醒文案 | 查询命令 |
|------|---------|---------|
| 商机 `stage`=赢单但无关联合同 | `⚠️ 商机"{名称}"已赢单但未找到关联合同` | `rxcordys accounts sub opportunity <accountId>` + 查合同 |
| 赢单 > 15 天未签约 | `🚨 商机"{名称}"赢单 {N} 天未签约,存在丢单风险` | 同上 + 对比 `actualEndTime` |

> 商机 `stage` 枚举(实测):`SUCCESS`=赢单(对应 `stageName: 成功`)、另有输单/进行中各阶段值,判断"赢单"用 `stage === "SUCCESS"`。赢单时间看 `actualEndTime`(实际结束时间)。

### 合同→回款断链

| 条件 | 提醒文案 | 查询命令 |
|------|---------|---------|
| 合同已签约,无回款计划 | `⚠️ 合同"{名称}"(¥{金额})未创建回款计划` | `rxcordys contracts payment-plan-page` 按 contractId 查 |
| 合同签约 > 30 天,无回款记录 | `🚨 合同"{名称}"签约 {N} 天仍无回款` | 看 `contracts page` 返回的 `alreadyPayAmount=0`,或 `accounts sub payment-record-stat` |
| 回款计划到期未回款 | `⚠️ {N} 笔回款计划已到期未收到回款` | `rxcordys contracts payment-plan-page`(筛 `planEndTime` < 今天) |

> 合同记录本身含 `alreadyPayAmount`(已回款金额)字段,签约时间用 `startTime`(合同开始)或 `createTime`(创建)。判断"签约无回款"可直接看 `alreadyPayAmount === 0`,无需额外查 stat。

### 合同→发票断链

| 条件 | 提醒文案 | 查询命令 |
|------|---------|---------|
| 合同签约 > 15 天未开发票 | `⚠️ 合同"{名称}"签约 {N} 天未开发票` | `rxcordys accounts sub invoice-stat <accountId>`,看 `invoicedAmount=0` |
| 已回款但未开票 | `⚠️ 已回款 ¥{金额} 但未开票` | 对比 `payment-record-stat.receivedAmount` 与 `invoice-stat.invoicedAmount` |
| 已开发票但未回款 | `📋 已开票 ¥{金额} 尚未回款` | 对比 `invoice-stat.invoicedAmount` 与 `payment-record-stat.receivedAmount` |

> `invoice-stat` 真实返回:`{contractAmount, uninvoicedAmount, invoicedAmount}`;`payment-record-stat`:`{totalAmount, receivedAmount, pendingAmount}`。判断开票/回款进度直接用这几个金额字段对比,不用数笔数。

### 客户活跃度断链

| 条件 | 提醒文案 | 查询命令 |
|------|---------|---------|
| 客户 > 90 天无跟进记录 | `⚠️ 客户"{名称}"已 {N} 天无跟进` | `rxcordys follows record account`(看最近记录时间) |
| 客户有名下商机但 > 60 天无跟进 | `⚠️ 客户"{名称}"有名下商机但已 {N} 天未跟进` | `accounts sub opportunity` + `follows record` |
| 客户有合同但 > 180 天无新商机 | `📊 客户"{名称}"有合同关系但 {N} 天无新商机,存在流失风险` | `accounts sub contract` + `opportunity` 对比 |

---

## 角色相关预警(依赖数据范围)

> 这些预警需要团队/全公司视角的聚合数据。用户**显式要求**看团队/全公司时才适用(数据范围切换见 role.md)。未确认角色或未要求时按销售(自己)视角扫描。

### 经理预警

| 条件 | 提醒文案 | 依赖 |
|------|---------|------|
| 团队跟进率 < 60% | `🚨 部门本周线索跟进率仅 {N}%` | ⚠️ `stats home-lead` + `searchType:DEPARTMENT`,需 `deptIds` |
| 某成员连续 2 周转化偏低 | `⚠️ {成员} 连续 {N} 周转化率 < 10%` | ⚠️ `util members` + 逐人统计,聚合命令待验证 |
| 部门目标进度 < 时间进度 | `📊 部门目标完成 {N}%,时间已过 {M}%` | 📋 待确认 stats 是否返回目标进度字段 |

### 高管预警

| 条件 | 提醒文案 | 依赖 |
|------|---------|------|
| 季度时间进度 > 业绩进度 + 15% | `🚨 季度目标完成率仅 {N}%,时间已过 {M}%` | 📋 待验证目标字段 |
| 某部门签约环比下降 > 30% | `⚠️ {部门}签约环比下降 {N}%` | ⚠️ `stats stat contract` 按 dept 拆分,待验证 |
| 全公司回款率 < 80% | `🚨 全公司回款率仅 {N}%` | ✅ `stats stat contract` + `payment-record` |

### 财务预警

| 条件 | 提醒文案 | 依赖 |
|------|---------|------|
| 回款逾期 | `🚨 合同"{名称}"回款逾期 {N} 天,¥{金额}` | ✅ `accounts sub payment-record-stat`(看逾期) |
| 未开票合同占比高 | `⚠️ 本月签约 {N} 份,仅 {M} 份已开票` | ✅ 对比合同数与 `invoice-stat` |
| 未来 7 天 ≥ 3 笔回款到期 | `📋 未来 7 天 {N} 笔回款到期,总 ¥{总额}` | ✅ `contracts payment-plan-page` 筛 `planEndTime` |

### 商务预警

| 条件 | 提醒文案 | 依赖 |
|------|---------|------|
| 合同审批 > 7 天未完成 | `🚨 合同"{名称}"审批已 {N} 天未完成` | ⚠️ `approvals todo pending` + 创建时间 |
| 合同到期 ≤ 30 天未标记续约 | `⚠️ 合同"{名称}"将在 {N} 天后到期` | ✅ `contracts page` 筛 `endTime` |

> ✅ 当前命令可算 · ⚠️ 依赖聚合命令/待验证字段 · 📋 待确认后端是否返回该字段

---

## 通用预警

适用所有列表查询,不依赖业务语义:

| 场景 | 提醒 |
|------|------|
| 列表返回空(data:[]) | 区分"确实没有"和"过滤太严":提示用户是否放宽筛选 |
| 数据量环比异常(±50%) | `📊 本周 {模块} 新增 {N} 条,较上周 {上升/下降} {M}%` |
| 查询返回 > 100 条 | 提示"共 {N} 条,建议增加筛选条件缩小范围" |

### 空结果判断规则

```
data: [] + meta.count = 0
  ├─ 用户带了筛选条件 → "当前筛选下无数据,建议放宽条件"(过滤太严的可能)
  └─ 用户未带筛选 → "系统中暂无 {模块} 数据"(确实为空)
```

---

## 链路健康度输出模板

执行 Customer 360 或全链路追踪时(见 intent.md),输出链路完整性:

```
🔗 链路健康:{客户名}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 线索→客户      已转化
✅ 客户→商机      2 个活跃商机
⚠️  商机→合同      1 个赢单未签约(15 天)
✅ 合同→回款      2 个合同,回款进度 50%
🚨 合同→发票      1 个合同未开发票(30 天)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

判断逻辑:对客户名下的每个关联模块逐一检查(用 `accounts sub` 各 type),缺失环节标 ⚠️/🚨,正常环节标 ✅。
