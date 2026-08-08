# invoices 深度参考

## 参数

`invoices list` 无参数(当前只支持列表查询)。

## 数据流

```
rxcli invoices list
  → CLI 带 JWT 调中间层 GET /proxy/api/invoices
  → 中间层验 JWT → 查 session 拿 company_token → 调公司应用 GET /api/invoices
  → 公司应用按 userId 过滤 → 中间层透传 → CLI 美化输出
```

## 边界情况

- **数据隔离**:只返回当前登录用户自己的发票(按 userId 过滤),绝不返回他人发票。
- **无发票**:返回 `{ "invoices": [] }`,不是错误。
- **发票与订单关联**:每张发票有 `orderId` 字段,可用 `rxcli orders get <orderId>` 查对应订单详情(需 `orders:read` scope)。
- **token 自动刷新**:company_token 过期时中间层自动刷新(对 CLI 透明)。
- **401 自动续期**:中间层 JWT 过期,CLI 自动用 refresh_token 续期一次,重试请求。
- **权限不足**:`invoices:read` 缺失返回 403。

## 限流

gateway 按 session 限流(默认每分钟 300 次)。触发限流返回 429,`Retry-After` 头指示等待秒数。
