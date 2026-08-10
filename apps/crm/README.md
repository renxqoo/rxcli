# @renxqoo/cli (rxcli)

> A CLI for agents to access company business data — orders / products / invoices / account.
>
> Built on the [`@renxqoo/agent-data-cli`](../cli-sdk) framework, demonstrating how to assemble an agent-native business package with the SDK.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

[English](README.md) · [中文](README.zh-CN.md)

---

## What is this

`rxcli` is a command-line tool that connects to the auth middleware layer and accesses the company business system (orders/products/invoices/accounts). It serves both as an everyday tool for terminal users to query data and as an interface for AI agents to fetch business data automatically.

```
agent / terminal user
    │  rxcli orders list
    ▼
@renxqoo/cli (this package, business commands)
    │  via OAuth auth + unified output format wrapping
    ▼
auth middleware (verify JWT, exchange company_token)
    │
    ▼
company business system (orders/products/invoices/accounts API)
```

**Features:**

- 🔐 **OAuth device flow login** — scan to authorize in a browser, token auto-refreshes
- 📦 **Structured output** — unified JSON by default (agent-friendly); `--no-json` switches to a human-readable table
- 🚇 **Unix pipes** — compose freely with `rxcli orders list | jq '...'`
- 📖 **Skill self-service** — AI agents read SKILL.md and automatically learn all commands
- 🧙 **Install wizard** — `rxcli install` guides you through everything (global install + skills + register + login)

---

## Quick Start

### One-step install (recommended)

```bash
npx @renxqoo/cli install
```

Automatically performs three steps: ① globally install the CLI → ② install skills to your AI-tool discovery dirs (`~/.agents` always + any installed tool among `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi`, auto-detected) → ③ register + login. Requires Node ≥ 20.

> No need to pre-install `npx`; once finished you get a global `rxcli` command plus skills in place.

### Manual install (step by step, equivalent to one-step install)

If any step of the one-step install fails, or you prefer to run them individually:

**Step 1: Install the CLI**

```bash
npm install -g @renxqoo/cli
```

After installing, run `rxcli --help` to confirm it works. Don't want a global install? Use `npx @renxqoo/cli <command>` to run it on the fly.

**Step 2: Install skills (so AI tools can discover them)**

Sync skills to your AI-tool discovery dirs (`~/.agents` always + any installed tool like `~/.claude`/`~/.cursor`/`~/.zcode`, auto-detected — for Claude Code / Cursor / Codex / ZCode / OpenClaw / Pi / Trae):

```bash
rxcli skills sync
```

Once synced, AI tools will automatically trigger this skill when users mention keywords like orders, products, invoices, or account. Verify:

```bash
rxcli skills list            # list installed skills
ls ~/.agents/skills/         # confirm skill files are in place
```

**Step 3: Configure credentials (OAuth auth)**

First-time use requires register + login (OAuth device flow):

```bash
rxcli auth register --token <registration token>   # one-time registration (token obtained from admin)
rxcli auth login                                    # scan to authorize in browser
```

Verify: `rxcli auth status` shows you are logged in.

---

## Command overview

### Business commands

```bash
# orders
rxcli orders list [--limit N] [--cursor TOKEN]  # list orders or continue from nextToken
rxcli orders get <id>                  # get a single order's details

# products
rxcli products list [--category <category>]  # list products
rxcli products get <id>                # get product details (price/stock)

# invoices
rxcli invoices list                    # list invoices (your own only)

# account
rxcli account profile                  # view current logged-in user's profile
rxcli account admin-users              # admin: list all users
```

### Auth commands

```bash
rxcli auth register [--token <registration token>]  # register this machine's client (one-time)
rxcli auth login                                    # login (OAuth device flow)
rxcli auth status                                   # view login status
rxcli auth logout                                   # logout
```

### Tool commands

```bash
rxcli qrcode <url>              # turn a URL into a QR code (ASCII / PNG)
rxcli skills list               # list all skills
rxcli skills read <name>        # read a skill's docs
rxcli skills sync               # sync skills to all agent discovery dirs
rxcli skills gen <name>         # generate/refresh command docs
```

### Global options

```bash
--json          Force unified JSON output
--no-json       Force human-readable text output (for terminal)
-h, --help      Show help
-v, --version   Show version
```

---

## Usage examples

### Query data in terminal (human-readable)

```bash
$ rxcli orders list --no-json
id      userId   status   total  currency
------  -------  -------  -----  --------
o_1001  u_alice  paid       199  CNY
o_1002  u_alice  shipped   58.5  CNY
```

### Agent fetches data (JSON)

```bash
$ rxcli orders list --limit 1
{"ok":true,"identity":"user","data":{"orders":[{"id":"o_1001","status":"paid","total":199}]},"meta":{"count":1,"pagination":{"complete":false,"items":1,"nextToken":"o_1001"}}}
```

### Pipeline composition

```bash
# Sum the totals of paid orders
rxcli orders list | jq '[.data.orders[] | select(.status=="paid") | .total] | add'

# Pipe protection: when piped, JSON is forced even with --no-json
rxcli orders list --no-json | jq '.data'
```

### AI agent integration

AI agents read the SKILL.md files under their discovery dirs (e.g. `~/.agents/skills/`, `~/.claude/skills/`, `~/.codex/skills/`) and automatically learn all commands:

```
User: Help me check my recent orders
agent: (reads rx-orders skill) → rxcli orders list → parse unified output → return result
```

---

## Output format

`rxcli` automatically selects an output format based on whether it is attached to a terminal:

| Scenario            | Default output                  |
| ------------------- | ------------------------------- |
| Terminal (TTY)      | Human-readable text (auto table)|
| Pipe/script/CI      | Unified JSON output             |

Override explicitly: `--json` (force JSON) / `--no-json` (force text).

---

## Configuration

### Environment variables

| Variable              | Default                 | Description                                        |
| --------------------- | ----------------------- | -------------------------------------------------- |
| `RXCLI_AUTH_BASE_URL` | `http://localhost:3000` | Auth middleware layer address                      |
| `RXCLI_API_BASE_URL`  | `http://localhost:3000` | Business API gateway address                       |
| `RXCLI_CLIENT_ID`     | (config.json)           | OAuth client id                                    |
| `RXCLI_CLIENT_SECRET` | (config.json)           | OAuth client secret                                |
| `RXCLI_SKILLS_SOURCE` | (empty = local)         | skills source URL (empty uses bundled local skills)|

### Local files

```
~/.rxcli/
├── config.json              clientId / clientSecret (written by register)
└── credentials/
    └── crm.json             OAuth token (written by login, 0600 permissions)
```

---

## Testing

rxcli depends on the OAuth auth middleware layer (device flow authorization + JWT issuance + business API gateway). Before testing or development, you must first deploy the companion [**renxqoo/auth-proxy**](https://github.com/renxqoo/auth-proxy):

```bash
git clone https://github.com/renxqoo/auth-proxy.git
cd auth-proxy

# 1. Start dependencies (Postgres + Redis)
docker compose up -d postgres redis

# 2. Run database migrations + seed (generates RSA keys + first admin)
DATABASE_URL=postgres://localhost:5432/auth-proxy pnpm --filter @auth-proxy/db migrate
DATABASE_URL=postgres://localhost:5432/auth-proxy \
  ADMIN_USERNAME=admin ADMIN_PASSWORD=devpassword123 \
  pnpm --filter @auth-proxy/db seed

# 3. Start services (mock company app + auth middleware layer)
pnpm dev:all
```

Once started, auth-proxy listens on `localhost:3000` by default (including OAuth device flow + business API gateway + mock company app). rxcli's default configuration (`RXCLI_AUTH_BASE_URL` / `RXCLI_API_BASE_URL` both `http://localhost:3000`) connects directly, with no extra configuration needed.

Then, in the admin panel (`localhost:3001/admin`, log in with the account set up by seed), create a client and obtain a registration token. You can then run rxcli's register → login → query data flow:

```bash
rxcli auth register --token <registration token>   # register this machine's client
rxcli auth login                                    # scan to authorize in browser
rxcli orders list                                   # query orders (via auth-proxy → mock company app)
```

> For auth-proxy deployment details (Docker production deployment, environment variables, architecture), see its [README](https://github.com/renxqoo/auth-proxy).

---

## Development

This package is a business application in the [rxcli monorepo](https://github.com/renxqoo/rxcli) and depends on the `@renxqoo/agent-data-cli` framework.

```bash
# From the monorepo root
pnpm install
pnpm build          # build all packages (required after changing cli-sdk source)
pnpm test           # run tests

# This package only
cd apps/crm
pnpm typecheck
pnpm test
pnpm build
```

> **Note**: `crm` resolves `@renxqoo/agent-data-cli` from its **dist** (not source). After changing cli-sdk source, you must run `pnpm build` (in packages/cli-sdk) first, or crm won't see the changes.

### Business package entry (reference implementation)

```ts
import { defineCli, defineAuth } from "@renxqoo/agent-data-cli";

const auth = await defineAuth({
  credentialNamespace: "crm",
  baseUrl: AUTH_BASE_URL,
  scope: "company.api orders:read products:read invoices:read admin offline_access",
  clientMetadata: {
    client_name: "crm",
    grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    scope: "company.api orders:read products:read invoices:read admin offline_access",
    token_endpoint_auth_method: "client_secret_basic",
  },
});

export default defineCli({
  name: "crm",
  plugins: [auth], // hooks + auth commands are fully automatic
  commands: {},
  namespaces: { orders, products, invoices, account }, // pure business
  baseUrl: API_BASE_URL,
  errorOnStatus: {
    401: "token_expired",
    403: "forbidden",
    404: "not_found",
    "5xx": "server_error",
  },
});
```

---

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
