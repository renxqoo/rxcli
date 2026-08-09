# "artificial intelligence" 翻译成中文

**翻译结果:人工智能**

- 原文(英语):artificial intelligence
- 译文(中文):人工智能
- 拼音:rén gōng zhìnéng

---

## 方法说明(方式 A:官方 60s skill / 直接 curl API)

调用方式:

```bash
curl "https://60s.viki.moe/v2/fanyi" -G \
  --data-urlencode "text=artificial intelligence" \
  --data-urlencode "to=zh-CHS"
```

返回:

```json
{
  "code": 200,
  "data": {
    "source": {"text": "artificial intelligence", "type": "en", "type_desc": "英语"},
    "target": {"text": "人工智能", "type": "zh-CHS", "type_desc": "中文", "pronounce": "rén gōng zhìnéng"}
  }
}
```

## 调研记录:官方 skill 有翻译接口吗?

**没有。** 官方 skill 合并文件(`/tmp/60s-skills-test/all_official_skills.md`,共 6 个 skill)里搜索 translate / fanyi / 翻译,**完全没有命中**。6 个 skill 覆盖的范围是:

1. `daily-news-60s` — 每日新闻
2. `hot-topics` — 微博/知乎/百度/抖音/头条/B站热搜
3. `weather-query` — 天气
4. `data-query` — 汇率/农历/历史/百科/油价/金价/化学元素
5. `entertainment` — 一言/笑话/段子/运势/KFC/摸鱼
6. `media-info` — 网易云/歌词/票房/收视

**翻译接口(`/v2/fanyi`)不在任何 skill 文档里。** 因此:

- 没有任何文档告诉我端点路径是 `/v2/fanyi`。
- 没有任何文档告诉我参数名叫 `text`(不是 `query`)。
- 没有任何文档告诉我目标语言代码是 `zh-CHS`(中文)。

我实际是这样找到的:
1. 先试 `/v2/translate` → 返回 404(端点猜错了)。
2. 再试 `/v2/fanyi?query=...&to=zh-CHS` → 返回 `400 参数 text 不能为空`,这条错误信息透露了正确的参数名是 `text`。
3. 改用 `text=artificial intelligence` → 200 成功,返回"人工智能"。

目标语言代码 `zh-CHS` 我是从**方式 B 的 rx60s skill 文档**里看到的,不是从官方 skill 知道的(官方 skill 根本没提翻译)。如果只看官方 skill、又不预先知道有道/Youdao 的语言代码约定,这个代码只能靠猜测或试错。
