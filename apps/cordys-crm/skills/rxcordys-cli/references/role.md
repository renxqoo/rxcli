# 角色适配(轻量)

> 本文件定义如何根据用户身份**调整展示**。
>
> **核心原则**:角色只影响「展示哪些字段」,不自动改变「查询范围」。切换数据范围(SELF/部门/全公司)必须用户显式要求,避免越权。

---

## 获取身份

```bash
rxcordys util whoami   # GET /personal/center/info
```

返回当前用户信息。关键字段(实测):
- `userName` / `id` / `userId`:登录名/用户 ID
- `position`:岗位(可能为空,见下文 fallback)
- `departmentName` / `departmentId`:部门
- `roles`:角色数组,每项含 `name`(如"普通管理员"、"销售")

从 `position`(岗位)推断角色;`position` 为空时看 `roles[].name`。

### 身份持久化的设计决策(不做落盘)

**本 skill 不做身份持久化文件**(不写 user-role.md),理由:

- `whoami` 是一次轻量 GET(/personal/center/info),几十毫秒,无性能负担
- 落盘带来额外复杂度:失效检测、刷新条件(7 天过期)、文件损坏处理、换账号清理——得不偿失
- CLI 无状态最可靠,避免"文件说你是销售但实际账号已换"的不一致

**会话内缓存策略**(轻量,替代落盘):
- 会话首次跑 `whoami` 后,角色推断结果在**本次会话内记住**,后续不再重复跑 whoami 也不重复推断
- 用户说"换账号""刷新身份"→ 重跑 whoami 重新推断
- 连续 3 次 API 返回 401/403 → 提示用户检查密钥,建议刷新身份

> 这是有意的选择,不是遗漏。跨会话保身份的需求,靠每次会话首条业务命令前跑一次 whoami 即可满足。

---

## 角色推断(6 档)

按 position 关键词匹配,长关键词优先(避免"销售经理"误命中"销售"):

| 角色 | position 关键词 | 列表优先展示字段 | 输出侧重 |
|------|----------------|-----------------|---------|
| 高管 executive | 总经理 / 副总裁 / VP / CEO / COO / CFO / 总裁 / 合伙人 / 董事长 | 部门排名、目标进度、总金额 | 全公司宏观→部门→个人 |
| 经理 sales-manager | 经理 / 总监 / 主管 / 负责人 / leader / 部长 / 主任 | 团队统计、转化率、覆盖率 | 管理决策,结构化风险+建议 |
| 财务 finance | 财务 / 会计 / 出纳 | 金额汇总、日期、发票状态、逾期天数 | 金额精确带单位,异常项优先 |
| 商务 contract-admin | 商务 / 合同管理 / 合同专员 / 法务 / 合规 | 合同状态、审批节点、到期日 | 合同全生命周期 |
| 销售 sales(兜底) | 销售 / BD / 专员 / 顾问 / 业务员 / 运营 | 负责人、跟进时间、阶段、下一步 | 操作建议,具体到"联系谁+做什么+先后" |
| admin | id=admin 或 roles 含 admin | 默认按经理视角 | — |

**匹配优先级**:高管控(总经理/VP)优先于管理岗(经理/总监),避免误匹配。

**position 为空时的 fallback**(实测 demo 账号 position 经常为空):
1. 看 `roles[].name`:含"管理员"/"admin" → `sales-manager`(经理视角);含"财务" → `finance`;含"商务" → `contract-admin`
2. roles 也无法判断 → 默认 `sales`(销售视角,最保守,防权限扩散)

> 已验证:whoami 返回 `position`(可能为空字符串)、`roles`(数组,含 `name`)、`departmentName`。不同部署的岗位命名可能不同,可用 `ROLE_MAP` 覆盖。

---

## ROLE_MAP(可选覆盖)

通过环境变量自定义岗位→角色映射,优先于内置规则:

```bash
# 格式:岗位关键词|岗位关键词...=角色ID,多组逗号分隔
# 角色 ID 对应上表的角色名(长关键词优先匹配)
export ROLE_MAP="总经理|VP=executive,总监|经理=sales-manager,区域经理=territory-manager,财务|会计=finance"
```

**规则**:
- 长关键词优先匹配(如同时配了"经理"和"区域经理",先匹长的)
- 未设置 `ROLE_MAP` 时用 §角色推断 的内置规则
- 映射到不存在角色名时降级为 `sales`(兜底)

**不做成必选**——内置规则已覆盖主流岗位,ROLE_MAP 只在岗位命名特殊时用。

---

## 数据范围切换(显式触发)

> ⚠️ **安全边界**:角色推断**不自动切查询范围**。要看团队/全公司数据,用户必须显式要求。

| 用户想要 | 参数 | 命令示例 |
|---------|------|---------|
| 看自己 | `searchType: SELF`(stats) 或 `viewId: SELF`(page) | `rxcordys stats home-lead --payload '{"searchType":"SELF"}'` |
| 看部门 | `searchType: DEPARTMENT` + `deptIds[]` | 先 `rxcordys util org` 拿 deptId,再 `stats home-lead --payload '{"searchType":"DEPARTMENT","deptIds":["D1"]}'` |
| 看全公司 | `searchType: ALL` | `rxcordys stats home-lead --payload '{"searchType":"ALL"}'` |

**两套参数的区别**:
- `page`/`list`/`search` 系列用 **`viewId`**:`ALL`(默认)/ `SELF` / `CUSTOMER_COLLABORATION`(协作客户)
- `stats home-*` / `stats stat` 用 **`searchType`**:`ALL` / `SELF` / `DEPARTMENT`,且载荷必须用 `--payload` flag 传(不是位置参数)

> 默认 `viewId: ALL`(constants.ts:64),即 page 命令默认看全公司可见数据。stats 默认看全部。要让默认行为变"看自己",需显式传 SELF。

**admin 账号例外**:id=admin 或含 admin 角色,可自由切换范围(管理员视角)。

---

## 输出适配

按角色调整展示侧重(从展示字段表延伸):

### 销售
- **默认范围**:自己(SELF),查自己的线索/客户/商机/合同
- **输出**:操作建议优先,具体到"联系谁 + 做什么 + 先后顺序"
- **摘要型列表优先**,辅以关键状态 emoji
- **主动提醒**:跟进超时、线索积压、商机停滞(见 risk.md §销售预警)

### 经理
- **默认范围**:自己(需看团队时用户显式说)
- **输出**:管理决策,结构化风险 + 建议,宏观→微观(全貌>个人>记录)
- **团队视角时**:成员排名、覆盖率、目标进度
- **主动提醒**:团队跟进率、转化偏低、目标进度(见 risk.md §经理预警)

### 财务
- **默认范围**:自己(需看全公司/部门时用户显式说)
- **输出**:金额精确带单位(¥/万),异常项优先排列,正常项折叠
- **主动提醒**:回款逾期、未开票、回款到期(见 risk.md §财务预警)

### 商务
- **默认范围**:自己
- **输出**:合同全生命周期,审批节点 + 到期日
- **主动提醒**:审批超时、合同到期、缺附件(见 risk.md §商务预警)

### 高管
- **默认范围**:自己(需看全公司时用户显式说)
- **输出**:全公司快照,趋势 > 明细,目标达成率 + 环比
- **主动提醒**:季度目标进度、签约环比、大额逾期(见 risk.md §高管预警)

---

## 工作流时间表(晨会/周会/月会)

各角色每天/每周/每月该看什么。用户说"今天做什么""这周怎么样""本月复盘"时,按对应角色的流程执行(命令已绑 rxcordys,字段经实测)。

### 销售

| 频率 | 触发语 | 执行 |
|------|--------|------|
| 晨会 | "今天做什么" | ① `follows plan lead` 今日未完成计划 → ② `leads page` SELF 按 `followTime` 升序(最久未跟在前,`EMPTY` 的最先) |
| 周会 | "这周怎么样" | ① `stats home-lead --payload '{"searchType":"SELF"}'`(本周线索) → ② `stats home-opportunity --payload '{"searchType":"SELF"}'`(本周商机数+金额) → ③ 本周签约合同额 |
| 月会 | "本月做了多少" | ① `stats stat contract --payload '{"searchType":"SELF"}'`(签约额) → ② `stats stat payment-record --payload '{"searchType":"SELF"}'`(回款额) → ③ 下月预测(进行中商机金额 × 赢单率) |

### 经理

| 频率 | 触发语 | 执行 |
|------|--------|------|
| 晨会 | "团队今天" | ① `util org` 拿部门树 → ② `util members --payload '{"departmentId":"<id>"}'` 成员数 → ③ `stats home-lead --payload '{"searchType":"DEPARTMENT","deptIds":["<id>"]}'`(部门线索) |
| 周会 | "团队这周" | ① 本周 L2C 漏斗(`stats home-*` DEPARTMENT) → ② 成员排名(线索量/签约量/签约金额) → ③ 周环比 |
| 月会 | "本月复盘" | ① 本月漏斗(线索→客户→商机→合同→回款) → ② 团队成员月度排名 → ③ 赢单/输单分析(商机按 stage 分组) |
| 预测 | "下月预测" | ① `stats home-opportunity --payload '{"searchType":"DEPARTMENT","deptIds":["<id>"]}' --type underway`(进行中商机金额) → ② 按阶段分组 × 历史转化率 |

> 经理流程的 `deptIds` 需用 `util org` 拿到的部门 ID;若要含子部门,需递归展开 org 树的 children。

### 财务

| 频率 | 触发语 | 执行 |
|------|--------|------|
| 日报 | "今天回款" | ① `contracts payment-record-page`(今日回款) → ② 今日到期回款计划 → ③ 逾期回款汇总 |
| 周报 | "欠款情况" | ① `contracts payment-plan-page` 全部计划 → ② 筛未回款/部分回款 → ③ 按到期日排序,逾期优先 |
| 周报 | "开票情况" | ① `accounts sub invoice-stat <id>` 各客户开票概览 → ② 筛已签约未开票 → ③ 汇总开票缺口 |
| 月报 | "本月财报" | ① 本月签约额(`stats stat contract`) → ② 本月回款额 → ③ 本月开票额 → ④ 环比 |

### 商务

| 频率 | 触发语 | 执行 |
|------|--------|------|
| 日常 | "合同审批追踪" | ① `approvals todo count`(看 total) → ② `approvals todo pending --payload '{"pageSize":20}'` 列表 → ③ 标超 3 天未处理 |
| 周报 | "今天签了什么" | ① `contracts page`(按 createTime 近期) → ② 看签约状态 |
| 周报 | "合同到期/续约" | ① `contracts page` 筛 `endTime` 近 30 天 → ② 标未续约 |

> 模糊指令的完整映射见 intent.md。本表是按角色组织的"时间表"视角,两者互补。

---

## 权限边界

| 角色 | 能做 | 不能做 |
|------|------|--------|
| 销售 | 查自己名下线索/客户/商机/合同/协作客户 | 查其他销售数据、审批合同(除非指定审批人)、查全公司财务 |
| 经理 | 查本部门数据、团队统计、转化分析 | 查全公司漏斗(需高管权限) |
| 财务 | 查合同/回款/发票数据 | 修改业务记录(除非有写权限) |
| admin | 全部 | — |

> 这是**展示层**的软约束——实际数据权限由 Cordys 后端 Key 控制。CLI 不会越权,但展示时按角色挑字段,避免给销售推全公司财务视图。
