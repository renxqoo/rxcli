# @renxqoo/rxstock (rxstock)

> A 股股票数据命令行工具 —— 行情/K 线/财务/板块/资金流/公告,完全免费、稳定、生产可用。
>
> 基于 [`@renxqoo/agent-data-cli`](../cli-sdk/README.zh-CN.md) 框架。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

[English](README.md) · [中文](README.zh-CN.md)

---

## ⚠️ 免责声明(使用前必读)

> **本项目仅供学习交流和技术研究使用,不构成任何投资建议。**

1. **数据来源**:本工具通过公开渠道获取 A 股行情数据,数据归各原始数据源所有。本工具不存储、不转售数据,仅作为命令行查询的便利封装。
2. **数据版权**:所有数据的版权归原作者/数据源所有。如有数据源认为本项目侵犯其权益,请通过 [Issues](https://github.com/renxqoo/rxcli/issues) 联系,确认后将在第一时间删除相关代码或下架项目。
3. **投资风险**:股票市场有风险,本工具提供的数据可能存在延迟、错误或缺失。**任何基于本工具数据的投资决策,风险自负**,作者不承担任何责任。
4. **使用限制**:本工具仅供个人学习研究使用,**禁止**用于商业转售、高频量化轰炸数据源、或任何违反数据源使用条款的场景。请合理控制调用频率。
5. **合规义务**:使用者需自行遵守所在地区关于证券数据使用的法律法规。本作者不对使用者的行为承担责任。

> 简言之:**数据是公开的、工具是免费的、用途是学习的、风险是自负的、有异议请联系删除。**

---

## 这是什么

`rxstock` 是一个开箱即用的 A 股股票数据 CLI,把多个公开数据源封装成统一接口,提供实时行情、K 线、分时、财务、板块、资金流、公告等常用数据。

**特性:**

- 🔓 **完全免费** —— 通过公开渠道获取数据,无需注册、无需 API key
- 📊 **数据全** —— 实时行情 + K 线 + 分时 + 财务 + 板块 + 资金流 + 公告
- 🔄 **多源 fallback** —— 任一数据源失败自动回落
- ⚡ **性能优化** —— 进程内 TTL 缓存(秒级~分钟级)+ singleflight
- 🔁 **自动重试** —— 网络错误/5xx 自动 2 次指数退避重试
- 📦 **JSON 统一输出** —— agent 可直接解析;`--no-json` 切人类可读表格
- 🚇 **管道友好** —— unix 管道串联,与 jq / ripgrep 等工具组合
- 📖 **skill 自服务** —— AI agent 读 SKILL.md 自动学会所有命令

```
agent / 终端用户
    │  rxstock quote 600519
    ▼
@renxqoo/rxstock (本包,业务命令)
    │  缓存 + 多源 fallback + 重试
    ▼
┌──────────────────────────────────────────────────────────┐
│  公开数据源 A (行情/K线/分时,主)                        │
│  公开数据源 B (财务/龙虎榜/北向/分红/股东/三表/两融,主)  │
│  公开数据源 C (行情/K线/列表,备)                        │
│  公开数据源 D (K线/盘口,兜底)                           │
│  公开数据源 E (列表/资金流/分笔,境内增强)              │
│                                                            │
│  注:均为公开渠道,具体源见 src/sources/,仅供学习研究     │
└──────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 一键安装(推荐)

```bash
npx @renxqoo/rxstock install
```

自动完成两步:① 全局安装 CLI → ② 安装 Skill 到你的 AI 工具发现目录(`~/.agents` 始终写 + 已装工具 `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi` 自动探测)。需 Node ≥ 20。无需 API key,开箱即用。

> `npx` 无需预装,跑完即得全局 `rxstock` 命令 + 已就位的 skill。

### 手动安装(分步,等价于一键安装)

如果一键安装某步失败或想单独执行:

**第 1 步:安装 CLI**

```bash
npm install -g @renxqoo/rxstock
```

安装后跑 `rxstock --help` 确认可用。不想全局装?用 `npx @renxqoo/rxstock <命令>` 临时执行。

**第 2 步:安装 Skill(让 AI 工具发现)**

把 skill 同步到你的 AI 工具发现目录(`~/.agents` 始终写 + 已装工具如 `~/.claude`/`~/.cursor`/`~/.zcode` 自动探测——覆盖 Claude Code / Cursor / Codex / ZCode / OpenClaw / Pi / Trae):

```bash
rxstock skills sync
```

同步后 AI 工具即可在用户提到股票、行情、K 线、财务等关键词时自动触发本 skill。验证:

```bash
rxstock skills list             # 列出已装的 skill
ls ~/.agents/skills/rx-stock/   # 确认 skill 文件就位
```

> 无需凭证配置——rxstock 走公开数据源,开箱即用。

## 命令一览

### 实时行情

```bash
rxstock quote 600519                  # 快速查询(单只)
rxstock quote get 600519              # 等价
rxstock quote batch 600519,000001,300750  # 批量(逗号分隔,最多 100 只)
rxstock quote get 600519 --source eastmoney  # 强制指定数据源
```

输出字段:code, name, price, prevClose, open, high, low, change, changePercent, volume, amount, turnoverRate, volumeRatio, amplitude, peRatio, pbRatio, circulateMarketCap, totalMarketCap, limitUp, limitDown, time, bids (五档买盘), asks (五档卖盘), source

### K 线

```bash
rxstock kline get 600519 --period day --limit 30         # 日 K
rxstock kline get 600519 --period week --limit 20        # 周 K
rxstock kline get 600519 --period month --limit 12       # 月 K
rxstock kline get 600519 --period day --adjust qfq       # 前复权
rxstock kline get 600519 --period day --adjust hfq       # 后复权
rxstock kline get 600519 --period m5                     # 5 分钟级
rxstock kline get 600519 --period day --start 2026-01-01 --end 2026-08-08  # 区间查询

rxstock kline minute 600519           # 当日分时图(每分钟累计价/量/均价)
rxstock kline tick 600519 --limit 50  # 当日分笔成交
```

### 搜索 / 列表 / 公司信息

```bash
rxstock stock search 茅台               # 按名称搜索(支持中文/拼音/代码)
rxstock stock search gzmt               # 拼音首字母
rxstock stock search 600519             # 按代码

rxstock stock list                      # 全市场股票列表(默认按涨跌幅降序)
rxstock stock list --market sh          # 只看沪市
rxstock stock list --market sz          # 只看深市
rxstock stock list --market bj          # 只看北交所
rxstock stock list --sort amount        # 按成交额排序
rxstock stock list --page 2 --size 50   # 分页

rxstock stock info 600519               # 公司基本信息(总股本/流通股本 等)
```

### 指数 / 北向资金

```bash
rxstock index list                      # 9 个常用指数清单(上证/深证/沪深 300/创业板 等)
rxstock index get sh000001              # 上证指数
rxstock index get sz399001              # 深证成指
rxstock index get sh000300              # 沪深 300
rxstock index get sz399006              # 创业板指
rxstock index get sh000688              # 科创 50
rxstock index kline sh000001 --limit 30 # 指数 K 线
rxstock index northbound                # 北向资金(沪深股通)
rxstock index northbound --type 001     # 仅沪股通(003=深股通)
```

### 板块 / 行业

```bash
rxstock sector list                      # 行业板块(默认)
rxstock sector list --kind concept       # 概念板块
rxstock sector list --kind area          # 地域板块
rxstock sector list --sort amount        # 按成交额排序
rxstock sector stocks BK1600             # 板块成分股(代码 BK 前缀)
rxstock sector quote BK1600              # 板块实时行情
```

### 财务 / 财报 / 资金面

```bash
rxstock financial main 600519             # 主要财务指标(连续多期)
rxstock financial main 600519 --limit 50  # 拉更多期
rxstock financial forecast 600519         # 业绩预告
rxstock financial fundflow 600519         # 资金流向(主力/大单/中单/小单,境内增强)
rxstock financial fundflow 600519 --limit 60
rxstock financial announcements 600519   # 个股公告
rxstock financial announcements 600519 --size 50

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
rxstock financial lhb                     # 龙虎榜(默认当日)
rxstock financial lhb --date 2026-08-07   # 指定日期
rxstock financial lhb --code 600519       # 指定个股上榜历史
```

---

## 代码格式

rxstock 自动判定市场:

| 输入                             | 解析            |
| -------------------------------- | --------------- |
| `600519`                         | 沪市(默认)      |
| `000001`                         | 深市            |
| `300750`                         | 深市创业板      |
| `688981`                         | 沪市科创板      |
| `836473`                         | 北交所          |
| `sh600519` `sz000001` `bj836473` | 显式指定        |
| `1.600519` `0.000001`            | 东财 secid 形态 |
| `600519.SH` `000001.SZ`          | 行业标准后缀    |

---

## 数据源

> 本工具通过多个公开渠道获取 A 股行情数据(均为各财经网站前端调用的公开接口)。具体数据源实现见 `src/sources/`,此处不再列举具体名称以避免商标误解。各数据归原始来源所有。

| 数据             | 源链(按优先级)                          | 备注 |
| ---------------- | ----------------------------------------- | ---- |
| 实时行情         | 主源 → 备源1 → 备源2 → 境内增强           | 多源 fallback |
| 日/周/月 K 线    | 主源 → 备源1 → 备源2 → 境内增强           | 多源,复权仅部分源 |
| 分钟级 K 线      | 备源1 → 境内增强                          | 2 源 |
| 分时             | 主源(失败明确报错)                      | 不静默返回空 |
| 搜索             | 单源                                      | 公开 token |
| 列表 / 板块      | 备源 → 境内增强                           | 备源境外可用 |
| 财务/龙虎榜/分红/股东/三表/两融/北向/公告 | 主源(单源) | 境内外都通,稳定 |
| 资金流 / 分笔    | 境内增强源(仅境内)                      | **境外不可用**,明确报错 |

**稳定性说明:** 核心数据(行情/K线/财务)境内外网络都通,多源 fallback;部分数据(资金流/分笔)仅境内 IP 可用,境外会明确报错。

---

## 输出模式

### 默认(JSON 统一输出)

```bash
$ rxstock quote 600519
{
  "ok": true,
  "identity": "user",
  "data": {
    "code": "600519", "name": "贵州茅台", "price": 1309.22, ...
  },
  "meta": { "count": 1 }
}
```

### 人类可读(`--no-json`)

```bash
$ rxstock quote 600519 --no-json
贵州茅台 (600519)  1309.22 +0.67 (+0.05%)
开 1308.66  高 1315.28  低 1301.00  昨收 1308.55
量 24976 手  额 3266920000 换手 0.2% 量比 114
PE 19.79  PB 7.03
总市值 16366.32  流通市值 16366.32
涨跌停 [1439.41 / 1177.70]  20260807161437

五档盘口:
  卖五       1309.8         1 手
  ...
```

---

## 在管道里组合

```bash
# 找到涨幅前 10 的股票,批量查实时行情
rxstock stock list --size 10 --sort changePercent | jq '.data[].code' | \
  xargs -I {} rxstock quote get {} | jq '.data'

# 拉 5 分钟 K 线,转 CSV
rxstock kline get 600519 --period m5 --limit 100 --json | \
  jq -r '.data[] | [.date, .open, .high, .low, .close, .volume] | @csv' > 600519.csv

# 找最近一年的所有财报
rxstock financial main 600519 --limit 4 | jq '.data[] | {date: .reportDate, eps: .eps, roe: .roe}'
```

---

## 错误处理

所有错误走 9 类类型化错误(对应 cli-sdk 标准):

| 错误                           | 原因                    | 处理                                        |
| ------------------------------ | ----------------------- | ------------------------------------------- |
| `not_found`                    | 代码不存在或已停牌      | 检查代码 / `rxstock stock search <keyword>` |
| `network / connection_refused` | 网络问题                | 重试 / 换数据源 `--source tencent/sina`     |
| `timeout`                      | 5xx + 重试 2 次后仍超时 | 稍后再试                                    |
| `bad_response`                 | 数据源返回非 JSON       | 已自动重试,可能源端临时异常                 |
| `rate_limited` (429)           | 数据源限流              | 已自动重试                                  |

---

## 开发

```bash
pnpm install        # 装依赖
pnpm build          # 构建
pnpm typecheck      # 类型检查
pnpm test           # 跑测试(vitest)
```

---

## License

[MIT](LICENSE) © renxqoo
