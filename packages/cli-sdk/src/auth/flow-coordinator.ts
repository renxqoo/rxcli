import type { ConfigStore, StoredOAuthCredentials } from "../credentials/types.js";
import type { TokenInfo } from "../oauth-contracts.js";

export interface OAuthRefreshStrategy {
  type?: StoredOAuthCredentials["authMethod"];
  requiresRefreshToken?: boolean;
  acquire(refreshToken?: string): Promise<TokenInfo>;
}

export interface OAuthFlowCoordinatorOptions {
  store: ConfigStore;
  namespace: string;
  strategy?: OAuthRefreshStrategy;
  /** Concise default-refresh constructor used by the public OAuth façade. */
  refresh?: (refreshToken: string) => Promise<TokenInfo>;
}

/** Owns refresh singleflight and the refresh-to-persistence transaction. */
export class OAuthFlowCoordinator {
  readonly #store: ConfigStore;
  readonly #namespace: string;
  readonly #strategy: OAuthRefreshStrategy;
  readonly #inflight = new Map<string, Promise<string | null>>();

  constructor(options: OAuthFlowCoordinatorOptions) {
    this.#store = options.store;
    this.#namespace = options.namespace;
    if (options.strategy) {
      this.#strategy = options.strategy;
      return;
    }
    if (!options.refresh) throw new TypeError("OAuthFlowCoordinator requires a refresh strategy");
    const refresh = options.refresh;
    this.#strategy = {
      requiresRefreshToken: true,
      acquire(token?: string) {
        if (!token) throw new TypeError("refresh token is required");
        return refresh(token);
      },
    };
  }

  readonly refreshStoredSession = async (): Promise<string | null> => {
    const current = (await this.#store.loadCredentials(
      this.#namespace,
    )) as Partial<StoredOAuthCredentials> | null;
    const refreshToken = current?.refreshToken || undefined;
    const requiresToken = this.#strategy.requiresRefreshToken ?? false;
    const authMethod = this.#strategy.type ?? current?.authMethod;
    if ((requiresToken && !refreshToken) || !authMethod) return null;

    const key = refreshToken ?? `${authMethod}:session`;
    const existing = this.#inflight.get(key);
    if (existing) return existing;

    const operation = this.#refreshAndPersist(current ?? {}, refreshToken, authMethod).finally(
      () => {
        this.#inflight.delete(key);
      },
    );
    this.#inflight.set(key, operation);
    return operation;
  };

  async #refreshAndPersist(
    current: Partial<StoredOAuthCredentials>,
    refreshToken: string | undefined,
    authMethod: StoredOAuthCredentials["authMethod"],
  ): Promise<string | null> {
    try {
      const token = await this.#strategy.acquire(refreshToken);
      const now = Date.now();
      const updated: StoredOAuthCredentials = {
        token: token.access_token,
        refreshToken: token.refresh_token ?? refreshToken ?? "",
        expiresAt: now + token.expires_in * 1000,
        scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : (current.scopes ?? []),
        storedAt: now,
        authMethod,
        ...(current.user ? { user: current.user } : {}),
      };
      await this.#store.saveCredentials(
        this.#namespace,
        updated as unknown as Record<string, unknown>,
      );
      return token.access_token;
    } catch {
      return null;
    }
  }
}
