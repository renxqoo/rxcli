# beta —— 实验性接口(上游标记不稳定)

⚠️ beta 命令依赖上游实验性路由,可能随时失效。

## 命令清单

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `beta kuan` | 无 | `{topics:[{id, title, hotness, followers, rating, ...}], total}` 酷安热门话题 |
| `beta qq <qq>` | `<qq>`(位置,5-11位) `[--size 0\|40\|100\|160\|640]` | `{qq, nickname, avatar_url, avatar_size}` QQ 信息 |
