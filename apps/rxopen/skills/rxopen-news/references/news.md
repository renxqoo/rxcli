# news —— 新闻资讯

`rxopen news` 查询每日新闻与行业资讯。子命令:today / ai / it / it-rank / rss。顶层快捷命令 `rxopen daily` = `news today`。

## news today / daily —— 每日新闻速览

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--date` | string | 否 | 今天 | 指定日期 YYYY-MM-DD(失败回退昨天/前天) |
| `--forceUpdate` | boolean | 否 | — | 跳过缓存强制刷新 |

返回字段:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `date` | string | YYYY-MM-DD |
| `news` | string[] | 新闻标题列表 |
| `tip` | string | 每日微语 |
| `image` | string | 图片版 URL |
| `day_of_week` | string | 星期几(中文) |
| `lunar_date` | string | 农历日期 |
| `updated` / `api_updated` | string/number | 更新时间 |

## news ai —— AI 资讯快报

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--date` | string | 否 | 昨天 | 指定日期 YYYY-MM-DD |
| `--all` | boolean | 否 | — | 返回全部日期(忽略 date) |

返回:`{ date, news: [{title, detail, link, source?}] }`

## news it —— IT 之家实时资讯

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--limit` | number | 否 | 20 | 返回条数(上限 50) |

返回数组:`[{title, link, description, created, created_at}]`(description 截断 360 字)

## news it-rank —— IT 之家排行榜

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--type` | string | 否 | day | `day` \| `week` \| `month` |

返回数组:`[{title, link}]`

## news rss —— RSS 订阅

无参数。上游返回 XML,CLI 解析为结构化数组:`[{title, link, pubDate, description}]`(近 7 天)。
