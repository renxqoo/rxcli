# fun / music / movie / tech / kb / health / beta —— 其它命令

## fun —— 趣味文案

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `fun hitokoto` | `[--id <number>]` | `{index, hitokoto}` 一言 |
| `fun duanzi` | `[--id <number>]` | `{index, duanzi}` 段子 |
| `fun dad-joke` | `[--id <number>]` | `{index, content}` 英文冷笑话 |
| `fun fabing` | `[--name <string>] [--id <number>]` | `{index, saying}` 发病文学(name 替换 [name],默认"主人") |
| `fun kfc` | 无 | `{index, kfc}` 疯狂星期四文案 |
| `fun answer` | `[--id <number>]` | `{index, answer}` 答案之书 |
| `fun luck` | `[--id <number>]` | `{luck_desc, luck_rank(1-10), luck_tip, luck_tip_index}` 今日运势 |
| `fun moyu` | `[--date <string>]` | 打工人日历(节假日/倒计时/进度,结构见下) |

`fun moyu` 返回结构:`{date:{gregorian, weekday, lunar:{...zodiac, yearGanZhi}}, today:{isWeekend, isHoliday, isWorkday, holidayName, ...}, progress:{week/month/year:{percentage}}, currentHoliday, nextHoliday, nextWeekend, countdown:{toWeekEnd, toFriday, toMonthEnd, toYearEnd}, moyuQuote}`。

## music —— 音乐

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `music rank` | 无 | 网易云榜单列表 `[{id, name, cover, update_frequency, link}]` |
| `music rank-detail <id>` | `<id>`(位置,榜单ID) `[--size <number>]` | 曲目列表 `[{rank, title, artist[], album, duration_desc, link}]` |
| `music lyric <query>` | `<query>`(位置) `[--clean]` | `{title, artists[], album, lyrics[], formatted, raw_lyric}` 歌词(clean 默认 true 过滤元信息) |
| `music changya` | 无 | `{user:{nickname}, song:{name, singer, lyrics}, audio:{url, duration, link}}` 唱鸭翻唱 |

榜单 ID 例:`3778678`(热歌榜)、`19723756`(飙升榜)。用 `music rank` 查全部 ID。

## movie —— 影视游戏

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `movie maoyan-all` | 无 | 全球票房榜 `{list:[{rank, movie_name, box_office_desc}], tip}` |
| `movie maoyan-realtime` | `[--type movie\|tv\|web] [--date YYYYMMDD]` | 实时榜 `{list:[...]}`(type 默认 movie) |
| `movie douban` | `[--cat movie\|tv_chinese\|tv_global\|show_chinese\|show_global]` | 豆瓣口碑榜 `[{rank, title, rating, good_rate, trend, cover, url}]`(默认 cat=movie) |
| `movie epic` | 无 | Epic 免费游戏 `[{title, cover, original_price_desc, free_start, free_end, link}]` |

## tech —— 科技社区

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `tech hackernews` | `[--type top\|best\|new] [--limit <number>] [--forceUpdate]` | `[{id, title, score, link, author, created}]` |

- `--type` 默认 top;`best` 精选。
- ⚠️ `new` 上游路由 bug:实际返回 top(等同 `--type top`)。
- `--limit` 默认 10,上限 35;缓存 10 分钟,`--forceUpdate` 强刷。

## kb —— 知识库

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `kb baike <word>` | `<word>`(位置,词条) | `{title, description, abstract, cover, has_other, link}` 未找到返回 `not_found` |
| `kb js-question` | `[--id <number>]` | `{id, question, code?, options[], answer, explanation}` JS 面试题(省略 id 随机) |

## health —— 健康评估

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `health assess` | `--height <cm> --weight <kg> --gender male\|female --age <岁>`(全必填) | `{bmi, weight_assessment, metabolism:{bmr, tdee}, body_fat, health_advice, ideal_measurements, disclaimer}` |

注:`--height` 50-300,`--weight` 10-300,`--age` 1-150。

## beta —— 实验性接口(上游标记不稳定)

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `beta kuan` | 无 | `{topics:[{id, title, hotness, followers, rating, ...}], total}` 酷安热门话题 |
| `beta qq <qq>` | `<qq>`(位置,5-11位) `[--size 0\|40\|100\|160\|640]` | `{qq, nickname, avatar_url, avatar_size}` QQ 信息 |
