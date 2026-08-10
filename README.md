<div align="center">

# rxcli

**Agent-Native CLI Framework + Business Packages**

Structured consumption of business/public data by AI agents and humans — through declarative code.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220)](https://pnpm.io/)

[English](README.md) · [中文](README.zh-CN.md)

[What is this](#what-is-this) · [Quick Start](#quick-start) · [Business Packages](#business-packages) · [Architecture](#architecture) · [Build Your Own CLI](#build-your-own-cli)

</div>

---

## What is this

`rxcli` is a monorepo consisting of an agent-native CLI framework and several ready-to-use business packages.

**Core idea**: converge "how data is delivered to an agent" into framework capabilities — stdout is always a structured envelope `{ok, source, data, meta}`, stderr is the error stream, and exit codes are categorized by error class. Agents parse reliably, humans get readable tables, and unix pipes compose freely.

Business packages only declare "which API to call and how to process fields" — and automatically get: auth, unified output format, 9 error categories, credential management, pipe support, skill auto-discovery, and more.

### Why it's needed

Traditional CLIs are built for humans (tables/colored output); agents calling them must parse unstructured text, which is fragile and error-prone. `rxcli` makes every CLI natively agent-friendly:

- **Reliable agent consumption**: unified JSON output + typed errors + exit-code semantics — agents don't guess with regex
- **Still human-friendly**: TTY auto-renders tables (CJK-aware alignment); `--no-json` forces human mode
- **Unix pipes native**: `a list | b generate` — upstream stdout automatically becomes downstream PipeRecords
- **Skill self-service**: CLI ships a SKILL.md — agents read it and know when to trigger and how to call

---

## Quick Start

### Use a ready-made business package

Four business packages, install on demand. All use `npx <package> install` as a one-step setup (installs CLI + Skill + configures credentials), requires Node ≥ 20.

| Package | One-step install | Auth | Description |
| --- | --- | --- | --- |
| **rxstock** (A-share data) | `npx @renxqoo/rxstock install` | None (public data) | Quotes/K-line/financials/sectors/dragon-tiger list, multi-source fallback |
| **rxopen** (Open data) | `npx @renxqoo/rxopen-cli install` | None (public data) | News/trending/weather/fuel-prices/translate/passwords — 60+ endpoints, split into 6 domain skills |
| **rxcordys** (Cordys CRM) | `npx @renxqoo/rxcordys-cli install` | Static dual headers (API Key) | Leads/accounts/opportunities/contracts/payments/approvals |
| **rxcli** (Company business) | `npx @renxqoo/cli install` | OAuth device flow | Orders/products/invoices/accounts |

> **Testing rxcli**: rxcli depends on an OAuth middleware layer — before testing/development you must deploy [renxqoo/auth-proxy](https://github.com/renxqoo/auth-proxy) (OAuth device-flow proxy + business API gateway + mock company app). See [rxcli README](apps/crm/README.md#testing).

> You can also install step by step: `npm install -g <package>` → `<bin> skills sync` → configure credentials manually. See each package's README for details.

**A-share data (rxstock, no login required):**

```bash
npx @renxqoo/rxstock quote 600519              # Real-time quote
npx @renxqoo/rxstock stock diagnosis 300656    # Comprehensive stock diagnosis
npx @renxqoo/rxstock kline indicator 600519    # Technical indicators (MACD/RSI/KDJ)
```

**Open data (rxopen, no login required):**

```bash
npx @renxqoo/rxopen-cli install
rxopen daily                         # What's in the news today
rxopen life weather 杭州              # Real-time weather
rxopen tool fanyi "hello" --to zh-CHS # Youdao translate
rxopen hot weibo                      # Weibo trending
```

**Cordys CRM (rxcordys, requires API Key):**

```bash
npx @renxqoo/rxcordys-cli install
rxcordys accounts page               # Account list
rxcordys contracts stat              # Contract amount statistics
```

---

## Business Packages

| Package | Directory | Auth | Data source |
| --- | --- | --- | --- |
| [`@renxqoo/agent-data-cli`](packages/cli-sdk) | `packages/cli-sdk` | — | Framework base package (auth/output/errors/credentials/pipe/skill) |
| [`@renxqoo/rxstock`](apps/a-stock) | `apps/a-stock` | None | Public market data APIs (Tencent/Eastmoney/Sina/10jqka, multi-source fallback) |
| [`@renxqoo/rxopen-cli`](apps/rxopen) | `apps/rxopen` | None | [vikiboss/60s](https://github.com/vikiboss/60s) open-source project (news/trending/weather/tools — 60+ endpoints, 6 domain skills) |
| [`@renxqoo/rx60s-cli`](apps/60s) | `apps/60s` | None | [vikiboss/60s](https://github.com/vikiboss/60s) — legacy single-skill version (superseded by `rxopen`) |
| [`@renxqoo/rxcordys-cli`](apps/cordys-crm) | `apps/cordys-crm` | Static dual headers | Cordys CRM (leads/accounts/opportunities/contracts/approvals/stats) |
| [`@renxqoo/cli`](apps/crm) | `apps/crm` | OAuth device flow | Company business gateway (orders/products/invoices/accounts) |

> **Data attribution**: rxstock / rxopen data comes from public market APIs and the [vikiboss/60s](https://github.com/vikiboss/60s) open-source project respectively. Copyright belongs to the original data sources; this project only wraps them as CLIs.

---

## Architecture

```
agent / terminal user
    │  rxstock quote 600519  /  rxopen life weather 杭州  /  rxcordys accounts page
    ▼
Business package (@renxqoo/rxstock / rxopen-cli / rxcordys-cli / cli)
    │  cache + multi-source fallback / response unwrap / static-key auth / OAuth auth + refresh
    ▼
@renxqoo/agent-data-cli (framework)
    │  unified output {ok,source,data,meta} / 9 error classes / exit code / pipe / skill discovery
    ▼
Data sources: public market APIs / 60s API / Cordys CRM / OAuth middleware + business gateway
```

### Output contract (framework-guaranteed)

| Stream | Content | Who writes it |
| --- | --- | --- |
| stdout | Success output `{ok:true, source, data, meta}` | Framework (serialized from business `return`) |
| stderr | Error output `{ok:false, error:{type, subtype, ...}}` + logs | Framework (rendered from `throw errs.*`) |

**Dual-mode output**: terminal (TTY) → human-readable tables (auto CJK alignment); pipe/CI → unified JSON output. `--json` / `--no-json` force override.

### Exit code mapping

| code | category | meaning |
| --- | --- | --- |
| 0 | — | success |
| 1 | api | server-side business error (404/500/429) |
| 2 | validation | invalid parameter |
| 3 | authentication / authorization / config | login required / missing permission / missing config |
| 4 | network | DNS / timeout / connection refused |
| 5 | internal | SDK internal error (should not happen) |
| 6 | policy | risk-control block |
| 10 | confirmation | high-risk write requires `--yes` |

---

## Agent Skills

CLIs ship built-in AI Agent Skills (SKILL.md) that teach agents when and how to use commands. Two discovery methods:

```bash
# Method 1: command discovery (agent executes, no install needed)
rxstock skills list                  # List all skills
rxstock skills read rx-stock         # Read skill content

# Method 2: install to the agent scan directory (recommended)
rxstock install                      # One-step install to ~/.agents/skills/ (30+ AI tools discovery path)
rxopen install                       # Same
```

Once installed, agents semantically match the SKILL.md `description` against user intent at startup, self-servicing all command discovery.

---

## Build Your Own CLI

```bash
pnpm add @renxqoo/agent-data-cli
```

A single command in < 30 lines (see [cli-sdk docs](packages/cli-sdk/README.md) and the [agent-cli-builder skill](packages/cli-sdk/skills/agent-cli-builder/SKILL.md)):

```ts
import { defineCli, defineCommand } from "@renxqoo/agent-data-cli";

export default defineCli({
  name: "myapp",
  description: "My data CLI",
  commands: {
    list: defineCommand({
      name: "list",
      description: "Query list",
      args: { limit: { type: "number", desc: "Maximum number of results" } },
      async run(args, ctx) {
        const res = await ctx.get<{ items: any[] }>("/items", { limit: args.limit });
        return { data: res.data.items };
      },
    }),
  },
});
```

Capabilities you get for free from the framework: request layer (with auth + 401 refresh), unified output format, 9 typed error classes, parameter parsing & validation, `--json`/`--no-json` dual-mode, unix pipes, skill auto-discovery.

---

## Development

This repo is a pnpm monorepo:

```bash
pnpm install            # Install dependencies
pnpm build              # Build all packages
pnpm typecheck          # Type checking
pnpm test               # Run tests (vitest)
pnpm lint               # oxlint checks
pnpm publish            # Publish all packages to npm (interactive)
pnpm publish:dry-run    # Preview what would be published
```

### Add a new business package

1. `pnpm init` under `apps/<your-package>/`, depend on `@renxqoo/agent-data-cli`
2. Write `src/index.ts` (`defineCli`) + `src/commands/*.ts` (`defineCommand`)
3. `pnpm build` + `<bin> skills gen <name> --init` to scaffold the skill (add `--lang zh` for Chinese skeleton)
4. Hand-write the semantic parts of SKILL.md (when to use / error handling / prerequisites)
5. See the [agent-cli-builder skill](packages/cli-sdk/skills/agent-cli-builder/SKILL.md)

---

## Acknowledgements

- **[vikiboss/60s](https://github.com/vikiboss/60s)** — rxopen / rx60s data source, a collection of high-quality open-source public APIs, MIT License © Viki
- Public market data APIs (Tencent/Eastmoney/Sina/10jqka) — rxstock data sources

---

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
