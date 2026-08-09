# life —— 生活服务

`rx60s life` 查询天气、油价、金价、汇率、老黄历等生活数据。

## life weather —— 实时天气

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `<query>`(位置参数) | string | 否 | 北京 | 城市搜索词(如 上海/广州天河) |
| `--city` | string | 否 | — | 精确匹配城市名 |
| `--province` | string | 否 | — | 精确匹配省份名 |

返回:`{location, weather:{condition, temperature, humidity, pressure, wind_direction, wind_power, ...}, air_quality:{aqi, quality, pm25, ...} | null, sunrise:{...} | null, life_indices[], alerts[]}`。城市未找到返回 `not_found`。

## life forecast —— 天气预报

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `<query>`(位置参数) | string | 否 | 北京 | 城市搜索词 |
| `--days` | number | 否 | 7 | 预报天数(日预报上限 8,日出日落上限 15) |
| `--city` / `--province` | string | 否 | — | 精确匹配 |

返回:`{location, hourly_forecast[], daily_forecast[], sunrise_sunset[]}`。

## life fuel-price —— 今日油价

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--region` | string | 否 | 北京 | 区域名(后缀匹配,如 北京/广东) |
| `--forceUpdate` | boolean | 否 | — | 跳过缓存(缓存 60 分钟) |

返回:`{region, trend:{next_adjustment_date, direction(上调/下调/搁浅), change_ton_desc, ...} | null, items:[{name, price, price_desc}], link}`。

## life gold-price —— 贵金属金价

无参数。返回:`{date, metals:[{name, sell_price, today_price, high/low_price, unit, updated}], stores:[{brand, product, price, ...}], banks:[...], recycle:[...]}`。

## life exchange-rate —— 汇率查询

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--currency` | string | 否 | CNY | 基准货币(ISO 4217,如 USD/EUR/JPY) |

返回:`{base_code, updated, rates:[{currency, rate}]}`(按天缓存)。

## life lunar —— 老黄历/万年历

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--date` | string | 否 | 今天 | 日期(支持 10/13 位时间戳或日期字符串) |

返回(基于 tyme4ts):`{solar, lunar, stats, term, zodiac, sixty_cycle, legal_holiday, festival, constellation, taboo:{day:{recommends,avoids}, hours:[...]}, nayin, fortune:{today_luck, career, money, love}, ...}`。

## life today-in-history —— 历史上的今天

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--date` | string | 否 | 今天 | 日期 ISO |

返回:`{date, month, day, items:[{title, year, description, event_type(birth|death|event), link}]}`(按年份升序)。

## life olympics —— 奥运奖牌榜

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--id` | string | 否 | 进行中赛事 | 赛事 slug(省略取进行中) |

返回:`{event_id, event_name, start_date, end_date, list:[{rank, code, country, gold, silver, bronze, total, flag}]}`(按金→银→铜→国家排序)。

## life olympics-events —— 历届奥运赛事

无参数。返回:`[{id, year, name, season(冬季|夏季), logo, url}]`。
