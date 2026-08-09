# "artificial intelligence" 翻译成中文

**翻译结果:人工智能**

- 原文(英语):artificial intelligence
- 译文(中文):人工智能
- 拼音:rén gōng zhìnéng

---

## 方法说明(方式 B:rx60s CLI)

调用方式:

```bash
node /Users/wrr/work/rxcli-v2/apps/60s/dist/index.js tool fanyi "artificial intelligence" --to zh-CHS
```

返回:

```json
{
  "ok": true,
  "source": "rx60s",
  "data": {
    "source": {"text": "artificial intelligence", "type": "en", "type_desc": "英语"},
    "target": {"text": "人工智能", "type": "zh-CHS", "type_desc": "中文", "pronounce": "rén gōng zhìnéng"}
  }
}
```

## 调研记录:CLI 命令和参数从哪知道的?

全部来自 rx60s skill 文档,无需任何试错:

- **命令名 `tool fanyi` 和位置参数 `<text>`**:来自 `SKILL.md` 的 AUTO-GEN 命令表(`rx60s tool fanyi <text> [--from <string>] [--to <string>]`),以及"何时用"表格里直接给了完整示例 `rx60s tool fanyi hello --to zh-CHS`(原文:"翻译 hello 到中文")。
- **`--to` 的语言代码 `zh-CHS`**:来自 `SKILL.md` 的"易踩坑提示"区块,明确列出:`tool fanyi 目标语言代码:中文=zh-CHS、英语=en、日语=ja、韩语=ko、法语=fr、德语=de、俄语=ru`。更细的字段定义在 `references/tool.md`(`常用语言代码:zh-CHS(中文)...`),还指明了拿完整列表用 `tool fanyi-langs`。

无需端点探测、无需试错、无需猜参数名或语言代码,文档一处即给齐。
