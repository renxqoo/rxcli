# 写入操作规范

> SKILL.md「写入操作」节讲了确认机制(--yes/exit 10)。本文件讲写入的完整规范:两阶段写入、字段推断、批量约束、转化映射。所有写入命令统一用 `--dry-run` 预览、`--yes` 执行。

---

## 核心原则:两阶段写入(先取表单,再写)

**创建/更新前必须先获取表单定义**,不要盲写:

```bash
rxcordys <ns> form          # 先看必填字段 + 字段类型 + 合法枚举值
rxcordys <ns> add '<json>' --dry-run   # 校验参数,不提交
rxcordys <ns> add '<json>' --yes      # 确认后执行
```

为什么要先取表单:
1. 了解必填字段(不同部署/不同模块配置可能不同)
2. 了解字段类型(数字/日期/枚举),避免类型错误
3. 了解枚举合法值(如 stage 的可选值),避免传非法值

> SKILL.md 已记的坑:`get` 不存在的 ID 返回 `data:null`(exit 0),不是报错。写入后验证结果时,用 `page` 而非 `get` 确认。

---

## 写入流程

```
用户意图(创建/更新/转化)
  ├─ 1. 识别模块 + 操作类型
  ├─ 2. 未加载表单 → rxcordys <ns> form 取表单定义
  ├─ 3. 分析用户输入 → 提取字段值映射到表单字段
  ├─ 4. 校验输入(必填/类型/枚举)→ 失败则提示修正
  ├─ 5. --dry-run 预览 → 用户确认
  ├─ 6. --yes 执行写入
  ├─ 7. 验证结果(page 查刚创建/更新的记录)
  └─ 8. 输出(创建摘要 / 更新变更对比,见 output.md)
```

---

## 各模块必填字段

| 模块 | 命令 | 必填字段 |
|------|------|---------|
| 线索 | `leads add` | `name`, `products`(产品 ID 数组) |
| 客户 | `accounts add` | `name` |
| 商机 | `opportunities add` | `name`, `customerId`, `contactId`, `owner`, `products` |
| 联系人 | `contacts add` | `customerId`, `name` |
| 跟进计划 | `follows plan-add <parent>` | 父资源 ID + `type`, `content`, `method`, `owner` |
| 跟进记录 | `follows record-add <parent>` | 父资源 ID + `type`, `content`, `followMethod`, `owner` |
| 合同 | `contracts add` | 以 `contracts form` 的 `required:true` 为准 |
| 回款计划 | `contracts payment-plan-add` | 以 `payment-plan-form` 为准 |
| 回款记录 | `contracts payment-record-add` | 以 `payment-record-form` 为准 |
| 发票 | `invoices add` | 以 `invoices form` 为准 |
| 工商抬头 | `contracts business-title-add` | 以 `business-title-form` 为准 |
| 报价单 | `opportunities quotation-add` | `name`, `opportunityId`, `untilTime`, `products`, `moduleFields`, `moduleFormConfigDTO` |
| 订单 | `orders add` | 以 `orders form` 为准 |

> 除必填字段外,`moduleFields` 数组可传任意自定义字段:`[{fieldId, fieldValue}, ...]`。
> **必填字段可能因部署配置不同而变**,始终以 `form` 命令返回的实时定义为准,本表是基准。

---

## 字段智能推断

用户通常不会给全字段,AI 需推断:

| 用户输入 | 推断策略 |
|---------|---------|
| 仅给名称 | 用最小必填字段,其余留空 |
| 自然语言描述 | 提取实体名/数字/日期,映射到字段 |
| 部分字段 | 补默认值(如有),必填缺失的**主动询问** |
| 批量数据 | 逐条校验,展示预览,确认后逐条执行 |

> 不要替用户瞎填。必填字段缺失时,主动问用户,不要用默认值硬塞。

---

## 更新操作的陷阱

### 陷阱 1:商机更新必须传全部必填字段

商机(`opportunities update`)不是 PATCH 语义,是**全量更新**——必须传 `name`/`contactId`/`owner`/`products` 全部必填字段,不能只传修改的字段:

```bash
# ❌ 错:只传修改的字段
rxcordys opportunities update '{"id":"xxx","amount":200000}' --yes

# ✅ 对:传全部必填字段 + 修改字段
rxcordys opportunities update '{"id":"xxx","name":"项目","customerId":"c1","contactId":"ct1","owner":"u1","products":["p1"],"amount":200000}' --yes
```

合同及二级表单(回款计划/记录、发票等)同理:更新前先 `get` 取当前值,合并修改字段后整体提交。

### 陷阱 2:报价单更新是完整对象更新

报价单更新前必须先 `opportunities quotation-get <id>` 取详情,保留创建必填字段,额外加 `id` + `approvalStatus`,整体提交。不得按 PATCH 只传修改字段。

### 陷阱 3:跟进计划/记录更新带父模块

跟进计划/记录的路径带父模块(parent ∈ lead/account/opportunity),更新 JSON 需含 `id`、父资源 ID + 完整必填字段:

```bash
rxcordys follows plan-update lead '{"id":"xxx","clueId":"<leadId>","type":"CLUE","content":"跟进","method":"m1","owner":"u1"}' --yes
```

---

## 批量操作约束

### 批量更新

```bash
# 按字段批量更新(仅 6 模块支持)
rxcordys leads batch-update '{"ids":["id1","id2"],"fieldId":"owner","fieldValue":"u456"}' --yes
```

**仅支持**:`leads`/`accounts`/`opportunities`/`contacts`/`contracts`/`orders`。其它模块(跟进/回款/发票/工商抬头)不支持批量,**不得用循环 update 绕过**。

### 批量创建

Cordys **不提供批量创建(batch-add)**端点。需要批量创建时,逐条 `add`:
1. 展示全部待创建记录的预览表格
2. 标注可能的问题字段(缺必填/类型错)
3. 用户确认后逐条执行

---

## fieldId 陷阱(batch-update)

`batch-update` 的 `fieldId`:
- ✅ 用表单定义中的实际字段 ID(形如 `"<fieldId>"`,**部署相关,从 `form` 命令取真实值,勿照抄任何示例数字**)
- ✅ 用系统字段的内部 key(如 `"owner"`)
- ❌ **不能用系统字段的 businessKey**(如 `name`、`phone`)

如果 API 返回 "Field does not exist",从 `form` 定义里找正确的字段 ID。

---

## 线索转化

### 线索转客户(transition)

```bash
# 最小:clueId + name
rxcordys leads transition '{"clueId":"xxx","name":"华星科技"}' --yes

# 带模块字段
rxcordys leads transition '{"clueId":"xxx","name":"华星科技","owner":"u1","moduleFields":[{"fieldId":"industry","fieldValue":"科技"}]}' --yes
```

### 线索转客户+商机(transform)

```bash
# 转客户 + 创建商机
rxcordys leads transform '{"clueId":"xxx","oppCreated":true,"oppName":"华星采购项目"}' --yes

# 只转客户
rxcordys leads transform '{"clueId":"xxx","oppCreated":false}' --yes
```

### 默认字段映射(线索 → 客户)

| 线索字段 | 客户字段 | 说明 |
|---------|---------|------|
| `name` | `name` | 公司/客户名称 |
| `phone` | `phone` | 电话 |
| `industry` | `industry` | 行业 |
| `province`/`city` | `province`/`city` | 地区 |
| `remark` | `remark` | 备注 |

---

## 写入安全约束

### 必须做

| 约束 | 说明 |
|------|------|
| 先取表单 | 创建/更新前 `form` 取定义,不盲写 |
| 校验输入 | 必填/类型/枚举校验,失败提示修正 |
| 预览确认 | `--dry-run` 或展示预览,用户确认后 `--yes` |
| 变更对比 | 更新后输出旧值→新值(见 output.md) |
| 验证结果 | 写入后 `page` 确认数据落库 |

### 禁止做

| 禁止 | 说明 |
|------|------|
| ❌ 删除操作 | 不提供、不执行任何删除 API(SKILL.md 安全边界) |
| ❌ 跳过校验 | 不得绕过表单定义校验 |
| ❌ 批量不预览 | 批量操作必须预览确认 |
| ❌ 改系统字段 | 不改 `id`/`createTime`/`createUser` 等 |
| ❌ 覆盖式全量更新 | 不执行"先删后建"等同删除操作 |
