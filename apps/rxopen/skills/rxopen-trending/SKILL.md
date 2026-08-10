---
name: rxopen-trending
description: 聚合并比较微博、知乎、头条、抖音、B站、小红书、百度、懂车帝和夸克的当前热搜快照。当用户明确要求多平台热搜汇总、跨平台共同话题、平台差异或内容选题线索时使用；单个平台榜单使用 rxopen-hot，本 skill 不用于事实核验、情绪分析或历史舆情监测。
metadata:
  requires:
    bins: ["rxopen"]
  category: composite
  skillType: workflow
---

# rxopen-trending

## 工作流

1. 先检查 `rxopen` 是否在 PATH（如 `command -v rxopen`）；不可用时读取 `references/install.md`，向用户说明安装步骤。
2. 使用用户指定的平台；未指定时并发查询全部 9 个平台，所有命令加 `--json`：

```bash
rxopen hot weibo --json
rxopen hot zhihu --json
rxopen hot toutiao --json
rxopen hot douyin --json
rxopen hot bili --json
rxopen hot rednote --json
rxopen hot baidu-hot --json
rxopen hot dongchedi --json
rxopen hot quark --json
```

3. 读取 `references/platform-fields.md`，以 `title` 为主，使用 `detail`、`summary` 或 `desc` 辅助判断。只有核心实体和事件一致且事实不冲突时才合并；不确定的话题保持分开。
4. 为每个话题保留统一标题、命中平台、命中数、原始标题和可用链接。按 `命中数/实际成功平台数` 降序输出，不使用固定“全民热点”阈值。
5. 两个平台对比时分为“共同话题”和“各自独有”；三个及以上平台时分为“跨平台共同话题”和“平台独有”。
6. 只根据实际标题和摘要归纳角度差异。证据不足时写“仅能确认同时上榜”，不得套用平台刻板印象。

## 可信边界

- 跨平台上榜表示榜单共现，不代表事件真实，也不是独立事实核验。
- 结果是调用时刻的快照，不提供历史趋势、情绪分析或持续舆情监测。
- 平台失败时继续处理其余平台，并列出失败平台；全部失败时返回错误。
- 默认展示共同话题前 10 项和每个平台少量独有话题；用户要求完整列表时再展开。

## 输出要求

- 标注调用时间、请求平台、成功平台和失败平台。
- 每个共同话题显示 `命中数/成功平台数`、平台名称及原始标题证据。
- 将内容定位为选题线索或关注度信号，不承诺真实性、代表性或传播效果。

## References

- 安装与验证:`references/install.md`
- 平台字段和聚类证据:`references/platform-fields.md`
