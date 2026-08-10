/**
 * logout 命令:吊销 token + 清本地凭证。
 */
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { defineCommand } from "../../define.js";
import { errs } from "../../errs/index.js";
import type { CommandResult, CommandSpec } from "../../types.js";
import type { ConfigStore } from "../../credentials/types.js";
import type { StoredOAuthCredentials } from "../../credentials/types.js";
import type { OAuthClientConfig } from "../../oauth.js";
import { revokeToken } from "../../oauth.js";

export interface LogoutCommandDeps {
  oauth: OAuthClientConfig;
  store: ConfigStore;
  credentialNamespace: string;
}

export function createLogoutCommand(deps: LogoutCommandDeps): CommandSpec {
  const { oauth, store } = deps;
  const credNs = deps.credentialNamespace;

  return defineCommand<any, unknown>({
    name: "logout",
    description: "Log out (revoke session + clear local credentials)",
    async run(_args, ctx): Promise<CommandResult> {
      const creds = (await store.loadCredentials(credNs)) as Partial<StoredOAuthCredentials> | null;
      if (creds?.token) {
        try {
          await revokeToken(oauth, creds.token);
        } catch {
          /* 离线/服务不可用仍清本地 */
        }
      }
      await store.clearCredentials(credNs);
      ctx.log.info("Logged out.");
      return { data: { loggedOut: true } };
    },
  });
}
