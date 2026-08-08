# quote —— 实时行情

`rxstock quote`(等价 `quote get`)查询实时行情,含五档盘口。多源 fallback:腾讯 → 新浪 → 同花顺 → 东财 push2。

## 命令

### `quote get <code>` —— 单只实时行情

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | string(positional) | 是 | 股票/指数代码(见 SKILL.md 代码格式表) |
| `--source` | string | 否 | 指定单源,**不再 fallback**:`tencent` \| `sina` \| `eastmoney` |

不传 `--source` 时按源链自动 fallback。找不到数据抛 `NotFoundError`。

### `quote batch <codes>` —— 批量行情

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `codes` | string(positional) | 是 | 逗号分隔代码,如 `600519,000001,300750`,最多 100 只 |

返回数组,顺序与输入一致;找不到的元素为 `null`。`meta.count` 为成功数,`meta.total` 为输入数。批量按源逐个补缺:腾讯批量 → 新浪批量 → 东财逐个(境内增强)。

## 返回字段(get)

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | string | 6 位代码 |
| `name` | string | 中文名称 |
| `market` | `'sh'`/`'sz'`/`'bj'` | 市场 |
| `price` | number | 当前价 |
| `prevClose` | number | 昨收 |
| `open` | number | 今开 |
| `high` / `low` | number | 最高 / 最低 |
| `change` | number | 涨跌额 |
| `changePercent` | number | 涨跌幅(%) |
| `volume` | number | 成交量(手) |
| `amount` | number | 成交额(元) |
| `turnoverRate` | number | 换手率(%) |
| `volumeRatio` | number | 量比 |
| `amplitude` | number | 振幅(%) |
| `peRatio` | number/null | 动态市盈率 |
| `pbRatio` | number/null | 市净率 |
| `circulateMarketCap` | number | 流通市值(元) |
| `totalMarketCap` | number | 总市值(元) |
| `limitUp` / `limitDown` | number | 涨停价 / 跌停价 |
| `time` | string | 数据时间戳 |
| `bids` | array | 买一到买五 `{price, volume}`(单位手) |
| `asks` | array | 卖一到卖五 `{price, volume}`(单位手) |
| `source` | string | 实际数据源:`tencent`/`eastmoney`/`sina`/`10jqka` |

## 数据源差异

| 源 | 五档盘口 | PE/PB/市值 | 换手/振幅/量比 |
| --- | --- | --- | --- |
| 腾讯(tencent) | ✅ 完整 | ✅ | ✅ |
| 东财(eastmoney) | ❌ 空 | ✅ | ✅ |
| 新浪(sina) | ❌ 空 | ❌(无 PE/PB/市值) | 部分 |
| 同花顺(10jqka) | ❌ 空 | ❌ | ❌(仅价格量) |

腾讯字段最全;**境外建议默认走腾讯**(不指定 source)。需要五档盘口必须命中腾讯(`--source tencent` 或自动 fallback 到腾讯)。

## 示例

```bash
rxstock quote 600519                          # 自动 fallback
rxstock quote get 600519 --source tencent     # 强制腾讯(拿五档)
rxstock quote batch 600519,000001,300750      # 批量
```

返回(JSON 信封内 `data`):

```json
{
  "code": "600519",
  "name": "贵州茅台",
  "price": 1689.00,
  "change": 12.50,
  "changePercent": 0.74,
  "volume": 21000,
  "amount": 3546900000,
  "peRatio": 28.5,
  "pbRatio": 9.2,
  "totalMarketCap": 2120000000000,
  "bids": [{ "price": 1688.99, "volume": 5 }, "..."],
  "asks": [{ "price": 1689.01, "volume": 3 }, "..."],
  "source": "tencent"
}
```
