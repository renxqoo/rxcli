# 热搜返回字段

`rxopen hot` 覆盖 9 个平台、11 个榜单。所有子命令无业务参数并返回数组；完整命令以 `SKILL.md` 的 AUTO-GEN 表为准。

## 共性字段

| 字段 | 类型 | 说明 | 适用平台 |
| --- | --- | --- | --- |
| `title` | string | 热搜标题/话题 | 全部 |
| `hot_value` | number | 热度值 | weibo/toutiao/douyin/zhihu(部分) |
| `link` / `url` | string | 详情链接 | 不同平台字段名不同 |
| `cover` | string | 封面图(可空) | 部分 |
| `rank` | number | 排名 | baidu-*/rednote |
| `score` / `score_desc` | number/string | 热度 | baidu-*/dongchedi |
| `detail` | string | 详情/摘要 | zhihu |

## 平台字段

- **weibo**:`{title, hot_value, link}`(已过滤推广)
- **zhihu**:`{title, detail, cover, hot_value_desc, answer_cnt, follower_cnt, comment_cnt, created_at, link}`
- **toutiao**:`{title, hot_value, cover, link}`
- **douyin**:`{title, hot_value, cover, link, event_time}`(⚠️上游 `event_time_at` 时间戳可能不准)
- **bili**:`{title, link}`(已过滤商业推广)
- **rednote**:`{rank, title, score, word_type, link}`
- **baidu-hot**:`{rank, title, desc, score, score_desc, cover, type_desc, url}`(type_desc: 新/热/null)
- **dongchedi**:`{rank, title, url, score, score_desc}`
- **quark**:`{id, title, summary, source, cover, category[], like_count, link}`

不要跨平台比较 `hot_value`、`score` 或 `rank`；这些值的量纲不同。
