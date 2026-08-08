# index —— 指数 / 北向资金

四个子命令:`list`(常用指数清单)、`get`(单指数行情)、`kline`(指数K线)、`northbound`(北向资金)。

## `index list` —— 常用指数清单

无参数。预置 9 个主要指数,并行拉取实时行情:

| 代码 | 名称 |
| --- | --- |
| `sh000001` | 上证指数 |
| `sz399001` | 深证成指 |
| `sz399006` | 创业板指 |
| `sh000300` | 沪深 300 |
| `sh000016` | 上证 50 |
| `sh000905` | 中证 500 |
| `sh000688` | 科创 50 |
| `sz399905` | 中证 500(深) |
| `sh000852` | 中证 1000 |

返回每项:`code` `name` `price` `change` `changePercent` `open` `high` `low` `prevClose` `volume` `amount` `time`。行情取数失败的项对应数值为 `null`。

## `index get <code>` —— 单个指数实时行情

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | string(positional) | 是 | 指数代码(如 `sh000001`) |

返回结构同 `quote get`(实时行情字段表见 `references/quote.md`)。指数代码走腾讯/新浪(`sh`/`sz` 前缀)。

## `index kline <code>` —— 指数 K线

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string(positional) | 是 | — | 指数代码 |
| `--period` | string | 否 | `day` | `day` \| `week` \| `month` \| `m5` \| `m15` \| `m30` \| `m60` |
| `--limit` | number | 否 | `320` | 返回根数 |

返回 K线数组,字段同 `kline get`(见 `references/kline.md` 返回字段表)。注:指数K线不支持复权(`--adjust` 无效)。

## `index northbound` —— 北向资金

查询沪深股通成交额、持股市值、领涨股。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--type` | string | `all` | 通道:`001`(沪股通) \| `003`(深股通) \| `all`(全部) |
| `--pageSize` | number | `30` | 返回天数 |

返回每日(EastmoneyNorthboundRow):

| 字段 | 说明 |
| --- | --- |
| `mutualType` | `001`=沪股通 / `003`=深股通 / `002`=港股通 |
| `tradeDate` | 交易日期 |
| `dealAmt` | 成交额(元) |
| `netDealAmt` | 净买入额(元;东财部分返回 `null`) |
| `holdMarketCap` | 持股总市值(元) |
| `leadStockCode` / `leadStockName` | 领涨股代码 / 名称 |
| `leadStockChange` | 领涨股涨跌幅(%) |

单源东财 datacenter(境内外都通)。`meta` 含 `count`、`type`。

## 示例

```bash
rxstock index list
rxstock index get sh000001
rxstock index kline sh000300 --period week --limit 20
rxstock index northbound
rxstock index northbound --type 001 --pageSize 10
```
