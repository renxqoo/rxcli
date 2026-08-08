# account 深度参考

## 参数

两个子命令均无额外参数:
- `account profile` —— 查当前用户资料
- `account admin-users` —— 管理员查全量用户

## 数据流

```
rxcli account profile
  → CLI 带 JWT 调中间层 GET /proxy/api/profile
  → 中间层验 JWT → 查 session 拿 company_token → 调公司应用 GET /api/profile
  → 公司应用按当前 token 的 userId 返回资料 → 中间层透传 → CLI 美化输出

rxcli account admin-users
  → GET /proxy/api/admin/users(需 admin scope)
```

## 边界情况

- **profile 无 scope 要求**:只要 token 有效(已登录),`profile` 就能查自己的资料;不像业务接口需要特定 scope。
- **admin-users 严格校验 admin scope**:非管理员返回 403 `forbidden`(bob / carol / dave 账号)。
- **资料不含密码**:`admin-users` 返回的 user 对象只含 id / name / scopes / profile,绝不暴露 password 字段。
- **scopes 的意义**:`scopes` 数组决定该用户能调用哪些业务接口:
  - `orders:read` → `rxcli orders list/get`
  - `products:read` → `rxcli products list/get`
  - `invoices:read` → `rxcli invoices list`
  - `admin` → `rxcli account admin-users`
- **token 自动刷新**:company_token 过期时中间层自动刷新(对 CLI 透明)。
- **401 自动续期**:中间层 JWT 过期,CLI 自动用 refresh_token 续期一次,重试请求。

## 限流

gateway 按 session 限流(默认每分钟 300 次)。触发限流返回 429,`Retry-After` 头指示等待秒数。
