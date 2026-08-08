---
name: rx-auth
version: 1.0.0
description: "rxcli 登录与身份管理:登录、查看状态、登出。当用户需要登录、切换身份、查登录状态、退出登录时使用。"
metadata:
  requires:
    bins: ["rxcli"]
  cliHelp: "rxcli auth --help"
  category: auth
---

# auth (v1)

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md),其中包含注册、登录、认证说明**

## 命令

| 操作 | 命令 |
|------|------|
| 登录(浏览器输公司账号) | `rxcli auth login` |
| 查看登录状态 | `rxcli auth status` |
| 退出登录 | `rxcli auth logout` |

## 何时用

| 用户说 | 用什么 |
|--------|--------|
| "登录" / "我要登录" / "连接" | `auth login` |
| "我登录了吗" / "当前是谁" / "状态" | `auth status` |
| "退出" / "登出" / "注销" | `auth logout` |

## 登录流程详解 —— Agent 必须用 Split-Flow

`rxcli auth login` 走 OAuth 2.0 设备授权流程。默认命令是**阻塞轮询**的(人类在终端直接用没问题),但**作为 AI agent,绝不能直接运行 `rxcli auth login`** —— 它会阻塞数分钟等待用户登录,期间 stdout 被缓冲,你拿不到验证 URL,表现为"卡住很久没输出"。

详细规则和原理见 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md) 的"登录流程"章节。要点:

**第一步(当前轮)**:发起授权
```bash
rxcli auth login --no-wait --json    # 立即返回 JSON 信封,data 含 verification_url 和 device_code
rxcli qrcode <verification_url> --output /tmp/rxcli-login-qr.png  # 生成二维码(推荐,方便扫码)
```
→ 把 URL + 二维码展示给用户 → 告知"授权完成后告诉我" → **结束本轮**

**第二步(后续轮)**:完成登录
```bash
rxcli auth login --device-code <第一步的 device_code>   # 由 agent 亲自执行,不要让用户自己跑
```
→ stderr 输出 `✓ 登录成功:Alice (u_alice)`、stdout 返回 `{"ok":true,"data":{"loggedIn":true,...}}` 即完成

**关键规则**:
- 不要在同一轮展示 URL 后立刻执行 `--device-code`(用户看不到 URL)
- 必须亲自执行 `--device-code`,不指示用户自行执行
- 禁止缓存 device_code,过期后重新 `--no-wait --json`

### URL 不要修改

验证 URL 是 opaque string(由 CLI 输出,不是你拼接):
- 不要 URL 编码/解码、添加空格标点、重新拼接 query
- URL 由 CLI 运行时根据当前环境的中间层地址动态生成,不要在文档里写死

## auth status 输出

```
已登录:Alice (u_alice)
环境:dev
中间层:<当前环境的中间层地址>
token 有效
```

或未登录:
```
未登录。运行 `rxcli auth login` 登录。
```

## auth logout

退出会调用中间层 `/revoke` 吊销当前 session(不只是清本地)。退出后:
- 本地 token 清除
- 该 session 在服务端也失效
- 重新 `auth login` 即可再次登录
