# rxx

> Dynamic agent-native CLI runtime: turn any backend service into an executable Agent Skill with one manifest.

`rxx` lets any SaaS API become an agent-usable CLI + Skill — no code to write, no MCP server to run. Publish a **manifest** describing your commands, and `rxx` generates the CLI, the `SKILL.md` (compliant with the [Agent Skills](https://agentskills.io) open standard), and distributes it to 40+ AI agent tools.

Built on [`@renxqoo/agent-data-cli`](https://github.com/renxqoo/rxcli/tree/main/packages/cli-sdk).

## Why

Agents need reliable "hands and feet" to fetch data and take action. Raw shell is unsafe and unstructured; MCP requires a persistent server process per tool. `rxx` is a thin client driven by a signed manifest — every command runs as a short-lived process (zero resident memory), with typed errors, param validation, and a unified output envelope that every agent can trust.

- **Zero resident processes** — unlike local MCP servers, `rxx` forks once per call and exits.
- **One manifest, all agents** — generates `SKILL.md` and syncs to every supported agent's discovery directory.
- **Typed contracts** — parameter validation, 9 error categories, pagination contract, identical envelope output whether the command is static or dynamic.
- **Security by default** — HTTPS required, Ed25519 manifest signing with host binding, SSRF protection, path-traversal blocking.

## Quick start

```bash
# install (from source in this monorepo)
pnpm install
pnpm --filter @renxqoo/rxx-cli build

# start the demo server (manifest host + mock SaaS)
pnpm --filter @renxqoo/rxx-server build
node server/dist/index.js   # listens on http://127.0.0.1:9966

# in another terminal: install a service from a manifest
rxx init http://127.0.0.1:9966/manifests/demo-orders --insecure --private-endpoints --yes

# run dynamic commands (the service did not exist in rxx source)
rxx run demo-orders orders list --limit 3
rxx run demo-orders orders get ord_001
rxx run demo-orders orders create --amount 990 --customer alice

# manage installed services
rxx list
rxx update demo-orders
rxx remove demo-orders
```

After `init`, the `SKILL.md` is distributed to `~/.agents/skills`, `~/.claude/skills`, `~/.cursor/skills`, etc. (configurable). Any agent supporting the Agent Skills standard can discover and invoke the service.

## Commands

| Command | Description |
|---------|-------------|
| `rxx init <url>` | Fetch + verify (signature) + install a service from a manifest URL |
| `rxx list` | List installed dynamic services |
| `rxx update <name>` | Re-fetch and update an installed service's manifest |
| `rxx remove <name>` | Remove a service (manifest + skill + shim) |
| `rxx run <service> <cmd>` | Run a dynamic service command (also reachable via shim: `<service> <cmd>`) |

### `init` flags

```
rxx init <url> [--insecure] [--private-endpoints] [--unsigned] [--yes] [--lang en|zh]
```

- `--insecure` — allow HTTP (local dev only)
- `--private-endpoints` — allow internal/loopback hosts (local dev only)
- `--unsigned` — accept unsigned manifests (WARNING: untrusted)
- `--yes` — skip confirmation prompt (non-interactive)
- `--lang` — skill document language

## Manifest format

A manifest describes a service's commands as serializable data — no code. The `run` function of a traditional CLI is split into `{ http, response }` mappings.

```jsonc
{
  "name": "my-svc",                       // required: lowercase, 2-64 chars, letter-led
  "description": "What this service does", // required: agent uses this for semantic matching
  "version": "1.0.0",                     // required: semver
  "api": { "baseUrl": "https://api.example.com" }, // required: HTTPS
  "auth": {                               // optional
    "type": "oauth2",
    "baseUrl": "https://auth.example.com",
    "credentialNamespace": "my-svc",
    "scope": "read",
    "flow": "device"                      // device | authorization_code | client_credentials
  },
  "errorOnStatus": { "404": "not_found", "5xx": "server_error" },
  "namespaces": {
    "orders": {
      "list": {
        "description": "List orders (paginated)",
        "args": {
          "limit":  { "type": "number", "desc": "page size" },
          "cursor": { "type": "string", "desc": "continuation token" }
        },
        "http": {
          "method": "GET",
          "path": "/api/orders",
          "query": { "limit": "{limit}", "cursor": "{cursor}" }
        },
        "response": {
          "data": "orders",               // extract field as data ("." = whole body)
          "pagination": {
            "complete":  { "field": "hasMore", "invert": true },
            "nextToken": { "field": "nextCursor" }
          }
        }
      },
      "get": {
        "description": "Get one order",
        "args": { "id": { "type": "string", "required": true, "positional": true, "desc": "order ID" } },
        "http": { "method": "GET", "path": "/api/orders/{id}" },
        "response": { "data": "." }
      }
    }
  },
  "signature": {                          // signing (see Security)
    "publicKey": "<base64-ed25519-spki>",
    "signature": "<base64-ed25519-sig>",
    "keyFingerprint": "sha256:...",
    "signedHosts": ["api.example.com"]
  }
}
```

### Placeholder syntax (intentionally minimal)

- `{argName}` — substituted with the arg value
- **path** placeholders are `encodeURIComponent`'d and reject `/` (path-traversal defense)
- **query/body** placeholders: empty values are omitted
- No expressions, conditionals, or loops — by design

### Response mapping

| field | meaning |
|-------|---------|
| `response.data` | `"."` = whole body; `"orders"` = `body.orders`; `"a.b"` = nested |
| `response.pagination.complete` | `{ field, invert? }` — reads `body[field]`, inverts if set |
| `response.pagination.nextToken` | `{ field }` — reads `body[field]` as the continuation token |

The executor normalizes every SaaS's heterogeneous response into the same envelope, so agents always see `{ data, meta: { pagination } }`.

## Validation

`rxx` ships a high-performance, dependency-free manifest validator (`src/manifest/validate.ts`). It collects **all** errors (not just the first), returns structured `{ ok, issues[] }`, and runs in <1ms for 100-command manifests. Every field and every bad value is covered by tests.

```bash
# programmatic
import { validate } from "@renxqoo/rxx-cli/validate";
const result = validate(manifest, { allowInsecure: true });
if (!result.ok) console.log(result.issues); // [{ level, field, message, hint }]
```

## Security model

**The control point is the SaaS, not the CLI.** `rxx` is a thin client: auth, permissions, audit, and compliance all live on the backend. `rxx` only guarantees:

1. **Manifest integrity** — Ed25519 signature with host binding (changing the `api.baseUrl` breaks verification).
2. **Auth passthrough** — tokens flow through to the SaaS via the standard `defineAuth` plugin.
3. **SSRF protection** — manifest hosts cannot point to private/loopback ranges.
4. **Path-traversal defense** — path placeholders are encoded and reject `/`.
5. **HTTPS by default** — plain HTTP requires explicit `--insecure`.

Trust model: TOFU (trust-on-first-use) for the publisher's public key, pinned after first install. Unsigned manifests require explicit `--unsigned`.

## How it works

```
rxx run <service> <args>
  → load manifest from ~/.rxx/registry/<service>/
  → buildAuthFromManifest(manifest)        // defineAuth (OAuth) or no-op
  → manifestToCommands(manifest)           // each command → CommandSpec via generic executor
  → defineCli({ name, plugins:[auth], namespaces, baseUrl, errorOnStatus })
  → app.run(args)                          // native 2-level routing, full pipeline
```

Every dynamic service is a fresh, ephemeral `defineCli` App — inheriting the entire cli-sdk pipeline (envelope, typed errors, pagination, pipes, pretty-printing). The cold-assemble cost is <10ms (`defineAuth` does zero network calls during construction).

## Relationship to Agent Skills, MCP, and cli-sdk

- **[Agent Skills](https://agentskills.io)** — `rxx` is a toolchain *for* this open standard (40+ agents). It generates compliant `SKILL.md` and distributes to discovery directories.
- **MCP** — `rxx` does not compete with MCP's protocol. It serves the "local, human-usable, zero-resident" niche that MCP's stdio model addresses with persistent child processes.
- **cli-sdk** — `rxx` is a pure consumer of `@renxqoo/agent-data-cli`'s public API. Zero changes to the SDK.

## Project layout

```
apps/rxx/
├── src/
│   ├── manifest/      schema, validate, loader (fetch + SSRF + DNS), sign (Ed25519)
│   ├── executor/      generic command executor, placeholders, response mapping
│   ├── auth/          manifest.auth → defineAuth
│   ├── commands/      init, list, update, remove, run
│   ├── errors.ts      friendly error mapping (→ cli-sdk typed errors)
│   ├── registry.ts    ~/.rxx/registry read/write
│   ├── shim.ts        PATH shim generation
│   └── skill-gen.ts   SKILL.md generation + multi-agent distribution
├── server/            manifest host + mock SaaS (demo + dynamic registration)
└── docs/DESIGN.md     full design rationale
```

## Development

```bash
pnpm install
pnpm --filter @renxqoo/rxx-cli build
pnpm --filter @renxqoo/rxx-cli test        # 128 tests (unit + e2e + friendly-errors)
pnpm --filter @renxqoo/rxx-cli typecheck
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/DESIGN.md](./docs/DESIGN.md) for architecture.

## License

MIT © renxqoo
