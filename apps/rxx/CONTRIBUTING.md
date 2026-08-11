# Contributing to rxx

Thanks for your interest in improving `rxx`. This guide covers setup, conventions, and how to submit changes.

## Development setup

```bash
git clone https://github.com/renxqoo/rxcli.git
cd rxcli
pnpm install
pnpm --filter @renxqoo/rxx-cli build
pnpm --filter @renxqoo/rxx-cli test
```

Node >= 20, pnpm >= 9.

## Project structure

- `src/manifest/` — schema, validation, loader (fetch + signature), signing.
- `src/executor/` — generic command executor, placeholder substitution, response mapping.
- `src/auth/` — manifest.auth → cli-sdk `defineAuth`.
- `src/commands/` — `init`, `list`, `update`, `remove`, `run`.
- `src/errors.ts` — friendly error mapping.
- `server/` — demo manifest host + mock SaaS (separate package, not published).

## Testing (TDD)

Tests are the source of truth. **Every change must come with tests, written first.**

```bash
pnpm --filter @renxqoo/rxx-cli test           # full suite (unit + e2e)
pnpm --filter @renxqoo/rxx-cli test -- --reporter=verbose
```

- Unit tests: `src/__tests__/*.test.ts` — pure logic (placeholders, response-map, validate, signing).
- E2E tests: `src/__tests__/e2e.test.ts` — real CLI via `child_process.spawn` against the demo server.
- Friendly-error tests: `src/__tests__/friendly-errors.test.ts` — bad manifests produce structured errors.

The test suite shares a single server instance via `global-setup.ts` (avoids port conflicts).

## Conventions

- **TypeScript strict** — `noUncheckedIndexedAccess` is on; index access returns `T | undefined`, use `!` only when certain.
- **ESM only** — `"type": "module"`, imports need `.js` extensions in TS source.
- **No external deps in the client** — `rxx` depends only on `@renxqoo/agent-data-cli`. The demo server also avoids frameworks (raw `node:http`).
- **Error handling** — internal errors (`LoaderError`, `ManifestValidationError`, `PlaceholderError`) must be mapped via `rxxError()` to cli-sdk typed errors. Never let raw internal errors reach the user/agent.
- **Comments** — Chinese is acceptable for inline rationale; public API docs and error messages should be English (bilingual where it helps).

## Submitting changes

1. Branch from `main`, name it `feat/...` or `fix/...`.
2. Write tests first (TDD). Run `pnpm --filter @renxqoo/rxx-cli test` — it must be green.
3. Run `pnpm --filter @renxqoo/rxx-cli typecheck` — zero errors.
4. Update `CHANGELOG.md` under `[Unreleased]`.
5. Open a PR describing what changed and why. Link any issue.

## Releasing

Releases are coordinated from the monorepo root via `scripts/publish.mjs`. `rxx` is marked `private: true` for now (not yet published to npm); when ready, flip `private` to `false` and remove it from the skip list.

## Code of conduct

Be respectful. Disagree on technical merits, not on people. See the repo-wide [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md).
