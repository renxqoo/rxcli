# 分页与筛选(深度)

> SKILL.md 已说明 `[payload]` 的两种形态(关键词字符串 / JSON)和续拉方式。本文件讲 `combineSearch.conditions` 的字段操作符和统计载荷。

## combineSearch.conditions(高级筛选)

每个 condition:`{ name, operator, value, type, multipleValue? }`

常用操作符:

| operator | 用途 | value 示例 |
|----------|------|-----------|
| `EQ` | 等于 | `"张三"` |
| `NE` | 不等于 | `"已作废"` |
| `LIKE` | 模糊 | `"%科技%"` |
| `IN` | 多值 | `["A","B"]`(配合 `multipleValue:true`) |
| `BETWEEN` | 区间 | `[<earlier_ms>, <later_ms>]`(时间戳毫秒) |
| `GT` / `GTE` / `LT` / `LTE` | 比较 | `1000` |
| `DYNAMICS` | 动态时间 | `"WEEK"`(本周)/ `"MONTH"` / `"QUARTER"` / `"YEAR"` |
| `DYNAMICS`(N天前) | 相对时间 | `["CUSTOM", n, "BEFORE_DAY"]` |

示例:查本周新增、金额≥1万的商机:

```bash
rxcordys opportunities page '{
  "combineSearch": {
    "searchMode": "AND",
    "conditions": [
      {"name":"createTime","operator":"DYNAMICS","value":"WEEK"},
      {"name":"amount","operator":"GTE","value":10000}
    ]
  }
}'
```

> 字段类型 → 操作符的完整映射可查 `rxcordys util raw GET /settings/fields?module=<module>`。

## 统计命令的载荷

`stats stat` / `stats home-*` 用 HomeStatisticBaseSearchRequest:

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
