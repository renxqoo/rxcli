# Custom Authentication Plugins and Providers

Use this only when `defineAuth` cannot express the protocol, such as HMAC, mTLS, or composite signing. Custom auth relies on lower-level APIs, so pin the framework version and test provider priority, persistence, refresh, retry, and redaction.

## Contents

1. Auth plugin skeleton
2. Plugin-owned login commands
3. Provider chains
4. HMAC signing
5. 401 refresh behavior

## 1. Auth plugin skeleton

An auth plugin resolves a token in `beforeCommand`, stores it in the context-bound auth session, injects it in `beforeRequest`, and may implement the public `onUnauthorized` hook for one refresh and retry. Never keep a request token in a plugin closure: one plugin instance serves concurrent `App.run()` calls.

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AuthenticationError,
  createOn401Hook,
  defaultProviders,
  fileStore,
  getAuthSession,
  injectAuthHeader,
  resolveWithChain,
  setAuthSession,
  updateAuthSessionToken,
  type CommandContext,
  type Plugin,
  type ProviderContext,
} from "@renxqoo/agent-data-cli";

export function createCustomAuth<State extends { user?: unknown }>(options: {
  namespace: string;
  authStyle?: "bearer" | "x-api-key" | "basic";
  oauth?: { baseUrl: string; clientId: string; clientSecret: string };
}): Plugin<State> {
  const store = fileStore({ dir: join(homedir(), ".my-cli") });
  const providers = defaultProviders();
  const authStyle = options.authStyle ?? "bearer";
  const refresh = options.oauth
    ? createOn401Hook({ cfg: options.oauth, store, namespace: options.namespace })
    : undefined;

  return {
    name: `auth:${options.namespace}`,
    enforce: "pre",
    async beforeCommand(ctx: CommandContext<State>) {
      const providerContext: ProviderContext = {
        namespace: options.namespace,
        configStore: store,
        args: {},
        env: process.env,
      };
      const resolved = await resolveWithChain(providers, providerContext);
      if (!resolved) {
        throw new AuthenticationError({
          subtype: "no_credentials",
          message: `${options.namespace} has no credentials`,
          hint: "Configure a supported environment variable or sign in",
        });
      }

      (ctx as { credentials: typeof ctx.credentials }).credentials = {
        get: async (namespace) =>
          (await store.loadCredentials(namespace)) as Record<string, string> | null,
        save: (namespace, data) => store.saveCredentials(namespace, data),
        clear: (namespace) => store.clearCredentials(namespace),
      };

      const identity = resolved.provider.resolveIdentity
        ? await resolved.provider.resolveIdentity(providerContext)
        : null;
      if (identity) {
        (ctx as unknown as { _identity?: typeof identity })._identity = identity;
        (ctx.state as Record<string, unknown>).user = {
          ...(identity.userId ? { userId: identity.userId } : {}),
          ...(identity.name ? { name: identity.name } : {}),
        };
      }

      setAuthSession(ctx, {
        token: resolved.token.token,
        type: resolved.token.type,
        source: resolved.token.source,
        refreshable: resolved.token.refreshable === true,
      });
    },

    async beforeRequest(ctx, request) {
      const session = getAuthSession(ctx);
      if (session) injectAuthHeader(request, session.token, authStyle);
    },

    async onUnauthorized(ctx) {
      const session = getAuthSession(ctx);
      if (!refresh || !session?.refreshable) return undefined;
      const token = await refresh();
      if (token) updateAuthSessionToken(ctx, token);
      return token;
    },
  };
}
```

`undefined` from `onUnauthorized` means that this credential is not refreshable and preserves ordinary 401 classification. `null` means refresh was attempted and failed. A string updates the retry credential. The session helper is keyed by `CommandContext`, so concurrent invocations cannot overwrite one another.

## 2. Plugin-owned login commands

A command contributed through `provides` skips that same plugin's `beforeCommand`. Therefore `ctx.credentials` is still the default no-op implementation. Plugin-owned login and logout commands must use the closed-over store directly.

```ts
const authCommands = defineCommands({
  login: defineCommand({
    name: "login",
    description: "Persist an API key from a controlled environment variable",
    async run() {
      const apiKey = process.env.MY_CLI_API_KEY;
      if (!apiKey) {
        throw new errs.ConfigError({
          subtype: "unbound_env",
          message: "MY_CLI_API_KEY is not set",
        });
      }
      await store.saveCredentials(options.namespace, { apiKey });
      return { data: { saved: true } };
    },
  }),
  logout: defineCommand({
    name: "logout",
    description: "Clear stored credentials",
    async run() {
      await store.clearCredentials(options.namespace);
      return { data: { cleared: true } };
    },
  }),
});
```

Never design long-lived secrets as `login --secret <value>`; command arguments may appear in history and process listings. Use a controlled environment variable or a genuinely masked prompt, and never return the secret.

## 3. Provider chains

`resolveWithChain` tries providers by ascending priority and stops at the first token. The default chain contains flag, API-key environment, Bearer environment, file, and OAuth providers.

The framework-global `--api-key` reaches `defineAuth` through an internal channel. The custom skeleton above sets `ProviderContext.args` to `{}` and therefore does not support that flag. Use environment, file, or a custom provider; do not advertise an unconnected flag.

A provider implements:

```ts
interface CredentialProvider {
  name(): string;
  priority?(): number;
  resolveToken(context: ProviderContext): Promise<TokenResult | null>;
  resolveIdentity?(context: ProviderContext): Promise<IdentityHint | null>;
}
```

Example:

```ts
class HmacProvider implements CredentialProvider {
  name() {
    return "hmac";
  }
  priority() {
    return 15;
  }
  async resolveToken(context: ProviderContext): Promise<TokenResult | null> {
    const credentials = await context.configStore.loadCredentials(context.namespace);
    if (!credentials?.accessKey || !credentials?.secretKey) return null;
    return {
      token: String(credentials.accessKey),
      type: "custom",
      source: "hmac",
    };
  }
}
```

Inside a provider, use `configStore.loadCredentials/saveCredentials`. In ordinary business commands, use `ctx.credentials` after `beforeCommand` initializes it.

## 4. HMAC signing

Sign in a post plugin after every other plugin finalizes method, path, body, and headers:

```ts
import { createHmac } from "node:crypto";

function hmacSigningPlugin(namespace: string): Plugin {
  return {
    name: "hmac-signing",
    enforce: "post",
    async beforeRequest(ctx, request) {
      const credentials = await ctx.credentials.get(namespace);
      if (!credentials?.secretKey) return;
      const body =
        typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? "");
      request.headers["X-Signature"] = createHmac("sha256", credentials.secretKey)
        .update(`${request.method}\n${request.path}\n${body}`)
        .digest("hex");
    },
  };
}
```

Treat canonicalization, timestamp, nonce, encoding, and header order as protocol facts. Derive them from the service specification and test known vectors; never invent them.

## 5. 401 refresh behavior

With `onUnauthorized` configured, the transport:

1. Receives 401 and runs the refresh hook.
2. Reuses one in-flight refresh for concurrent requests when the underlying hook supports singleflight.
3. Persists the refreshed token.
4. Applies the token, reruns all `beforeRequest` hooks, and retries once.
5. Throws `AuthenticationError(token_expired)` if refresh fails or the retry is still 401.

The plugin must update its context-bound session before retry hooks run. Re-signing plugins must recompute timestamps, nonces, and signatures on retry. Business commands should not implement a second 401 retry loop.
