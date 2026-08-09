# sector —— 板块 / 行业

三个子命令:`list`(板块列表)、`stocks`(板块成分股)、`quote`(板块实时行情)。

> ⚠️ 源码注释(`commands/sector.ts` 文件头)提到过一个 `sector top` 子命令(涨跌幅 TOP 板块),但**未在 `defineCommands` 中实现**——当前不存在该命令,请勿使用。

板块代码为 `BK` 前缀 + 数字(如 `BK1600`)。

> ⚠️ **境内外代码差异**:`sector list` 在境内命中东财时返回 `BK` 代码;**境外回落新浪时返回新浪节点 ID**(如 `new_blhy`),不是 `BK` 代码。`sector stocks` / `sector quote` **只支持东财 `BK` 代码**(单源东财),境外拿到新浪 ID 后无法用于这两个命令——需境内网络才能用成分股/板块行情。

## `sector list` —— 板块列表

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--kind` | string | `industry` | 板块类型:`industry`(行业) \| `concept`(概念) \| `area`(地域) |
| `--page` | number | `1` | 页码 |
| `--size` | number | `100` | 单页条数 |

`--kind` 传其他值抛 `ValidationError`。

源链:东财 push2(境内,带完整行情,主源)→ 新浪节点树(境外,仅板块清单,行情字段为 `NaN`)。返回每项(SectorListItem):

| 字段 | 说明 |
| --- | --- |
| `code` / `name` | 板块代码(BK前缀) / 名称 |
| `price` / `changePercent` / `change` | 板块指数价 / 涨跌幅% / 涨跌额(东财有,新浪为 NaN) |
| `amount` / `volume` | 成交额 / 成交量(东财有,新浪为 0) |
| `industry` | 分类标记(新浪回退时为 kind 值) |

`meta` 含 `total`(板块总数)、`kind`。

## `sector stocks <code>` —— 板块成分股

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string(positional) | 是 | — | 板块代码(如 `BK1600`) |
| `--page` | number | 否 | `1` | 页码 |
| `--size` | number | 否 | `100` | 单页条数 |

返回成分股列表,字段同 `stock list` 的 StockListItem(见 `references/stock.md`)。`meta` 含 `total`(成分股总数)、`sector`。

## `sector quote <code>` —— 板块实时行情

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | string(positional) | 是 | 板块代码(如 `BK1600`) |

从行业板块清单中查找指定代码,返回该板块的 SectorListItem(同 `list` 单项)。找不到抛 `NotFoundError`。

注:板块代码(`BK` 前缀)腾讯不直接支持,均走东财。

## 示例

```bash
rxstock sector list                          # 行业板块
rxstock sector list --kind concept           # 概念板块
rxstock sector stocks BK1600                 # 板块成分股
rxstock sector quote BK1600                  # 板块行情
```
