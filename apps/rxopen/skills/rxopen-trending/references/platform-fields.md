# 热搜聚类字段

各命令返回数组。所有平台都有 `title`；详情链接可能叫 `link` 或 `url`。热度值的量纲不同，不跨平台比较。

| 平台 | 可用字段 | 聚类用途 |
| --- | --- | --- |
| 微博 | `title, hot_value, link` | 主要使用标题 |
| 知乎 | `title, detail, answer_cnt, follower_cnt, link` | 用 `detail` 辅助确认是否同一事件 |
| 头条 | `title, hot_value, cover, link` | 主要使用标题 |
| 抖音 | `title, hot_value, cover, link, event_time` | 不依赖可能不准的 `event_time` |
| B站 | `title, link` | 只能依据标题 |
| 小红书 | `rank, title, score, word_type, link` | 主要使用标题 |
| 百度 | `rank, title, desc, score, score_desc, url` | 用 `desc` 辅助确认事件 |
| 懂车帝 | `rank, title, score, score_desc, url` | 主要使用标题 |
| 夸克 | `title, summary, source, category, link` | 用 `summary` 辅助确认事件 |

## 聚类规则

1. 先比较核心实体，再比较动作、时间和地点；仅关键词相似不足以合并。
2. 标题描述同一实体但事件不同、时间不同或结论冲突时保持分开。
3. 为每个聚类保留各平台原始标题，便于用户核查。
4. 角度差异只能来自实际 `title`、`detail`、`desc` 或 `summary`；没有证据时不推断。
5. 单平台独有不表示异常、偏差或营销，尤其是垂直平台话题。
