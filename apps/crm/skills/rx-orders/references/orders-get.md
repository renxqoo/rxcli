# orders get 深度参考

## 参数

| 参数   | 类型   | 说明                          |
| ------ | ------ | ----------------------------- |
| `<id>` | string | 订单 id(位置参数),如 `o_1001` |

## 数据流

```
rxcli orders get o_1001
  → CLI 带 JWT 调中间层 GET /proxy/api/orders/o_1001
  → 中间层验 JWT → 查 session 拿 company_token → 调公司应用 GET /api/orders/o_1001
  → 公司应用校验:该订单是否属于当前 user?是→返回详情,否→404
  → 中间层透传给 CLI → CLI 美化 JSON 输出
```

## 边界情况

- **查别人的订单 → 404**:公司应用按 userId 过滤,不属于当前用户的订单一律返回 404 `not_found`,不返回 403,避免泄露"该订单存在但属于别人"。
- **不存在的订单 → 404**:同上,返回 404 `not_found`。
- **行项目 items**:订单详情比列表多 `items`(行项目)和 `shippingAddress` 字段;列表只有汇总。
- **401 自动续期**:中间层 JWT 过期,CLI 自动用 refresh_token 续期一次,重试请求。
- **权限不足**:`orders:read` scope 缺失返回 403 `forbidden`(bob / dave / erin 账号)。
