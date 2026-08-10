# Eval-3 对比报告:翻译 "artificial intelligence" 到中文

任务:把英文 "artificial intelligence" 翻译成中文(目标语言:中文)。
两种方式都真实调用,结果一致:**人工智能**。

---

## 一、官方 skill 有没有覆盖翻译接口?

**没有。完全没覆盖。**

在官方 6 个 skill 合并文件(`/tmp/60s-skills-test/all_official_skills.md`,约 1460 行)里搜索 `translate` / `fanyi` / `翻译`,**零命中**。6 个 skill 是:

| # | skill | 覆盖域 |
|---|-------|--------|
| 1 | daily-news-60s | 每日新闻 60s |
| 2 | hot-topics | 微博/知乎/百度/抖音/头条/B站热搜 |
| 3 | weather-query | 实时天气/预报 |
| 4 | data-query | 汇率/农历/历史/百科/油价/金价/化学元素 |
| 5 | entertainment | 一言/笑话/段子/运势/KFC/摸鱼 |
| 6 | media-info | 网易云/歌词/票房/收视/网剧 |

翻译(有道 `/v2/fanyi`)是 60s API 里真实存在的接口,但官方 skill 把它漏掉了。

## 二、这说明什么?

1. **官方 skill 的接口覆盖不完整,存在盲区。** 一个常用且 API 真实提供的功能(翻译),6 个 skill 里都没有。说明官方 skill 是按"主题包"粗粒度组织的,接口枚举不系统,容易漏接口。
2. **agent 只靠官方 skill,会"不知道能翻译"或"知道能翻译但不知怎么传参"。** 本任务里 agent 还能靠常识+试错凑出来,但对于更偏门或参数更复杂的接口(如本任务暴露的参数名 `text` 不是直觉的 `query`、语言代码 `zh-CHS` 不是 `zh`),纯靠试错会失败或调错。
3. **参数细节(尤其枚举值)是更大的缺口。** 即使 agent 猜到端点是 `/v2/fanyi`,也无法从官方 skill 得知:① 参数名是 `text` 而非 `query`;② 目标中文代码是 `zh-CHS` 而非 `zh`/`cn`/`chinese`。这两个都得靠报错反向推断或预先知识。

## 三、两种方式各几步完成

### 方式 A:官方 skill + curl API

| 步骤 | 动作 | 结果 |
|------|------|------|
| 1 | 读官方 6-skill 合并文件,搜 translate/翻译 | 无命中,确认未覆盖 |
| 2 | 猜端点 `curl /v2/translate?query=...&to=zh-CHS` | 404,猜错 |
| 3 | 换猜 `curl /v2/fanyi?query=...&to=zh-CHS` | 400「参数 text 不能为空」,反推出参数名是 `text` |
| 4 | 改 `text=artificial intelligence` 再 curl | 200,得「人工智能」 |

**≈ 4 步,含 2 次失败探测**(`--to=zh-CHS` 这个代码还是从方式 B 的 skill 抄来的,否则还要多一轮试错)。

### 方式 B:rx60s CLI

| 步骤 | 动作 | 结果 |
|------|------|------|
| 1 | 读 `SKILL.md`,"何时用"表直接有示例「翻译 hello 到中文 → `tool fanyi hello --to zh-CHS`」 | 命令、参数、语言代码一次拿全 |
| 2 | `node dist/index.js tool fanyi "artificial intelligence" --to zh-CHS` | 直接得「人工智能」 |

**2 步,0 次失败探测。** 语言代码 `zh-CHS` 来自 `SKILL.md` 的「易踩坑提示」和 `references/tool.md`,无需猜。

## 四、哪种更容易知道怎么传参数(特别是 `--to zh-CHS`)?

**方式 B(rx60s)明显更容易。**

| 维度 | 官方 skill | rx60s |
|------|-----------|-------|
| 是否告诉你有翻译接口 | ❌ 没提 | ✅ 命令表+示例都有 |
| 是否告诉你端点/命令名 | ❌ 要自己猜 `/v2/fanyi` | ✅ `tool fanyi` |
| 是否告诉你参数名(text vs query) | ❌ 靠 400 报错反推 | ✅ 文档明示位置参数 |
| 是否告诉你语言代码 `zh-CHS` | ❌ 完全没有 | ✅ 明确列表(中文=zh-CHS) |
| 是否需要试错/失败探测 | 是(至少 2 次) | 否(0 次) |
| 完成步骤 | ~4 步 | 2 步 |

`zh-CHS` 是有道翻译(Youdao)的语言代码约定,既不是 ISO 639-1(`zh`)也不是常见直觉写法。官方 skill 完全没给这个枚举;rx60s 在 SKILL.md 顶部「易踩坑提示」和 `references/tool.md` 两处都明确列出,并提示用 `tool fanyi-langs` 拿完整列表,杜绝瞎猜。

## 五、结论

- 翻译结果两边一致(都返回「人工智能」),**功能本身没问题**。
- 差距在"可发现性 / 参数自描述性":官方 skill 对翻译是**零覆盖**,agent 要靠端点猜、报错反推、外加从别处借语言代码;rx60s skill **一处给齐命令+参数+语言代码枚举**,开箱即用。
- 本任务集中暴露了官方 skill 的两个结构性短板:**接口覆盖不全**(漏翻译)+ **枚举值不自描述**(参数名、语言代码都得猜)。
