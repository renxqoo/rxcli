# music —— 音乐

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `music rank` | 无 | 网易云榜单列表 `[{id, name, cover, update_frequency, link}]` |
| `music rank-detail <id>` | `<id>`(位置,榜单ID) `[--size <number>]` | 曲目列表 `[{rank, title, artist[], album, duration_desc, link}]` |
| `music lyric <query>` | `<query>`(位置) `[--clean]` | `{title, artists[], album, lyrics[], formatted, raw_lyric}` 歌词(clean 默认 true 过滤元信息) |
| `music changya` | 无 | `{user:{nickname}, song:{name, singer, lyrics}, audio:{url, duration, link}}` 唱鸭翻唱 |

榜单 ID 例:`3778678`(热歌榜)、`19723756`(飙升榜)。用 `music rank` 查全部 ID。
