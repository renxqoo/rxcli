# orders list 深度参考

## 参数

| 参数       | 类型   | 说明                                                      |
| ---------- | ------ | --------------------------------------------------------- |
| `--limit`  | number | 本页返回数量上限(传给公司应用的 query 参数,服务端最大 100) |
| `--cursor` | string | 续拉游标,取上次响应的 `meta.pagination.nextToken`          |

## 数据流

```
rxcli orders list --limit 5
  → CLI 带 JWT 调中间层 GET /proxy/api/orders?limit=5
  → 中间层验 JWT → 查 session 拿 company_token → 调公司应用 GET /api/orders?limit=5
  → 公司应用返回订单数据 → 中间层透传给 CLI
  → CLI 美化 JSON 输出
```

续拉下一页：

```bash
rxcli orders list --limit 5 --cursor <上次 meta.pagination.nextToken>
```

CLI 会把服务端的 `hasMore` / `nextCursor` 转换成统一的 `meta.pagination.complete` / `nextToken`。`complete:false` 时继续拉取，`complete:true` 时停止。

## 边界情况

- **无订单**:返回 `{ "orders": [] }`,不是错误
- **游标不存在**:服务端从当前用户的第一条订单重新开始；调用方应原样使用上次返回的 `nextToken`,不要自行构造
- **数据隔离**:只返回当前登录用户自己的订单(按 userId 过滤),绝不返回他人订单
- **token 自动刷新**:company_token 过期时,中间层自动刷新(对 CLI 透明),CLI 无感
- **401 自动续期**:中间层 JWT 过期,CLI 自动用 refresh_token 续期一次,重试请求
- **权限不足**:公司应用返回 403 `forbidden`,中间层原样透传(如 bob 账号无 orders:read scope)

## 限流

gateway 按 session 限流(默认每分钟 300 次)。触发限流返回 429,`Retry-After` 头指示等待秒数。
