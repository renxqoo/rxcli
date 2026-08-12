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
- **🔌 Vite-style plugins** — explicit prepare/observe/handle/transform hooks + `provides` for auto-contributing commands.
- **🔑 Provider chain** — flag / env API key / env bearer / file / OAuth credential resolution, with custom sources per business.
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
import { defineCli, defineCommand } from "@renxqoo/agent-data-cli";
import * as z from "zod";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = defineCli({
  name: "myapp",
  description: "My data CLI",
  commands: {
    list: defineCommand({
      name: "list",
      description: "Query list",
      args: {
        schema: z.object({
          limit: z.coerce.number().min(1).max(100).default(20),
        }),
      },
      async run(ctx, args) {
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
import { defineCliApp, defineAuth } from "@renxqoo/agent-data-cli";
import { homedir } from "node:os";
import { join } from "node:path";

export default await defineCliApp({
  name: "orders",
  // One app-owned root; the assembler hands it to every stateful plugin via apply(services).
  dir: join(homedir(), ".orders"),
  plugins: [
    defineAuth({
      credentialNamespace: "orders", // → config/orders.json + credentials/orders.json
      baseUrl: "https://auth.example.com",
      scope: "orders.read offline_access", // business-defined, no default
    }),
  ], // ← hooks + login/status/logout/register auto-injected
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

### `defineCommand(spec)` — Declare a command

```ts
import * as z from "zod";

defineCommand({
  name: "get",
  description: "Query a single order",
  args: {
    schema: z.object({
      id: z.string().min(1).describe("Order ID"),
      verbose: z.boolean().describe("Verbose output").default(false),
    }),
    pos: ["id"],
  },
  humanFormat: (data, meta) => `Order: ${data.id}`, // optional: custom text for --no-json
  async run(ctx, args) {
    // ctx.get/post/put/patch/delete — request methods are attached directly to ctx
    const res = await ctx.get(`/orders/${args.id}`);
    return { data: res.data };
  },
});
```

`args` is optional; omitting it means the command accepts no business parameters. When present,
its Zod object is the only validation and type source. `type` defaults to `"argv"`; `pos` lists
the schema fields consumed only as native positional operands, not as same-name long flags. For a
componentized command group, `defineCommands<State>({...})` contextually types every command against
the same application state.

#### Validated JSON payloads

For create/update operations with many or nested fields, set `args.type` to `"json"`. The command
then accepts exactly one complete document through `--input`, `--input-file`, or native stdin and
does not merge JSON with business flags. The same Zod schema drives validation, inference, and
`--input-schema`; no adapter or second schema protocol exists. See
[`docs/07-structured-input.md`](docs/07-structured-input.md).

### `defineAuth(opts)` — OAuth 2.1 auth factory (sync; assembly in `apply(services)`)

```ts
const auth = defineAuth({
  credentialNamespace: "crm", // → config/crm.json + credentials/crm.json
  baseUrl: AUTH_BASE_URL, // OAuth middleware
  scope: "company.api offline_access", // one scope for both login and registration metadata
  // flow: 'device',                 // default 'device' | 'authorization_code' | 'client_credentials'
  // commandNamespace: 'auth',       // default 'auth' → rxcli auth login
});
```

Three OAuth 2.1 flows, one factory: `device` (RFC 8628, default), `authorization_code` + PKCE (the only user-interactive flow), and `client_credentials` (server-to-server, no user). Registration metadata (RFC 7591) is derived per field — `client_name` from `credentialNamespace`, `grant_types` from `flow`, `scope` from `scope`, `token_endpoint_auth_method` as `client_secret_basic` — pass explicit `clientMetadata` fields to override.

Returns a Plugin — drop it into `plugins: [auth]` of `defineCliApp`. The assembler runs `apply(services)` once before routing compiles; the plugin resolves `services.localState.store` there and auto-mounts the auth commands. (Low-level `defineCli` users call `await auth.apply?.({ localState, appName })` manually.)

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
    return { ...req, headers: { ...req.headers, "x-client": "my-cli" } };
  },
  async observeRequest(ctx, event) {
    /* awaited audit; event.outcome is response | network-error */
  },
  async handleUnauthorized(ctx, event) {
    /* update session first, then explicitly retry */
    return { action: "decline" };
  },
  async transformOutput(ctx, data) {
    return transformedData;
  },
  async observeError(ctx, err) {
    /* telemetry only; void never swallows the error */
  },
  async handleError(ctx, err) {
    return { action: "replace", error: normalizedErr };
  },
};
```

> Commands contributed via a plugin's `provides` are **automatically exempted from that same plugin's own `beforeCommand`** (precise exemption), but not from other plugins. No need to hand-write `skipPluginHooks: true`.

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

Optional update awareness remains outside the business channel:

```ts
import { createUpdateNotifier } from "@renxqoo/agent-data-cli";

const updateNotifier = createUpdateNotifier({
  packageName: "@scope/my-cli",
  currentVersion: "1.2.0",
});

const app = await defineCliApp({ /* dir, plugins: [updateNotifier], ... */ });
```

`defineCliApp({ dir })` is the only application-directory decision. The assembler creates one local-state object and injects it into every plugin through `apply(services)`. Layout: per-namespace app config `<dir>/config/<ns>.json`, credentials `<dir>/credentials/<ns>.json`, and update metadata `<dir>/cache/updates/`. The high-level APIs (`defineAuth`, `defineInstaller`, `createUpdateNotifier`) take no directory parameters.

The notifier runs once per app run (`afterAppRun`, successful runs only), reads its throttled cache, refreshes registry metadata in a detached helper, and writes an XML `<system-message>` only to stderr. It never contaminates stdout or appends to structured command errors. Set `NO_UPDATE_NOTIFIER=1` to disable it. The suggested upgrade command is informational and is never executed automatically.

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

| Doc                                                     | Content                                               |
| ------------------------------------------------------- | ----------------------------------------------------- |
| [`00-overview.md`](docs/00-overview.md)                 | Architecture, layering, decision checklist            |
| [`01-cli-usage.md`](docs/01-cli-usage.md)               | Command invocation, pipes, pagination, exit codes     |
| [`02-sdk-guide.md`](docs/02-sdk-guide.md)               | SDK usage, ctx interface, hooks                       |
| [`03-envelopes.md`](docs/03-envelopes.md)               | Unified output field contract                         |
| [`04-errors.md`](docs/04-errors.md)                     | 9 error classes, when to throw                        |
| [`05-credentials.md`](docs/05-credentials.md)           | Provider chain, custom credentials                    |
| [`06-skills.md`](docs/06-skills.md)                     | Skill system, command doc auto-generation (`--lang en | zh`) |
| [`07-structured-input.md`](docs/07-structured-input.md) | Structured payloads, validation, write policies, rxx  |

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
