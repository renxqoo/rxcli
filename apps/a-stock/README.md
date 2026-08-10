# @renxqoo/rxstock (rxstock)

> A-share stock data command-line tool — quotes / K-lines / financials / sectors / fund flow / announcements. Completely free, stable, production-ready.
>
> Built on the [`@renxqoo/agent-data-cli`](../cli-sdk) framework.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

[English](README.md) · [中文](README.zh-CN.md)

---

## ⚠️ Disclaimer (read before use)

> **This project is for educational and technical research purposes only and does not constitute any investment advice.**

1. **Data source**: This tool fetches A-share quote data through public channels. The data belongs to the original sources. This tool does not store or resell data; it is only a convenience wrapper for command-line queries.
2. **Data copyright**: The copyright of all data belongs to the original authors / data sources. If any data source believes this project infringes their rights, please contact us via [Issues](https://github.com/renxqoo/rxcli/issues). Once confirmed, we will remove the relevant code or take the project down as soon as possible.
3. **Investment risk**: The stock market carries risk. Data provided by this tool may be delayed, incorrect, or incomplete. **You bear all risk for any investment decision based on this tool's data.** The author assumes no responsibility.
4. **Usage restrictions**: This tool is for personal study and research only. It is **strictly prohibited** from being used for commercial resale, high-frequency quantitative hammering of data sources, or any scenario that violates the terms of use of the data sources. Please control your call rate reasonably.
5. **Compliance obligations**: Users must comply with the laws and regulations of their region regarding the use of securities data. The author is not responsible for the user's behavior.

> In short: the data is public, the tool is free, the use is for learning, the risk is yours, and contact us for removal if you have objections.

---

## What is this

`rxstock` is an out-of-the-box A-share stock data CLI. It wraps multiple public data sources behind a unified interface and provides common data such as real-time quotes, K-lines, intraday data, financials, sectors, fund flow, and announcements.

**Features:**

- 🔓 **Completely free** — fetches data via public channels, no registration, no API key
- 📊 **Comprehensive data** — real-time quotes + K-lines + intraday + financials + sectors + fund flow + announcements
- 🔄 **Multi-source fallback** — automatically falls back when any source fails
- ⚡ **Performance optimized** — in-process TTL cache (seconds to minutes) + singleflight
- 🔁 **Auto retry** — network errors / 5xx automatically retried twice with exponential backoff
- 📦 **Unified JSON output** — agents can parse it directly; `--no-json` switches to human-readable tables
- 🚇 **Pipeline friendly** — chains in unix pipelines, composes with tools like jq / ripgrep
- 📖 **Self-service skill** — AI agents read SKILL.md and automatically learn all commands

```
agent / end user
    │  rxstock quote 600519
    ▼
@renxqoo/rxstock (this package, business commands)
    │  cache + multi-source fallback + retry
    ▼
┌──────────────────────────────────────────────────────────┐
│  Public source A (quote/K-line/intraday, primary)        │
│  Public source B (financials/dragon-tiger list/          │
│    northbound/dividend/shareholder/three statements/     │
│    margin, primary)                                       │
│  Public source C (quote/K-line/list, backup)             │
│  Public source D (K-line/order book, fallback)           │
│  Public source E (list/fund flow/ticks,                  │
│    domestic-enhanced)                                     │
│                                                            │
│  Note: all public channels, see src/sources/ for details, │
│        for learning and research only                      │
└──────────────────────────────────────────────────────────┘
```

---

## Quick Start

### One-step install (recommended)

```bash
npx @renxqoo/rxstock install
```

This automatically does two things: ① globally installs the CLI → ② installs the Skill to your AI-tool discovery dirs (`~/.agents` always + any installed tool among `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi`, auto-detected). Requires Node ≥ 20. No API key needed — works out of the box.

> `npx` requires no pre-install; after running you get the global `rxstock` command plus the skill in place.

### Manual install (step by step, equivalent to one-step install)

If a step of the one-step install fails, or you want to run them individually:

**Step 1: Install the CLI**

```bash
npm install -g @renxqoo/rxstock
```

After install, run `rxstock --help` to confirm it works. Don't want a global install? Use `npx @renxqoo/rxstock <command>` to run it ad-hoc.

**Step 2: Install the Skill (so AI tools can discover it)**

Sync the skill to your AI-tool discovery dirs (`~/.agents` always + any installed tool like `~/.claude`/`~/.cursor`/`~/.zcode`, auto-detected — for Claude Code / Cursor / Codex / ZCode / OpenClaw / Pi / Trae):

```bash
rxstock skills sync
```

After syncing, AI tools will automatically trigger this skill when the user mentions keywords like stocks, quotes, K-lines, financials, etc. Verify:

```bash
rxstock skills list             # list installed skills
ls ~/.agents/skills/rx-stock/   # confirm skill files are in place
```

> No credential configuration needed — rxstock uses public data sources and works out of the box.

## Command overview

### Real-time quotes

```bash
rxstock quote 600519                  # quick query (single)
rxstock quote get 600519              # equivalent
rxstock quote batch 600519,000001,300750  # batch (comma-separated, up to 100)
rxstock quote get 600519 --source eastmoney  # force a specific source
```

Output fields: code, name, price, prevClose, open, high, low, change, changePercent, volume, amount, turnoverRate, volumeRatio, amplitude, peRatio, pbRatio, circulateMarketCap, totalMarketCap, limitUp, limitDown, time, bids (5-level buy book), asks (5-level sell book), source

### K-lines

```bash
rxstock kline get 600519 --period day --limit 30         # daily K
rxstock kline get 600519 --period week --limit 20        # weekly K
rxstock kline get 600519 --period month --limit 12       # monthly K
rxstock kline get 600519 --period day --adjust qfq       # forward-adjusted
rxstock kline get 600519 --period day --adjust hfq       # backward-adjusted
rxstock kline get 600519 --period m5                     # 5-minute bars
rxstock kline get 600519 --period day --start 2026-01-01 --end 2026-08-08  # range query

rxstock kline minute 600519           # intraday chart (per-minute cumulative price/volume/avg price)
rxstock kline tick 600519 --limit 50  # intraday tick trades
```

### Search / lists / company info

```bash
rxstock stock search 茅台               # search by name (supports Chinese/pinyin/code)
rxstock stock search gzmt               # pinyin initials
rxstock stock search 600519             # by code

rxstock stock list                      # full market stock list (default: price change % descending)
rxstock stock list --market sh          # Shanghai market only
rxstock stock list --market sz          # Shenzhen market only
rxstock stock list --market bj          # Beijing Stock Exchange only
rxstock stock list --sort amount        # sort by turnover
rxstock stock list --page 2 --size 50   # pagination

rxstock stock info 600519               # company basics (total shares / floating shares, etc.)
```

### Indices / northbound capital

```bash
rxstock index list                      # 9 commonly used indices (SSE/SZSE/CSI 300/ChiNext, etc.)
rxstock index get sh000001              # SSE Composite Index
rxstock index get sz399001              # SZSE Component Index
rxstock index get sh000300              # CSI 300
rxstock index get sz399006              # ChiNext Index
rxstock index get sh000688              # STAR 50
rxstock index kline sh000001 --limit 30 # index K-lines
rxstock index northbound                # northbound capital (Shanghai/Shenzhen Stock Connect)
rxstock index northbound --type 001     # Shanghai Connect only (003 = Shenzhen Connect)
```

### Sectors / industries

```bash
rxstock sector list                      # industry sectors (default)
rxstock sector list --kind concept       # concept sectors
rxstock sector list --kind area          # regional sectors
rxstock sector list --sort amount        # sort by turnover
rxstock sector stocks BK1600             # sector constituents (BK-prefixed codes)
rxstock sector quote BK1600              # real-time sector quote
```

### Financials / reports / fund flow

```bash
rxstock financial main 600519             # key financial indicators (multiple periods)
rxstock financial main 600519 --limit 50  # pull more periods
rxstock financial forecast 600519         # earnings forecast
rxstock financial fundflow 600519         # fund flow (main/large/medium/small orders, domestic-enhanced)
rxstock financial fundflow 600519 --limit 60
rxstock financial announcements 600519   # company announcements
rxstock financial announcements 600519 --size 50

# Three financial statements
rxstock financial balancesheet 600519     # balance sheet
rxstock financial income 600519           # income statement
rxstock financial cashflow 600519         # cash flow statement

# Shareholders & dividends
rxstock financial dividend 600519         # dividend and bonus history
rxstock financial holders 600519          # top 10 shareholders
rxstock financial holdercount 600519      # shareholder count changes

# Fund flow
rxstock financial margin 600519           # margin trading detail
rxstock financial lhb                     # dragon-tiger list (default: today)
rxstock financial lhb --date 2026-08-07   # specific date
rxstock financial lhb --code 600519       # listing history for a specific stock
```

---

## Code formats

rxstock auto-resolves the market:

| Input                           | Resolved            |
| ------------------------------- | ------------------- |
| `600519`                        | Shanghai market (default) |
| `000001`                        | Shenzhen market     |
| `300750`                        | Shenzhen ChiNext    |
| `688981`                        | Shanghai STAR Market |
| `836473`                        | Beijing Stock Exchange |
| `sh600519` `sz000001` `bj836473` | Explicit             |
| `1.600519` `0.000001`           | Eastmoney secid form |
| `600519.SH` `000001.SZ`         | Industry-standard suffix |

---

## Data sources

> This tool fetches A-share quote data through multiple public channels (the public APIs that financial websites call on their front-ends). The data source implementations are in `src/sources/`; specific names are not listed here to avoid trademark confusion. All data belongs to its original sources.

| Data             | Source chain (by priority)                | Notes |
| ---------------- | ----------------------------------------- | ---- |
| Real-time quotes         | primary → backup1 → backup2 → domestic-enhanced | multi-source fallback |
| Daily/weekly/monthly K-lines | primary → backup1 → backup2 → domestic-enhanced | multi-source; adjustment only on some sources |
| Minute K-lines           | backup1 → domestic-enhanced               | 2 sources |
| Intraday                 | primary (errors clearly on failure)        | never silently returns empty |
| Search                   | single source                             | public token |
| List / sectors           | backup → domestic-enhanced                | backup works overseas |
| Financials/dragon-tiger list/dividend/shareholder/three statements/margin/northbound/announcements | primary (single source) | works domestic and overseas, stable |
| Fund flow / ticks        | domestic-enhanced source (domestic only)  | **unavailable overseas**, errors clearly |

**Stability notes:** core data (quotes/K-lines/financials) works on both domestic and overseas networks with multi-source fallback; some data (fund flow / ticks) is only available from domestic IPs and will error clearly overseas.

---

## Output modes

### Default (unified JSON output)

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

### Human-readable (`--no-json`)

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

## Composing in pipelines

```bash
# Find the top 10 stocks by price change %, then batch-query real-time quotes
rxstock stock list --size 10 --sort changePercent | jq '.data[].code' | \
  xargs -I {} rxstock quote get {} | jq '.data'

# Pull 5-minute K-lines and convert to CSV
rxstock kline get 600519 --period m5 --limit 100 --json | \
  jq -r '.data[] | [.date, .open, .high, .low, .close, .volume] | @csv' > 600519.csv

# Get all financial reports over the past year
rxstock financial main 600519 --limit 4 | jq '.data[] | {date: .reportDate, eps: .eps, roe: .roe}'
```

---

## Error handling

All errors use 9 typed error categories (matching the cli-sdk standard):

| Error                           | Cause                    | How to handle                                        |
| ------------------------------ | ----------------------- | ------------------------------------------- |
| `not_found`                    | code does not exist or is suspended      | check the code / `rxstock stock search <keyword>` |
| `network / connection_refused` | network issue                | retry / switch source `--source tencent/sina`     |
| `timeout`                      | still timing out after 5xx + 2 retries | try again later                                    |
| `bad_response`                 | source returned non-JSON       | already auto-retried; likely a transient issue on the source side                 |
| `rate_limited` (429)           | source rate limit              | already auto-retried                                  |

---

## Development

```bash
pnpm install        # install deps
pnpm build          # build
pnpm typecheck      # type check
pnpm test           # run tests (vitest)
```

---

## License

[MIT](LICENSE) © renxqoo
