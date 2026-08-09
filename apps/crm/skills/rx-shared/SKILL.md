---
name: rx-shared
version: 1.1.0
description: "rxcli 通用前置:注册、登录、认证、输出约定、错误处理。使用任何其它 rxcli skill 前,或遇到登录/注册/凭证/权限/错误问题时必读。"
metadata:
  requires:
    bins: ["rxcli"]
  category: shared
---

# rxcli 共享规则

本技能指导你如何通过 rxcli 访问公司应用资源,以及通用约定。所有业务 skill(orders / products / invoices / account)启动时 MUST 先读本文件。

## 本地状态目录

所有本地状态集中在 `~/.rxcli/`(0600 权限):

```
~/.rxcli/
├── config.json              # 客户端凭据(clientId / clientSecret),register 写入
└── credentials/
    └── crm.json             # OAuth token(refreshToken / scopes / user),login 写入
```

## 输出与统一输出格式约定

每个命令的 **stdout 永远是单行紧凑 JSON 统一输出**(便于 agent/管道解析);人类可读提示打到 **stderr**(`ctx.log.info`)。

- **成功**(stdout):

  ```json
  {"ok":true,"identity":"user","data":{...}}
  ```

  `identity` 仅在已解析出身份时出现(用户态命令为 `"user"`)。`data` 是命令的原始返回,字段名原样透传(不转大小写)。

- **失败**(stderr,exit code 非零):
  ```json
  {
    "ok": false,
    "error": {
      "type": "api",
      "subtype": "not_found",
      "message": "订单 o_xxx 不存在",
      "code": 404,
      "retryable": false
    }
  }
  ```
  常见 `type`:`validation` / `authentication` / `authorization` / `config` / `network` / `api` / `internal`。

### `--json` 行为

默认 `auto`:stdout 是 TTY → 人类文本;非 TTY(管道) → JSON。`--json` 强制 JSON,`--no-json` 强制人类文本(**但非 TTY 下会被覆盖为 JSON**,保护 agent)。agent 场景可不加 flag(管道自动 JSON),也可显式 `--json`。

## 首次使用:注册(register)

每台机器首次使用 rxcli 前,必须注册一次本机客户端(获取独立 clientId/clientSecret)。注册需要**注册令牌**(从管理员后台获取)。注册是一次性的,之后无需重复。

```bash
# 交互式(提示输入令牌,仅 TTY)
rxcli auth register

# 或直接传令牌(agent / 非 TTY 用)
rxcli auth register --token <注册令牌>
```

注册成功 → 凭据写入 `~/.rxcli/config.json`,stdout 返回 `{"ok":true,"data":{"registered":true,"clientId":"cli_..."}}`。

> **顺序很重要**:register(拿 clientId) → login(拿 token) → 业务命令。跳过 register 直接 login 会得到 `device_authorization failed`(401 invalid_client)。

## 认证

### 认证任务速查

| 用户意图               | 命令                                   |
| ---------------------- | -------------------------------------- |
| 注册本机客户端(首次)   | `rxcli auth register [--token <令牌>]` |
| 登录(浏览器输公司账号) | `rxcli auth login`                     |
| 查看当前登录态         | `rxcli auth status`                    |
| 退出登录               | `rxcli auth logout`                    |

### 登录流程(设备授权)—— Agent 必须用 Split-Flow

`rxcli auth login` 走 OAuth 2.0 设备授权流程。默认命令是**阻塞轮询**的(人类在终端直接用没问题),但**作为 AI agent,绝不能直接运行裸 `rxcli auth login`** —— 它会阻塞数分钟等待用户在浏览器完成登录,期间 stdout 被缓冲,你拿不到验证 URL,表现为"卡住很久没输出"。

**agent 必须用 Split-Flow**,把"发起授权"和"完成轮询"拆成两轮对话:

#### 第一步:发起授权(当前轮)

1. 执行 `rxcli auth login --no-wait --json`(必须加 `--no-wait --json`)
   - 它会**立即返回**单行 JSON 统一输出后退出,不阻塞:
     ```json
     {
       "ok": true,
       "data": {
         "device_code": "...",
         "user_code": "XXXX-XXXX",
         "verification_url": "https://...?user_code=XXXX-XXXX",
         "verification_uri_complete": "...",
         "verification_uri": "...",
         "expires_in": 300,
         "interval": 5
       }
     }
     ```
     `verification_url` = `verification_uri_complete`(优先)或 `verification_uri`。
2. 从 JSON 的 `data` 中提取 `verification_url` 和 `device_code`(**记住 device_code,第二步要用**)
3. 生成二维码(方便手机扫码):`rxcli qrcode <verification_url> --output /tmp/rxcli-login-qr.png`
4. **把 URL 和二维码一起展示给用户**(先 URL 文本,后二维码图片)
5. **结束本轮对话前,必须明确告知用户**:"请在浏览器打开上面的链接完成授权。授权完成后回来告诉我,我会帮你完成后续步骤。"

#### 第二步:完成授权(后续轮)

1. 等待用户回复"已完成授权" / "好了" / "done" 等
2. **由你(agent)亲自执行**:`rxcli auth login --device-code <第一步拿到的 device_code>`
   - 此命令会轮询授权状态并完成登录(成功后自动把 token 存入 `~/.rxcli/credentials/crm.json`)
3. stderr 输出 `✓ 登录成功:<name> (<open_id>)`、stdout 返回 `{"ok":true,"identity":"user","data":{"loggedIn":true,"user":{"id":"...","name":"..."}}}` 即流程结束

#### 关键规则(务必遵守)

- **你必须亲自执行 `--device-code` 命令**,不要指示用户自己去终端执行
- **不要在同一轮里展示 URL 后立刻执行 `--device-code`** —— agent harness 不透传中间输出,这会导致用户根本看不到 URL
- **禁止缓存 `verification_url` 或 `device_code`**:每次需要重新登录时,必须重新跑 `--no-wait --json` 发起新链接。device_code 一般几分钟就过期,复用过期的会失败

#### URL 输出规则(opaque string)

验证 URL 由 CLI 运行时动态产出(来自当前配置的中间层地址),视为不可修改的 opaque string:

- 不要做任何修改(包括 URL 编码/解码、添加空格或标点、重新拼接 query)
- 不要在 skill 文档里写死地址 —— 地址取决于环境变量或注册时配置的中间层

## 后端地址(环境变量)

v2 是框架,业务包各自声明 baseUrl,**无 dev/test/prod 多环境概念**(已取消)。

| 环境变量              | 作用                                                                   | 默认值                 |
| --------------------- | ---------------------------------------------------------------------- | ---------------------- |
| `RXCLI_AUTH_BASE_URL` | OAuth/auth 中间层(device flow / token / user_info / revoke / register) | `http://120.26.219.32` |
| `RXCLI_API_BASE_URL`  | 业务 API 网关(命令经中间层 `/proxy/api/*` 访问业务接口)                | `http://120.26.219.32` |
| `RXCLI_CLIENT_ID`     | 覆盖 clientId(默认读 `~/.rxcli/config.json`)                           | —                      |
| `RXCLI_CLIENT_SECRET` | 覆盖 clientSecret(默认读 config.json)                                  | —                      |
| `RXCLI_SKILLS_SOURCE` | skills 源 URL(空 → 用包内本地 skills)                                  | —                      |

```bash
RXCLI_API_BASE_URL=http://your-gateway rxcli orders list
```

默认两个地址同址(均为中间层)。URL 在文档/输出里均为 opaque,不要写死。

## token 过期与刷新

- access token 过期后,CLI 调接口时会自动用 refresh token 续期(对调用方透明,重试一次)
- refresh token 也过期(7天)后,需要重新 `auth login`
- 自动续期失败 → `authentication` / `token_expired`,exit 3

## 权限(scope)

业务命令需要对应的 scope,由登录用户的账号决定(公司应用签发)。缺权限会收到 **403**,映射为 `forbidden`(exit 3)。

| 命令                             | 所需 scope               |
| -------------------------------- | ------------------------ |
| `orders list` / `orders get`     | `orders:read`            |
| `products list` / `products get` | `products:read`          |
| `invoices list`                  | `invoices:read`          |
| `account admin-users`            | `admin`                  |
| `account profile`                | (登录即可,无 scope 要求) |

> 遇到 403 `forbidden` 时:不是 bug,是该账号没有对应权限。可用 `rxcli account admin-users`(需 admin)查看某用户的 scopes。

## 错误处理

### 常见错误

| subtype                                 | code  | 原因                                                         | 处理                                   |
| --------------------------------------- | ----- | ------------------------------------------------------------ | -------------------------------------- |
| `forbidden`                             | 403   | 当前用户缺 scope                                             | 换有权限的账号,或让管理员授权          |
| `not_found`                             | 404   | 资源不存在,或不属于当前用户(查别人的也返回 404,不泄露存在性) | 确认 id / 权限                         |
| `token_expired`                         | 401   | 登录态失效(被踢下线或过期)                                   | `auth login` 重新登录                  |
| `no_token` / `no_credentials`           | 401/3 | 本地无 token                                                 | `auth login` 登录                      |
| `invalid_argument` / `missing_required` | 2     | 参数校验失败                                                 | 按错误 hint 修正参数                   |
| `timeout` / `connection_refused`        | 4     | 网络错误                                                     | 检查中间层地址(`auth status` 的中间层) |
| `server_error`                          | 5xx   | 上游/中间层异常                                              | 稍后重试(retryable=true)               |
| —                                       | 429   | 触发限流                                                     | 等待 `Retry-After` 头指示的秒数后重试  |

> 注:旧文档里的 `insufficient_scope` / `order_not_found` 等错误名已废弃,真实 subtype 见上表。

### 登录态失效的处理

如果用户被管理员"踢下线",或长时间未使用导致 token 过期:

- `orders list` 等命令返回 `token_expired` / `session not found`
- 此时 `auth login` 仍可重新登录(同一个 client 凭据仍有效)
- 只有 client 被"删除"或本机未注册时,才需要重新 `auth register`
