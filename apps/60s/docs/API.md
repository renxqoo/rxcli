# 60s API 接口文档

> **数据源 / 上游**:[vikiboss/60s](https://github.com/vikiboss/60s) 开源项目(MIT License © Viki)。默认实例 `https://60s.viki.moe`,全部接口在 `/v2` 前缀下。所有数据归上游原项目及原始数据源所有,本项目(rx60s)仅做 CLI 化封装,不持有/缓存任何数据。
>
> 本文是 CLI 化的接口契约,每条接口都封装为一个 `rx60s` 子命令。

---

## 0. 通用约定

### 统一响应包装(JSON)

所有 JSON 接口返回(`Common.buildJson`):

```jsonc
{
  "code": 200,
  "message": "获取成功。开源地址 https://github.com/vikiboss/60s,反馈群 595941841。",
  "data": { /* 各接口具体结构,见下 */ }
}
```

错误时 `code` 为对应 HTTP 状态(400/404/500),`data: null`,`message` 为错误说明。

### 输出编码(`?encoding=`)

由 `encoding` 中间件根据 `?encoding=<值>`(参数名可由环境变量 `ENCODING_PARAM_NAME` 改,默认 `encoding`)切换 `ctx.state.encoding`。默认 `json`。

| 值 | 含义 | 哪些接口支持 |
|---|---|---|
| `json`(默认) | 标准包装 JSON | 全部 |
| `text` | 纯文本 | 多数列表/资讯类 |
| `markdown` | Markdown | 多数列表/资讯类 |
| `image` | 302 重定向到图片 | 60s / bing / qrcode / qq |
| `image-4k` | 302 重定向到 4K 图 | bing |
| `image-proxy` | 代理返回图片二进制 | 60s |
| `audio` | 302 重定向到音频 | changya |
| `html` | 完整可视化 HTML 页 | color |
| `text-detail` | 详细文本报告 | password |

> **CLI 设计取舍**:CLI 主要消费 `json`(结构化数据给 agent/管道)。`text/markdown` 由 CLI 自行渲染(`humanFormat` / `printTable`);`image/audio/html/image-proxy` 这类二进制/重定向输出不适合 agent-data-cli 的统一 JSON 契约,标记为「跳过」或仅保留链接字段。

### 路由方法

- `GET`:绝大多数查询接口
- `ALL`(同时接 GET/POST 等,并支持从 body 解析参数):`og` / `hash` / `fanyi` / `fanyi/langs` / `lyric` / `fuel-price`
- `beta` 前缀:`kuan`、`qq/profile`(上游标记不稳定)
- 兼容旧路由(未来大版本移除,CLI 不实现):`/exchange_rate`、`/today_in_history`、`/maoyan`、`/baidu/realtime`、`/weather`、`/ncm-rank`、`/color`

---

## 1. 命名空间划分(CLI 设计)

把约 50 个接口按语义聚类成 11 个 namespace + 6 个顶层快捷命令。CLI 入口 `rx60s`。

| namespace | 中文名 | 接口数 | 子命令(→ 原路由) |
|---|---|---|---|
| **`news`** 新闻资讯 | 每日新闻 / 行业资讯 | 5 | `news today` / `news ai` / `news it` / `news it-rank` / `news rss` |
| **`hot`** 热榜 | 各平台热搜榜单 | 9 | `hot weibo/zhihu/toutiao/baidu-hot/baidu-teleplay/baidu-tieba/douyin/bili/rednote` |
| **`tech`** 科技社区 | 国外科技资讯 | 2 | `tech hackernews` / `tech hackernews best` |
| **`fun`** 趣味文案 | 段子/运势/发病等 | 9 | `fun hitokoto/duanzi/dad-joke/fabing/kfc/answer/luck/moyu/hitokoto` |
| **`music`** 音乐 | 网易云榜单/歌词/唱鸭 | 3 | `music rank` / `music rank-detail` / `music lyric` / `music changya` |
| **`movie`** 影视 | 猫眼票房/豆瓣榜单/ Epic | 3 | `movie maoyan-*` / `movie douban-*` / `movie epic` |
| **`life`** 生活服务 | 天气/油价/金价/汇率/日历 | 8 | `life weather/forecast/fuel-price/gold-price/exchange-rate/lunar/today-in-history/olympics` |
| **`tool`** 开发工具 | 哈希/二维码/OG/域名/IP/密码/颜色/化学/翻译 | 12 | `tool hash/qrcode/og/whois/ip/password/password-check/color/color-palette/chemical/fanyi/fanyi-langs` |
| **`kb`** 知识库 | 百科/面试题 | 2 | `kb baike` / `kb js-question` |
| **`health`** 健康 | BMI/健康评估 | 1 | `health assess` |
| **`sports`** 体育 | 奥运奖牌 | 1 | `sports olympics` / `sports olympics-events` |
| **`beta`** 测试 | 酷安/QQ(Beta) | 2 | `beta kuan` / `beta qq` |

**顶层快捷命令**(常用直达):

- `rx60s 60s` → `news today`(项目核心)
- `rx60s bing` → 必应每日壁纸(独立,不便归类)
- `rx60s toutiao` / `weibo` / `zhihu` → 热搜直达
- `rx60s hitokoto` → 一言直达
- `rx60s moyu` → 摸鱼日历直达

---

## 2. 接口明细(按 namespace 分组)

### 2.1 `news` 新闻资讯

#### 2.1.1 `GET /v2/60s` — 每天 60 秒读懂世界 ⭐ 核心

- **中文名**:每天 60 秒读懂世界(每日新闻摘要 + 微语 + 图片版)
- **CLI**:`rx60s news today`(顶层快捷 `rx60s 60s`)
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `date` | string(`YYYY-MM-DD`) | no | 今天(上海时区),失败回退昨天/前天 | 指定日期的新闻 |
| `force-update` | flag(presence) | no | — | 跳过内存缓存强制刷新 |

- **响应 `data`**:
  ```ts
  {
    date: string                       // "YYYY-MM-DD"
    news: { title: string; link: string }[]
    cover: string
    tip: string                        // 微语
    image: string                      // 图片版 URL
    link: string
    day_of_week: string                // 星期一
    lunar_date: string                 // 农历(无"农历"前缀)
    updated: string
    updated_at: number
    api_updated: string
    api_updated_at: number
  }
  ```
- **特殊编码**:`text` / `markdown` / `image`(重定向到当日 PNG,失败回退 `60s-static.viki.moe/images/<date>.png`) / `image-proxy`(代理返回图片字节)

#### 2.1.2 `GET /v2/60s/rss` — 60s RSS 订阅

- **中文名**:每天 60s RSS 2.0 XML 订阅(近 7 天新闻)
- **CLI**:`rx60s news rss`
- **参数**:无
- **响应**:⚠️ **不走 JSON 包装**,直接返回 `application/xml`,RSS `<channel>` 含最多 7 个 `<item>`,每个含 title/link/guid/pubDate + CDATA description(新闻列表 + 微语 + 图片 + 来源页脚)
- **CLI 取舍**:返回 XML,CLI 解析为 `{ items: [{title, link, pubDate, ...}] }` 结构化输出

#### 2.1.3 `GET /v2/ai-news` — AI 资讯快报

- **中文名**:AI 资讯快报(每日 AI 行业新闻,抓自 ai-bot.cn)
- **CLI**:`rx60s news ai`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `date` | string(`YYYY-MM-DD`) | no | 昨天 | 指定日期 |
| `all` | flag(presence) | no | — | 返回全部日期的新闻(忽略 date) |

- **响应 `data`**:
  ```ts
  { date: string; news: { title: string; detail: string; link: string; source?: string; date?: string }[] }
  ```
- **特殊编码**:`text` / `markdown`

#### 2.1.4 `GET /v2/it-news` — IT 之家实时资讯

- **中文名**:IT 之家实时资讯(IT之家 RSS)
- **CLI**:`rx60s news it`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `limit` | number | no | 20(上限 50) | 返回条数 |

- **响应 `data`**:数组
  ```ts
  [{ title: string; link: string; description: string; created: string; created_at: number }]
  // created 格式 "YYYY-MM-DD HH:mm:ss";description 截断 360 字
  ```
- **特殊编码**:`text` / `markdown`

#### 2.1.5 `GET /v2/it-news/rank` — IT 之家排行榜

- **中文名**:IT 之家排行榜(日/周/月热榜)
- **CLI**:`rx60s news it-rank`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `type` | string(`day`/`week`/`month`) | no | `day` | 榜单类型;非法值返回 400 |

- **响应 `data`**:`[{ title: string; link: string }]`
- **特殊编码**:`text` / `markdown`

---

### 2.2 `hot` 热搜榜单

> 这一组接口大多无参数,返回数组,支持 text/markdown(截前 20 条)。

#### 2.2.1 `GET /v2/weibo` — 微博实时热搜

- **CLI**:`rx60s hot weibo`(顶层快捷 `rx60s weibo`)
- **参数**:无
- **响应 `data`**:
  ```ts
  [{ title: string; hot_value: number; link: string }]
  // link = s.weibo.com/weibo?q=<encoded>;已过滤推广(pic 须匹配 /img_search_\d+/)
  ```

#### 2.2.2 `GET /v2/zhihu` — 知乎实时热搜

- **CLI**:`rx60s hot zhihu`(顶层快捷 `rx60s zhihu`)
- **参数**:无
- **响应 `data`**:
  ```ts
  [{
    title: string; detail: string; cover: string
    hot_value_desc: string             // "1234 万热度"
    answer_cnt, follower_cnt, comment_cnt: number
    created_at: number; created: string
    link: string                       // 重写为 www.zhihu.com/question/...
  }]
  ```

#### 2.2.3 `GET /v2/toutiao` — 头条实时热搜

- **CLI**:`rx60s hot toutiao`(顶层快捷 `rx60s toutiao`)
- **参数**:无
- **响应 `data`**:`[{ title: string; hot_value: number; cover: string; link: string }]`

#### 2.2.4 `GET /v2/douyin` — 抖音实时热搜

- **CLI**:`rx60s hot douyin`
- **参数**:无
- **响应 `data`**:
  ```ts
  [{
    title: string; hot_value: number; cover: string; link: string
    event_time: string; event_time_at: number    // ⚠️ 上游疑似 bug:new Date(秒) 未 *1000
    active_time: string; active_time_at: number
  }]
  ```

#### 2.2.5 `GET /v2/bili` — B 站实时热搜

- **CLI**:`rx60s hot bili`
- **参数**:无
- **响应 `data`**:`[{ title: string; link: string }]`(link = search.bilibili.com/all?keyword=...)
- 已过滤商业推广

#### 2.2.6 `GET /v2/rednote` — 小红书实时热点

- **CLI**:`rx60s hot rednote`
- **参数**:无
- **响应 `data`**:`[{ rank: number; title: string; score: number; word_type: string; work_type_icon: string; link: string }]`

#### 2.2.7 `GET /v2/baidu/hot` — 百度实时热搜

- **CLI**:`rx60s hot baidu-hot`
- **参数**:无
- **响应 `data`**:
  ```ts
  [{ rank: number; title: string; desc: string; score: number; score_desc: string; cover: string | null; type: string; type_desc: string; type_icon: string; url: string }]
  // type_desc: 新/热/null
  ```

#### 2.2.8 `GET /v2/baidu/teleplay` — 百度电视剧榜单

- **CLI**:`rx60s hot baidu-teleplay`
- **参数**:无
- **响应 `data`**:`[{ rank; title; desc; score; score_desc; cover; url }]`

#### 2.2.9 `GET /v2/baidu/tieba` — 百度贴吧热门

- **CLI**:`rx60s hot baidu-tieba`
- **参数**:无
- **响应 `data`**:`[{ rank; title; desc; abstract; score; score_desc; avatar; url }]`

---

### 2.3 `tech` 科技社区

#### 2.3.1 `GET /v2/hacker-news/{type}` — Hacker News

- **路由**:`/hacker-news/new`、`/hacker-news/top`、`/hacker-news/best`
- **CLI**:`rx60s tech hackernews [--type best]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `limit` | number | no | 10(上限 35) | 文章数 |
| `force-update` | flag | no | false | 强制刷新缓存(10 分钟 TTL) |

- **响应 `data`**:`[{ id: number; title: string; score: number; link: string; author: string; created: string; created_at: number }]`
- **⚠️ 上游 bug**:`/hacker-news/new` 在 router.ts:124 被错连到 `handle('top')`,实际返回的是 top 而非 newest。CLI 设计时用 `--type new` 也只能拿到 top;建议 CLI 文档标注「new 实际等同 top(上游 bug)」

#### 2.3.2 其它科技资讯

- `dongchedi`(懂车帝热搜)、`quark`(夸克热点)归类到 `hot`(汽车/综合资讯)。见下。

---

### 2.4 `fun` 趣味文案 / `moyu` 摸鱼

#### 2.4.1 `GET /v2/hitokoto` — 一言

- **CLI**:`rx60s fun hitokoto`(顶层快捷 `rx60s hitokoto`)
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `id` | number | no | 随机 | 指定索引;越界返回 404 |

- **响应 `data`**:`{ index: number; hitokoto: string }`

#### 2.4.2 `GET /v2/duanzi` — 段子

- **CLI**:`rx60s fun duanzi`
- **参数**:`id`(number, 可选,越界 404)
- **响应 `data`**:`{ index: number; duanzi: string }`

#### 2.4.3 `GET /v2/dad-joke` — 冷笑话(英文)

- **CLI**:`rx60s fun dad-joke`
- **参数**:`id`(number, 可选)
- **响应 `data`**:`{ index: number; content: string }`

#### 2.4.4 `GET /v2/fabing` — 发病文学

- **CLI**:`rx60s fun fabing [--name 主人]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `name` | string | no | `主人` | 替换模板里的 `[name]` |
| `id` | number | no | 随机 | 索引 |

- **响应 `data`**:`{ index: number; saying: string }`

#### 2.4.5 `GET /v2/kfc` — 疯狂星期四文案

- **CLI**:`rx60s fun kfc`
- **参数**:无
- **响应 `data`**:`{ index: number; kfc: string }`
- 缓存 1 天

#### 2.4.6 `GET /v2/answer` — 答案之书

- **CLI**:`rx60s fun answer`
- **参数**:`id`(number, 可选)
- **响应 `data`**:`{ ...answerItem, index: number }`(answerItem 含 `answer: string`)

#### 2.4.7 `GET /v2/luck` — 今日运势

- **CLI**:`rx60s fun luck`
- **参数**:`id`(number, 可选)
- **响应 `data`**:
  ```ts
  { luck_desc: string; luck_rank: number; luck_tip: string; luck_tip_index: number }
  // luck_rank: 1-10;luck_tip 从 content 数组随机选一条
  ```

#### 2.4.8 `GET /v2/moyu` — 摸鱼办·打工人日历

- **CLI**:`rx60s fun moyu`(顶层快捷 `rx60s moyu`)
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `date` | string | no | 今天 | 计算指定日期的日历 |

- **响应 `data`**(`MoyuCalendar`):
  ```ts
  {
    date: {
      gregorian: string; weekday: string; dayOfWeek: number
      lunar: { year; month; day: number; yearCN; monthCN; dayCN: string; isLeapMonth: boolean; yearGanZhi; monthGanZhi; dayGanZhi: string; zodiac: string }
    }
    today: { isWeekend; isHoliday; isWorkday: boolean; holidayName: string | null; solarTerm: string | null; lunarFestivals: string[] }
    progress: { week: {passed; total; remaining; percentage}; month: {...}; year: {...} }
    currentHoliday: { name; dayOfHoliday; daysRemaining; totalDays } | null
    nextHoliday: { name; date; until; duration; workdays: string[] } | null
    nextWeekend: { date; weekday; daysUntil } | null
    countdown: { toWeekEnd; toFriday; toMonthEnd; toYearEnd }
    moyuQuote: string
  }
  ```
- 缓存:按 date 内存缓存

---

### 2.5 `music` 音乐

#### 2.5.1 `GET /v2/ncm-rank/list` — 网易云音乐榜单列表

- **CLI**:`rx60s music rank`
- **参数**:无
- **响应 `data`**:
  ```ts
  [{
    id: number; name: string; description: string | null; cover: string
    update_frequency: string; updated: string; updated_at: number
    created: string; created_at: number; link: string
  }]
  ```
- 缓存 30 分钟

#### 2.5.2 `GET /v2/ncm-rank/:id` — 网易云音乐榜单详情

- **CLI**:`rx60s music rank-detail <id>`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `id` | string(路径) | **yes** | — | 榜单 ID(如 `3778678` 热歌榜) |
| `size` | number | no | 36 | text/markdown 输出条数 |

- **响应 `data`**:曲目数组
  ```ts
  [{
    id: number; rank: number; rank_name: string; title: string
    artist: { id; name; cover; link }[]
    album: { id; name; cover; published; published_at; company }
    duration: number; duration_desc: string    // "3:45"
    popularity: number; score: number; fee: number; status: number
    mb: { sq; hq; mq; lq: { size; size_desc; bitrate; extension } | null }  // 音质文件
    link: string
  }]
  ```

#### 2.5.3 `ALL /v2/lyric` — 歌词搜索(QQ 音乐)

- **CLI**:`rx60s music lyric <query> [--clean false]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `query` | string | **yes** | — | 歌曲/歌手关键词;缺失 400 |
| `clean` | boolean(string,`!== 'false'` 为真) | no | true | 过滤词/曲/编曲/copyright 等元信息行 |

- **响应 `data`**:
  ```ts
  {
    title: string; artists: string[]; album: string; offset: number
    lyrics: { ms: number; time: string; label: string; lyric: string }[]  // 按时间戳排序
    formatted: string           // 清洗后纯文本歌词(去时间戳)
    raw_lyric: string           // 原始 LRC
  }
  ```
- 找不到:404 `{ code:404, data:null, message:"未找到歌曲或歌词" }`

#### 2.5.4 `GET /v2/changya` — 唱鸭随机作品

- **CLI**:`rx60s music changya`
- **参数**:无
- **响应 `data`**:
  ```ts
  {
    user: { nickname; gender; avatar_url: string }
    song: { name; singer; lyrics: string[] }
    audio: { url; duration: number; like_count: number; link: string; publish: string; publish_at: number }
  }
  ```
- **特殊编码**:`audio`(302 重定向到音频文件)— CLI 仅取 audio.url 字段

---

### 2.6 `movie` / `epic` 影视游戏

#### 2.6.1 猫眼票房 `GET /v2/maoyan/...`

4 条路由:

| 路由 | CLI | 说明 |
|---|---|---|
| `GET /v2/maoyan/all/movie` | `rx60s movie maoyan-all` | 全球电影票房总榜 |
| `GET /v2/maoyan/realtime/movie` | `rx60s movie maoyan-realtime --type movie` | 今日实时票房 |
| `GET /v2/maoyan/realtime/tv` | `rx60s movie maoyan-realtime --type tv` | 今日实时电视收视 |
| `GET /v2/maoyan/realtime/web` | `rx60s movie maoyan-realtime --type web` | 今日实时网播热度 |

- **参数**(仅 realtime 系列):

| name | type | required | default | desc |
|---|---|---|---|---|
| `date` | string(`YYYYMMDD`) | no | 今天 | 实时数据日期 |

- **响应 `data`**:
  - all/movie:`{ list: [{ rank; maoyan_id; movie_name; release_year; box_office; box_office_desc }]; tip; update_time; update_time_at }`
  - realtime/movie:`{ list: [{ movie_name; box_office_desc; release_info; ... }] }`
  - realtime/tv:`{ list: [{ programme_name; channel_name; market_rate; ... }] }`
  - realtime/web:`{ list: [{ series_name; curr_heat_desc; release_info; ... }] }`
  - 异常:`{ message: "数据异常" }`

#### 2.6.2 豆瓣一周口碑榜 `GET /v2/douban/weekly/{category}`

5 个分类:

| 路由 | CLI | 说明 |
|---|---|---|
| `/douban/weekly/movie` | `rx60s movie douban --cat movie` | 一周口碑电影榜 🎬 |
| `/douban/weekly/tv_chinese` | `rx60s movie douban --cat tv_chinese` | 国内剧集榜 📺 |
| `/douban/weekly/tv_global` | `rx60s movie douban --cat tv_global` | 全球剧集榜 🌍 |
| `/douban/weekly/show_chinese` | `rx60s movie douban --cat show_chinese` | 国内综艺榜 🎤 |
| `/douban/weekly/show_global` | `rx60s movie douban --cat show_global` | 全球综艺榜 🌍 |

- **参数**:无(category 由路径选)
- **响应 `data`**:最多 10 条
  ```ts
  [{
    rank; title; id; rating; rating_count; good_rate
    trend: "up"|"down"|"equal"; rank_change: number
    card_subtitle; description; cover; cover_proxy; url; tags: string[]
  }]
  // cover_proxy 把 doubanio 主机改写为 doubanio.viki.moe
  ```

#### 2.6.3 `GET /v2/epic` — Epic Games 免费游戏

- **CLI**:`rx60s movie epic`
- **参数**:无
- **响应 `data`**:数组
  ```ts
  [{
    id; title: string             // "Mystery Game" 本地化为"神秘游戏"
    cover; original_price: number // 元,已 /100
    original_price_desc: string   // "¥99"
    description; seller
    is_free_now: boolean
    free_start; free_start_at: number; free_end; free_end_at: number
    link                          // store.epicgames.com/store/zh-CN/p/{slug}
  }]
  ```
- 按 promotion 开始日期 + 标题排序;只含 100% off 的 OTHERS/BASE_GAME

---

### 2.7 `life` 生活服务

#### 2.7.1 `GET /v2/weather/realtime` — 实时天气

- **CLI**:`rx60s life weather [北京]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `query` | string | no | `北京` | 城市/地区搜索词 |
| `city` | string | no | — | 精确匹配城市名 |
| `province` | string | no | — | 精确匹配省份名 |

- **响应 `data`**:
  ```ts
  {
    location: { name; province; city; county }
    weather: {
      condition; condition_code; temperature; humidity; pressure
      precipitation; wind_direction; wind_power; weather_icon
      weather_colors: string[]; updated; updated_at
    }
    air_quality: { aqi; level; quality; pm25; pm10; co; no2; o3; so2; rank; total_cities; updated; updated_at } | null
    sunrise: { sunrise; sunrise_at; sunrise_desc; sunset; sunset_at; sunset_desc } | null
    life_indices: { key; name; level; description }[]
    alerts: { type; level; level_code; province; city; county; detail; updated; updated_at }[]
  }
  ```
- 城市未找到:404

#### 2.7.2 `GET /v2/weather/forecast` — 天气预报

- **CLI**:`rx60s life forecast [北京] [--days 7]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `query` | string | no | `北京` | 城市搜索词 |
| `days` | int | no | 7 | 预报天数(日预报上限 8,日出日落上限 15) |
| `city` / `province` | string | no | — | 精确匹配 |

- **响应 `data`**:
  ```ts
  {
    location: { name; province; city; county }
    hourly_forecast: { datetime; temperature; condition; condition_code; wind_direction; wind_power; weather_icon }[]  // ≤48
    daily_forecast: { date; day_condition; day_condition_code; night_condition; night_condition_code; max_temperature; min_temperature; day_wind_direction; day_wind_power; night_wind_direction; night_wind_power; aqi; aqi_level; air_quality; day_weather_icon; night_weather_icon }[]  // ≤min(days,8)
    sunrise_sunset: { sunrise; sunrise_at; sunrise_desc; sunset; sunset_at; sunset_desc }[]  // ≤min(days,15)
  }
  ```

#### 2.7.3 `ALL /v2/fuel-price` — 今日油价

- **CLI**:`rx60s life fuel-price [--region 北京]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `region` | string | no | `北京` | 区域名(后缀匹配,如"北京"、"广东") |
| `force-update` | any | no | — | truthy 即强制刷新 |

- **响应 `data`**:
  ```ts
  {
    region: string
    trend: {
      next_adjustment_date: string; direction: string    // 上调/下调/搁浅
      change_ton: number; change_ton_desc: string
      change_liter_min; change_liter_max: number; change_liter_desc: string
      description: string
    } | null
    items: { name: string; price: number; price_desc: string }[]
    link: string; updated: string; updated_at: number
  }
  ```
- 不支持区域:400;缓存 60 分钟

#### 2.7.4 `GET /v2/gold-price` — 贵金属/金价

- **CLI**:`rx60s life gold-price`
- **参数**:无
- **响应 `data`**:
  ```ts
  {
    date: string                     // YYYY-MM-DD
    metals: { name; sell_price; today_price; high_price; low_price; unit; updated; updated_at }[]
    stores: { brand; product; price; unit; formatted; updated; updated_at }[]
    banks: { bank; product; price; unit; formatted; time; updated; updated_at }[]
    recycle: { type; price; unit; formatted; purity; updated; updated_at }[]
  }
  ```

#### 2.7.5 `GET /v2/exchange-rate` — 汇率查询

- **CLI**:`rx60s life exchange-rate [--currency CNY]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `currency` | string | no | `CNY` | 基准货币(ISO 4217,如 USD) |

- **响应 `data`**:
  ```ts
  {
    base_code: string; updated; updated_at: number; next_updated; next_updated_at: number
    rates: { currency: string; rate: number }[]
  }
  ```
- 来源 open.er-api.com,按天缓存

#### 2.7.6 `GET /v2/lunar` — 老黄历/万年历

- **CLI**:`rx60s life lunar [--date <date>]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `date` | string | no | 当前(上海时区) | 支持 10 位秒级 / 13 位毫秒级时间戳,或日期字符串 |

- **响应 `data`**(顶层字段,基于 tyme4ts):
  ```ts
  {
    solar: { year; month; day; hour; minute; second; full; full_with_time; week; week_desc; week_desc_short; season*; is_leap_year }
    lunar: { year; month; day; hour; full_with_hour; desc_short; *_desc; is_leap_month }
    stats: { day_of_year; week_of_year; week_of_month; percents; percents_formatted }
    term: { today; stage: { name; position; is_jie; is_qi } }
    zodiac: { year; month; day; hour }
    sixty_cycle: { year; month; day; hour: { heaven_stem; earth_branch; name; name_short } }
    legal_holiday: { name; is_work } | null
    festival: { solar; lunar; both_desc }
    phase: { name; position }
    constellation: { name; name_short }
    taboo: {
      day: { recommends; avoids }
      hour: { hour; hour_short; avoids; recommends }
      hours: { hour; hour_short; recommends; avoids }[]  // 12 时辰
    }
    julian_day: number
    nayin: { year; month; day; hour }
    baizi: { year_baizi; day_baizi }
    fortune: { today_luck; career; money; love }
    constants: { legal_holiday_list; phase_list; zodiac_list; constellation_list; heaven_stems; earth_branches; solar_terms }
  }
  ```

#### 2.7.7 `GET /v2/today-in-history` — 历史上的今天

- **CLI**:`rx60s life today-in-history [--date <date>]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `date` | string(ISO) | no | 当前(上海时区) | 指定日期 |

- **响应 `data`**:
  ```ts
  {
    date: string      // "M-D"
    month: number; day: number
    items: { title; year; description; event_type: "birth"|"death"|"event"; link }[]
    // event_type 区分出生/逝世/事件;按年份升序
  }
  ```

#### 2.7.8 `GET /v2/olympics` — 奥运奖牌榜

- **CLI**:`rx60s life olympics [--id <event-slug>]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `id` | string | no | 进行中的赛事(默认 `milano-cortina-2026`) | 历届赛事 slug;省略或等于进行中赛事则取实时 |

- **响应 `data`**:
  ```ts
  {
    event_id; event_name; start_date; end_date; updated; updated_at
    list: { rank; code; country; gold; silver; bronze; total; flag: string }[]
    // 按 金→银→铜→国家名 排序
  }
  ```
- 未知 id:抛错"暂无 ID 为 {id} 的奥运赛事数据"

#### 2.7.9 `GET /v2/olympics/events` — 历届奥运赛事列表

- **CLI**:`rx60s life olympics-events`
- **参数**:无
- **响应 `data`**:`[{ id; year; name; season: "冬季"|"夏季"; logo; url }]`(只含 Winter/Summer)

---

### 2.8 `tool` 开发者工具

#### 2.8.1 `ALL /v2/hash` — Hash & 编码转换

- **CLI**:`rx60s tool hash <content>`
- **参数**:`content`(string, **required**)
- **响应 `data`**:
  ```ts
  {
    source: string
    md5: string
    sha: { sha1; sha256; sha512 }
    base64: { encoded; decoded }
    url: { encoded; decoded }
    gzip: { encoded; decoded }
    deflate: { encoded; decoded }
    brotli: { encoded; decoded }
  }
  // decoded 字段尝试对 content 解码,失败返回空串
  ```

#### 2.8.2 `GET /v2/qrcode` — 二维码生成

- **CLI**:`rx60s tool qrcode <text> [--size 256] [--level M]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `text` | string | **yes** | — | 编码文本 |
| `size` | int | no | 256 | 图片 px |
| `level` | string | no | `M` | 纠错级别 L/M/Q/H |
| `type` | int | no | — | QR 类型号 |

- **响应 `data`**(仅 json 编码):
  ```ts
  { mime_type: "image/gif"; text: string; base64: string; data_uri: string }
  ```
- 默认 `encoding=image` 直接返回 `image/gif` 二进制;CLI 取 base64/data_uri 字段

#### 2.8.3 `ALL /v2/og` — Open Graph 解析

- **CLI**:`rx60s tool og <url>`
- **参数**:`url`(string, **required**;无协议头自动补 `https://`)
- **响应 `data`**:`{ title: string; image: string; description: string }`
- 非 HTML/无效 URL:400/500

#### 2.8.4 `GET /v2/whois` — 域名 WHOIS

- **CLI**:`rx60s tool whois <domain>`
- **参数**:`domain`(string, **required**;支持子域/协议头,自动提取根域,支持中文域名)
- **响应 `data`**(`WhoisData`):
  ```ts
  {
    domain; unicode_domain; punycode_domain
    status: string[]; registrar: string
    registrant: { name; organization; email; country }
    nameservers: string[]; dnssec: boolean | string
    created; created_at; updated; updated_at; expires; expires_at
    duration: number; duration_desc: string    // 如 "3 年 120 天"
  }
  ```
- 未注册/失败:400;5 分钟 LRU 缓存

#### 2.8.5 `GET /v2/ip` — IP 地址查询

- **CLI**:`rx60s tool ip [--ip <ip>]`
- **参数**:`ip`(string, 可选;省略则用请求头 IP,本地 IP 回退公网)
- **响应 `data`**(`IpInfo`):
  ```ts
  {
    ip; continent; country; zipcode; timezone; accuracy; owner; isp; source
    areacode; adcode; asnumber; lat; lng; radius; prov; city; district
  }
  // 注:当前 ip.sb 源下 prov/city/district 等部分字段为空串
  ```

#### 2.8.6 `GET /v2/password` — 随机密码生成

- **CLI**:`rx60s tool password [--length 16] [开关 flags]`
- **参数**(全可选):

| name | type | default | desc |
|---|---|---|---|
| `length` | int | 16(范围 4–128) | 密码长度 |
| `numbers` | bool string | 包含 | 包含数字;`false`/`0` 关 |
| `symbols` | bool string | 不包含 | 包含特殊符号;`true`/`1` 开 |
| `lowercase` | bool string | 包含 | 包含小写 |
| `uppercase` | bool string | 包含 | 包含大写 |
| `exclude_similar` | bool string | `true` | 排除相似字符 il1Lo0O |
| `exclude_ambiguous` | bool string | `true` | 排除模糊字符 {}[]()/等 |

- **响应 `data`**(`PasswordResult`):
  ```ts
  {
    password: string; length: number
    config: { include_numbers; include_symbols; include_lowercase; include_uppercase; exclude_similar; exclude_ambiguous }
    character_sets: { lowercase; uppercase; numbers; symbols; used_sets: string[] }
    generation_info: { entropy; strength; time_to_crack }
  }
  ```

#### 2.8.7 `GET /v2/password/check` — 密码强度检测

- **CLI**:`rx60s tool password-check <password>`
- **参数**:`password`(string, **required**, ≤128)
- **响应 `data`**(`PasswordStrengthResult`):
  ```ts
  {
    password; length; score: number          // 0-100
    strength: string                         // 极弱/弱/中等/强/极强
    entropy: number; time_to_crack: string
    character_analysis: { has_lowercase; has_uppercase; has_numbers; has_symbols; has_repeated; has_sequential; character_variety }
    recommendations: string[]; security_tips: string[]
  }
  ```

#### 2.8.8 `GET /v2/color/random` — 颜色信息/格式转换

- **CLI**:`rx60s tool color [color]`
- **参数**:`color`(string, 可选;HEX 如 `#FF5733`/`FF5733`,3/6 位;省略随机)
- **响应 `data`**:
  ```ts
  {
    hex: string; name: string                // 色系名如"红色系"
    rgb: { r; g; b; string }; hsl: { h; s; l; string }; hsv: {...}; cmyk: {...}; lab: {...}
    brightness: number                       // 0-255
    contrast: { white: number; black: number }
    accessibility: { aa_normal; aa_large; aaa_normal; aaa_large: boolean; best_text_color: string }
    complementary: string; analogous: string[]; triadic: string[]
  }
  ```
- **特殊编码**:`html`(完整可视化页)— CLI 跳过

#### 2.8.9 `GET /v2/color/palette` — 配色方案

- **CLI**:`rx60s tool color-palette [color]`
- **参数**:`color`(string, 可选;省略随机)
- **响应 `data`**:
  ```ts
  {
    input: { hex; rgb; hsl; name }
    palettes: { name; description; colors: { hex; name; role; theory }[] }[]
    // 含:单色/互补/邻近/三角/分裂互补/四边形/Web设计/暖色/冷色(暖冷仅对应色系时)
    metadata: { color_theory: string; total_palettes: number; applications: string[] }
  }
  ```

#### 2.8.10 `GET /v2/chemical` — 化学物质信息

- **CLI**:`rx60s tool chemical [--id <id>]`
- **参数**:`id`(string/number, 可选;省略随机 1–60000000)
- **响应 `data`**:
  ```ts
  {
    id: number; name: string; mass: number | ''
    formula: string; image: string          // 结构式图 URL
    monoisotopicMass: number | ''
  }
  ```

#### 2.8.11 `ALL /v2/fanyi` — 有道翻译

- **中文名**:有道翻译(调用有道网页翻译接口)
- **CLI**:`rx60s tool fanyi <text> [--from auto] [--to auto]`
- **参数**(支持 query 和 body):

| name | type | required | default | desc |
|---|---|---|---|---|
| `text` | string | **yes** | — | 待翻译文本;缺失返回 400 |
| `from` | string | no | `auto` | 源语言代码(须为 `/fanyi/langs` 列表中的值或 `auto`) |
| `to` | string | no | `auto` | 目标语言代码 |

- **响应 `data`**(翻译成功):
  ```ts
  {
    source: { text: string; type: string; type_desc: string; pronounce: string }
    target: { text: string; type: string; type_desc: string; pronounce: string }
    // type 是语言代码(如 zh-CHS/en);type_desc 是中文名(如"中文"/"英语")
  }
  ```
- 语言无效:400 `"不支持的语言类型,请通过 /fanyi/langs 接口查询支持的语言类型"`
- 翻译服务异常:500 `"翻译服务异常,调试信息: ..."`
- **特殊编码**:`text`(仅译文)、`markdown`(原文/译文/发音/语言)

#### 2.8.12 `ALL /v2/fanyi/langs` — 翻译支持语言列表

- **中文名**:有道翻译支持的语言列表
- **CLI**:`rx60s tool fanyi-langs`
- **参数**:无
- **响应 `data`**:语言对象数组,按字母(alphabet)排序
  ```ts
  [{ label: string; code: string; alphabet: string }[]]
  // label: 中文名(如"中文");code: 语言代码(如 zh-CHS);alphabet: 排序字母(如 Z)
  ```
- 语言列表来源:有道 `api-overmind.youdao.com` 接口,失败回退内置 `langs.json`(common 5 + specify 109 种)

---

### 2.9 `kb` 知识库

#### 2.9.1 `GET /v2/baike` — 百度百科

- **CLI**:`rx60s kb baike <word>`
- **参数**:`word`(string, **required**)
- **响应 `data`**:
  ```ts
  {
    title; description; abstract; cover: string
    has_other: boolean; link: string
  }
  ```
- 未找到:404 `{ data: null, code: 404, msg: "未找到相关词条" }`

#### 2.9.2 `GET /v2/awesome-js` — JS 面试题

- **CLI**:`rx60s kb js-question [--id <id>]`
- **参数**:`id`(int, 可选;省略随机)
- **响应 `data`**(`JavaScriptQuestion`):
  ```ts
  { id: number; question: string; code?: string; options: string[]; answer: string; explanation: string }
  ```
- 指定 id 不存在:404

---

### 2.10 `health` 健康

#### 2.10.1 `GET /v2/health` — 健康评估报告

- **CLI**:`rx60s health assess --height <cm> --weight <kg> --gender <male|female> --age <years>`
- **参数**(全 **required**):

| name | type | range | desc |
|---|---|---|---|
| `height` | number | 50–300 | 身高 cm |
| `weight` | number | 10–300 | 体重 kg |
| `gender` | string | `male`/`female` | 性别 |
| `age` | int | 1–150 | 年龄 |

- **响应 `data`**(`HealthResult`):
  ```ts
  {
    basic_info: { height; weight; gender; age (各含 *_desc) }
    bmi: { value; category; evaluation; risk (含 *_desc) }
    weight_assessment: { ideal_weight_range; standard_weight; status; adjustment }
    metabolism: { bmr; tdee; recommended_calories; weight_loss_calories; weight_gain_calories }
    body_surface_area: { value; formula }
    body_fat: { percentage; category; fat_weight; lean_weight }
    health_advice: { daily_water_intake; exercise_recommendation; nutrition_advice; health_tips: string[] }
    ideal_measurements: { chest; waist; hip; note }
    disclaimer: string
  }
  ```
- 注:根级 `GET /health` 返回 "ok" 是健康检查,与此不同

---

### 2.11 其它(独立接口)

#### 2.11.1 `GET /v2/bing` — 必应每日壁纸

- **CLI**:`rx60s bing`(顶层快捷)
- **参数**:无
- **响应 `data`**:
  ```ts
  {
    title; headline; description
    cover: string            // 1920x1080
    cover_4k: string         // UHD
    main_text: string        // QuickFact.MainText
    copyright: string
    update_date: string; update_date_at: number
  }
  ```
- 抓取失败:500 `{ code:500, message:"获取数据失败...", data:null }`
- **特殊编码**:`image`(重定向 cover) / `image-4k`(重定向 cover_4k)

#### 2.11.2 `GET /v2/dongchedi` — 懂车帝热搜

- **CLI**:`rx60s hot dongchedi`(归 hot namespace)
- **参数**:无
- **响应 `data`**:`[{ rank; title; url; score; score_desc }]`(score_desc ≥10000 显示 `N.Nw`)

#### 2.11.3 `GET /v2/quark` — 夸克热点

- **CLI**:`rx60s hot quark`(归 hot namespace)
- **参数**:无
- **响应 `data`**(`QuarkHotItem[]`,≤50):
  ```ts
  [{
    id; title; summary; content; source; published; published_at
    cover; images: { url; width; height; type; description? }[]
    category: string[]; tags: string[]
    like_count; share_count; comment_count; link
  }]
  ```

---

### 2.12 `beta` 测试接口(上游标记不稳定)

#### 2.12.1 `GET /v2/beta/kuan` — 酷安热门话题

- **CLI**:`rx60s beta kuan`
- **参数**:无
- **响应 `data`**(`KuanApiResponse`):
  ```ts
  {
    topics: {
      id; title; description; logo; cover; url
      followers; comments; hotness
      rating: { score: number; total: number }
      created; created_at; updated; updated_at
    }[]
    total: number; updated; updated_at
  }
  ```

#### 2.12.2 `GET /v2/beta/qq/profile` — QQ 用户信息

- **CLI**:`rx60s beta qq <qq> [--size 0]`
- **参数**:

| name | type | required | default | desc |
|---|---|---|---|---|
| `qq` | string | **yes** | — | QQ 号(5–11 位数字) |
| `size` | int | no | 0 | 头像尺寸,须为 `[0,40,100,160,640]` 之一 |

- **响应 `data`**(`QQUserInfo`):
  ```ts
  { qq: string; nickname: string; avatar_url: string; avatar_size: number }
  ```
- 无效 qq/size:400
- **特殊编码**:`image`(302 重定向到头像)— CLI 取 avatar_url 字段

---

## 3. 接口总览表(快速索引)

| # | 路由 | namespace | CLI 命令 | 中文名 | 参数 |
|---|---|---|---|---|---|
| 1 | `GET /60s` | news | `news today` | 每天 60 秒 | date?, force-update? |
| 2 | `GET /60s/rss` | news | `news rss` | 60s RSS | — |
| 3 | `GET /ai-news` | news | `news ai` | AI 资讯 | date?, all? |
| 4 | `GET /it-news` | news | `news it` | IT 之家资讯 | limit? |
| 5 | `GET /it-news/rank` | news | `news it-rank` | IT 排行榜 | type? |
| 6 | `GET /weibo` | hot | `hot weibo` | 微博热搜 | — |
| 7 | `GET /zhihu` | hot | `hot zhihu` | 知乎热搜 | — |
| 8 | `GET /toutiao` | hot | `hot toutiao` | 头条热搜 | — |
| 9 | `GET /douyin` | hot | `hot douyin` | 抖音热搜 | — |
| 10 | `GET /bili` | hot | `hot bili` | B 站热搜 | — |
| 11 | `GET /rednote` | hot | `hot rednote` | 小红书热点 | — |
| 12 | `GET /baidu/hot` | hot | `hot baidu-hot` | 百度热搜 | — |
| 13 | `GET /baidu/teleplay` | hot | `hot baidu-teleplay` | 百度电视剧榜 | — |
| 14 | `GET /baidu/tieba` | hot | `hot baidu-tieba` | 百度贴吧热门 | — |
| 15 | `GET /dongchedi` | hot | `hot dongchedi` | 懂车帝热搜 | — |
| 16 | `GET /quark` | hot | `hot quark` | 夸克热点 | — |
| 17 | `GET /hacker-news/top` | tech | `tech hackernews` | HN Top | limit?, force-update? |
| 18 | `GET /hacker-news/best` | tech | `tech hackernews --type best` | HN Best | limit?, force-update? |
| 19 | `GET /hacker-news/new` | tech | `tech hackernews --type new` | HN New ⚠️bug | limit?, force-update? |
| 20 | `GET /hitokoto` | fun | `fun hitokoto` | 一言 | id? |
| 21 | `GET /duanzi` | fun | `fun duanzi` | 段子 | id? |
| 22 | `GET /dad-joke` | fun | `fun dad-joke` | 冷笑话 | id? |
| 23 | `GET /fabing` | fun | `fun fabing` | 发病文学 | name?, id? |
| 24 | `GET /kfc` | fun | `fun kfc` | 疯狂星期四 | — |
| 25 | `GET /answer` | fun | `fun answer` | 答案之书 | id? |
| 26 | `GET /luck` | fun | `fun luck` | 今日运势 | id? |
| 27 | `GET /moyu` | fun | `fun moyu` | 摸鱼日历 | date? |
| 28 | `GET /ncm-rank/list` | music | `music rank` | 网易云榜单列表 | — |
| 29 | `GET /ncm-rank/:id` | music | `music rank-detail` | 网易云榜单详情 | id, size? |
| 30 | `ALL /lyric` | music | `music lyric` | 歌词搜索 | query, clean? |
| 31 | `GET /changya` | music | `music changya` | 唱鸭作品 | — |
| 32 | `GET /maoyan/all/movie` | movie | `movie maoyan-all` | 全球票房榜 | — |
| 33 | `GET /maoyan/realtime/movie` | movie | `movie maoyan-realtime` | 实时票房 | date? |
| 34 | `GET /maoyan/realtime/tv` | movie | `movie maoyan-realtime --type tv` | 实时收视 | date? |
| 35 | `GET /maoyan/realtime/web` | movie | `movie maoyan-realtime --type web` | 实时网播 | date? |
| 36 | `GET /douban/weekly/movie` | movie | `movie douban` | 豆瓣电影榜 | — |
| 37 | `GET /douban/weekly/tv_chinese` | movie | `movie douban --cat tv_chinese` | 豆瓣国内剧 | — |
| 38 | `GET /douban/weekly/tv_global` | movie | `movie douban --cat tv_global` | 豆瓣全球剧 | — |
| 39 | `GET /douban/weekly/show_chinese` | movie | `movie douban --cat show_chinese` | 豆瓣国内综艺 | — |
| 40 | `GET /douban/weekly/show_global` | movie | `movie douban --cat show_global` | 豆瓣全球综艺 | — |
| 41 | `GET /epic` | movie | `movie epic` | Epic 免费游戏 | — |
| 42 | `GET /weather/realtime` | life | `life weather` | 实时天气 | query?, city?, province? |
| 43 | `GET /weather/forecast` | life | `life forecast` | 天气预报 | query?, days?, city?, province? |
| 44 | `ALL /fuel-price` | life | `life fuel-price` | 今日油价 | region?, force-update? |
| 45 | `GET /gold-price` | life | `life gold-price` | 贵金属金价 | — |
| 46 | `GET /exchange-rate` | life | `life exchange-rate` | 汇率查询 | currency? |
| 47 | `GET /lunar` | life | `life lunar` | 老黄历 | date? |
| 48 | `GET /today-in-history` | life | `life today-in-history` | 历史上的今天 | date? |
| 49 | `GET /olympics` | life | `life olympics` | 奥运奖牌榜 | id? |
| 50 | `GET /olympics/events` | life | `life olympics-events` | 历届奥运 | — |
| 51 | `ALL /hash` | tool | `tool hash` | Hash/编码 | content |
| 52 | `GET /qrcode` | tool | `tool qrcode` | 二维码 | text, size?, level?, type? |
| 53 | `ALL /og` | tool | `tool og` | OG 解析 | url |
| 54 | `GET /whois` | tool | `tool whois` | 域名 WHOIS | domain |
| 55 | `GET /ip` | tool | `tool ip` | IP 查询 | ip? |
| 56 | `GET /password` | tool | `tool password` | 密码生成 | length?, 多个开关 |
| 57 | `GET /password/check` | tool | `tool password-check` | 密码检测 | password |
| 58 | `GET /color/random` | tool | `tool color` | 颜色信息 | color? |
| 59 | `GET /color/palette` | tool | `tool color-palette` | 配色方案 | color? |
| 60 | `GET /chemical` | tool | `tool chemical` | 化学物质 | id? |
| 61 | `ALL /fanyi` | tool | `tool fanyi` | 有道翻译 | text, from?, to? |
| 62 | `ALL /fanyi/langs` | tool | `tool fanyi-langs` | 翻译语言列表 | — |
| 63 | `GET /baike` | kb | `kb baike` | 百度百科 | word |
| 64 | `GET /awesome-js` | kb | `kb js-question` | JS 面试题 | id? |
| 65 | `GET /health` | health | `health assess` | 健康评估 | height, weight, gender, age |
| 66 | `GET /bing` | —(顶层) | `bing` | 必应壁纸 | — |
| 67 | `GET /beta/kuan` | beta | `beta kuan` | 酷安热门 | — |
| 68 | `GET /beta/qq/profile` | beta | `beta qq` | QQ 信息 | qq, size? |

> **合计**:68 条接口(含路径变体),来自 49 个模块文件。其中 `dy-parser` 模块未注册(空实现),不计入。

---

## 4. 上游已知问题(CLI 实现时注意)

1. **`hacker-news/new` 路由错连**:router.ts:124 把 `/hacker-news/new` 连到 `handle('top')`,实际返回 top。CLI 用 `--type new` 也只能拿到 top。→ CLI 文档标注,或向上游提 issue。
2. **`douyin` `event_time_at` 未 ×1000**:`new Date(秒级时间戳).getTime()` 得到错误毫秒值。→ CLI 实现时若用该字段需 ×1000 修正,或仅用 `event_time` 字符串。
3. **`60s-rss` 不走 JSON 包装**:返回 `application/xml`。CLI 需独立 XML→结构化解析。
4. **`fabing` index 反查不可靠**:模板替换后用字符串反查 index,若 name 与模板内容冲突会算错。
5. **`ip` 部分字段为空**:ip.sb 数据源下 prov/city/district 等可能为空串。
6. **`kuan` / `qq` 在 beta 前缀**:上游明确标记不稳定,CLI 标注「实验性」。

---

## 5. CLI 实现备注(给后续编码)

- **数据源/baseUrl**:可配置(默认 `https://60s.viki.moe`),通过 `--base-url` 或环境变量 `RX60S_BASE_URL`。生产建议自部署。
- **响应解包**:所有 JSON 接口需从 `{ code, message, data }` 解包取 `data`。`code !== 200` 视为错误(`errorOnStatus` 配 400→validation、404→not_found、500→server_error)。
- **encoding 默认 json**:CLI 统一请求 `?encoding=json` 拿结构化数据;text/markdown 由 CLI 本地用 `printTable` 渲染。
- **二进制/重定向输出**(image/audio/html/image-proxy):CLI 不直接产出二进制,只暴露对应 URL/base64 字段(如 qrcode 的 data_uri、bing 的 cover、changya 的 audio.url)。
- **无需鉴权**:全公开接口,不挂 auth 插件。
- **分页**:多数热搜接口上游固定条数(≤30/≤50),无需 pagination;`hacker-news`/`it-news` 用 `limit` 参数控制。
