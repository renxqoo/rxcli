---
name: rx-account
version: 1.0.0
description: "账号信息:查看个人资料、管理员查全量用户。当用户需要看自己的资料(邮箱/部门),或管理员需要列出所有用户时使用。"
metadata:
  requires:
    bins: ["rxcli"]
  cliHelp: "rxcli account --help"
  category: business
---

# account (v1)

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md),其中包含注册、登录、认证说明**

## 命令

| 操作 | 命令 |
|------|------|
| 查看当前用户资料 | `rxcli account profile` |
| 管理员:查全量用户 | `rxcli account admin-users` |

## 何时用

| 用户说 | 用什么 |
|--------|--------|
| "我的资料" / "我的邮箱" / "我哪个部门" | `account profile` |
| "列出所有用户" / "有哪些账号" / "用户列表" | `account admin-users`(需 admin) |

## 前置条件

- 已登录:`rxcli auth status`,未登录 → `rxcli auth login`
- `account profile`:登录即可,无 scope 要求
- `account admin-users`:需要 `admin` scope(测试账号 alice / erin 有,其它无)

## account profile

查看当前登录用户的资料(经中间层 gateway 调公司应用)。

```bash
rxcli account profile
```

### 输出示例

```json
{"ok":true,"data":{"id":"u_alice","email":"alice@example.com","displayName":"Alice Wang","department":"Engineering","avatarUrl":"https://i.pravatar.cc/128?img=1","createdAt":"2023-01-15T08:30:00Z"}}
```

## account admin-users

**管理员功能**:列出系统中全部用户(含 id / name / scopes / 资料)。普通用户调用会收到 403。

```bash
rxcli account admin-users
```

### 输出示例(节选)

```json
{"ok":true,"data":{"users":[{"id":"u_alice","name":"alice","scopes":["orders:read","orders:write","products:read","invoices:read","admin"],"profile":{"email":"alice@example.com","department":"Engineering"}}]}}
```

> 返回的 `scopes` 可用于判断某个用户能调用哪些业务命令(如某用户缺 `orders:read`,则 `orders list` 对其返回 403)。

### 错误处理

| 错误 | 处理 |
|------|------|
| `insufficient_scope` / 403(仅 admin users) | 当前用户非管理员,无 `admin` scope |
| `profile_not_found` / 404(仅 profile) | token 有效但用户资料缺失(理论上不该发生) |
| `session not found` | 登录态失效,`auth login` 重新登录 |

## 深度参考

- 数据流和边界?读 [`references/account.md`](references/account.md)
  (用 `rxcli skills read rx-account/references/account.md`)
