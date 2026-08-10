# kb —— 知识库

## kb baike —— 百度百科

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `kb baike <word>` | `<word>`(位置,词条) | `{title, description, abstract, cover, has_other, link}` 未找到返回 `not_found` |

## kb js-question —— JavaScript 面试题

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `kb js-question` | `[--id <number>]` | `{id, question, code?, options[], answer, explanation}` JS 面试题(省略 id 随机) |
