# fun —— 趣味文案

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
