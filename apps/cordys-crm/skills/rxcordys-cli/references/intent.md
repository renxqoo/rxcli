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

以下指令依赖角色判断(见 role.md),未确认角色时按销售(自己)视角处理:

| 用户说 | 适用角色 | 执行 |
|--------|---------|------|
| 团队今天 / 部门概览 | 经理 | `stats home-*` + `searchType:DEPARTMENT`(需先 `util org` 拿 deptId) |
| 团队这周 / 部门周会 | 经理 | 同上 + 本周环比 |
| 人均产出 / 人效 | 高管 | `util members` + 逐人 `stats stat` |
| 公司情况 / 经营数据 | 高管 | `stats home-*` + `searchType:ALL` |
| 今天回款 / 回款情况 | 财务 | `accounts sub payment-record-stat`(全公司/部门) |
| 欠款情况 / 催款 | 财务 | `contracts payment-plan-page` 筛到期未回 |
| 开票情况 | 财务 | `accounts sub invoice-stat` |
| 合同审批追踪 | 商务 | `approvals todo pending` |
| 合同到期 / 续约 | 商务 | `contracts page` 筛 `endTime` 近 30 天 |

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
