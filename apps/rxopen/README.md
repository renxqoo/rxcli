# @renxqoo/rxopen-cli (rxopen)

An open-data agent CLI tool — built on the [`@renxqoo/agent-data-cli`](../../packages/cli-sdk) framework, fully wrapping the public API of the open-source [vikiboss/60s](https://github.com/vikiboss/60s) project. Covers news, trending, weather, fuel prices, translate, QR code, passwords, and 60+ more endpoints. No login, no API key required.

[English](README.md) · [中文](README.zh-CN.md)

## Quick Start

### One-step install (recommended)

```bash
npx @renxqoo/rxopen-cli install
```

This runs two steps automatically: ① globally install the CLI → ② install the Skills to your AI-tool discovery dirs (`~/.agents` always + any installed tool among `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi`, auto-detected). Requires Node ≥ 20.

> No need to pre-install `npx` — running this gives you the global `rxopen` command plus ready-to-use skills. This tool is **unauthenticated** (fully public data) and requires no credential configuration.

### Manual install (step by step, equivalent to one-step install)

If a step of the one-step install fails, or if you want to run them individually:

**Step 1: Install the CLI**

```bash
npm install -g @renxqoo/rxopen-cli
```

After installation, run `rxopen --help` to confirm it works. Don't want a global install? Use `npx @renxqoo/rxopen-cli <command>` for one-off execution.

**Step 2: Install the Skills (so AI tools can discover them)**

Sync the 6 domain skills to your AI-tool discovery dirs (`~/.agents` always + any installed tool like `~/.claude`/`~/.cursor`/`~/.zcode`, auto-detected — for Claude Code / Cursor / Codex / ZCode / OpenClaw / Pi / Trae):

```bash
rxopen skills sync
```

After syncing, AI tools can auto-trigger the relevant skill whenever users mention keywords like news / trending / weather / fuel prices / translation / passwords. Verify:

```bash
rxopen skills list                # list installed skills
ls ~/.agents/skills/              # confirm skill files are in place (rxopen-news / rxopen-hot / ...)
```

## Features

Covers 60+ categories of public data, organized into 6 focused skills:

| Skill | Scope | Description |
|------|-------|------|
| `rxopen-news` | news / tech / daily / bing | Daily news digest / AI news / IT Home news and rankings / RSS / Hacker News / Bing wallpaper |
| `rxopen-hot` | hot / weibo / zhihu / toutiao | Trending searches on Weibo / Zhihu / Toutiao / Douyin / Bilibili / RedNote / Baidu / Dongchedi / Quark |
| `rxopen-life` | life / health | Real-time weather / forecast / fuel prices / gold prices / exchange rates / Chinese almanac / today in history / Olympics / BMI |
| `rxopen-tool` | tool / kb / beta | Youdao translation / Hash / QR code / OG parser / WHOIS / IP / password / color / chemistry / Baidu Baike / JS questions / QQ info |
| `rxopen-media` | music / movie | NetEase Cloud charts / lyrics / Changya covers / Maoyan box office / Douban reputation / Epic free games |
| `rxopen-fun` | fun / hitokoto / moyu | Hitokoto / jokes / cold jokes / melodramatic literature / KFC copy / Book of Answers / fortune / slacking-off calendar |

Top-level shortcut commands: `daily` / `bing` / `weibo` / `zhihu` / `toutiao` / `hitokoto` / `moyu` (no namespace prefix needed).

## Common commands

```bash
rxopen daily                                     # today's news digest (the project's core)
rxopen hot weibo                                 # Weibo real-time trending searches
rxopen life weather 上海                         # real-time weather in Shanghai
rxopen life fuel-price --region 广东             # today's fuel prices in Guangdong
rxopen tool fanyi "hello" --to zh-CHS            # Youdao translation
rxopen tool password --length 20 --symbols       # generate a 20-char password with symbols
rxopen life lunar                                # today's Chinese almanac
rxopen hitokoto                                  # random hitokoto
rxopen moyu                                      # slacking-off calendar (how many days until the next holiday)
```

Add `--json` to force JSON output (for agents / piping); add `--no-json` to force human-readable output (tables / cards — still JSON when piped, to protect downstream consumers). See `rxopen --help` for the full command list.

## Output contract

Follows the agent-data-cli unified output format: `{ ok, source, data, meta }`. `source` is always `rxopen`; list commands populate `meta.count` and `meta.pagination.complete`.

## Data source

> **This project is a CLI wrapper for the open-source [vikiboss/60s](https://github.com/vikiboss/60s) project.** All data is provided by and belongs to the original project; this project only wraps it as a CLI and does not hold or cache any data. The original project is MIT License © Viki.

The default public instance is `https://60s.viki.moe` (limited daily request quota with strict rate limiting — for development and debugging only). For production, self-host the original project and switch:

```bash
export RXOPEN_BASE_URL=https://your-60s.example.com/v2
```

## Development

```bash
pnpm --filter @renxqoo/rxopen-cli build          # build
pnpm --filter @renxqoo/rxopen-cli test           # test
pnpm --filter @renxqoo/rxopen-cli typecheck      # type check
```

Skill docs: each of the 6 `skills/rxopen-*/SKILL.md` files has hand-written frontmatter + semantic content (complying with the skill-creator spec) and an AUTO-GEN command block generated by `rxopen skills gen <name>` (scoped via `skillsScopes` so each skill only lists its own domain's commands). The API contract is in `docs/API.md` (full field-level docs for all endpoints).

## Technical decisions

- **Naming**: npm package `@renxqoo/rxopen-cli` / bin command `rxopen` / 6 skills `rxopen-{news,hot,life,tool,media,fun}` / **no credentialNamespace** (fully public data, no auth attached).
- **Unauthenticated**: all endpoints are public; `plugins: []` — no auth plugin attached and no credentials to configure.
- **Uses `ctx.get` + baseUrl**: standard REST (uniform response `{ code, message, data }`), served via the framework's request layer with `errorOnStatus` (auto-throws on 400/404/429/5xx). The baseUrl includes the `/v2` prefix.
- **Business-code unwrapping**: some endpoints may return HTTP 200 + `code≠200`; all commands are unwrapped/validated via `unwrap()` (`src/envelope.ts`).
- **Forced JSON encoding**: all requests automatically carry `?encoding=json` to get structured data; text/markdown is rendered locally by the CLI's `humanFormat`.
- **Skill splitting via `skillsScopes`**: the CLI defines `skillsScopes` mapping each of the 6 skill directories to the namespaces it covers; `skills gen` uses this to write only the in-scope commands into each skill's AUTO-GEN block, keeping each skill focused for reliable triggering.

## Data source & acknowledgements

- **Data source / upstream**: [vikiboss/60s](https://github.com/vikiboss/60s) — a collection of high-quality, open-source, reliable, globally CDN-accelerated open APIs, MIT License © Viki. All data in this project comes from that open-source project; copyright belongs to the original project and its underlying data sources.
- **This project's role**: a **CLI wrapper** over the 60s API, built on the `@renxqoo/agent-data-cli` framework for easy invocation by AI agents and terminal users. It does not modify, hold, or cache any upstream data.
- **CLI framework**: [`@renxqoo/agent-data-cli`](../../packages/cli-sdk) (this monorepo's cli-sdk).
- **Reference implementation**: [`apps/a-stock`](../a-stock) (also an unauthenticated public-data CLI).
- If the upstream API changes or has issues, please report them at [vikiboss/60s issues](https://github.com/vikiboss/60s/issues). For issues with this CLI itself, please report them in [this repo's issues](https://github.com/renxqoo/rxcli/issues).

## Disclaimer

- **This project is for educational and research purposes only.** It does not provide, store, or cache any data. All data comes from the upstream open-source [vikiboss/60s](https://github.com/vikiboss/60s) project and its data sources; copyright belongs to the original data sources.
- Some endpoints of the upstream API obtain data by scraping or calling third-party platforms (Weibo, Zhihu, QQ Music, Youdao Translation, etc.) and may be subject to third-party Terms of Service (ToS). **This CLI serves only as a command-line client for the upstream API and contains no reverse-engineering, cracking, or anti-crawler-circumvention code.** Users bear all legal responsibility arising from data obtained through this tool.
- This project makes no guarantee as to the accuracy, completeness, or timeliness of the data. Any decisions made by users based on data from this tool are at their own risk.
- If any data source considers that this project infringes upon their lawful rights and interests, please raise it with the upstream [vikiboss/60s](https://github.com/vikiboss/60s) project; this project will cooperate after being notified.
- Commercial use (reselling services, integrating into commercial products) may amplify legal risk and is recommended only after assessment by legal counsel.
