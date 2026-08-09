---
name: rx-stock
description: "A 股股票数据查询 CLI(rxstock):实时行情、K线、分时、分笔、技术指标(MA/MACD/RSI/KDJ/BOLL/ATR)、估值分位、个股综合诊断、财务指标、业绩预告、财报三表(资产负债/利润/现金流)、资金流向、板块(行业/概念/地域)、龙虎榜、北向资金、分红送配、十大股东、股东人数、融资融券、公告、股票搜索与列表。数据源腾讯/东方财富/新浪/同花顺,全免费,多源 fallback。用户提到 A股/股票/行情/报价/K线/分时/技术指标/均线/MACD/RSI/估值/基本面/财报/三表/资产负债表/利润表/现金流量表/资金流/主力资金/板块/行业/概念/龙虎榜/北向资金/沪深股通/分红/送转/股东/融资融券/公告/股票搜索 等任何 A 股数据需求时使用——即使用户没明说 rxstock。"
---

# rxstock —— A 股数据查询

> ⚠️ **免责声明**:本工具仅供学习研究,数据归原始数据源所有,不构成投资建议,投资风险自负。详见项目 README。

rxstock 是 A 股股票数据的命令行工具,通过公开渠道(腾讯/东方财富/新浪/同花顺)免费获取数据,无需 API key,内置多源 fallback + 重试 + TTL 缓存,输出 JSON 统一输出便于 agent 解析。

## 安装与运行

```bash
npx @renxqoo/rxstock install

# 一键安装 skill 到本地 AI 工具(向导)
rxstock install
```

`rxstock install` 是安装向导特殊入口(业务包拦截,非框架路由命令),会把本 skill 同步到 `~/.agents/skills/` 供 AI 工具发现。

## 全局约定

### 代码格式

rxstock 接受多种代码格式,自动判定市场:

| 输入                                 | 解析结果        |
| ------------------------------------ | --------------- |
| `600519`                             | 沪市(默认)      |
| `000001`                             | 深市(默认)      |
| `300750`                             | 深市(创业板)    |
| `688981`                             | 沪市(科创板)    |
| `836473`                             | 北交所(默认)    |
| `sh600519` / `sz000001` / `bj836473` | 显式指定市场    |
| `1.600519` / `0.000001`              | 东财 secid 形态 |
| `600519.SH` / `000001.SZ`            | 行业标准后缀    |

指数代码:`sh000001`(上证)、`sz399001`(深证)、`sz399006`(创业板)、`sh000300`(沪深 300)、`sh000016`(上证 50)、`sh000905`(中证 500)、`sh000688`(科创 50)、`sh000852`(中证 1000)。

板块代码:`BK` 前缀 + 数字(如 `BK1600`),由 `sector list` 返回。

### 输出格式

默认 JSON 统一输出:

```json
{
  "ok": true,
  "identity": "user",
  "data": { ... },
  "meta": { ... }
}
```

人类可读(终端用)加 `--no-json`(框架级 flag,调用命令的 humanFormat;**管道下游时强制 JSON**,避免污染管道):

```bash
rxstock quote 600519 --no-json
```

## 命令总览

> 每条命令的参数、枚举值、默认值、返回字段表见对应 `references/<namespace>.md`。**需要构造精确调用或解析返回字段前,先读对应 reference**。

### 顶层快捷命令

```bash
rxstock quote <code>              # 等价 quote get(单只实时行情)
rxstock search <keyword>          # 等价 stock search(代码/名称/拼音)
```

### quote —— 实时行情

```bash
rxstock quote get <code>                      # 单只(全字段 + 五档盘口)
rxstock quote get <code> --source tencent     # 指定源 tencent|sina|eastmoney
rxstock quote batch 600519,000001             # 批量(逗号分隔,最多 100 只)
```

字段表与 `--source` 行为 → `references/quote.md`

### kline —— K线 / 分时 / 分笔 / 技术指标

```bash
rxstock kline get <code> --period day --limit 30        # 日/周/月 K(默认 day,320 根)
rxstock kline get <code> --period m5                    # 分钟级 m1|m5|m15|m30|m60
rxstock kline get <code> --adjust qfq                   # 复权 none|qfq|hfq
rxstock kline get <code> --start 2026-01-01 --end 2026-06-30  # 日期区间
rxstock kline minute <code>                            # 当日分时走势
rxstock kline tick <code>                              # 当日分笔成交(境内网络)
rxstock kline indicator <code>                         # 技术指标(MA/MACD/RSI/KDJ/BOLL/ATR)
rxstock kline indicator <code> --types macd,rsi        # 指定指标
```

period/adjust 枚举、limit 上限、返回字段 → `references/kline.md`

### stock —— 搜索 / 列表 / 公司信息 / 估值 / 综合诊断

```bash
rxstock stock search 茅台                   # 代码 / 中文名 / 拼音首字母(gzmt)
rxstock stock list                          # 全市场列表(默认 all,按涨幅降序)
rxstock stock list --market sh --sort amount --page 2
rxstock stock info 600519                   # 公司基本信息(总股本/流通股本/上市日期)
rxstock stock valuation 600519              # 估值分位(PE/PB 历史百分位)
rxstock stock diagnosis 600519              # 综合诊断(基本面+技术面+股东一次聚合)
```

list 的 market/sort/page/size/desc、info/valuation/diagnosis 返回字段 → `references/stock.md`

### index —— 指数 / 北向资金

```bash
rxstock index list                # 9 大常用指数清单(含实时行情)
rxstock index get sh000001        # 单个指数实时行情
rxstock index kline sh000300 --period week --limit 20   # 指数 K线
rxstock index northbound          # 北向资金(默认全部,30 天)
rxstock index northbound --type 001 --pageSize 10      # 沪股通(003=深股通,all=全部)
```

指数清单、northbound 参数 → `references/index.md`

### sector —— 板块 / 行业

```bash
rxstock sector list                       # 行业板块(默认)
rxstock sector list --kind concept        # 概念板块(concept|area)
rxstock sector stocks BK1600              # 板块成分股
rxstock sector quote BK1600               # 板块实时行情
```

kind 枚举、分页参数 → `references/sector.md`(注:`sector top` 子命令在源码注释中提及但未实现)

### financial —— 财务 / 财报三表 / 资金面

```bash
# 财务指标与预告
rxstock financial main 600519             # 主要财务指标(连续多期)
rxstock financial forecast 600519         # 业绩预告

# 资金面
rxstock financial fundflow 600519         # 资金流向(境内 push2,境外报错)
rxstock financial lhb                     # 龙虎榜(当日,默认最新)
rxstock financial lhb --date 2026-08-07   # 指定日期
rxstock financial lhb --code 600519       # 指定个股上榜历史
rxstock financial margin 600519           # 融资融券明细

# 财报三表
rxstock financial balancesheet 600519     # 资产负债表
rxstock financial income 600519           # 利润表
rxstock financial cashflow 600519         # 现金流量表

# 股东与分红
rxstock financial dividend 600519         # 分红送配历史
rxstock financial holders 600519          # 十大股东
rxstock financial holdercount 600519      # 股东人数变化

# 公告
rxstock financial announcements 600519    # 个股公告
```

12 个子命令的参数、默认 limit、返回字段 → `references/financial.md`

## 数据源与可用性

| 数据             | 源链(按优先级)                          | 备注 |
| ---------------- | ----------------------------------------- | ---- |
| 实时行情         | 腾讯 → 新浪 → 同花顺 → 东财 push2          | 4 源 fallback,五档盘口仅腾讯完整 |
| 日/周/月 K线     | 腾讯 → 新浪 → 同花顺 → 东财 push2his       | 4 源,复权仅腾讯/东财 |
| 分钟级 K线       | 新浪 → 东财 push2his                       | 2 源 |
| 分时(minute)   | 腾讯(主)→ 东财 push2his                  | 失败会明确报错 |
| 分笔(tick)     | 东财 push2(仅境内)                       | **境外报错** |
| 技术指标/估值/诊断 | 本地基于日K计算 + 东财 datacenter          | 复合命令 |
| 搜索             | 东财 searchapi                            | 单源(带固定 token) |
| 列表 / 板块      | 新浪 → 东财 push2(境内)                   | 新浪境外可用;东财 push2 仅境内 |
| 财务/龙虎榜/分红/股东/三表/两融/北向/公告 | 东财 datacenter(境内外都通) | 单源,datacenter 很稳定 |
| 资金流           | 东财 push2(仅境内)                       | **境外报错** |

**境内外说明:**
- 腾讯 / 新浪 / 同花顺 / 东财 datacenter:境内外网络都通,核心数据有多源 fallback,稳定。
- 东财 push2 / push2his 系列:仅**境内 IP 可用**(境外 HTTP 超时),优先级最低,境外自动回落其他源。
- **资金流、分笔数据只有东财 push2 提供**,境外网络下这两个命令会明确报错(非空数据)。

## 缓存策略

| 数据类型    | TTL     |
| ----------- | ------- |
| 实时行情    | 1.5 秒  |
| 分时        | 30 秒   |
| K 线        | 5 分钟  |
| 列表 / 搜索 | 10 分钟 |
| 财务        | 30 分钟 |

进程内单例缓存 + singleflight(同 key 并发只请求一次)。

## 按需深读 references

需要构造精确命令或解析返回字段时,读对应文件:

| 需求 | 文件 |
| --- | --- |
| 行情完整字段表、batch、`--source` | `references/quote.md` |
| K线 period/adjust 枚举、分时/Tick 区别、技术指标字段 | `references/kline.md` |
| stock list 分页参数、info/valuation/diagnosis 返回结构 | `references/stock.md` |
| 9 大指数清单、northbound 参数与字段 | `references/index.md` |
| sector kind 枚举、板块成分股字段 | `references/sector.md` |
| financial 12 个子命令参数与字段表 | `references/financial.md` |

<!-- AUTO-GEN:START commands -->
<!-- 本区块由 `rxcli skills gen` 自动生成,不要手改 -->
## 命令

| 操作 | 命令 |
|------|------|
| 查询单只股票/指数实时行情 | `rxstock quote <code> [--source <string>]` |
| 搜索股票(支持代码 / 中文名称 / 拼音首字母) | `rxstock search <keyword> [--limit <number>]` |
| 查询单只股票/指数实时行情 | `rxstock quote get <code> [--source <string>]` |
| 批量查询多只股票实时行情(逗号分隔,最多 100 只) | `rxstock quote batch <codes>` |
| 查询 K 线(支持日/周/月/分钟级 + 前/后复权) | `rxstock kline get <code> [--period <string>] [--adjust <string>] [--limit <number>] [--start <string>] [--end <string>]` |
| 当日分时走势(分钟级,含均价) | `rxstock kline minute <code>` |
| 当日分笔成交(tick 级,数据量大) | `rxstock kline tick <code> [--limit <number>]` |
| 技术指标计算(MA均线/MACD/RSI/KDJ/布林带/ATR,本地基于日K计算) | `rxstock kline indicator <code> [--types <string>] [--limit <number>]` |
| 搜索股票(支持代码 / 中文名称 / 拼音首字母) | `rxstock stock search <keyword> [--limit <number>]` |
| 查询股票列表(全市场 / 按市场过滤 / 排序 / 分页) | `rxstock stock list [--market <string>] [--page <number>] [--size <number>] [--sort <string>] [--desc]` |
| 查询公司基本信息(总股本 / 流通股本 / 上市日期 等) | `rxstock stock info <code>` |
| 估值分位(PE/PB 在历史区间的百分位,判断当前贵不贵) | `rxstock stock valuation <code> [--days <number>]` |
| 个股综合诊断(一次性聚合基本面+技术面+股东+估值,深度分析用) | `rxstock stock diagnosis <code>` |
| 常用指数清单(预置 9 个主要指数) | `rxstock index list` |
| 查询单个指数实时行情 | `rxstock index get <code>` |
| 查询指数 K 线 | `rxstock index kline <code> [--period <string>] [--limit <number>]` |
| 查询北向资金(沪深股通成交额/持股市值/领涨股) | `rxstock index northbound [--type <string>] [--pageSize <number>]` |
| 查询板块列表(行业 / 概念 / 地域) | `rxstock sector list [--kind <string>] [--page <number>] [--size <number>]` |
| 查询板块成分股 | `rxstock sector stocks <code> [--page <number>] [--size <number>]` |
| 查询板块实时行情 | `rxstock sector quote <code>` |
| 查询主要财务指标(连续多期,默认 20 期) | `rxstock financial main <code> [--limit <number>]` |
| 查询业绩预告(净利润预增/预减 区间) | `rxstock financial forecast <code> [--limit <number>]` |
| 查询资金流向(主力 / 大单 / 中单 / 小单 净流入) | `rxstock financial fundflow <code> [--limit <number>]` |
| 查询个股公告 | `rxstock financial announcements <code> [--page <number>] [--size <number>]` |
| 查询分红送配历史(送股/转增/派息) | `rxstock financial dividend <code> [--limit <number>]` |
| 查询十大股东(最新一期,持股数/比例/变动) | `rxstock financial holders <code> [--limit <number>]` |
| 查询股东人数变化(筹码集中度趋势) | `rxstock financial holdercount <code> [--limit <number>]` |
| 查询融资融券明细(融资余额/融券余额/买入额) | `rxstock financial margin <code> [--limit <number>]` |
| 查询资产负债表(资产/负债/股东权益明细) | `rxstock financial balancesheet <code> [--limit <number>]` |
| 查询利润表(营收/成本/费用/利润明细) | `rxstock financial income <code> [--limit <number>]` |
| 查询现金流量表(经营/投资/筹资活动现金流) | `rxstock financial cashflow <code> [--limit <number>]` |
| 查询龙虎榜(当日/历史个股上榜,买入卖出净额) | `rxstock financial lhb [--date <string>] [--code <string>] [--pageSize <number>]` |
<!-- AUTO-GEN:END -->
