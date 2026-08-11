import type {
  CommandContext,
  CredentialsApi,
  RequestOptions,
  UnauthorizedDecision,
} from "../types.js";
import type {
  ConfigStore,
  CredentialProvider,
  IdentityHint,
  ProviderContext,
  TokenResult,
} from "../credentials/index.js";
import { resolveWithChain } from "../credentials/index.js";
import { AuthenticationError } from "../errs/index.js";
import { injectAuthHeader, type AuthStyle } from "../oauth.js";
import { identityKey } from "../context.js";

interface AuthSession {
  token: TokenResult;
  identity?: IdentityHint;
}

export interface AuthSessionManagerOptions {
  namespace: string;
  commandNamespace: string;
  store: ConfigStore;
  providers: CredentialProvider[];
  authStyle: AuthStyle;
  refresh: () => Promise<string | null>;
}

/** Owns provider resolution, per-command auth state, identity, injection and refresh. */
export class AuthSessionManager {
  readonly #options: AuthSessionManagerOptions;
  readonly #sessions = new WeakMap<CommandContext<any>, AuthSession>();

  constructor(options: AuthSessionManagerOptions) {
    this.#options = options;
  }

  async authenticate<State>(
    ctx: CommandContext<State>,
    credentialArgs?: Record<string, unknown>,
  ): Promise<void> {
    const providerContext = this.#providerContext(credentialArgs);
    const resolved = await resolveWithChain(this.#options.providers, providerContext);
    if (!resolved) {
      throw new AuthenticationError({
        subtype: "no_credentials",
        message: `${this.#options.namespace} is not logged in`,
        hint: `run \`${this.#options.commandNamespace} login\` to log in`,
      });
    }

    const identity = resolved.provider.resolveIdentity
      ? ((await resolved.provider.resolveIdentity(providerContext)) ?? undefined)
      : undefined;
    this.#sessions.set(ctx, { token: resolved.token, identity });
    (ctx as CommandContext<State> & { [identityKey]?: IdentityHint })[identityKey] = identity;
    (ctx as { credentials: CredentialsApi }).credentials = this.#credentialsApi();

    if (identity?.identity === "user") {
      (ctx.state as Record<string, unknown>).user = {
        ...(identity.userId ? { userId: identity.userId } : {}),
        ...(identity.name ? { name: identity.name } : {}),
      };
    }
  }

  prepare<State>(ctx: CommandContext<State>, logical: Readonly<RequestOptions>): RequestOptions {
    const request: RequestOptions = {
      ...logical,
      ...(logical.query ? { query: { ...logical.query } } : {}),
      headers: { ...logical.headers },
    };
    const session = this.#sessions.get(ctx);
    if (session) injectAuthHeader(request, session.token.token, this.#options.authStyle);
    return request;
  }

  async handleUnauthorized<State>(ctx: CommandContext<State>): Promise<UnauthorizedDecision> {
    const session = this.#sessions.get(ctx);
    if (!session?.token.refreshable) return { action: "decline" };

    const token = await this.#options.refresh();
    if (!token) {
      return {
        action: "reject",
        error: new AuthenticationError({
          subtype: "token_expired",
          code: 401,
          message: "Authentication expired (token refresh failed)",
          hint: "Please log in again",
        }),
      };
    }

    this.#sessions.set(ctx, {
      ...session,
      token: { ...session.token, token },
    });
    return { action: "retry" };
  }

  #providerContext(credentialArgs?: Record<string, unknown>): ProviderContext {
    return {
      namespace: this.#options.namespace,
      configStore: this.#options.store,
      args: { apiKey: credentialArgs?.apiKey },
      env: process.env,
    };
  }

  #credentialsApi(): CredentialsApi {
    const store = this.#options.store;
    return {
      async get(namespace) {
        const credentials = await store.loadCredentials(namespace);
        if (!credentials) return null;
        const serialized: Record<string, string> = {};
        for (const [key, value] of Object.entries(credentials)) {
          if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          ) {
            serialized[key] = String(value);
          }
        }
        return serialized;
      },
      save: (namespace, data) => store.saveCredentials(namespace, data),
      clear: (namespace) => store.clearCredentials(namespace),
    };
  }
}
