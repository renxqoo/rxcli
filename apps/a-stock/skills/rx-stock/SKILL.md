---
name: rx-stock
version: 1.1.0
description: "rxstock A 股股票数据查询:实时行情、K 线、分时、财务、财报三表、板块、龙虎榜、北向资金、分红、十大股东、融资融券、搜索、公告。数据源:腾讯/东方财富/新浪/同花顺(全免费,多源 fallback,公开)。"
metadata:
  requires:
    bins: ["rxstock"]
  category: finance
---

# rxstock —— A 股数据查询

> ⚠️ **免责声明**:本工具仅供学习研究,数据归原始数据源所有,不构成投资建议,投资风险自负。详见项目 README。

rxstock 是 A 股股票数据的命令行工具,提供实时行情、K 线、分时走势、个股财务、财报三表、板块数据、龙虎榜、北向资金、分红、股东、融资融券、公告等常用功能。

**特点:**

- 完全免费 —— 通过公开渠道获取数据,无需注册、无需 API key
- 数据全 —— 行情 + K线 + 分时 + 财务 + 财报三表 + 板块 + 龙虎榜 + 北向 + 分红 + 股东 + 两融 + 公告
- 稳定 —— 多数据源自动 fallback(核心数据 3-4 源),内置重试 + TTL 缓存
- agent-friendly —— JSON 信封输出,便于管道组合

## 安装

无需全局安装,用 `npx` 即用即跑:

```bash
npx @renxqoo/rxstock <命令>
```

全局安装:

```bash
npm install -g @renxqoo/rxstock
```

## 命令一览

### 实时行情

```bash
rxstock quote <code>              # 单只实时行情(默认自动 fallback)
rxstock quote get 600519          # 等价上面
rxstock quote batch 600519,000001 # 批量(逗号分隔,最多 100 只)
rxstock quote get 600519 --source eastmoney  # 强制走东财
```

### K 线

```bash
rxstock kline get 600519 --period day --limit 30        # 日 K
rxstock kline get 600519 --period week --limit 20       # 周 K
rxstock kline get 600519 --period month --limit 12      # 月 K
rxstock kline get 600519 --period day --adjust qfq      # 前复权
rxstock kline get 600519 --period day --adjust hfq      # 后复权
rxstock kline minute 600519      # 当日分时图
rxstock kline tick 600519        # 当日分笔成交
```

### 搜索 / 列表 / 公司信息

```bash
rxstock stock search 茅台          # 按名称搜索(支持中文/拼音/代码)
rxstock stock search gzmt          # 拼音首字母
rxstock stock list                # 全市场股票列表
rxstock stock list --market sh    # 只看沪市
rxstock stock list --sort changePercent  # 按涨幅排序
rxstock stock info 600519         # 公司基本信息(总股本/流通股本/上市日期)
```

### 指数 / 北向资金

```bash
rxstock index list                # 常用指数清单(上证/深证/沪深 300/创业板 等 9 个)
rxstock index get sh000001        # 上证指数行情
rxstock index get sz399001        # 深证成指
rxstock index get sh000300        # 沪深 300
rxstock index get sz399006        # 创业板指
rxstock index get sh000688        # 科创 50
rxstock index kline sh000001 --limit 30  # 指数 K 线
rxstock index northbound          # 北向资金(沪深股通成交额/持股市值/领涨股)
rxstock index northbound --type 001  # 仅沪股通(003=深股通,all=全部)
```

### 板块 / 行业

```bash
rxstock sector list                       # 行业板块(默认)
rxstock sector list --kind concept        # 概念板块
rxstock sector list --kind area           # 地域板块
rxstock sector stocks BK1600              # 板块成分股
rxstock sector quote BK1600               # 板块实时行情
```

### 财务 / 财报 / 资金面

```bash
rxstock financial main 600519             # 主要财务指标(连续多期)
rxstock financial forecast 600519         # 业绩预告
rxstock financial fundflow 600519         # 资金流向(主力/大单/中单/小单,境内增强)
rxstock financial announcements 600519    # 个股公告

# 财报三表
rxstock financial balancesheet 600519     # 资产负债表
rxstock financial income 600519           # 利润表
rxstock financial cashflow 600519         # 现金流量表

# 股东与分红
rxstock financial dividend 600519         # 分红送配历史
rxstock financial holders 600519          # 十大股东
rxstock financial holdercount 600519      # 股东人数变化

# 资金面
rxstock financial margin 600519           # 融资融券明细
rxstock financial lhb                     # 龙虎榜(当日,默认最新)
rxstock financial lhb --date 2026-08-07   # 指定日期龙虎榜
rxstock financial lhb --code 600519       # 指定个股上榜历史
```

## 代码格式

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

指数代码也支持:`sh000001`(上证)、`sz399001`(深证)、`sz399006`(创业板)、`sh000300`(沪深 300)、`sh000688`(科创 50)

## 输出模式

默认输出 JSON 信封,适合 agent 解析:

```json
{
  "ok": true,
  "identity": "user",
  "data": { ... },
  "meta": { ... }
}
```

人类可读(终端用):加 `--no-json`

```bash
rxstock quote 600519 --no-json
```

## 数据源

| 数据             | 源链(按优先级)                          | 备注 |
| ---------------- | ----------------------------------------- | ---- |
| 实时行情         | 腾讯 → 新浪 → 同花顺 → 东财push2          | 4 源 fallback |
| 日/周 K线        | 腾讯 → 新浪 → 同花顺 → 东财push2his       | 4 源,复权仅腾讯/东财 |
| 分钟 K线         | 新浪 → 东财push2his                       | 2 源 |
| 分时             | 腾讯(主)→ 东财push2his                  | 分时失败会明确报错 |
| 搜索             | 东财 searchapi                            | 单源(带固定 token) |
| 列表 / 板块      | 新浪 → 东财push2(境内)                   | 新浪境外可用;东财 push2 仅境内 |
| 财务/龙虎榜/分红/股东/三表/两融/北向/公告 | 东财 datacenter(境内外都通) | 单源,datacenter 很稳定 |
| 资金流/分笔      | 东财 push2(仅境内)                      | **境外不可用**,会明确报错 |

**稳定性说明:**

- 腾讯 / 新浪 / 同花顺 / 东财 datacenter:境内外网络都通,核心数据有多源 fallback,稳定。
- 东财 push2 / push2his 系列:仅**境内 IP 可用**(境外 HTTP 超时),作为"境内增强源"保留优先级最低。境外环境会自动回落到其他源。
- 资金流、分笔数据只有东财 push2 提供(东财 datacenter 无此数据),**境外网络下这两个命令会明确报错**而非返回空数据。

## 缓存策略

| 数据类型    | TTL     |
| ----------- | ------- |
| 实时行情    | 1.5 秒  |
| 分时        | 30 秒   |
| K 线        | 5 分钟  |
| 列表 / 搜索 | 10 分钟 |
| 财务        | 30 分钟 |

进程内单例缓存 + singleflight(同 key 并发只请求一次)。
