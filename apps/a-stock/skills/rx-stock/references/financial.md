# financial —— 财务 / 财报三表 / 资金面

12 个子命令。除 `fundflow`(东财 push2,仅境内)外,其余 11 个均走东财 datacenter(境内外都通,单源,稳定)。

通用参数:除 `lhb` 外,所有子命令首个 positional 参数为 `<code>`(股票代码),可选 `--limit`/`--pageSize`/`--page`/`--size` 控制返回条数。返回包裹在 JSON 统一输出 `data` 数组中,`meta.count` 为实际返回数。

---

## 财务指标

### `financial main <code>` —— 主要财务指标

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `20` | 返回期数(上限 ~50) |

字段(EastmoneyFinancialRow):

| 字段 | 说明 |
| --- | --- |
| `reportDate` | 报告期 `YYYY-MM-DD` |
| `reportType` | 一季报/半年报/三季报/年报 |
| `totalRevenue` | 营业总收入(元) |
| `netProfit` | 归母净利润(元) |
| `eps` | 基本每股收益 |
| `roe` | 净资产收益率(%) |
| `revenueYoY` / `profitYoY` | 营收/净利润同比(%) |
| `grossMargin` | 销售毛利率(%) |
| `bps` | 每股净资产 |
| `debtRatio` | 资产负债率(%) |

### `financial forecast <code>` —— 业绩预告

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `20` | 返回条数 |

字段同 `main`(forecast 走同一接口 RPT_F10_FINANCE_MAINFINADATA 的预告数据)。

---

## 资金面

### `financial fundflow <code>` —— 资金流向

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `30` | 返回天数 |

字段(EastmoneyFundFlowRow):

| 字段 | 说明 |
| --- | --- |
| `date` | 日期 |
| `mainNet` | 主力净流入(元) |
| `superNet` | 超大单净流入(元) |
| `bigNet` | 大单净流入(元) |
| `mediumNet` | 中单净流入(元) |
| `smallNet` | 小单净流入(元) |
| `mainNetRatio` | 主力净流入占比(%) |

> ⚠️ **仅东财 push2 提供,境外网络会报错**(非空数据)。境内增强源,优先级独占。

### `financial lhb` —— 龙虎榜

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--date` | 最新 | 交易日期 `YYYY-MM-DD` |
| `--code` | — | 指定个股代码(查该股上榜历史) |
| `--pageSize` | `30` | 返回条数 |

不传 `code` 时按日期返回当日上榜全量;传 `code` 返回该股上榜历史。字段(EastmoneyDragonTigerRow):

| 字段 | 说明 |
| --- | --- |
| `tradeDate` | 交易日期 |
| `code` / `name` | 代码 / 名称 |
| `closePrice` / `changeRate` / `turnoverRate` | 收盘价 / 涨跌幅% / 换手率% |
| `explain` | 上榜原因 |
| `buyAmt` / `sellAmt` / `netAmt` | 龙虎榜买入/卖出/净额(元) |
| `buySeatCount` / `sellSeatCount` | 买入/卖出席位数 |

### `financial margin <code>` —— 融资融券明细

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `30` | 返回天数 |

字段(EastmoneyMarginRow):

| 字段 | 说明 |
| --- | --- |
| `date` | 日期 |
| `rzye` / `rqye` / `rzrqye` | 融资余额 / 融券余额 / 融资融券余额(元) |
| `rzmre` / `rzjme` | 融资买入额 / 融资偿还额(元) |
| `rqmcl` | 融券卖出量(股) |
| `closePrice` / `changeRate` | 收盘价 / 涨跌幅% |

---

## 财报三表

### `financial balancesheet <code>` —— 资产负债表

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `8` | 返回期数 |

字段(EastmoneyBalanceSheetRow):`reportDate` `monetaryFunds`(货币资金) `accountsReceivable`(应收账款) `inventory`(存货) `totalCurrentAssets`(流动资产合计) `totalNonCurrentAssets`(非流动资产合计) `totalAssets`(资产总计) `totalCurrentLiabilities`(流动负债) `totalNonCurrentLiabilities`(非流动负债) `totalLiabilities`(负债合计) `totalShareholdersEquity`(股东权益合计)。金额单位均为元。

### `financial income <code>` —— 利润表

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `8` | 返回期数 |

字段(EastmoneyIncomeRow):`reportDate` `totalRevenue`(营业总收入) `operatingRevenue`(营业收入) `operatingCost`(营业成本) `sellingExpense`(销售费用) `managingExpense`(管理费用) `financialExpense`(财务费用) `operatingProfit`(营业利润) `totalProfit`(利润总额) `netProfit`(净利润) `parentNetProfit`(归母净利润)。金额单位均为元。

### `financial cashflow <code>` —— 现金流量表

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `8` | 返回期数 |

字段(EastmoneyCashFlowRow):`reportDate` `operatingCashFlow`(经营活动净额) `investingCashFlow`(投资活动净额) `financingCashFlow`(筹资活动净额) `netCashIncrease`(现金净增加额) `cashBalance`(期末现金余额)。金额单位均为元。

---

## 股东与分红

### `financial dividend <code>` —— 分红送配历史

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `20` | 返回条数 |

字段(EastmoneyDividendRow):`noticeDate`(公告日) `reportDate`(报告期) `implPlan`(实施方案,如"10转1.00派6.00元") `bonusRatio`(送股/每10股) `transferRatio`(转增/每10股) `pretaxDividend`(派息税前/每10股/元) `exDividendDate`(除权除息日) `equityRecordDate`(股权登记日) `progress`(进度)。

### `financial holders <code>` —— 十大股东

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `10` | 返回条数(默认即十大股东) |

字段(EastmoneyHolderRow):`endDate`(截止日期) `holderName`(股东名称) `holdNum`(持股数/股) `holdRatio`(持股比例%) `holdChange`(持股变动/股;`不变`记为 0) `changeRatio`(变动比例%) `isOrg`(是否机构) `rank`(排名)。

### `financial holdercount <code>` —— 股东人数变化

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--limit` | `10` | 返回期数 |

字段(EastmoneyHolderCountRow):`endDate`(截止日期) `holderTotalNum`(股东总数) `totalNumRatio`(较上期变化%) `avgFreeShares`(户均流通股) `avgHoldAmt`(户均持股金额/元) `holdFocus`(筹码集中度)。股东人数减少=筹码趋向集中。

---

## 公告

### `financial announcements <code>` —— 个股公告

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `code`(positional) | — | 股票代码 |
| `--page` | `1` | 页码 |
| `--size` | `20` | 单页条数(上限 50) |

字段(EastmoneyAnnouncementItem):`artCode`(公告编号) `title`(标题) `noticeDate`(发布日期) `columns`(`[{code,name}]` 关联证券) `sourceType`(类型)。

---

## 示例

```bash
rxstock financial main 600519 --limit 8
rxstock financial forecast 600519
rxstock financial fundflow 600519 --limit 10
rxstock financial lhb --date 2026-08-07
rxstock financial lhb --code 600519
rxstock financial margin 600519
rxstock financial balancesheet 600519
rxstock financial income 600519
rxstock financial cashflow 600519
rxstock financial dividend 600519
rxstock financial holders 600519
rxstock financial holdercount 600519
rxstock financial announcements 600519 --size 10
```
