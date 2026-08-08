# products 深度参考

## 参数

| 命令                | 参数                | 说明                                             |
| ------------------- | ------------------- | ------------------------------------------------ |
| `products list`     | `--category <name>` | 按分类精确匹配过滤(如 `电脑外设`);不传则返回全部 |
| `products get <id>` | `<id>`              | 商品 id 位置参数(如 `p_002`)                     |

## 数据流

```
rxcli products list --category 电脑外设
  → CLI 带 JWT 调中间层 GET /proxy/api/products?category=电脑外设
  → 中间层验 JWT → 查 session 拿 company_token → 调公司应用 GET /api/products?category=...
  → 公司应用按 category 过滤 → 中间层透传 → CLI 美化输出
```

## 边界情况

- **缺货商品**:`stock: 0` 的商品仍出现在列表里(如 `p_005`),不是错误,仅表示无库存。
- **分类精确匹配**:`--category` 是全等匹配,不是模糊搜索;分类名要完全一致(含中文)。
- **商品目录全局共享**:与订单(按用户隔离)不同,所有有 `products:read` 的用户看到同一份目录。
- **token 自动刷新**:company_token 过期时中间层自动刷新(对 CLI 透明)。
- **401 自动续期**:中间层 JWT 过期,CLI 自动用 refresh_token 续期一次,重试请求。
- **权限不足**:`products:read` 缺失返回 403 `forbidden`。

## 限流

gateway 按 session 限流(默认每分钟 300 次)。触发限流返回 429,`Retry-After` 头指示等待秒数。
