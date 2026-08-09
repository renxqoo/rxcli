# 分页与筛选(深度)

> SKILL.md 已说明 `[payload]` 的两种形态(关键词字符串 / JSON)和续拉方式。本文件讲 `combineSearch.conditions` 的字段操作符和统计载荷。
>
> ⚠️ **操作符必须用完整大写词**(`EQUALS`/`CONTAINS`/`EMPTY`),SQL 简写(`EQ`/`LIKE`)会被后端拒绝(实测)。`type` 字段推荐填(更规范),非必填。

## combineSearch.conditions(高级筛选)

每个 condition:`{ name, operator, value, type?, multipleValue? }`

> `type` 字段非必填(实测无 type 也能成功),但 DYNAMICS 场景推荐配 `TIME_RANGE_PICKER`,`IN` 场景推荐配对应枚举类型,后端解析更稳。

### 操作符总表(实测确认)

| 操作符 | 含义 | value 示例 | 备注 |
|--------|------|-----------|------|
| `EQUALS` | 精确等于 | `"张三"` | ❌ 不要写 `EQ` |
| `NOT_EQUALS` | 不等于 | `"已作废"` | ❌ 不要写 `NE` |
| `CONTAINS` | 包含(模糊) | `"%科技%"` | ❌ 不要写 `LIKE` |
| `NOT_CONTAINS` | 不包含 | `"测试"` | |
| `GT` / `LT` / `GE` / `LE` | 大于/小于/≥/≤ | `1000` | ❌ 不要写 `GTE`/`LTE` |
| `IN` | 在集合中(多选) | `["A","B"]` | 配合 `multipleValue:false` |
| `NOT_IN` | 不在集合中 | `["A"]` | |
| `BETWEEN` | 区间 | `[<earlier_ms>, <later_ms>]` | 时间戳毫秒 |
| `EMPTY` | **为空** | `""` | 判空(如从未跟进的 followTime) |
| `NOT_EMPTY` | 不为空 | `""` | |
| `DYNAMICS` | 动态时间 | `"WEEK"`(本周)/ `"MONTH"` / `"QUARTER"` / `"YEAR"` | 推荐配 `type:TIME_RANGE_PICKER` |
| `DYNAMICS`(N天前) | 相对时间 | `["CUSTOM", n, "BEFORE_DAY"]` | 如过去 90 天 |
| `COUNT_GT` / `COUNT_LT` | 多值数量大于/小于 | `2` | 用于多值字段 |

### 动态时间常量表

| 常量 | 含义 | | 常量 | 含义 |
|------|------|-|------|------|
| `TODAY` | 今天 | | `YESTERDAY` | 昨天 |
| `WEEK` | 本周 | | `LAST_WEEK` | 上周 |
| `MONTH` | 本月 | | `LAST_MONTH` | 上个月 |
| `QUARTER` | 本季度 | | `LAST_QUARTER` | 上季度 |
| `YEAR` | 本年度 | | `LAST_YEAR` | 上年度 |
| `LAST_SEVEN` | 过去7天 | | `LAST_THIRTY` | 过去30天 |

## 字段类型 → 支持的操作符(后端核心规则)

构造 conditions 前应查目标字段类型,再按此表选合法操作符。字段类型可用 `rxcordys util raw GET /settings/fields?module=<module>` 查。

| 字段类型 | 中文名 | 支持的操作符 |
|----------|--------|-------------|
| `INPUT` | 单行输入 | `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `EMPTY`, `NOT_EMPTY` |
| `TEXTAREA` | 多行输入 | `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `EMPTY`, `NOT_EMPTY` |
| `PHONE` / `LINK` / `SERIAL_NUMBER` | 电话/链接/流水号 | `EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `EMPTY`, `NOT_EMPTY` |
| `INPUT_NUMBER` | 数字 | `EQUALS`, `NOT_EQUALS`, `GT`, `LT`, `GE`, `LE` |
| `DATE_TIME` | 日期时间 | `BETWEEN`, `GT`, `LT`, `EMPTY`, `NOT_EMPTY`, `DYNAMICS`(配 `TIME_RANGE_PICKER`) |
| `ATTACHMENT` | 附件 | `CONTAINS`, `NOT_CONTAINS`, `EMPTY`, `NOT_EMPTY` |
| `INPUT_MULTIPLE` | 多值输入 | `COUNT_LT`, `COUNT_GT`, `CONTAINS`, `NOT_CONTAINS`, `EMPTY`, `NOT_EMPTY` |
| `RADIO` / `SELECT` / `CHECKBOX` | 单选/多选 | `IN`, `NOT_IN`, `EMPTY`, `NOT_EMPTY` |
| `MEMBER` / `DEPARTMENT` / `DATA_SOURCE` | 成员/部门/数据源 | `IN`, `NOT_IN`, `EMPTY`, `NOT_EMPTY` |
| `LOCATION` | 地址 | `IN`, `NOT_IN`, `EMPTY`, `NOT_EMPTY` |

> `DIVIDER`(分割线)/ `PICTURE`(图片)/ `FORMULA`(公式)/ `INDUSTRY`(行业)/子表类**无操作符**,不可作为查询条件。

### 操作符归属速查

| 归属组 | 可用操作符 |
|--------|-----------|
| 文本类 | EQUALS, NOT_EQUALS, CONTAINS, NOT_CONTAINS, EMPTY, NOT_EMPTY |
| 数字类 | EQUALS, NOT_EQUALS, GT, LT, GE, LE |
| 日期类 | BETWEEN, GT, LT, EMPTY, NOT_EMPTY, DYNAMICS |
| 枚举/选择类 | IN, NOT_IN, EMPTY, NOT_EMPTY |

## 示例

查本周新增、金额≥1万的商机:

```bash
rxcordys opportunities page '{
  "combineSearch": {
    "searchMode": "AND",
    "conditions": [
      {"name":"createTime","operator":"DYNAMICS","value":"WEEK","type":"TIME_RANGE_PICKER"},
      {"name":"amount","operator":"GE","value":10000,"type":"INPUT_NUMBER"}
    ]
  }
}'
```

查从未跟进的线索(判空,配合 risk.md 销售预警):

```bash
rxcordys leads page '{
  "combineSearch": {
    "conditions": [
      {"name":"followTime","operator":"EMPTY","value":"","type":"DATE_TIME"}
    ]
  }
}'
```

按部门筛(经理看团队):

```bash
rxcordys leads page '{
  "combineSearch": {
    "conditions": [
      {"name":"departmentId","operator":"IN","value":["D1"],"multipleValue":false,"type":"TREE_SELECT"}
    ]
  }
}'
```

> 字段类型 → 操作符的完整映射可查 `rxcordys util raw GET /settings/fields?module=<module>`。

## 统计命令的载荷

`stats stat` / `stats home-*` 用 HomeStatisticBaseSearchRequest,**载荷必须用 `--payload` flag 传**(不是位置参数):

```json
{
  "searchType": "ALL",
  "deptIds": [],
  "timeField": "CREATE_TIME",
  "userField": "CREATE_USER",
  "priorPeriodEnable": true
}
```

| 字段 | 可选值 |
|------|--------|
| `searchType` | `ALL` / `SELF` / `DEPARTMENT`(`deptIds` 指定部门) |
| `timeField` | `CREATE_TIME` / `EXPECTED_END_TIME` / `ACTUAL_END_TIME` |
| `userField` | `CREATE_USER` / `OWNER` |
| `priorPeriodEnable` | `true` 计算环比 |
