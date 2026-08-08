---
name: rx-products
version: 1.1.0
description: "查询商品目录。当用户需要查商品、看商品列表、按分类筛商品、查某个商品详情(价格/库存)、有什么商品时使用。"
metadata:
  requires:
    bins: ["rxcli"]
  cliHelp: "rxcli products --help"
  category: business
---

# products (v1.1)

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../rx-shared/SKILL.md`](../rx-shared/SKILL.md),其中包含输出信封约定、登录、scope、错误处理说明**

## 命令

| 操作         | 命令                                      |
| ------------ | ----------------------------------------- |
| 查询商品列表 | `rxcli products list [--category <分类>]` |
| 查询商品详情 | `rxcli products get <id>`                 |

## 何时用

| 用户说                                         | 用什么                              |
| ---------------------------------------------- | ----------------------------------- |
| "有什么商品" / "商品列表" / "目录"             | `products list`                     |
| "电脑外设有哪些" / "按分类看商品"              | `products list --category 电脑外设` |
| "p_002 是什么" / "这个商品多少钱" / "还有货吗" | `products get p_002`                |

## 前置条件

- 已登录:`rxcli auth status`,未登录 → 引导 `rxcli auth login`(agent 用 Split-Flow,见 rx-shared)
- 需要 `products:read` scope(缺权限返回 403 `forbidden`)

## products list

查询商品目录(经中间层 gateway 调公司应用)。商品目录是**全局共享**的(不像订单按用户隔离),所有有权限的用户看到同一份。

```bash
rxcli products list                          # 全部商品
rxcli products list --category 电脑外设       # 按分类过滤(精确匹配)
```

### 输出示例

stdout(信封):

```json
{
  "ok": true,
  "identity": "user",
  "data": {
    "products": [
      {
        "id": "p_002",
        "sku": "SKU-KEY-K1",
        "name": "机械键盘 K1",
        "category": "电脑外设",
        "price": 599.0,
        "currency": "CNY",
        "stock": 48
      }
    ],
    "total": 2
  }
}
```

### 分类参考

`--category` 是**全等精确匹配**(非模糊搜索),分类名要完全一致(含中文)。当前目录分类(仅示例,实际以 `products list` 返回为准):`厨房用品`、`电脑外设`、`文具`、`配件`。缺货商品(`stock:0`)仍会出现,仅表示无库存。

## products get

查询单个商品详情。

```bash
rxcli products get p_002
```

### 输出示例

```json
{
  "ok": true,
  "identity": "user",
  "data": {
    "id": "p_002",
    "sku": "SKU-KEY-K1",
    "name": "机械键盘 K1",
    "category": "电脑外设",
    "price": 599.0,
    "currency": "CNY",
    "stock": 48
  }
}
```

### 错误处理

| subtype                          | code | 处理                                            |
| -------------------------------- | ---- | ----------------------------------------------- |
| `not_found`                      | 404  | 商品 id 不存在                                  |
| `forbidden`                      | 403  | 当前用户无 `products:read` 权限                 |
| `token_expired`                  | 401  | 登录态失效,`auth login` 重新登录                |
| `timeout` / `connection_refused` | 4    | 网络/中间层错误,检查 `auth status` 的中间层地址 |

> 信封/错误格式见 rx-shared「输出与信封约定」与「错误处理」。

## 深度参考

- 完整参数、数据流和边界?读 [`references/products.md`](references/products.md)
  (用 `rxcli skills read rx-products/references/products.md`)
