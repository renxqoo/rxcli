# Authentication with `defineAuth`

Prefer `defineAuth` for standard OAuth, Bearer, API key, and Basic authentication. Read `custom-auth-plugin.md` only for HMAC, mTLS, composite auth, or a provider the factory cannot express.

## Contents

1. Factory behavior and options
2. Agent-safe split-flow login
3. Install wizard
4. Credential isolation and security
5. When to use a custom plugin

## 1. Factory behavior and options

`defineAuth` contributes:

- `auth login`, `status`, `logout`, and `register` commands.
- Device, authorization-code with PKCE, and client-credentials flows.
- Credential-provider resolution in `beforeCommand`.
- Bearer, X-API-Key, or Basic header injection in `beforeRequest`.
- One singleflight refresh and retry after a 401.
- Route-specific exemption so auth commands do not require an existing login.

The factory is asynchronous. Always await it:

```ts
import { defineAuth, defineCli, fileStore } from "@renxqoo/agent-data-cli";
import { homedir } from "node:os";
import { join } from "node:path";

const auth = await defineAuth({
  credentialNamespace: "weather",
  baseUrl: process.env.AUTH_BASE_URL!,
  store: fileStore({ dir: join(homedir(), ".weather") }), // the app owns the dir; the SDK has no default
  scope: "weather:read offline_access", // Use only after the service contract confirms it.
  clientMetadata: { client_name: "weather-cli" },
  bearerToken: process.env.WEATHER_BEARER_TOKEN,
});

const app = defineCli({
  name: "weather",
  commands: weatherCommands,
  plugins: [auth],
});
```

Passing `defineAuth(...)` directly in `plugins` passes a Promise, so hooks do not run even though the failure may be silent.

Important options:

| Option                      | Meaning                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `credentialNamespace`       | Required credential-file namespace                                   |
| `baseUrl`                   | Required auth service base URL                                       |
| `scope`                     | Explicit, verified minimum OAuth scope                               |
| `scopeFromMetadata`         | Uses every returned `scopes_supported`, overriding `scope`           |
| `flow`                      | `device` by default, `authorization_code`, or `client_credentials`   |
| `clientMetadata`            | RFC 7591 dynamic registration metadata                               |
| `bearerToken`               | Pre-issued token injection for controlled CI or sandbox use          |
| `providers`                 | Custom credential provider chain                                     |
| `clientId` / `clientSecret` | Explicit client credentials                                          |
| `authStyle`                 | `bearer`, `x-api-key`, or `basic`                                    |
| `redirectPort`              | Local callback port for authorization-code flow                      |
| `store`                     | **Required.** Credential store; the app owns the dir (the SDK has no default). Use `fileStore` in prod, `memoryStore` in tests. |
| `commandNamespace`          | Defaults to `auth`                                                   |

For client ID and secret, resolution order is:

1. Explicit options, then `RXCLI_CLIENT_ID` / `RXCLI_CLIENT_SECRET`.
2. Values written to `~/.rxcli/config.json` by registration.
3. Empty values, which make login fail with a registration hint.

Typical first-use order is register, login, then business commands. Skip registration only when the auth service already provides a client ID and secret.

## 2. Agent-safe split-flow login

An agent must not run the blocking login command and wait while the user cannot see the authorization URL. Use two turns:

```bash
# Turn 1: start and return immediately.
my-cli auth login --no-wait --json

# Optional: render the returned verification URL as a QR code.
my-cli qrcode <verification_url> --output /tmp/my-cli-login.png

# Turn 2, after the user confirms authorization.
my-cli auth login --device-code <device_code>
```

Show the URL and optional QR image to the user, retain the short-lived `device_code` only for the current flow, and wait for confirmation before completing login. Never cache or reuse expired device codes.

Business Skills for authenticated CLIs must describe this split flow. Human-facing READMEs may show interactive `auth login` because a person can see the terminal directly.

## 3. Install wizard

Intercept `install` in the executable entry point and propagate the wizard's return code:

```ts
const argv = process.argv.slice(2);

if (isMainEntry() && argv[0] === "install") {
  const { runInstallWizard } = await import("@renxqoo/agent-data-cli");
  process.exitCode = await runInstallWizard({
    skillsSource: process.env.MY_CLI_SKILLS_SOURCE,
  });
} else if (isMainEntry()) {
  await app.run(argv);
}
```

The interactive wizard may:

1. Install the business package globally.
2. Install Skills through `npx skills add` or local `<bin> skills sync`.
3. Run registration when no client is configured.
4. Offer interactive login.

Disclose these writes before asking an agent to run the wizard. `skillsSource` must be passed to `runInstallWizard`; setting it only in `defineCli` has no installation effect.

## 4. Credential isolation and security

The store directory is chosen by the app (the SDK has no default); within that store, credentials are isolated only by `credentialNamespace`:

```ts
import { fileStore } from "@renxqoo/agent-data-cli";
import { homedir } from "node:os";
import { join } from "node:path";

const auth = await defineAuth({
  credentialNamespace: "orders-prod",
  baseUrl: process.env.AUTH_BASE_URL!,
  store: fileStore({ dir: join(homedir(), ".rxcli") }), // app-chosen dir
});
```

Two CLIs with the same namespace silently share credentials. Check for collisions and separate development, test, and production namespaces when their credentials must differ.

For a fully independent product directory:

```ts
import { fileStore } from "@renxqoo/agent-data-cli";
import { homedir } from "node:os";
import { join } from "node:path";

const store = fileStore({ dir: join(homedir(), ".my-cli") });
const auth = await defineAuth({
  credentialNamespace: "my-cli",
  baseUrl: process.env.AUTH_BASE_URL!,
  store,
});
```

Security rules:

- Never put client secrets, tokens, API keys, or refresh tokens in source, Skills, READMEs, logs, or snapshots.
- Do not ask an agent or user to paste production credentials into chat.
- `auth register` without `--token` uses ordinary terminal input and does **not** mask characters. Passing `--token` may expose it through history and process listings. In high-sensitivity environments, treat secure registration input as an unresolved framework limitation.
- Use a private terminal for registration and disclose the visible-input limitation.
- `scopeFromMetadata: true` adopts every scope returned by metadata. Use it in production only when that set has been reviewed; otherwise configure an explicit verified minimum scope.
- Report provider source, expiry, and missing scopes during debugging, never credential values or auth responses.

Use `memoryStore` in tests to avoid touching disk.

## 5. When to use a custom plugin

| Requirement                                                           | Choice                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| Standard OAuth device, authorization-code, or client-credentials flow | `defineAuth`                                              |
| Single Bearer, API key, or Basic credential                           | `defineAuth` with matching `authStyle`                    |
| HMAC signing                                                          | Custom auth/provider plus post-signing plugin             |
| mTLS                                                                  | Custom plugin and transport-specific certificate handling |
| Multiple signatures or composite headers                              | Custom plugins with explicit hook ordering                |

For the last three cases, read `custom-auth-plugin.md` and pin the framework version used by the implementation.
