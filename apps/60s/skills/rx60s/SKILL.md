---
name: rx60s
description: 每天 60 秒读懂世界 · 开放数据查询 CLI(rx60s):每日新闻、微博/知乎/抖音/B站等各平台热搜、AI/IT 资讯、实时天气与预报、今日油价、贵金属金价、汇率、老黄历/万年历、历史上的今天、奥运奖牌、有道翻译、二维码生成、密码生成与检测、域名 WHOIS、IP 归属、百度百科、JS 面试题、BMI 健康评估、Hacker News、网易云音乐榜单与歌词、猫眼票房、豆瓣口碑榜、Epic 免费游戏、一言/段子/运势等 60+ 接口。数据源 vikiboss/60s 开源项目,全免费、无需登录。用户提到 新闻/热搜/天气/油价/金价/汇率/老黄历/历史上的今天/翻译/二维码/密码/WHOIS/IP/BMI/一言/段子/Epic免费游戏 等任意日常数据或资讯需求时使用——即使用户没明说 60s 或 rx60s。
metadata:
  requires:
    bins: ["rx60s"]
  category: data
---

# rx60s —— 每天 60 秒读懂世界 · 开放数据

rx60s 是 [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目的命令行封装(基于 `@renxqoo/agent-data-cli` 框架),通过公开 API 免费获取新闻资讯、热搜榜单、天气、油价、翻译、密码工具等 60+ 类数据,**无需登录、无需 API key**。所有数据归上游原项目及原始数据源所有,本项目仅做 CLI 化。输出 JSON 统一格式(`{ok, source, data, meta}`)便于 agent 解析与管道串联。

## 安装与运行

```bash
npx @renxqoo/rx60s-cli install  # 一键安装(同步 skill 到 ~/.agents/skills/)
# 或直接用(已全局安装)
rx60s 60s                       # 今天有什么新闻?
```

## 全局约定

### 输出格式

默认 JSON 统一输出(agent / 管道用):

```json
{ "ok": true, "source": "rx60s", "data": { ... }, "meta": { ... } }
```

人类可读(终端用)加 `--no-json`(框架渲染表格/卡片;**管道下游时强制 JSON**,保护下游解析):

```bash
rx60s 60s --no-json             # 卡片式新闻
rx60s hot weibo --no-json       # 热搜表格
```

### 数据源

数据来自 [vikiboss/60s](https://github.com/vikiboss/60s) 开源项目(MIT License © Viki),数据版权归原项目及原始数据源所有。默认公共实例 `https://60s.viki.moe`(有限流)。生产建议自部署后用环境变量切换:

```bash
RX60S_BASE_URL=https://your-60s.example.com/v2 rx60s 60s
```

## 典型用法

> 完整命令清单见下方 AUTO-GEN 命令表;每类命令的完整参数、枚举值、返回字段见对应 `references/<域>.md`。**构造精确调用或解析返回字段前,先读对应 reference**。

```bash
rx60s 60s                            # 今天有什么新闻(项目核心)
rx60s hot weibo                      # 微博热搜
rx60s life weather 北京              # 实时天气(位置参数:城市名)
rx60s life forecast 上海 --days 5    # 天气预报
rx60s life fuel-price --region 广东  # 今日油价
rx60s tool fanyi "hello" --to zh-CHS # 有道翻译
rx60s tool password --length 20 --symbols  # 生成含符号密码
rx60s life lunar                     # 今日老黄历
rx60s moyu                           # 摸鱼日历(离放假还有几天)
```

## 何时用

| 用户说 | 命令 |
|--------|------|
| "今天有什么新闻" / "60 秒" / "读懂世界" | `rx60s 60s` |
| "微博热搜" / "知乎热榜" / "现在什么火" | `rx60s hot weibo` / `hot zhihu` |
| "北京天气" / "上海天气怎么样" | `rx60s life weather 北京` |
| "今天油价" / "广东 95 号多少钱" | `rx60s life fuel-price --region 广东` |
| "金价" / "黄金多少钱一克" | `rx60s life gold-price` |
| "美元汇率" / "人民币兑日元" | `rx60s life exchange-rate --currency USD` |
| "今天宜什么" / "老黄历" / "农历几号" | `rx60s life lunar` |
| "历史上的今天" | `rx60s life today-in-history` |
| "翻译 hello 到中文" | `rx60s tool fanyi hello --to zh-CHS` |
| "生成一个 20 位密码" | `rx60s tool password --length 20` |
| "查 baidu.com 的 whois" | `rx60s tool whois baidu.com` |
| "我的 IP 是哪里的" | `rx60s tool ip` |
| "必应今日壁纸" | `rx60s bing` |
| "来一句一言" / "随机句子" | `rx60s hitokoto` |
| "摸鱼" / "离放假还有几天" | `rx60s moyu` |
| "今天运势" / "抽个签" | `rx60s fun luck` |
| "网易云热歌榜" / "榜单上的歌" | `rx60s music rank`(查 ID)→ `music rank-detail <id>` |
| "豆瓣口碑电影" / "本周好看的电影" | `rx60s movie douban`(默认电影榜) |
| "Epic 免费游戏" / "这周送什么游戏" | `rx60s movie epic` |

## 易踩坑提示(参数默认值/非显然值)

这些点光看 `--help` 容易踩坑,优先查 reference:

- **`tool password` 的 `--symbols` 默认关**:用户要"含特殊符号的密码"必须显式加 `--symbols`,否则只生成字母+数字。其它(`--numbers`/`--lowercase`/`--uppercase`)默认开。
- **`tool fanyi` 目标语言代码**:`中文=zh-CHS`、英语=en、日语=ja、韩语=ko、法语=fr、德语=de、俄语=ru。完整列表跑 `tool fanyi-langs`(不能瞎猜代码)。
- **`life weather` 城市是位置参数**:`rx60s life weather 上海`(不是 `--query 上海`)。
- **`music rank-detail` 要先拿 ID**:榜单 ID(如 3778678 热歌榜)从 `music rank` 列表里取,不能瞎编。
- **`tool color` 用 `--color`**:`rx60s tool color --color "#FF5733"`(注意是 flag 不是位置参数)。

## 前置条件

- **无需登录**:rx60s 是公开数据 CLI,无鉴权。直接调用即可。
- 数据源为公共实例时可能限流(429),稍后重试或自部署(设 `RX60S_BASE_URL`)。

## 错误处理

| 错误 | 含义 | 处理 |
|------|------|------|
| `not_found` / exit 1 | 接口或记录不存在(如越界的 `--id`、不存在的城市) | 检查参数;用 `list` 类命令查有效值 |
| `invalid_argument` / exit 2 | 参数不合法(如缺必填、值超范围) | 看 `--help` 或 reference 查参数约束 |
| exit 4 网络错误 | 连不上数据源 | 稍后重试;确认网络 |
| `rate_limited` / exit 1 (429) | 公共实例限流 | 稍后重试,或自部署设 `RX60S_BASE_URL` |
| `server_error` / exit 1 (5xx) | 上游服务异常 | 稍后重试 |

## 输出示例

```bash
$ rx60s hitokoto --json
{"ok":true,"source":"rx60s","data":{"index":2403,"hitokoto":"一过岁,不就是老女人了嘛!"}}

$ rx60s tool fanyi hello --to zh-CHS --json
{"ok":true,"source":"rx60s","data":{"source":{"text":"hello","type":"en","type_desc":"英语"},"target":{"text":"你好","type":"zh-CHS","type_desc":"中文"}}}
```

## 按需深读 references

构造精确命令或解析返回字段时,读对应文件:

| 需求 | 文件 |
| --- | --- |
| news 各接口参数与返回字段 | `references/news.md` |
| hot 各平台热搜字段差异 | `references/hot.md` |
| life 天气/油价/金价/汇率/老黄历字段 | `references/life.md` |
| tool 翻译/密码/二维码/WHOIS 字段 | `references/tool.md` |
| fun/music/movie/tech/kb/health/beta 字段 | `references/misc.md` |

<!-- AUTO-GEN:START commands -->
<!-- 本区块由 `rxcli skills gen` 自动生成,不要手改 -->
## 命令

| 操作 | 命令 |
|------|------|
| 每天 60 秒读懂世界(每日新闻摘要 + 微语) | `rx60s 60s [--date <string>] [--forceUpdate]` |
| 必应每日壁纸(标题 + 1080P/4K 封面) | `rx60s bing` |
| 微博实时热搜 | `rx60s weibo` |
| 知乎实时热搜 | `rx60s zhihu` |
| 头条实时热搜 | `rx60s toutiao` |
| 一言(随机短句,可指定 id) | `rx60s hitokoto [--id <number>]` |
| 摸鱼办·打工人日历(节假日/倒计时/进度) | `rx60s moyu [--date <string>]` |
| 每天 60 秒读懂世界(每日新闻摘要 + 微语) | `rx60s news today [--date <string>] [--forceUpdate]` |
| AI 资讯快报(每日 AI 行业新闻) | `rx60s news ai [--date <string>] [--all]` |
| IT 之家实时资讯 | `rx60s news it [--limit <number>]` |
| IT 之家排行榜(日/周/月热榜) | `rx60s news it-rank [--type <string>]` |
| 60s RSS 订阅(近 7 天新闻) | `rx60s news rss` |
| 微博实时热搜 | `rx60s hot weibo` |
| 知乎实时热搜 | `rx60s hot zhihu` |
| 头条实时热搜 | `rx60s hot toutiao` |
| 抖音实时热搜 | `rx60s hot douyin` |
| B 站实时热搜 | `rx60s hot bili` |
| 小红书实时热点 | `rx60s hot rednote` |
| 百度实时热搜 | `rx60s hot baidu-hot` |
| 百度电视剧榜单 | `rx60s hot baidu-teleplay` |
| 百度贴吧热门话题 | `rx60s hot baidu-tieba` |
| 懂车帝热搜 | `rx60s hot dongchedi` |
| 夸克热点新闻 | `rx60s hot quark` |
| Hacker News 文章(top / best) | `rx60s tech hackernews [--type <string>] [--limit <number>] [--forceUpdate]` |
| 一言(随机短句,可指定 id) | `rx60s fun hitokoto [--id <number>]` |
| 段子(随机中文段子) | `rx60s fun duanzi [--id <number>]` |
| 冷笑话(英文 dad joke) | `rx60s fun dad-joke [--id <number>]` |
| 发病文学(模板替换 [name]) | `rx60s fun fabing [--name <string>] [--id <number>]` |
| 肯德基疯狂星期四文案 | `rx60s fun kfc` |
| 答案之书(随机答案) | `rx60s fun answer [--id <number>]` |
| 今日运势(运势等级 + 幸运提示) | `rx60s fun luck [--id <number>]` |
| 摸鱼办·打工人日历(节假日/倒计时/进度) | `rx60s fun moyu [--date <string>]` |
| 网易云音乐榜单列表 | `rx60s music rank` |
| 网易云音乐榜单详情(曲目列表) | `rx60s music rank-detail <id> [--size <number>]` |
| 歌词搜索(QQ 音乐,返回解析后的歌词) | `rx60s music lyric <query> [--clean]` |
| 唱鸭随机翻唱作品(含音频 URL) | `rx60s music changya` |
| 猫眼全球电影票房总榜 | `rx60s movie maoyan-all` |
| 猫眼今日实时票房/收视/网播榜 | `rx60s movie maoyan-realtime [--type <string>] [--date <string>]` |
| 豆瓣一周口碑榜 | `rx60s movie douban [--cat <string>]` |
| Epic Games 免费游戏(当前 + 即将) | `rx60s movie epic` |
| 实时天气(含空气质量/日出日落/预警) | `rx60s life weather [query] [--city <string>] [--province <string>]` |
| 天气预报(逐小时 + 多日 + 日出日落) | `rx60s life forecast [query] [--days <number>] [--city <string>] [--province <string>]` |
| 今日油价(各省汽柴油价格 + 调价预测) | `rx60s life fuel-price [--region <string>] [--forceUpdate]` |
| 贵金属金价(实时行情 + 金店/银行/回收价) | `rx60s life gold-price` |
| 汇率查询(基准货币对其它货币) | `rx60s life exchange-rate [--currency <string>]` |
| 老黄历/万年历(公历农历/干支/宜忌/节气/运势) | `rx60s life lunar [--date <string>]` |
| 历史上的今天(出生/逝世/事件) | `rx60s life today-in-history [--date <string>]` |
| 奥运奖牌榜 | `rx60s life olympics [--id <string>]` |
| 历届奥运赛事列表 | `rx60s life olympics-events` |
| Hash & 编码转换(MD5/SHA/Base64/URL/gzip/...) | `rx60s tool hash <content>` |
| 二维码生成(返回 base64 / data_uri) | `rx60s tool qrcode <text> [--size <number>] [--level <string>]` |
| Open Graph 信息解析(抓取网页 og:title/image/description) | `rx60s tool og <url>` |
| 域名 WHOIS 查询(注册信息,支持中文域名) | `rx60s tool whois <domain>` |
| IP 地址查询(归属/ISP/地理位置) | `rx60s tool ip [--ip <string>]` |
| 随机密码生成(含熵/破解时间评估) | `rx60s tool password [--length <number>] [--numbers] [--symbols] [--lowercase] [--uppercase] [--excludeSimilar] [--excludeAmbiguous]` |
| 密码强度检测(熵/破解时间/改进建议) | `rx60s tool password-check <password>` |
| 颜色信息/格式转换(HEX/RGB/HSL/HSV/CMYK/LAB + 无障碍对比度) | `rx60s tool color [--color <string>]` |
| 配色方案生成(单色/互补/邻近/三角/...) | `rx60s tool color-palette [--color <string>]` |
| 化学物质信息(分子式/分子量/结构式) | `rx60s tool chemical [--id <string>]` |
| 有道翻译 | `rx60s tool fanyi <text> [--from <string>] [--to <string>]` |
| 有道翻译支持的语言列表 | `rx60s tool fanyi-langs` |
| 百度百科词条摘要(标题/描述/封面/链接) | `rx60s kb baike <word>` |
| JavaScript 面试题(含选项/答案/解析) | `rx60s kb js-question [--id <number>]` |
| 健康评估报告(BMI/理想体重/基础代谢/体脂率/建议) | `rx60s health assess --height <number> --weight <number> --gender <string> --age <number>` |
| 酷安热门话题(实验性) | `rx60s beta kuan` |
| QQ 用户信息(昵称 + 头像,实验性) | `rx60s beta qq <qq> [--size <number>]` |
<!-- AUTO-GEN:END -->
