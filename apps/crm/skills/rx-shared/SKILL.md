---
name: rx-shared
version: 1.0.0
description: "rxcli 通用前置:注册、登录、认证、错误处理。使用任何其它 rxcli skill 前必读。"
metadata:
  requires:
    bins: ["rxcli"]
  category: shared
---

# rxcli 共享规则

本技能指导你如何通过 rxcli 访问公司应用资源,以及注意事项。

## 首次使用:注册

每台机器首次使用 rxcli 前,必须注册一次本机客户端(获取独立的 clientId/clientSecret)。

注册需要**注册令牌**(从管理员后台获取)。注册是一次性的,之后无需重复。

```bash
# 用注册令牌注册(交互式,提示输入令牌)
rxcli auth register

# 或直接传令牌
rxcli auth register --token <注册令牌>
```

注册成功后,凭据写入 `~/.rxcli/config.json`,之后所有命令自动使用。

## 认证

### 认证任务速查

| 用户意图 | 命令 |
|---|---|
| 登录(浏览器输公司账号) | `rxcli auth login` |
| 查看当前登录态 | `rxcli auth status` |
| 退出登录 | `rxcli auth logout` |

### 登录流程(设备授权)—— Agent 必须用 Split-Flow

`rxcli auth login` 走 OAuth 设备授权流程。默认命令是**阻塞轮询**的(在终端里人类直接用没问题),但**作为 AI agent,你绝不能直接运行 `rxcli auth login`** —— 它会阻塞数分钟等待用户在浏览器完成登录,期间 stdout 被缓冲,你拿不到中间打印的验证 URL,表现为"卡住很久没输出"。

**agent 必须用 Split-Flow**,把"发起授权"和"完成轮询"拆成两轮对话:

#### Split-Flow 完整步骤

**第一步:发起授权(当前轮)**

1. 执行 `rxcli auth login --no-wait --json`(必须加 `--no-wait --json`)
   - 它会**立即返回**单行 JSON 信封后退出,不阻塞:
     ```json
     {"ok":true,"data":{"device_code":"...","user_code":"XXXX-XXXX","verification_url":"https://...?user_code=XXXX-XXXX","verification_uri_complete":"...","verification_uri":"...","expires_in":300,"interval":5}}
     ```
2. 从 JSON 的 `data` 中提取 `verification_url` 和 `device_code`(**记住 device_code,第二步要用**)
3. 生成二维码(推荐,方便手机扫码):`rxcli qrcode <verification_url> --output /tmp/rxcli-login-qr.png`
4. **把 URL 和二维码一起展示给用户**(先 URL 文本,后二维码图片)
5. **结束本轮对话前,必须明确告知用户**:"请在浏览器打开上面的链接完成授权。授权完成后回来告诉我,我会帮你完成后续步骤。"

**第二步:完成授权(后续轮)**

1. 等待用户回复"已完成授权" / "好了" / "done" 等
2. **由你(agent)亲自执行**:`rxcli auth login --device-code <第一步拿到的 device_code>`
   - 此命令会轮询授权状态并完成登录(成功后自动把 token 存入 `~/.rxcli/credentials/crm.json`)
3. stderr 输出 `✓ 登录成功:<name> (<open_id>)`、stdout 返回 `{"ok":true,"data":{"loggedIn":true,...}}` 即流程结束

#### 关键规则(务必遵守)

- **你必须亲自执行 `--device-code` 命令**,不要指示用户自己去终端执行
- **不要在同一轮里展示 URL 后立刻执行 `--device-code`** —— agent harness 不透传中间输出,这会导致用户根本看不到 URL
- **禁止缓存 `verification_url` 或 `device_code`**:每次需要重新登录时,必须重新跑 `--no-wait --json` 发起新链接。device_code 一般几分钟就过期,复用过期的会失败

#### URL 输出规则(opaque string)

验证 URL 由 CLI 运行时动态产出(来自当前配置的中间层地址),视为不可修改的 opaque string:
- 不要做任何修改(包括 URL 编码/解码、添加空格或标点、重新拼接 query)
- 不要在 skill 文档里写死地址 —— 地址取决于 `RXCLI_AUTH_BASE_URL` / `RXCLI_API_BASE_URL` 环境变量或注册时配置的中间层

### 后端地址(baseUrl)

地址分两个独立配置(OAuth/auth 中间层 与 业务 API 网关):

```bash
RXCLI_AUTH_BASE_URL=http://your-auth-proxy rxcli auth login
RXCLI_API_BASE_URL=http://your-gateway rxcli orders list
```

### token 过期与刷新

- access token 过期后,CLI 调接口时会自动用 refresh token 续期(无需重新登录)
- refresh token 也过期(7天)后,需要重新 `auth login`

### 权限(scope)

业务命令需要对应的 scope,由登录用户的账号决定(公司应用签发)。缺权限会收到 `403 insufficient_scope`。

| 命令 | 所需 scope |
|------|-----------|
| `orders list` / `orders get` | `orders:read` |
| `products list` / `products get` | `products:read` |
| `invoices list` | `invoices:read` |
| `account admin-users` | `admin` |
| `account profile` | (登录即可,无 scope 要求) |


遇到 403 时:不是 bug,是该账号没有对应权限。可用 `rxcli account admin-users`(需 admin)查看某用户的 scopes。

## 错误处理

### 常见错误

| 错误 | 原因 | 处理 |
|------|------|------|
| `invalid_client` / `device_authorization failed` | client 未注册或已被删除 | `rxcli auth register --token <新令牌>` |
| `session not found; please re-login` | 登录态失效(被踢下线或过期) | `rxcli auth login` 重新登录 |
| `未登录。请先运行 rxcli auth login` | 本地无 token | `rxcli auth login` |
| `too_many_requests` | 触发限流 | 等待后重试(Retry-After 头指示秒数) |

### 登录态失效的处理

如果用户被管理员"踢下线",或长时间未使用导致 token 过期:
- `orders list` 等命令会返回 `session not found`
- 此时 `auth login` 仍可重新登录(同一个 client 凭据仍有效)
- 只有 client 被"删除"时,才需要重新 `register`
