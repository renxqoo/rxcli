---
name: rx-auth
version: 1.1.0
description: "rxcli 登录与身份管理:注册客户端、登录、查看状态、登出。当用户需要注册、登录、切换身份、查登录状态、退出登录时使用。"
metadata:
  requires:
    bins: ["rxcli"]
  cliHelp: "rxcli auth --help"
  category: auth
---

# auth (v1.1)

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md),其中包含输出统一格式约定、注册/登录顺序、Split-Flow 登录、环境变量、错误处理说明**

## 命令

| 操作                             | 命令                                       |
| -------------------------------- | ------------------------------------------ |
| 注册本机客户端(首次,拿 clientId) | `rxcli auth register [--token <注册令牌>]` |
| 登录(浏览器输公司账号)           | `rxcli auth login`                         |
| 查看登录状态                     | `rxcli auth status`                        |
| 退出登录                         | `rxcli auth logout`                        |

## 何时用

| 用户说                             | 用什么                                             |
| ---------------------------------- | -------------------------------------------------- |
| "注册" / "register" / "首次配置"   | `auth register --token <令牌>`(需注册令牌)         |
| "登录" / "我要登录" / "连接"       | `auth login`(agent 必须用 Split-Flow,见 rx-shared) |
| "我登录了吗" / "当前是谁" / "状态" | `auth status`                                      |
| "退出" / "登出" / "注销"           | `auth logout`                                      |

## 前置条件

- **首次使用必须先 register**:跳过 register 直接 login 会得到 `device_authorization failed`(401)。
- register 需要注册令牌(从管理员后台获取)。

## 登录流程 —— Agent 必须用 Split-Flow

`auth login` 走 OAuth 2.0 设备授权流程。默认是**阻塞轮询**的(人类在终端直接用没问题),但**agent 绝不能直接运行裸 `rxcli auth login`** —— 它会阻塞数分钟,期间 stdout 被缓冲,你拿不到验证 URL。

agent 必须用 Split-Flow(`--no-wait --json` 发起 → 展示 URL+二维码 → 用户授权后 `--device-code` 完成)。**完整步骤、规则、二维码生成见 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md) 的「登录流程(设备授权)」与「输出与统一输出格式约定」章节。** 此处不重复。

要点速查:

```bash
# 第一步:发起(立即返回 JSON,不阻塞)
rxcli auth login --no-wait --json
# → data 含 device_code、user_code、verification_url

# 第二步:用户授权完成后,agent 亲自执行
rxcli auth login --device-code <第一步的 device_code>
```

## auth register

注册本机客户端,换取独立 clientId/clientSecret(写入 `~/.rxcli/config/crm.json`)。

```bash
rxcli auth register                          # 交互式(仅 TTY,提示输入令牌)
rxcli auth register --token <注册令牌>        # 直接传令牌(agent / 非 TTY 用)
```

stdout:`{"ok":true,"data":{"registered":true,"clientId":"cli_..."}}`

> 注册是一次性的。之后除非 client 被删除,否则不需要重复注册。

## auth status

stdout 返回 JSON(无 `identity` 字段,因为此命令不解析业务身份):

- **已登录**:`{"ok":true,"data":{"loggedIn":true,"user":{"id":"<open_id>","name":"<name>"},"expired":false}}`
- **未登录**:`{"ok":true,"data":{"loggedIn":false}}`

人类可读提示(stderr):

```
已登录:Alice (u_alice)
中间层:http://120.26.219.32
token 有效
```

或 token 已过期:`token 已过期(下次调用会自动刷新)`。未登录:`未登录。运行 \`auth login\` 登录。`。

> 若 user_info 调用失败(登录态已失效),抛 `authentication` / `token_expired`,hint 指示重新 `auth login`。

## auth logout

退出会调用中间层 `/revoke` 吊销当前 session(不只是清本地)。退出后:

- 本地 token 清除(`~/.rxcli/credentials/crm.json` 删除)
- 该 session 在服务端也失效
- 重新 `auth login` 即可再次登录(无需重新 register)

stdout:`{"ok":true,"data":{"loggedOut":true}}`

### 错误处理

| subtype                                           | 处理                               |
| ------------------------------------------------- | ---------------------------------- |
| `invalid_argument` / `missing_required`(register) | 非 TTY 未传 `--token`,或令牌为空   |
| `token_expired`(status)                           | 登录态已失效,`auth login` 重新登录 |
| 其它错误见 rx-shared「错误处理」表                |
