# tech —— 科技社区

`rxopen tech` 查询海外科技社区内容。

## tech hackernews —— Hacker News

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--type` | string | 否 | top | `top` \| `best` \| `new` |
| `--limit` | number | 否 | 10 | 返回条数(上限 35) |
| `--forceUpdate` | boolean | 否 | — | 跳过缓存(缓存 10 分钟) |

返回数组:`[{id, title, score, link, author, created}]`

注意事项:

- `--type` 默认 `top`;`best` 精选热门。
- ⚠️ `new` 上游路由 bug:实际返回 top(等同 `--type top`)。
- `--limit` 默认 10,上限 35。
