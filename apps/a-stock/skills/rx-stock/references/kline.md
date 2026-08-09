# kline —— K线 / 分时 / 分笔 / 技术指标

四个子命令:`get`(K线)、`minute`(当日分时)、`tick`(当日分笔)、`indicator`(技术指标)。

## `kline get <code>` —— K线

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string(positional) | 是 | — | 股票/指数代码 |
| `--period` | string | 否 | `day` | 周期(见下表) |
| `--adjust` | string | 否 | `none` | 复权(见下表) |
| `--limit` | number | 否 | `320` | 返回根数(腾讯上限 ~800,东财 ~1000,建议 ≤500) |
| `--start` | string | 否 | — | 起始日期 `YYYY-MM-DD` 或 `YYYYMMDD` |
| `--end` | string | 否 | — | 结束日期 |

### `--period` 周期

| 值 | 含义 | 数据源 |
| --- | --- | --- |
| `day` | 日 K | 腾讯 → 新浪 → 同花顺 → 东财 |
| `week` | 周 K | 腾讯 → 新浪 → 同花顺 → 东财 |
| `month` | 月 K | 腾讯 → 新浪 → 东财 |
| `m1` / `m5` / `m15` / `m30` / `m60` | 分钟级 | 新浪 → 东财(腾讯不支持分钟级) |

**合法值只有:`m1 m5 m15 m30 m60 day week month`**(共 8 个)。传其他值(如 `year`)会抛 `ValidationError`。

### `--adjust` 复权

| 值 | 含义 | 支持 |
| --- | --- | --- |
| `none` | 不复权(默认) | 全源 |
| `qfq` | 前复权(推荐回测) | 仅腾讯 / 东财 |
| `hfq` | 后复权 | 仅腾讯 / 东财 |

分钟级 K线不支持复权(新浪不复权,东财分钟级复权依赖源)。

### 返回字段(每根 K线)

| 字段 | 说明 |
| --- | --- |
| `date` | 日期(日/周/月:`YYYY-MM-DD`;分钟级:时间) |
| `open` / `close` / `high` / `low` | 开/收/高/低 |
| `volume` | 成交量(手) |
| `amount` | 成交额(元;东财/同花顺有,新浪/腾讯部分周期为 `null`) |
| `changePercent` | 涨跌幅(%;源缺时本地按 close 环比补算,首根为 0) |
| `change` | 涨跌额(元;同上) |
| `turnoverRate` | 换手率(%;仅东财,其余 `null`) |

## `kline minute <code>` —— 当日分时

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | string(positional) | 是 | 股票/指数代码 |

每分钟一个点,字段:`time` / `price` / `volume`(该分钟量,手) / `avgPrice`(累计均价)。主源腾讯,失败抛错(不静默返空)。TTL 30 秒。

## `kline tick <code>` —— 当日分笔

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string(positional) | 是 | — | 股票/指数代码 |
| `--limit` | number | 否 | `100` | 返回条数(上限 ~5000) |

每笔成交明细,字段:`time` / `price` / `volume`(股) / `direction`(`buy`/`sell`/`auction`) / `amount`。**仅东财 push2 提供,境外网络报错**。

## `kline indicator <code>` —— 技术指标

基于历史日K**本地计算**的常用技术指标,适合判断趋势/超买超卖。

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string(positional) | 是 | — | 股票代码 |
| `--types` | string | 否 | `ma,macd,rsi,kdj,boll,atr` | 指标类型,逗号分隔 |
| `--limit` | number | 否 | `120` | 基于的历史日K根数(越大越准越慢) |

### `--types` 取值与输出字段

| 类型 | 输出字段(`values`) | 含义 |
| --- | --- | --- |
| `ma` | `ma5` `ma10` `ma20` `ma60` | 均线(多头排列=上升趋势) |
| `macd` | `macd` `signal` `histogram` | MACD;macd 上穿 signal=金叉 |
| `rsi` | `rsi6` `rsi12` `rsi24` | RSI;>70 超买,<30 超卖 |
| `kdj` | `k` `d` `j` | KDJ;`j`>90 超买,<10 超卖 |
| `boll` | `upper` `mid` `lower` | 布林带;触上轨偏强/超买,触下轨偏弱/超卖 |
| `atr` | `atr` | 平均真实波幅(衡量波动) |

返回每个类型一个对象:`{type, date, price, values}`,`date`/`price` 为最新一根 K线。

## 示例

```bash
rxstock kline get 600519 --period day --limit 30
rxstock kline get 600519 --period week --adjust qfq
rxstock kline get 600519 --start 2026-01-01 --end 2026-06-30
rxstock kline minute 600519
rxstock kline tick 600519 --limit 50
rxstock kline indicator 600519 --types macd,rsi,kdj
```
