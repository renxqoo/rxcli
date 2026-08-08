---
name: rx-orders
version: 1.1.0
description: "查询订单。当用户需要查订单、看订单列表、查最近订单、查某个订单详情时使用。"
metadata:
  requires:
    bins: ["rxcli"]
  cliHelp: "rxcli orders --help"
  category: business
---

# orders (v1.1)

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md),其中包含注册、登录、认证说明**

## 命令

| 操作 | 命令 |
|------|------|
| 查询订单列表 | `rxcli orders list [--limit N]` |
| 查询订单详情 | `rxcli orders get <id>` |

## 何时用

| 用户说 | 用什么 |
|--------|--------|
| "查订单" / "看看订单" / "订单列表" | `orders list` |
| "最近 5 条订单" | `orders list --limit 5` |
| "查一下 o_1001" / "这个订单详情" / "订单里有什么" | `orders get o_1001` |

## 前置条件

调用 orders 命令前,确保已登录:
- 检查:`rxcli auth status`
- 未登录 → 引导用户 `rxcli auth login`

需要 `orders:read` scope(测试账号 alice / carol 有,bob / dave / erin 无)。

## orders list

查询订单列表(经中间层 gateway 调公司应用接口)。只返回**当前登录用户**的订单(跨用户隔离)。

```bash
rxcli orders list              # 查全部
rxcli orders list --limit 10   # 限制返回数量
```

### 输出示例

```json
{"ok":true,"data":{"orders":[{"id":"o_1001","userId":"u_alice","status":"paid","total":199.0,"currency":"CNY","createdAt":"2024-02-10T03:15:00Z"}]}}
```

## orders get

查询单个订单详情(含行项目 items、收货地址)。**只能查自己的订单**:查别人的订单返回 404(不泄露存在性)。

```bash
rxcli orders get o_1001
```

### 输出示例

```json
{"ok":true,"data":{"id":"o_1001","userId":"u_alice","status":"paid","total":199.0,"currency":"CNY","createdAt":"2024-02-10T03:15:00Z","items":[{"productId":"p_001","name":"红色马克杯","quantity":3,"unitPrice":39.0},{"productId":"p_004","name":"A5 笔记本","quantity":2,"unitPrice":25.5}],"shippingAddress":"北京市朝阳区示例路 1 号"}}
```

### 错误处理

| 错误 | 处理 |
|------|------|
| `order_not_found` / 404 | 订单不存在,或不属于当前用户(查别人的也返回 404) |
| `session not found` | 登录态失效,`auth login` 重新登录 |
| `insufficient_scope` / 403 | 当前用户无 `orders:read` 权限 |
| 网络错误 | 检查中间层地址(`auth status` 里的中间层) |

## 深度参考

- 需要了解 orders list 的完整参数和边界?读 [`references/orders-list.md`](references/orders-list.md)
  (用 `rxcli skills read rx-orders/references/orders-list.md`)
- 需要 orders get 的数据流和边界?读 [`references/orders-get.md`](references/orders-get.md)
  (用 `rxcli skills read rx-orders/references/orders-get.md`)
