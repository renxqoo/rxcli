# Changelog

All notable changes to `rxx` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Pending
- Central manifest registry (enterprise)
- OpenAPI → manifest converter
- Dynamic/static hybrid (per-service static fallback)
- Shared login state across services

## [0.2.0] - 2026-08-11

### Security
- **CRITICAL**: `fetchManifest` now SSRF-checks the fetch URL itself (not only the manifest's `api.baseUrl`). Previously `rxx init https://169.254.169.254/...` could reach the metadata service because only content URLs were checked post-fetch.
- **DNS rebinding protection**: new `assertSafeHost()` resolves the hostname via `dns.lookup` before fetch and rejects if any resolved IP is private. Narrows the TOCTOU window (full connect-to-IP would break vhost/SNI, intentionally not done).
- **Non-dot IPv4 encodings** now blocked by `isPrivateHost`: decimal (`2130706433`), hex (`0x7f000001`), octal (`0177.0.0.1`), and hex-segment (`0x7f.0.0.1`) forms previously bypassed the check.
- **Fetch timeout** (AbortController, 30s default) and **max body size** (1MB default) prevent malicious manifest servers from hanging the connection or streaming gigabytes (DoS).

### Data Integrity
- **Transactional install**: `install-flow.ts` now cleans up on partial failure (compensating actions reverse `writeService`/`generateAndSyncSkill`/`writeShim`). Previously a skill-sync failure mid-install left a half-installed service (cached manifest, no skill/shim).
- **Non-interactive confirmation** now throws `ConfirmationRequiredError` (exit 10) instead of returning a success envelope (`{installed:false, confirmation_required:true}`). Agents that didn't read `data.reason` previously treated it as installed.
- **`listInstalled` no longer crashes** when the registry directory contains non-service subdirectories (e.g. `trusted-keys/`, `.cache/`). Now filters by `isSafeServiceName`.
- **Atomic writes with fsync**: registry's `atomicWriteText` now fsyncs before rename, preventing zero-byte files after a crash. Public-key writes are also atomic (previously plain `writeFileSync`).

### Changed
- **`signature_failed` error category** corrected from `authorization/forbidden` to `authentication/signature_failed` (trust failure is an identity issue, not a scope issue).
- **`http_error` subtype** now maps from the real HTTP status (404→not_found, 409→conflict, 429→rate_limited, 5xx→server_error) instead of always `not_found`.
- **`rxxError` return type** narrowed to `CliError`; unknown errors are wrapped as `internal/unknown` instead of being passed through as bare `Error`. The `run` dispatch path no longer emits raw `error: <msg>` text (envelope contract violation); all errors now serialize as `{ok:false, error:{...}}` JSON.
- **`index.ts`** no longer manually handles `--version` (delegated to cli-sdk's `leadingVersion` check inside `app.run()`).
- **`RXX_VERSION`** is now read from `package.json` at runtime (was hardcoded `"0.1.0"` despite a comment claiming otherwise).
- **`config.ts` paths** (`RX_DIR`, `RX_BIN_DIR`, etc.) are now functions (`getRxDir()`, `getRxBinDir()`) evaluated at call time — eliminates the module-load side effect that forced tests to `dynamic-import`/`resetModules`.

### Added
- **`docs/signing-spec.md`**: authoritative specification of the manifest signing protocol. The client (`src/manifest/sign.ts`) and server (`server/src/sign.ts`) implement it independently (no shared code); the spec guards byte-level consistency that e2e round-trip tests also verify.
- **`fillBody` rewrite**: now recursive (supports nested objects/arrays) and accepts hyphenated placeholder names (`{my-arg}`). Previously only flat top-level string values were substituted and hyphen names silently failed.
- **Placeholder regex** now matches `{[\w-]+}` (was `\w+` only).
- **`validate.ts`**: `errorOnStatus` values must be registered subtypes; command/namespace names must match `[A-Za-z][A-Za-z0-9_-]*` (rejects spaces/slashes that break argv parsing); `pagination.complete.invert` must be boolean. `NAME_RE` removed in favor of the single `isSafeServiceName` source.
- **`shim.ts`**: `pathEq` now uses `realpathSync` (resolves symlinked bin dirs, preventing duplicate PATH block writes); rc-file writes are atomic (fsync+rename, prevents corrupting user's rc on crash); fish shell config supported; partial marker blocks stripped before rewrite.
- **`init.ts` TOFU fallback**: when a pinned key fails verification, falls back to the manifest's built-in public key with a warning (instead of hard-failing on URL-segment name collisions between unrelated services). `guessNameFromUrl` now strips `.yaml`/`.json5` and skips generic names like `manifest`.

### Fixed
- `safeGetField` falsy-value behavior locked by tests (`0`/`false`/`""` are preserved, not turned into `null`).
- `mapResponse` no longer mutates the `mapPagination` return value.
- `mapPagination` parameter typed `unknown` (was `any`).
- Server: order/product ID collisions after delete+create (now use monotonic counters); `cursor` NaN returns 400 instead of an empty page; `seedStore` idempotent (dedupes by id); `" Gizmo"` typo; `clearStore` dead code removed.
- Server: `/__admin/*` endpoints gated by `RXX_ADMIN_TOKEN` env var (opt-in, prevents open signing oracle when bound to `0.0.0.0`); CORS tightened from `*` to localhost origins; `readBody` drains the stream on rejection.
- `from-manifest.ts`: `clientMetadata` content now validated (`client_name` must be string); removed the unsound `as Parameters<typeof defineAuth>[0]` cast.
- `errors.ts`: dead `getInstalledKeyFingerprint` re-export from `manage.ts` removed; duplicate `countCommands` consolidated.
- `dynamic-command.ts`: inlined the single-use `manifestToCommandGroup` layer.

### Tests
- **+82 tests** (203 → 285): `fillBody` nested/hyphen, `safeGetField` falsy, SSRF encodings + DNS rebinding, `install-flow` transactional rollback + `ConfirmationRequiredError`, `loader` SSRF/timeout/body-size, `errors` subtype mapping, `validate` new checks, `listInstalled` crash.
- `global-setup.ts`: replaced fixed 800ms sleep with health-endpoint polling (faster + reliable on slow CI); server stderr retained for startup-failure diagnostics.
- `security.test.ts`: stray bottom-of-file imports hoisted to top.
- `validate.test.ts`: removed dead `globalThis.__testHelpers` and `export type` from test file.

## [0.1.0] - 2026-08-11

### Added
- **Core runtime**: dynamic agent-native CLI driven by signed manifests.
  - `rxx init <url>` — fetch + verify (Ed25519 signature, host binding) + cache + generate `SKILL.md` + distribute to agent discovery dirs + install PATH shim.
  - `rxx run <service> <cmd>` — per-call ephemeral `defineCli` App assembly (<10ms cold start).
  - `rxx list` / `rxx update <name>` / `rxx remove <name>`.
- **Manifest schema** (`src/manifest/schema.ts`) — serializable, SDK-independent contract: `{ args, http, response }` mapping replaces handwritten `run` functions.
- **Generic executor** (`src/executor/`) — manifest command → `CommandSpec`; placeholder substitution with path-traversal defense; heterogeneous response normalization into the cli-sdk envelope.
- **High-performance validator** (`src/manifest/validate.ts`) — pure function, collects all errors, <1ms per 100-command manifest, full test coverage (62 cases).
- **Dynamic auth** (`src/auth/from-manifest.ts`) — `manifest.auth` → `defineAuth` (device / authorization_code / client_credentials flows).
- **Friendly error mapping** (`src/errors.ts`) — internal errors → cli-sdk typed errors with `param` + `hint` for agent recovery.
- **Ed25519 signing** (`src/manifest/validator.ts`) — host-bound signatures; TOFU public-key pinning; tamper/host-swap detection.
- **Security controls**: HTTPS required, SSRF protection (private/loopback blocked), path-traversal blocking, unsigned-manifest gating.
- **Skill distribution** — reuses cli-sdk `generateSkillSkeleton` + `syncSkills` (7 default agent targets).
- **Demo server** (`server/`) — manifest host with auto-signing + mock SaaS (orders/products) + dynamic service registration endpoint for testing.
- **Test suite**: 128 tests (placeholders, response-map, validate, validator/signing, dynamic-command, friendly-errors, real-CLI e2e including dynamic registration).
- **Docs**: README, CHANGELOG, CONTRIBUTING, LICENSE, full DESIGN.md.

### Security
- TOFU trust model for publisher public keys.
- Default-deny on unsigned manifests.
- SSRF and path-traversal are enforced in both the validator and the executor.
