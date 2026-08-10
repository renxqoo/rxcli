# @renxqoo/rx60s-cli (rx60s)

Understand the world in 60 seconds every day · an open-data agent CLI tool — built on the [`@renxqoo/agent-data-cli`](../../packages/cli-sdk) framework, fully wrapping the public API of the open-source [vikiboss/60s](https://github.com/vikiboss/60s) project. No login, no API key required.

[English](README.md) · [中文](README.zh-CN.md)

## Quick Start

### One-step install (recommended)

```bash
npx @renxqoo/rx60s-cli install
```

This runs two steps automatically: ① globally install the CLI → ② install the Skill to `~/.agents/skills/` (the discovery path for AI tools). Requires Node ≥ 20.

> No need to pre-install `npx` — running this gives you the global `rx60s` command plus a ready-to-use skill. This tool is **unauthenticated** (fully public data) and requires no credential configuration.

### Manual install (step by step, equivalent to one-step install)

If a step of the one-step install fails, or if you want to run them individually:

**Step 1: Install the CLI**

```bash
npm install -g @renxqoo/rx60s-cli
```

After installation, run `rx60s --help` to confirm it works. Don't want a global install? Use `npx @renxqoo/rx60s-cli <command>` for one-off execution.

**Step 2: Install the Skill (so AI tools can discover it)**

Sync the skill to `~/.agents/skills/` (the common discovery path for AI tools such as Claude Code / Cursor / Trae):

```bash
rx60s skills sync
```

After syncing, AI tools can auto-trigger this skill whenever users mention keywords like news / trending / weather / fuel prices / translation / passwords. Verify:

```bash
rx60s skills list                # list installed skills
ls ~/.agents/skills/rx60s/       # confirm skill files are in place
```

## Features

Covers 60+ categories of public data including news, trending charts, lifestyle services, and developer tools:

| Module | Description |
|------|------|
| `news` | Understand the world in 60 seconds every day / AI news / IT Home news and rankings / RSS |
| `hot` | Trending searches on Weibo / Zhihu / Toutiao / Douyin / Bilibili / Xiaohongshu (RedNote) / Baidu / Dongchedi / Quark |
| `tech` | Hacker News (top / best) |
| `fun` | Hitokoto (one word) / jokes / cold jokes / melodramatic literature / KFC copy / Book of Answers / today's fortune / slacking-off calendar |
| `music` | NetEase Cloud Music charts / lyrics search / Changya covers |
| `movie` | Maoyan box office / Douban reputation charts / Epic free games |
| `life` | Real-time weather / weather forecast / fuel prices / gold prices / exchange rates / Chinese almanac / today in history / Olympics |
| `tool` | Youdao translation / Hash / QR code / OG parser / WHOIS / IP / password / color / chemistry |
| `kb` | Baidu Baike / JS interview questions |
| `health` | BMI / health assessment |
| `beta` | Coolapk trending / QQ info (experimental) |

Top-level shortcut commands: `60s` / `bing` / `weibo` / `zhihu` / `toutiao` / `hitokoto` / `moyu` (no namespace prefix needed).

## Common commands

```bash
rx60s 60s                                       # today's news (the project's core)
rx60s hot weibo                                 # Weibo real-time trending searches
rx60s life weather 上海                         # real-time weather in Shanghai
rx60s life fuel-price --region 广东             # today's fuel prices in Guangdong
rx60s tool fanyi "hello" --to zh-CHS            # Youdao translation
rx60s tool password --length 20 --symbols       # generate a 20-char password with symbols
rx60s life lunar                                # today's Chinese almanac
rx60s hitokoto                                  # random hitokoto
rx60s moyu                                      # slacking-off calendar (how many days until the next holiday)
```

Add `--json` to force JSON output (for agents / piping); add `--no-json` to force human-readable output (tables / cards — still JSON when piped, to protect downstream consumers). See `rx60s --help` for the full command list.

## Output contract

Follows the agent-data-cli unified output format: `{ ok, source, data, meta }`. `source` is always `rx60s`; list commands populate `meta.count` and `meta.pagination.complete`.

## Data source

> **This project is a CLI wrapper for the open-source [vikiboss/60s](https://github.com/vikiboss/60s) project.** All data is provided by and belongs to the original project; this project only wraps it as a CLI and does not hold or cache any data. The original project is MIT License © Viki.

The default public instance is `https://60s.viki.moe` (limited daily request quota with strict rate limiting — for development and debugging only). For production, self-host the original project and switch:

```bash
export RX60S_BASE_URL=https://your-60s.example.com/v2
```

## Development

```bash
pnpm --filter @renxqoo/rx60s-cli build          # build
pnpm --filter @renxqoo/rx60s-cli test           # test (21 cases)
pnpm --filter @renxqoo/rx60s-cli typecheck      # type check
```

Skill docs: `skills/rx60s/SKILL.md` (frontmatter is hand-written to comply with the skill-creator spec; the AUTO-GEN command block is generated by `rx60s skills gen`). The API contract is in `docs/API.md` (full field-level docs for 68 endpoints).

## Technical decisions

- **Naming**: npm package `@renxqoo/rx60s-cli` / bin command `rx60s` / skill `rx60s` / **no credentialNamespace** (fully public data, no auth attached).
- **Unauthenticated**: all 60s endpoints are public; `plugins: []` — no auth plugin attached and no credentials to configure.
- **Uses `ctx.get` + baseUrl**: 60s is standard REST (uniform response `{ code, message, data }`), served via the framework's request layer with `errorOnStatus` (auto-throws on 400/404/429/5xx). The baseUrl includes the `/v2` prefix.
- **Business-code unwrapping**: some endpoints may return HTTP 200 + `code≠200`; all commands are unwrapped/validated via `unwrap()` (`src/envelope.ts`).
- **Forced JSON encoding**: all requests automatically carry `?encoding=json` to get structured data; text/markdown is rendered locally by the CLI's `humanFormat`.
- **Dual SKILL.md spec reconciliation**: `agent-cli-builder`'s `skills gen` produces frontmatter containing a `version` field, but `skill-creator`'s `quick_validate.py` rejects `version`. Resolution: use `gen` for the mechanical AUTO-GEN block, and hand-write the frontmatter + semantic content to comply with the skill-creator spec (already passing validation).

## Data source & acknowledgements

- **Data source / upstream**: [vikiboss/60s](https://github.com/vikiboss/60s) — a collection of high-quality, open-source, reliable, globally CDN-accelerated open APIs, MIT License © Viki. All data in this project comes from that open-source project; copyright belongs to the original project and its underlying data sources.
- **This project's role**: a **CLI wrapper** over the 60s API, built on the `@renxqoo/agent-data-cli` framework for easy invocation by AI agents and terminal users. It does not modify, hold, or cache any upstream data.
- **CLI framework**: [`@renxqoo/agent-data-cli`](../../packages/cli-sdk) (this monorepo's cli-sdk).
- **Reference implementation**: [`apps/a-stock`](../a-stock) (also an unauthenticated public-data CLI).
- If the upstream API changes or has issues, please report them at [vikiboss/60s issues](https://github.com/vikiboss/60s/issues). For issues with this CLI itself, please report them in [this repo's issues](https://github.com/renxqoo/rxcli/issues).

## Disclaimer

- **This project is for educational and research purposes only.** It does not provide, store, or cache any data. All data comes from the upstream open-source [vikiboss/60s](https://github.com/vikiboss/60s) project and its data sources; copyright belongs to the original data sources.
- Some endpoints of the upstream 60s API obtain data by scraping or calling third-party platforms (Weibo, Zhihu, QQ Music, Youdao Translation, etc.) and may be subject to third-party Terms of Service (ToS). **This CLI serves only as a command-line client for the upstream API and contains no reverse-engineering, cracking, or anti-crawler-circumvention code.** Users bear all legal responsibility arising from data obtained through this tool.
- This project makes no guarantee as to the accuracy, completeness, or timeliness of the data. Any decisions made by users based on data from this tool are at their own risk.
- If any data source considers that this project infringes upon their lawful rights and interests, please raise it with the upstream [vikiboss/60s](https://github.com/vikiboss/60s) project; this project will cooperate after being notified.
- Commercial use (reselling services, integrating into commercial products) may amplify legal risk and is recommended only after assessment by legal counsel.
