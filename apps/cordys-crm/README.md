# @renxqoo/rxcordys-cli (rxcordys)

A command-line agent tool for the full Cordys CRM Lead-to-Cash (L2C) pipeline — built on the [`@renxqoo/agent-data-cli`](../../packages/cli-sdk) framework, with full coverage of the CordysCRM API.

[English](README.md) · [中文](README.zh-CN.md)

## Quick Start

### One-step install (recommended)

```bash
npx @renxqoo/rxcordys-cli install
```

Performs three steps automatically: ① globally install the CLI → ② install the Skill to `~/.agents/skills/` (the AI-tool discovery path) → ③ configure credentials. Requires Node ≥ 20.

> `npx` requires no pre-install — once it finishes you'll have the global `rxcordys` command plus a skill ready to go.

### Manual install (step by step, equivalent to one-step install)

If any step of the one-step install fails, or you prefer to run them individually:

**Step 1: Install the CLI**

```bash
npm install -g @renxqoo/rxcordys-cli
```

After installation, run `rxcordys --help` to confirm it works. Don't want a global install? Use `npx @renxqoo/rxcordys-cli <command>` to execute on demand.

**Step 2: Install the Skill (so AI tools can discover it)**

Sync the skill to `~/.agents/skills/` (the common discovery path for AI tools such as Claude Code / Cursor / Trae):

```bash
rxcordys skills sync
```

Once synced, AI tools will automatically trigger this skill when users mention keywords like leads/accounts/opportunities/contracts. Verify:

```bash
rxcordys skills list                # List installed skills
ls ~/.agents/skills/rxcordys-cli/   # Confirm the skill files are in place
```

**Step 3: Configure credentials**

Obtain credentials from the Cordys admin console under 'Profile Center → API Keys'. Choose one of two methods:

```bash
# Method A: Persistent (recommended, writes to ~/.rxcli/credentials/cordys.json)
rxcordys auth login --accessKey <AccessKey> --secretKey <SecretKey>

# Method B: Environment variables (CI / temporary)
export CORDYS_ACCESS_KEY=<AccessKey>
export CORDYS_SECRET_KEY=<SecretKey>
# Self-hosted: export CORDYS_CRM_DOMAIN=https://your-address
```

Verify: `rxcordys whoami` returning user information means the credentials are valid.

## Features

Covers the full L2C workflow of leads → accounts → opportunities → contracts → payments → invoices → orders:

| Module | Description |
|------|------|
| `leads` | Leads CRUD + convert to account (transition) / convert to opportunity (transform) |
| `accounts` | Accounts CRUD + account 360 (contracts/opportunities/orders/payments/invoices sub-resources + stats) |
| `opportunities` | Opportunities CRUD + quotations (quotation) |
| `contacts` | Contacts CRUD |
| `contracts` | Contracts + payment plans/records + business registration headers + stats |
| `invoices` | Invoices |
| `orders` | Orders + stats |
| `follows` | Follow-up plans/records (across lead/account/opportunity) |
| `approvals` | Approvals to-do/actions/resources/workflow config |
| `stats` | Module amount stats + home page dashboard |
| `records` | Cross-module generic (view/get/page/search/contact/product/form) |
| `util` | whoami/org/members/glocount/raw passthrough |

## Common commands

```bash
rxcordys leads page --json                              # Query leads (paginated)
rxcordys accounts page "张三"                           # Search accounts
rxcordys accounts sub contract <customerId>            # Contracts under an account
rxcordys contracts stat                                # Contract amount stats
rxcordys accounts add '{"name":"客户A"}' --yes         # Create account (high-risk, requires --yes)
rxcordys leads transition '{"clueId":"L1","name":"X"}' --yes  # Convert lead to account
rxcordys approvals todo pending                        # Approvals pending for me
rxcordys util raw GET /lead/view/view                  # Passthrough for uncovered endpoints
```

Add `--dryRun` to validate only, do not submit; see `rxcordys --help` for the full command list.

## Output contract

Follows the unified agent-data-cli output format: `{ ok, source, data, meta }`. List commands automatically compute `meta.pagination.complete`.

## Development

```bash
pnpm --filter @renxqoo/rxcordys-cli build       # Compile
pnpm --filter @renxqoo/rxcordys-cli test         # Test (64 cases)
pnpm --filter @renxqoo/rxcordys-cli typecheck    # Type check
```

Skill documentation: `skills/rxcordys-cli/SKILL.md` (hand-written and maintained, with decision information up front).

## Technical decisions

- **Naming**: npm package `@renxqoo/rxcordys-cli` / bin command `rxcordys` / skill `rxcordys-cli` / credential namespace `cordys`.
- **Hand-written auth plugin** (not `defineAuth`): Cordys uses static dual headers, and the framework's `injectAuthHeader` only supports a single header, so a hand-written `beforeRequest` injection is used.
- **Business code unwrapping**: Cordys business errors may return HTTP 200 + `code≠100200`, so all commands go through `unwrap()` for unwrapping and validation.
- **credentialNamespace = `cordys`**: Avoids colliding and sharing credentials with the `crm` namespace of `apps/crm`.
