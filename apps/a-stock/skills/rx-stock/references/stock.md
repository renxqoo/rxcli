# stock —— 搜索 / 列表 / 公司信息 / 估值 / 综合诊断

五个子命令:`search`、`list`、`info`、`valuation`、`diagnosis`。顶层快捷 `rxstock search <kw>` 等价 `stock search`。

## `stock search <keyword>` —— 搜索

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `keyword` | string(positional) | 是 | — | 代码(`600519`) / 中文名(`茅台`) / 拼音首字母(`gzmt`) |
| `--limit` | number | 否 | `20` | 返回条数 |

单源(东财 searchapi)。返回:

| 字段 | 说明 |
| --- | --- |
| `code` | 代码 |
| `name` | 名称 |
| `pinyin` | 拼音 |
| `market` | `sh`/`sz`/`bj` |
| `classify` | 分类 |
| `quoteId` | 东财 secid 形态(如 `1.600519`) |

`meta.total` 为命中总数。提示:用 `stock info <code>` 或 `quote get <code>` 查详情。

## `stock list` —— 股票列表

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--market` | string | `all` | 市场:`sh` \| `sz` \| `bj` \| `all` |
| `--sort` | string | `changePercent` | 排序字段(见下表) |
| `--desc` | boolean | `true` | 是否降序 |
| `--page` | number | `1` | 页码 |
| `--size` | number | `100` | 单页条数(上限 1000) |

`--sort` 取值:`changePercent`(涨幅) | `change`(涨跌额) | `amount`(成交额) | `volume`(成交量) | `code` | `name`。其他值抛 `ValidationError`。

源链:新浪(境外可用)→ 东财 push2(境内,字段更全)。返回每项(StockListItem):

| 字段 | 说明 |
| --- | --- |
| `code` / `name` | 代码 / 名称 |
| `price` / `changePercent` / `change` | 当前价 / 涨跌幅% / 涨跌额 |
| `open` / `high` / `low` / `prevClose` | 今开/高/低/昨收 |
| `volume` / `amount` | 成交量(手) / 成交额(元) |
| `amplitude` / `turnoverRate` | 振幅% / 换手率%(东财有,新浪无 amplitude) |
| `peRatio` / `pbRatio` | 市盈率 / 市净率 |
| `circulateMarketCap` / `totalMarketCap` | 流通市值 / 总市值(元) |
| `speedRate` | 涨速(仅东财) |
| `change5Min` / `change60Day` / `changeYTD` | 5分钟/60日/年初至今涨跌幅(仅东财) |

`meta`:`total`(东财源为全市场总数;**新浪回退源境外返回 `-1`,不可用作总数**)、`page`、`size`、`pagination.complete`(当前页是否已取完)、`pagination.nextToken`(下一页码,**仅当还有更多页时出现**,无更多页时该字段省略)。翻页靠 `complete`/`nextToken` 判断而非 `total`(境外 `total=-1` 时 `complete` 不可靠,需按 `items.length < size` 自行判断)。

## `stock info <code>` —— 公司基本信息

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | string(positional) | 是 | 股票代码 |

单源(东财 F10 财报主接口)。**稳定返回的字段只有 4 个**(实测):

| 字段 | 说明 |
| --- | --- |
| `code` / `name` | 代码 / 名称 |
| `totalShares` | 总股本(股) |
| `circulateShares` | 流通股本(股) |

> ⚠️ 类型上 `industry`/`listDate`/`controller`/`totalMarketCap`/`circulateMarketCap`/`bps`/`registeredCapital` 也存在,但当前数据源接口**实际不填充**(恒为 `null`)。需要行业/市值/市盈率等请用 `quote get`(行情)或 `stock diagnosis`(综合诊断)。

找不到抛 `NotFoundError`。

## `stock valuation <code>` —— 估值分位

判断当前价格相对历史"贵不贵"。基于历史日K收盘价 + 最新 EPS/BPS 算 PE/PB 代理值的百分位。

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string(positional) | 是 | — | 股票代码 |
| `--days` | number | 否 | `250` | 历史回溯天数(约一年) |

返回(ValuationResult):

| 字段 | 说明 |
| --- | --- |
| `code` / `price` | 代码 / 最新价 |
| `eps` / `bps` | 最新每股收益 / 每股净资产 |
| `peProxy` / `pbProxy` | 当前 PE/PB 代理值 |
| `pePercentile` / `pbPercentile` | PE/PB 在过去 N 日的百分位(0-100) |
| `days` | 实际参与计算的历史天数 |

`meta.hint`:>80 偏贵(高估),<20 偏便宜(低估),50 为中位。注:基于价/EPS 代理,反映估值随价变动趋势;历史不足 30 日或无 EPS/BPS 时返回 `NotFoundError`。

## `stock diagnosis <code>` —— 个股综合诊断

一次性聚合基本面 + 技术面 + 股东 + 估值,适合深度分析(避免反复调多个命令)。任一维度失败不影响其他维度(对应字段 `undefined`)。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | string(positional) | 是 | 股票代码 |

返回(StockDiagnosis),三个维度:

**`fundamental`(基本面)**: `name` `industry` `price` `peRatio` `pbRatio` `totalMarketCap` `circulateMarketCap`,含嵌套 `latestFinance`(`reportDate` `eps` `roe` `revenueYoY` `profitYoY` `grossMargin` `debtRatio`)和 `valuation`(`pePercentile` `pbPercentile`)。

**`technical`(技术面)**: `date` `price` `ma5` `ma20` `ma60` `macd` `rsi12` `kdjJ` `bollMid` `bollUpper` `bollLower`(最新一日)。

**`holders`(股东/筹码)**: `holderCount` `holderCountChange`(较上期变化%) `topHolderRatio`(十大股东合计持股比例%)。

`meta.dimensions`: `["fundamental","technical","holders"]`。

## 示例

```bash
rxstock stock search 茅台
rxstock stock list --market sh --sort amount --page 2 --size 50
rxstock stock info 600519
rxstock stock valuation 600519 --days 500
rxstock stock diagnosis 600519
```
