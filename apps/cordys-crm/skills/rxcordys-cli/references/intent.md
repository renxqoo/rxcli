# 模糊指令意图映射

> SKILL.md 的「何时用什么」速查表覆盖**显式操作**(查列表/看详情/创建)。本文件覆盖那表之外的**模糊工作指令**——用户没说具体动词,只说目标("今天做什么""这周怎么样")。
>
> **设计原则**:意图→命令直连,不做"意图→profile→章节"的间接跳转。

---

## 模糊指令 → 命令

| 用户说 | 执行命令 | 输出重点 |
|--------|---------|---------|
| 今天做什么 / 有什么要跟的 | `follows plan lead`(今日未完成计划) + `leads page` SELF 按 `followTime` 升序 | 今日计划 + 最久未跟线索 + 风险提醒 |
| 这周怎么样 / 周报 | `stats home-lead` + `home-opportunity`(含 `searchType`) | 本周线索/商机/签约统计 + 环比(`priorPeriodCompareRate`) |
| 有什么要注意的 / 有什么风险 | 触发全量扫描(见 risk.md):线索 + 商机 + 合同 + 审批 | 按严重度排序的异常清单 |
| 查查这笔单子 / 这笔合同 | 见 §L2C 全链路追踪 | 完整链路视图 + 链路健康度 |
| XX 公司全景 / 看看 XX 公司 | 见 §Customer 360 | 360 视图 + 链路健康度 |
| 本月做了多少 | `stats stat contract --payload '{"searchType":"SELF"}'` + `stats stat payment-record` | 月度签约额 + 回款额(`{amount, averageAmount}`) |
| 我的商机怎么样 | `opportunities page` SELF,按 `stage` 分组 | 阶段分布 + 卡点商机(停留>7天) + 金额预测 |
| 批一下 / 待审批 | `approvals todo count`(看 `total`)+ `approvals todo pending --payload '{"pageSize":20}'` | 待办数量 + 列表(按创建时间) |
| 先跟哪个 / 优先级 | `leads page` SELF 按 `followTime` 升序 + 对比 `follows plan` | 按紧急度排序:超期→计划待办→新线索 |
| 我的客户怎么样 | `accounts page` SELF + 按 `followTime` 升序找沉睡客户 | 活跃/沉睡分类 + 续约预警 |

> `searchType`/`viewId` 等数据范围参数:默认看自己(SELF),用户明确说"团队的/全公司的"才切,见 role.md §数据范围。
>
> **stats 命令载荷用 `--payload` flag**(不是位置参数):`stats home-lead --payload '{...}'`。`stats home-*` 的 searchType 默认看全部(ALL),要限自己/部门需显式传。
>
> **stats home-* 真实返回字段**(实测):
> - `home-lead`:`{thisYearClue, thisMonthClue, thisWeekClue, todayClue}`,每项 `{value, priorPeriodCompareRate}`
> - `home-opportunity`:`{thisYearOpportunity, thisMonthOpportunity, thisWeekOpportunity, todayOpportunity, thisYearOpportunityAmount, ...Amount}`,前 4 个是数量,后 4 个是对应金额
> - `stat <module>`:`{amount, averageAmount}`

---

## L2C 全链路追踪("查查这笔单子")

用户给合同名/编号/ID,追溯完整链路(线索→客户→商机→合同→回款→发票)。

### 执行流程

```
起点:合同(用户给了编号或名)
  ├─ 1. rxcordys contracts page '{"keyword":"CRM-2026-001"}'
  │      → 定位合同,拿 contractId + customerId
  ├─ 2. rxcordys contracts get <contractId>
  │      → 合同详情(金额/签约日/审批状态)
  ├─ 3. 反向追溯(合同→客户→商机→线索):
  │      ├─ rxcordys accounts page '{"keyword":"<customerName>"}' → 客户基本信息(不用 get,常返回 null)
  │      └─ rxcordys accounts sub opportunity <customerId> → 客户名下商机(找对应商机)
  ├─ 4. 正向追踪(合同→回款→发票):
  │      ├─ rxcordys accounts sub payment-record-stat <customerId> → 回款统计
  │      └─ rxcordys accounts sub invoice-stat <customerId>        → 开票统计
  └─ 5. 输出完整 L2C 时间线 + 链路健康度
```

### 输出模板

```
📋 L2C 全链路:{合同名/编号}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔹 客户 {客户名}({行业},负责人 {姓名})
     └── 🔹 商机 {商机名} ¥{金额}(阶段={阶段})
              └── 🔹 合同 {合同号} ¥{金额}(签约 {日期})
                       ├── 💰 回款 {已回}/{总额}({N}期计划)
                       └── 🧾 发票 {N} 张 ¥{开票金额}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 链路健康:{用 risk.md §链路健康度模板}
⏱️ 成交周期:{N} 天
💰 回款进度:{M}%
```

> ⚠️ **关联字段(已实测确认)**:合同通过 `customerId` 关联客户,**没有 `opportunityId`**(商机↔合同靠客户间接关联,需用 `customerId` 反查 `accounts sub opportunity`)。线索→客户靠转化 API,无字段直接关联。stat 返回结构:`payment-record-stat → {totalAmount, receivedAmount, pendingAmount}`;`invoice-stat → {contractAmount, uninvoicedAmount, invoicedAmount}`;`contract-stat → {totalAmount}`。

---

## Customer 360("看看 XX 公司")

用户给公司名,输出公司全景。

### 执行流程

```
1. rxcordys util glocount <公司名>
     → 各模块命中数,确认有客户记录
2. rxcordys accounts page '{"keyword":"公司名"}'
     → 锁定 accountId + 拿客户基本信息(行业/负责人/部门)
3. 并行调子资源(accounts sub 自动注入 customerId):
   ├─ accounts sub contract <id>           → 合同列表(含 alreadyPayAmount)
   ├─ accounts sub opportunity <id>        → 商机列表(含 stage/stageName)
   ├─ accounts sub order <id>              → 订单列表
   ├─ accounts sub contract-stat <id>      → 合同总额 {totalAmount}
   ├─ accounts sub payment-record-stat <id>→ 回款概览 {totalAmount, receivedAmount, pendingAmount}
   └─ accounts sub invoice-stat <id>       → 开票概览 {contractAmount, uninvoicedAmount, invoicedAmount}
4. rxcordys follows record account(看最近跟进,可能因权限返回 500,忽略)
5. 输出 360 视图 + 链路健康度
```

> **客户基本信息从 `accounts page` 拿,不用 `accounts get`**——实测 `accounts get <id>` 经常返回 `data:null`(SKILL.md 已记的已知行为)。`page` 搜索结果已含 name/ownerName/departmentName/latestFollowUpTime 等字段。

### 输出模板

```
🏢 客户 360:{公司名}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{行业} | {省份} | 负责人 {姓名}

📌 商机({N} 个,总计 ¥{金额})
| 名称 | 金额 | 阶段 | 创建时间 |

📌 合同({N} 份,签约 ¥{签约},已回 ¥{已回})
| 合同号 | 金额 | 签约日 | 回款进度 |

📌 联系人({N} 人) · 订单({N} 个) · 发票({N} 张)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 链路健康:{用 risk.md §链路健康度模板}
最近跟进:{日期} - {内容摘要}
```

---

## 角色相关模糊指令

以下指令依赖角色判断(见 role.md),未确认角色时按销售(自己)视角处理。完整工作流时间表见 role.md §工作流时间表。

### 经理("团队今天""团队这周""本月复盘")

```
团队今天 / 部门概览:
  1. rxcordys util org                     → 部门树,拿 deptId
  2. rxcordys util members --payload '{"departmentId":"<id>"}' → 成员数
  3. rxcordys stats home-lead --payload '{"searchType":"DEPARTMENT","deptIds":["<id>"]}'
     → 部门线索统计(thisWeekClue 等)
  4. rxcordys stats home-opportunity --payload '{"searchType":"DEPARTMENT","deptIds":["<id>"]}'
     → 部门商机数 + 金额

团队这周 / 部门周会:
  同上 + 对比本周与上周(priorPeriodCompareRate 字段) + 成员排名

本月复盘:
  1. 本月漏斗(stats home-* DEPARTMENT)
  2. rxcordys util members → 逐人 rxcordys stats stat contract --payload '{"searchType":"DEPARTMENT","deptIds":["<成员deptId>"]}'
  3. 商机按 stage 分组(赢单/输单/进行中)
```

> `deptIds` 需用 `util org` 拿到的部门 ID。若要含子部门,递归展开 org 树的 children。

### 高管("公司情况""人均产出")

```
公司情况 / 经营数据:
  1. rxcordys stats home-lead --payload '{"searchType":"ALL"}'         → 全公司线索
  2. rxcordys stats home-opportunity --payload '{"searchType":"ALL"}'  → 全公司商机 + 金额
  3. rxcordys stats stat contract --payload '{"searchType":"ALL"}'     → 合同总额
  4. rxcordys stats stat payment-record --payload '{"searchType":"ALL"}' → 回款总额

人均产出 / 人效:
  1. rxcordys util org → 一级部门列表
  2. 逐部门:rxcordys util members --payload '{"departmentId":"<id>"}' → 成员数
  3. 逐部门:rxcordys stats stat contract --payload '{"searchType":"DEPARTMENT","deptIds":["<id>"]}' → 签约额
  4. 人均 = 签约额 / 成员数,部门间排序输出
```

### 财务("今天回款""欠款情况""开票情况")

```
今天回款 / 回款情况:
  1. rxcordys contracts payment-record-page → 看今日 recordEndTime
  2. rxcordys contracts payment-plan-page → 今日到期计划
  3. 汇总逾期(已过 planEndTime 但无对应 record)

欠款情况 / 催款:
  1. rxcordys contracts payment-plan-page → 全部计划
  2. 筛未回款/部分回款(planStatus),按 planEndTime 排序
  3. 逾期优先输出,附金额和逾期天数

开票情况:
  1. 遍历有合同的客户:rxcordys accounts sub invoice-stat <id>
  2. 汇总 uninvoicedAmount(未开票额)
  3. 标已回款未开票的(对比 payment-record-stat.receivedAmount 与 invoicedAmount)
```

### 商务("合同审批追踪""合同到期")

```
合同审批追踪:
  1. rxcordys approvals todo count → 看 total
  2. rxcordys approvals todo pending --payload '{"pageSize":20}' → 待办列表
  3. 标超 3 天未处理(对比 createTime)

合同到期 / 续约:
  1. rxcordys contracts page → 看 endTime
  2. 筛 endTime 近 30 天的合同
  3. 标未续约(无新关联合同)
```

> 未确认角色时:先 `rxcordys util whoami` 推断(见 role.md)。无法确定时默认销售视角,并提示用户"如需团队/全公司数据,请说明"。

---

## 搜索即链路

全局模糊搜索时,除分别展示各模块结果,自动做关联分析:

| 命中情况 | 标注 |
|---------|------|
| 命中 account | 标注"该客户名下有 {N} 个商机/合同" |
| 命中 lead + account | 标注"线索 {名} 可能已转化为该客户" |
| 命中 contract | 标注"回款进度 {X}%" |
| 线索+客户+商机同时命中 | 标注"检测到完整链路:线索→客户→商机(¥金额),建议查看客户 360" |

---

## L2C 漏斗分析

用户问转化率/管道/漏斗("漏斗怎么样""转化率""管道金额""下月预测")时,按本节执行。

### 角色 → searchType 映射(算漏斗前先定范围)

| 角色 | searchType | deptIds | 谁的数据 |
|------|-----------|---------|---------|
| 销售 | `SELF` | 空 | 自己 |
| 经理 | `DEPARTMENT` | `util org` 拿的部门 ID(含子部门需递归展开) | 本部门 |
| 高管/财务 | `ALL` | 空 | 全公司 |

### 漏斗数据采集(各阶段独立统计)

```
漏斗快照(本月):
  1. 线索数:rxcordys stats home-lead --payload '{"searchType":"<范围>"}'
     → thisMonthClue.value(本月新增线索数)
  2. 商机数+金额:rxcordys stats home-opportunity --payload '{"searchType":"<范围>"}'
     → thisMonthOpportunity.value(数)+ thisMonthOpportunityAmount.value(金额)
  3. 赢单数+金额:rxcordys stats home-opportunity --type success --payload '{"searchType":"<范围>"}'
  4. 进行中商机:rxcordys stats home-opportunity --type underway --payload '{"searchType":"<范围>"}'
  5. 合同签约额:rxcordys stats stat contract --payload '{"searchType":"<范围>"}'
     → {amount, averageAmount}
  6. 回款额:rxcordys stats stat payment-record --payload '{"searchType":"<范围>"}'
```

> 各阶段是**独立统计**(线索数 ≠ 客户数),完整转化率需关联字段支持。`priorPeriodCompareRate` 字段是环比。

### 漏斗输出格式

```
📊 L2C 漏斗快照(本月 · {范围})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔹 线索       {N} 条
🔹 商机        {N} 条   ¥{金额}(📈 {环比}% vs 上期)
   ├ 赢单      {N} 条   ¥{金额}
   └ 进行中    {N} 条   ¥{金额}
🔹 签约合同    {N} 份   ¥{金额}
🔹 已回款      {N} 笔   ¥{金额}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 各阶段独立统计,完整转化率需关联字段
```

### 管道预测("下月预测""能签多少")

```
预测签约额 = 进行中商机金额 × 历史赢单率

  1. rxcordys stats home-opportunity --type underway --payload '{"searchType":"<范围>"}'
     → 进行中商机总金额(underwayAmount)
  2. 赢单率 = 赢单数 / (赢单数 + 输单数)(从商机 page 按 stage 统计)
  3. 预测签约额 = underwayAmount × 赢单率
  4. 按阶段分组细化(每个阶段 × 该阶段历史转化率)
```

> 预测是估算,需说明假设(赢单率取历史值)。输出时标注"基于历史赢单率 {X}% 估算"。
