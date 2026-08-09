# hot —— 热搜榜单

`rx60s hot` 查询各平台热搜榜单,**所有子命令无参数**,返回数组。

## 命令清单

| 命令 | 平台 |
| --- | --- |
| `hot weibo` | 微博实时热搜 |
| `hot zhihu` | 知乎实时热搜 |
| `hot toutiao` | 头条实时热搜 |
| `hot douyin` | 抖音实时热搜 |
| `hot bili` | B 站实时热搜 |
| `hot rednote` | 小红书实时热点 |
| `hot baidu-hot` | 百度实时热搜 |
| `hot baidu-teleplay` | 百度电视剧榜单 |
| `hot baidu-tieba` | 百度贴吧热门话题 |
| `hot dongchedi` | 懂车帝热搜 |
| `hot quark` | 夸克热点新闻 |

## 返回字段(共性)

各平台返回字段略有差异,核心字段:

| 字段 | 类型 | 说明 | 适用平台 |
| --- | --- | --- | --- |
| `title` | string | 热搜标题/话题 | 全部 |
| `hot_value` | number | 热度值 | weibo/toutiao/douyin/zhihu(部分) |
| `link` / `url` | string | 详情链接 | 全部 |
| `cover` | string | 封面图(可空) | 部分 |
| `rank` | number | 排名 | baidu-*/rednote |
| `score` / `score_desc` | number/string | 热度 | baidu-*/dongchedi |
| `detail` | string | 详情/摘要 | zhihu |

### 平台特有字段

- **weibo**:`{title, hot_value, link}`(已过滤推广)
- **zhihu**:`{title, detail, cover, hot_value_desc, answer_cnt, follower_cnt, comment_cnt, created_at, link}`
- **toutiao**:`{title, hot_value, cover, link}`
- **douyin**:`{title, hot_value, cover, link, event_time}`(⚠️上游 `event_time_at` 时间戳可能不准)
- **bili**:`{title, link}`(已过滤商业推广)
- **rednote**:`{rank, title, score, word_type, link}`
- **baidu-hot**:`{rank, title, desc, score, score_desc, cover, type_desc, url}`(type_desc: 新/热/null)
- **dongchedi**:`{rank, title, url, score, score_desc}`
- **quark**:`{id, title, summary, source, cover, category[], like_count, link}`
