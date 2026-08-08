---
name: rx-products
version: 1.0.0
description: "查询商品目录。当用户需要查商品、看商品列表、按分类筛商品、查某个商品详情(价格/库存)时使用。"
metadata:
  requires:
    bins: ["rxcli"]
  cliHelp: "rxcli products --help"
  category: business
---

# products (v1)

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md),其中包含注册、登录、认证说明**

## 命令

| 操作 | 命令 |
|------|------|
| 查询商品列表 | `rxcli products list [--category <分类>]` |
| 查询商品详情 | `rxcli products get <id>` |

## 何时用

| 用户说 | 用什么 |
|--------|--------|
| "有什么商品" / "商品列表" / "目录" | `products list` |
| "电脑外设有哪些" / "按分类看商品" | `products list --category 电脑外设` |
| "p_002 是什么" / "这个商品多少钱" / "还有货吗" | `products get p_002` |

## 前置条件

- 已登录:`rxcli auth status`,未登录 → `rxcli auth login`
- 需要 `products:read` scope(测试账号 alice / carol 有,bob / dave / erin 无)

## products list

查询商品目录(经中间层 gateway 调公司应用)。商品目录是**全局共享**的(不像订单按用户隔离),所有有权限的用户看到同一份。

```bash
rxcli products list                          # 全部商品
rxcli products list --category 电脑外设       # 按分类过滤
```

### 输出示例

```json
{"ok":true,"data":{"products":[{"id":"p_002","sku":"SKU-KEY-K1","name":"机械键盘 K1","category":"电脑外设","price":599.0,"currency":"CNY","stock":48}],"total":2}}
```

### 分类参考

当前目录的分类(仅供示例,实际以 `products list` 返回为准):`厨房用品`、`电脑外设`、`文具`、`配件`。

## products get

查询单个商品详情。

```bash
rxcli products get p_002
```

### 输出示例

```json
{"ok":true,"data":{"id":"p_002","sku":"SKU-KEY-K1","name":"机械键盘 K1","category":"电脑外设","price":599.0,"currency":"CNY","stock":48}}
```

### 错误处理

| 错误 | 处理 |
|------|------|
| `product_not_found` / 404 | 商品 id 不存在 |
| `insufficient_scope` / 403 | 当前用户无 `products:read` 权限 |
| `session not found` | 登录态失效,`auth login` 重新登录 |

## 深度参考

- 完整参数、数据流和边界?读 [`references/products.md`](references/products.md)
  (用 `rxcli skills read rx-products/references/products.md`)
