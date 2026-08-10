# @renxqoo/agent-data-cli

[English](README.md) · [中文](README.zh-CN.md)

> Agent-native CLI framework — a command-line framework that lets AI agents consume business data in a structured way.
>
> Business packages only declare "which backend API to call and how to process fields" — and get auth, unified output format, error classification, credentials, pipes, skill discovery, and more out of the box.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![CI](https://github.com/renxqoo/rxcli/actions/workflows/ci.yml/badge.svg)](https://github.com/renxqoo/rxcli/actions/workflows/ci.yml)

---

## Why you need it

When an AI agent (or script, or pipeline) consumes your business data, there's a core tension: **backend APIs vary wildly** (REST/GraphQL/RPC, OAuth/API-key/mTLS, all kinds of field naming), but "how data is delivered to an agent" is universal.

`agent-data-cli` leaves the former to business packages and converges the latter into framework capabilities:

```
┌─────────────────────────────────────────────────────────────────────┐
│  @renxqoo/agent-data-cli  (this package, the framework)             │
│  auth / request / unified output / error classification /           │
│  credentials / pipe / skill                                         │
├─────────────────────────────────────────────────────────────────────┤
│  Your business package  (depends on this package, only wires APIs)  │
│  e.g. @renxqoo/rxstock (A-share quotes/financials/indicators, public)│
│       @renxqoo/cli (orders/products/invoices, OAuth auth)           │
├─────────────────────────────────────────────────────────────────────┤
│  agent / terminal user                                              │
│  compose commands via unix pipes, read skills for self-discovery    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Features

- **🔐 Auth factory `defineAuth`** — OAuth 2.0 device flow (RFC 8628) + 401 singleflight auto-refresh. One line of config and login/status/logout/register commands are injected automatically.
- **📦 Structured unified output** — JSON mode outputs `{ok, source, data, meta}`, stderr is the error stream, exit codes are categorized; `defaultFormat` can choose JSON, human text, or TTY auto mode.
- **🏷️ 9 typed error classes** — validation/authentication/permission/config/network/api/not_found/policy/internal, each mapped to an exit code.
- **🔌 Vite-style plugins** — beforeCommand/beforeRequest/afterRequest/onUnauthorized/beforeOutput/onError hooks + `provides` for auto-contributing commands.
- **🔑 Provider chain** — flag/env/file/oauth four-tier credential resolution priority, with custom credential sources per business.
- **🚇 Unix pipes** — `rxcli orders list | rxcli report` automatically splits the upstream unified output into a record stream.
- **📖 Skill system** — SKILL.md command docs auto-generated and synced to installed AI agent discovery dirs (`~/.agents` always + detected tools among `~/.claude`/`~/.codex`/`~/.cursor`/`~/.zcode`/`~/.openclaw`/`~/.pi`) for AI agent self-discovery.
- **🖥️ Dual-mode output** — defaults to `auto` (TTY→text, script/pipe→JSON); `--json` / `--no-json` for explicit override; `defaultFormat` to pin a default.
- **🧙 Install wizard** — global install + skills loading + register + login guidance; business packages just intercept the `install` command.

### Real business packages (built on this framework)

| Package                                          | Scenario                             | Auth mode           | Highlights                                                                     |
| ------------------------------------------------ | ------------------------------------ | ------------------- | ------------------------------------------------------------------------------ |
| [`@renxqoo/rxstock`](../../apps/a-stock)         | A-share quotes/financials/indicators | None (public data)  | Multi-source fallback, unified fallback executor, local indicator computation  |
| [`@renxqoo/rxopen-cli`](../../apps/rxopen)       | Open data (news/trending/weather)    | None (public data)  | 60+ endpoints from vikiboss/60s, split into 6 domain skills via `skillsScopes` |
| [`@renxqoo/rx60s-cli`](../../apps/60s)           | Daily info (news/trending/weather)   | None (public data)  | Legacy single-skill version of rxopen                                          |
| [`@renxqoo/rxcordys-cli`](../../apps/cordys-crm) | Cordys CRM (leads/contracts/orders)  | Static dual headers | Full L2C pipeline, hand-written auth plugin                                    |
| [`@renxqoo/cli`](../../apps/crm)                 | Company business (orders/products)   | OAuth device flow   | Middleware auth, split-flow login, install wizard                              |

---

## Installation

```bash
npm install @renxqoo/agent-data-cli
# or
pnpm add @renxqoo/agent-data-cli
```

> **Requires** Node.js >= 20
>
> This package is ESM-only. Use `import`/dynamic `import()` from an ESM project; CommonJS `require()` is not supported.

---

## Quick start (write a business package)

A single command in < 30 lines (no-auth scenario, e.g. public data):

```ts
import { defineCli, defineCommandFromArgs } from "@renxqoo/agent-data-cli";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = defineCli({
  name: "myapp",
  description: "My data CLI",
  commands: {
    list: defineCommandFromArgs({
      name: "list",
      description: "Query list",
      args: { limit: { type: "number", default: 20, desc: "Maximum number of results" } },
      async run(args, ctx) {
        const res = await ctx.get<{ items: Array<{ id: string; title: string }> }>("/items", {
          limit: args.limit,
        });
        return { data: res.data.items, meta: { count: res.data.items.length } };
      },
    }),
  },
});

// bin entry detection (realpathSync avoids npm global-install symlink mismatch)
function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isMainEntry()) app.run(process.argv.slice(2));
export default app;
```

> For a complete no-auth example, see the real package [`@renxqoo/rxstock`](../../apps/a-stock) (A-share data, multi-source fallback).
> For an auth scenario (OAuth backend), see [`@renxqoo/cli`](../../apps/crm).

Add auth (one line):

```ts
import { defineCli, defineAuth } from "@renxqoo/agent-data-cli";

const auth = await defineAuth({
  credentialNamespace: "orders",
  baseUrl: "https://auth.example.com",
  scope: "orders.read offline_access", // business-defined, no default
});

export default defineCli({
  name: "orders",
  plugins: [auth], // ← hooks + login/status/logout/register auto-injected
  commands: {},
  // ...
});
```

→ `rxcli auth login` / `rxcli auth status` / `rxcli auth logout` / `rxcli auth register` are available automatically — no manual command mounting needed.

---

## Core API

### `defineCli(options)` — Assemble a business package

```ts
defineCli({
  name: 'orders',                  // required: namespace
  description: '...',              // required
  plugins: [authPlugin],           // optional: plugins (auth/logging/audit...)
  commands: { list, get },         // required: top-level commands → rxcli list
  namespaces: { orders: {...} },   // optional: sub-namespaces → rxcli orders list
  baseUrl: 'https://api.x.com',    // optional: backend address
  errorOnStatus: { 404: 'not_found', '5xx': 'server_error' },  // optional
  defaultFormat: 'auto',           // optional: 'auto' (default) | 'json' | 'human'
  skillsDir: './skills',           // optional: skill directory
  skillsTargets: [...],            // optional: skill sync targets (omit = default 7 agent dirs)
})
```

### `defineCommandFromArgs(spec)` / `defineCommand(spec)` — Declare a command

```ts
defineCommandFromArgs({
  name: "get",
  description: "Query a single order",
  args: {
    id: { type: "string", required: true, positional: true, desc: "Order ID" },
    verbose: { type: "boolean", desc: "Verbose output" },
  },
  humanFormat: (data, meta) => `Order: ${data.id}`, // optional: custom text for --no-json
  async run(args, ctx) {
    // ctx.get/post/put/patch/delete — request methods are attached directly to ctx
    const res = await ctx.get(`/orders/${args.id}`);
    return { data: res.data };
  },
});
```

Use `defineCommandFromArgs` when the argument schema is the source of truth. Use
`defineCommand<Args, Result, State>` for domain-specific unions or commands that read
`ctx.state`. For a componentized command group, `defineCommands<State>({...})` contextually
types every command against the same application state and rejects incompatible groups at
`defineCli<State>` assembly time.

### `defineAuth(opts)` — OAuth auth factory

```ts
const auth = await defineAuth({
  credentialNamespace: "crm", // → credentials/crm.json
  baseUrl: AUTH_BASE_URL, // OAuth middleware
  scope: "company.api offline_access", // business-defined; empty = no scope
  // commandNamespace: 'auth',      // default 'auth' → rxcli auth login
  // authStyle: 'bearer',           // default 'bearer' | 'x-api-key' | 'basic'
});
```

Returns a Plugin — drop it into `plugins: [auth]` to activate the hooks and auto-mount the auth commands.

### Plugin (hooks + provides)

```ts
const myPlugin: Plugin = {
  name: "audit",
  enforce: "pre", // 'pre' | 'post' (default normal)
  provides: {
    // optional: contribute commands, auto-injected by defineCli
    namespaces: { admin: { users: userCmd } },
    commands: { telemetry: telemetryCmd },
  },
  async beforeCommand(ctx) {
    /* populate state */
  },
  async beforeRequest(ctx, req) {
    /* add header */
  },
  async afterRequest(ctx, res) {
    /* audit */
  },
  async onUnauthorized(ctx, req) {
    /* refresh credentials and return a replacement token */
  },
  async beforeOutput(ctx, data) {
    return transformedData;
  },
  async onError(ctx, err) {
    return normalizedErr;
  },
};
```

> Commands contributed via a plugin's `provides` are **automatically exempted from that same plugin's own `beforeCommand`** (precise exemption), but not from other plugins. No need to hand-write `internal: true`.

---

## Output contract

**Success** (stdout):

```json
{"ok":true,"identity":"user","data":{"orders":[...]},"meta":{"count":2,"pagination":{"complete":true}}}
```

**Error** (stderr):

```json
{
  "ok": false,
  "error": {
    "type": "api",
    "subtype": "not_found",
    "message": "Order not found",
    "hint": "Check the ID"
  }
}
```

**Exit code mapping** (set automatically by the framework by error category; agents can use it to decide handling strategy):

| code | category                                | meaning                                              |
| ---- | --------------------------------------- | ---------------------------------------------------- |
| 0    | —                                       | success                                              |
| 1    | api                                     | server-side business error (404/500/429, etc.)       |
| 2    | validation                              | invalid parameter                                    |
| 3    | authentication / authorization / config | login required / missing permission / missing config |
| 4    | network                                 | DNS / timeout / connection refused                   |
| 5    | internal                                | SDK internal error (should rarely happen)            |
| 6    | policy                                  | risk-control block                                   |
| 10   | confirmation                            | high-risk write requires `--yes`                     |

9 typed error classes: `ValidationError` / `AuthenticationError` / `PermissionError` / `ConfigError` / `NetworkError` / `APIError` (with `NotFoundError` subclass) / `PolicyError` / `InternalError` / `ConfirmationRequiredError`. Always construct them with `errs.*` — never `throw new Error()` (it gets downgraded to internal/unknown).

---

## `--json` / `--no-json` output modes

| Mode                     | Behavior                                                        |
| ------------------------ | --------------------------------------------------------------- |
| Default (`auto`)         | stdout is a TTY (terminal) → text; non-TTY (pipe/script) → JSON |
| `--json`                 | Force unified JSON output                                       |
| `--no-json`              | Force text (pipe protection: still JSON when stdin is non-TTY)  |
| `defaultFormat: 'human'` | Business sets text as default                                   |
| `defaultFormat: 'json'`  | Business sets JSON as default                                   |

`--no-json` text mode: the framework auto-detects the data structure and renders a table (array of objects → table / single object → key:value / scalar array → numbered list); commands can optionally provide a `humanFormat` for polish (¥ / Chinese column names / translations). CJK characters are aligned by display width.

---

## Documentation

### Design docs (shipped with the package, in the `docs/` directory)

| Doc                                           | Content                                               |
| --------------------------------------------- | ----------------------------------------------------- |
| [`00-overview.md`](docs/00-overview.md)       | Architecture, layering, decision checklist            |
| [`01-cli-usage.md`](docs/01-cli-usage.md)     | Command invocation, pipes, pagination, exit codes     |
| [`02-sdk-guide.md`](docs/02-sdk-guide.md)     | SDK usage, ctx interface, hooks                       |
| [`03-envelopes.md`](docs/03-envelopes.md)     | Unified output field contract                         |
| [`04-errors.md`](docs/04-errors.md)           | 9 error classes, when to throw                        |
| [`05-credentials.md`](docs/05-credentials.md) | Provider chain, custom credentials                    |
| [`06-skills.md`](docs/06-skills.md)           | Skill system, command doc auto-generation (`--lang en | zh`) |

### Agent Skill: agent-cli-builder

The npm package ships the English [`agent-cli-builder`](skills/agent-cli-builder/SKILL.md) Skill by default. It guides AI agents through fact discovery, minimal CLI design, authentication, structured output, typed errors, Skill distribution, testing, packaging, and production acceptance.

The repository also keeps a Chinese source version at [`agent-cli-builder-zh-CN`](agent-cli-builder-zh-CN/SKILL.md). It is available on GitHub only and is intentionally excluded from TypeScript builds and npm packages.

Includes advanced references:

- [`core-api.md`](skills/agent-cli-builder/references/core-api.md) — project setup, core APIs, entry point, output contract
- [`auth-patterns.md`](skills/agent-cli-builder/references/auth-patterns.md) — defineAuth / split-flow login / registration
- [`patterns.md`](skills/agent-cli-builder/references/patterns.md) — pagination follow-up / pipe downstream / humanFormat
- [`skill-optimization.md`](skills/agent-cli-builder/references/skill-optimization.md) — TRACE production review
- [`testing.md`](skills/agent-cli-builder/references/testing.md) — unit, end-to-end, package, and forward testing

---

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build
pnpm typecheck      # Type checking
pnpm test           # Run tests (vitest)
```

See the [contribution guide](https://github.com/renxqoo/rxcli/blob/main/CONTRIBUTING.md), [security policy](https://github.com/renxqoo/rxcli/blob/main/SECURITY.md), and [support policy](https://github.com/renxqoo/rxcli/blob/main/SUPPORT.md) before opening a pull request or report.

## License

[MIT](LICENSE) © [renxqoo](https://github.com/renxqoo)
