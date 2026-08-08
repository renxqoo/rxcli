---
name: rx-invoices
version: 1.0.0
description: "查询发票。当用户需要查发票、看发票列表、查开票记录时使用。"
metadata:
  requires:
    bins: ["rxcli"]
  cliHelp: "rxcli invoices list --help"
  category: business
---

# invoices (v1)

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md),其中包含注册、登录、认证说明**

## 命令

| 操作 | 命令 |
|------|------|
| 查询发票列表 | `rxcli invoices list` |

## 何时用

| 用户说 | 用什么 |
|--------|--------|
| "查发票" / "发票列表" / "开票记录" / "我的发票" | `invoices list` |

## 前置条件

- 已登录:`rxcli auth status`,未登录 → `rxcli auth login`
- 需要 `invoices:read` scope(测试账号 alice / dave 有,其它无)

## invoices list

查询当前用户的发票列表(经中间层 gateway 调公司应用)。只返回**当前登录用户**的发票(跨用户隔离)。

```bash
rxcli invoices list
```

### 输出示例

```json
{"ok":true,"data":{"invoices":[{"id":"inv_2001","orderId":"o_1001","userId":"u_alice","amount":199.0,"currency":"CNY","status":"paid","issuedAt":"2024-02-10T03:20:00Z"}]}}
```

发票状态:`issued`(已开具)/ `paid`(已支付)/ `void`(已作废)。

### 错误处理

| 错误 | 处理 |
|------|------|
| `insufficient_scope` / 403 | 当前用户无 `invoices:read` 权限 |
| `session not found` | 登录态失效,`auth login` 重新登录 |
| 网络错误 | 检查中间层地址(`auth status` 里的中间层) |

## 深度参考

- 数据流和边界?读 [`references/invoices.md`](references/invoices.md)
  (用 `rxcli skills read rx-invoices/references/invoices.md`)
