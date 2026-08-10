# movie —— 影视游戏

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `movie maoyan-all` | 无 | 全球票房榜 `{list:[{rank, movie_name, box_office_desc}], tip}` |
| `movie maoyan-realtime` | `[--type movie\|tv\|web] [--date YYYYMMDD]` | 实时榜 `{list:[...]}`(type 默认 movie) |
| `movie douban` | `[--cat movie\|tv_chinese\|tv_global\|show_chinese\|show_global]` | 豆瓣口碑榜 `[{rank, title, rating, good_rate, trend, cover, url}]`(默认 cat=movie) |
| `movie epic` | 无 | Epic 免费游戏 `[{title, cover, original_price_desc, free_start, free_end, link}]` |
