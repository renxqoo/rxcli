## 实时行情字段说明

`rxstock quote get <code>` 返回的标准化字段:

| 字段                 | 类型                 | 说明                                  |
| -------------------- | -------------------- | ------------------------------------- |
| `code`               | string               | 6 位代码                              |
| `name`               | string               | 中文名称                              |
| `market`             | `'sh'`/`'sz'`/`'bj'` | 市场                                  |
| `price`              | number               | 当前价                                |
| `prevClose`          | number               | 昨收                                  |
| `open`               | number               | 今开                                  |
| `high`               | number               | 最高                                  |
| `low`                | number               | 最低                                  |
| `change`             | number               | 涨跌额                                |
| `changePercent`      | number               | 涨跌幅(%)                             |
| `volume`             | number               | 成交量(手)                            |
| `amount`             | number               | 成交额(元)                            |
| `turnoverRate`       | number               | 换手率(%)                             |
| `volumeRatio`        | number               | 量比                                  |
| `amplitude`          | number               | 振幅(%)                               |
| `peRatio`            | number/null          | 动态市盈率                            |
| `pbRatio`            | number/null          | 市净率                                |
| `circulateMarketCap` | number               | 流通市值(元)                          |
| `totalMarketCap`     | number               | 总市值(元)                            |
| `limitUp`            | number               | 涨停价                                |
| `limitDown`          | number               | 跌停价                                |
| `time`               | string               | 数据时间戳                            |
| `bids`               | array                | 买一到买五                            |
| `asks`               | array                | 卖一到卖五                            |
| `source`             | string               | 实际数据源:tencent / eastmoney / sina |

注意:东财数据源返回的字段比腾讯少(`bids`/`asks` 为空),腾讯是最完整的。
