---
name: rxopen-morning
description: 生成包含实时天气、天气预报、新闻、打工日历及可选黄历和历史事件的综合晨报。当用户明确要求晨报、出门前综合概览或“今天该知道什么”时使用；普通问候、单项天气、带伞、穿衣或新闻问题分别使用 rxopen-life 或 rxopen-news。
metadata:
  requires:
    bins: ["rxopen"]
  category: composite
  skillType: workflow
---

# rxopen-morning

## 工作流

1. 先检查 `rxopen` 是否在 PATH（如 `command -v rxopen`）；不可用时读取 `references/install.md`，向用户说明安装步骤。
2. 确认城市。用户未提供城市时只询问城市，不默认北京。
3. 并发执行以下命令，全部加 `--json`：

```bash
rxopen life weather <城市> --json
rxopen life forecast <城市> --days 1 --json
rxopen daily --json
rxopen moyu --json
rxopen life lunar --json
rxopen life today-in-history --json
```

4. 读取 `references/data-fields.md` 后合成简报。只依据返回字段给出穿衣、带伞、空气质量和预警建议，不补造缺失数据。
5. 任一模块失败时继续处理其他模块，列出缺失模块及原因。天气实时和预报都失败时，不给出出行建议。
6. 检查新闻返回的实际日期；发生日期回退时明确标注。
7. 黄历和运势只作可选趣味信息，不作为决策依据。

## 输出要求

- 开头给出城市、日期和数据更新时间。
- 天气部分包含当前状态、当日最高/最低温、降水或预警、空气质量及有依据的出行建议。
- 新闻最多选 3 条，不扩写来源未提供的事实。
- 给出工作日、周末或节假日倒计时。
- 黄历和历史事件放在末尾；字段缺失时省略，不保留空模板。

## References

- 安装与验证:`references/install.md`
- 晨报命令和字段:`references/data-fields.md`
