/**
 * client_credentials 策略(RFC 6749 §4.4)。
 *
 * 机器对机器:无用户参与,直接用 client_id + client_secret 换 token。
 * 通常不发 refresh_token → 401 时重新 login(覆盖 refresh)。
 */
import { clientCredentialsToken, type TokenInfo } from "../oauth.js";
import type { AuthFlow, FlowDeps } from "./types.js";

export const clientCredentialsFlow: AuthFlow = {
  type: "client_credentials" as const,

  async login(deps: FlowDeps): Promise<TokenInfo> {
    return clientCredentialsToken(deps.cfg, deps.scope);
  },

  /**
   * client_credentials 没有 refresh_token → 401 时重新用 client 凭证换 token。
   */
  async refresh(deps: FlowDeps): Promise<TokenInfo> {
    return clientCredentialsToken(deps.cfg, deps.scope);
  },
};
