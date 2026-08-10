---
name: rx-invoices
version: 1.1.0
description: "查询发票。当用户需要查发票、看发票列表、查开票记录、我的发票、发票状态时使用。"
metadata:
  requires:
    bins: ["rxcli"]
  cliHelp: "rxcli invoices list --help"
  category: business
---

# invoices (v1.1)

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md),其中包含输出统一格式约定、登录、scope、错误处理说明**

## 命令

| 操作         | 命令                  |
| ------------ | --------------------- |
| 查询发票列表 | `rxcli invoices list` |

## 何时用

| 用户说                                          | 用什么          |
| ----------------------------------------------- | --------------- |
| "查发票" / "发票列表" / "开票记录" / "我的发票" | `invoices list` |

## 前置条件

- 已登录:`rxcli auth status`,未登录 → 引导 `rxcli auth login`(agent 用 Split-Flow,见 rx-shared)
- 需要 `invoices:read` scope(缺权限返回 403 `forbidden`)

## invoices list

查询当前用户的发票列表(经中间层 gateway 调公司应用)。只返回**当前登录用户**的发票(跨用户隔离)。

```bash
rxcli invoices list
```

### 输出示例

stdout(统一输出格式):

```json
{
  "ok": true,
  "identity": "user",
  "data": {
    "invoices": [
      {
        "id": "inv_2001",
        "orderId": "o_1001",
        "userId": "u_alice",
        "amount": 168.0,
        "currency": "CNY",
        "status": "paid",
        "issuedAt": "2024-02-10T03:20:00Z"
      }
    ]
  }
}
```

发票状态:`issued`(已开具)/ `paid`(已支付)/ `void`(已作废)。无发票时 `data.invoices` 为空数组 `[]`,不是错误。

> 每张发票的 `orderId` 可用 `rxcli orders get <orderId>` 查对应订单详情(需 `orders:read` scope)。

### 错误处理

| subtype                          | code | 处理                                            |
| -------------------------------- | ---- | ----------------------------------------------- |
| `forbidden`                      | 403  | 当前用户无 `invoices:read` 权限                 |
| `token_expired`                  | 401  | 登录态失效,`auth login` 重新登录                |
| `timeout` / `connection_refused` | 4    | 网络/中间层错误,检查 `auth status` 的中间层地址 |

> 统一输出格式/错误格式见 rx-shared「输出与统一输出格式约定」与「错误处理」。

## 深度参考

- 数据流和边界?读 [`references/invoices.md`](references/invoices.md)
  (用 `rxcli skills read rx-invoices/references/invoices.md`)
