/**
 * login 命令:纯委托 flow 策略。
 * - 正常:flow.login() → persistCredentials
 * - device flow --no-wait:flow 抛 SplitFlowSignal → 框架返回 JSON/url
 * - device flow --device-code:flow 恢复轮询
 */
import { defineCommand } from "../../define.js";
import { errs } from "../../errs/index.js";
import type { CommandResult, CommandSpec } from "../../types.js";
import type { ConfigStore, StoredOAuthCredentials } from "../../credentials/types.js";
import {
  fetchScopesFromMetadata,
  getUserInfo,
  type OAuthClientConfig,
  type PollResult,
  type ClientMetadata,
} from "../../oauth.js";
import type { AuthFlow, FlowType, FlowDeps } from "../../flows/types.js";
import { SplitFlowSignal } from "../../flows/device.js";

export interface LoginCommandDeps {
  oauth: OAuthClientConfig;
  store: ConfigStore;
  credentialNamespace: string;
  commandNamespace: string;
  scope?: string;
  flow: AuthFlow;
  redirectPort?: number;
  poller?: (oauth: OAuthClientConfig, deviceCode: string) => Promise<PollResult>;
  scopeFromMetadata?: boolean;
}

/** 统一落盘(被 login 命令调)。 */
export async function persistCredentials(
  store: ConfigStore,
  namespace: string,
  oauth: OAuthClientConfig,
  token: { access_token: string; refresh_token?: string; expires_in: number; scope?: string },
  flowType: FlowType,
  log?: { info(...args: unknown[]): void },
): Promise<{ loggedIn: boolean; user?: { id: string; name: string } }> {
  const creds: StoredOAuthCredentials = {
    token: token.access_token,
    refreshToken: token.refresh_token ?? "",
    expiresAt: Date.now() + token.expires_in * 1000,
    scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
    storedAt: Date.now(),
    authMethod: flowType,
  };

  // client_credentials 没有 user;device/authCode 查 user_info
  if (flowType !== "client_credentials") {
    try {
      const user = await getUserInfo(oauth, token.access_token);
      creds.user = { userId: user.open_id, name: user.name };
      await store.saveCredentials(namespace, creds as unknown as Record<string, unknown>);
      log?.info(`\n✓ Login successful: ${user.name} (${user.open_id})`);
      return { loggedIn: true, user: { id: user.open_id, name: user.name } };
    } catch {
      await store.saveCredentials(namespace, creds as unknown as Record<string, unknown>);
      log?.info("\n✓ Login successful (could not fetch user info)");
      return { loggedIn: true };
    }
  }

  await store.saveCredentials(namespace, creds as unknown as Record<string, unknown>);
  log?.info("\n✓ Login successful (client credentials)");
  return { loggedIn: true };
}

export function createLoginCommand(deps: LoginCommandDeps): CommandSpec {
  const { oauth, store, scope, flow } = deps;
  const credNs = deps.credentialNamespace;
  const cmdNs = deps.commandNamespace;

  return defineCommand<any, unknown>({
    name: "login",
    description: `Log in via the middleware (OAuth ${flow.type.replace("_", " ")} flow)`,
    args: {
      wait: { type: "boolean", desc: "Block and poll (default; --no-wait returns immediately)" },
      json: { type: "boolean", desc: "Output JSON (with --no-wait, for agent split-flow)" },
      "device-code": {
        type: "string",
        desc: "Complete login with an existing device_code (device flow split-flow step 2)",
      },
    },
    async run(args, ctx): Promise<CommandResult> {
      // 校验:--no-wait / --device-code 只对 device flow 有效
      const deviceCode = args["device-code"] as string | undefined;
      const noWait = args.wait === false;
      if ((deviceCode || noWait) && flow.type !== "device") {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: deviceCode ? "--device-code" : "--no-wait",
          message: `--${deviceCode ? "device-code" : "no-wait"} is only supported for device flow (current: ${flow.type})`,
        });
      }

      // 动态 scope:从 metadata 读 scopes_supported(运行时,不写死)
      let effectiveScope = scope;
      if (deps.scopeFromMetadata) {
        const remoteScopes = await fetchScopesFromMetadata(oauth);
        if (remoteScopes.length > 0) {
          effectiveScope = remoteScopes.join(" ");
        }
      }

      // 构造 deps:所有 flow 共享基础 + device flow 专用参数
      const flowDeps: FlowDeps = {
        cfg: oauth,
        scope: effectiveScope,
        log: ctx.log,
        poller: deps.poller,
        callbackPort: deps.redirectPort,
        // device flow split-flow 参数(其它 flow 忽略)
        noWait: args.wait === false,
        resumeDeviceCode: args["device-code"] as string | undefined,
      };

      try {
        // 委托 flow.login() → 统一落盘
        const token = await flow.login(flowDeps);
        const result = await persistCredentials(store, credNs, oauth, token, flow.type, ctx.log);
        return { data: result };
      } catch (e) {
        // device flow --no-wait:flow 抛 SplitFlowSignal,框架捕获后返回 JSON/url
        if (e instanceof SplitFlowSignal) {
          if (args.json) {
            return {
              data: {
                device_code: e.deviceCode,
                user_code: e.userCode,
                verification_url: e.verificationUrl,
                verification_uri_complete: e.verificationUriComplete,
                verification_uri: e.verificationUri,
                expires_in: e.expiresIn,
                interval: e.interval,
              },
            };
          }
          ctx.log.info(
            `\nPlease complete login in your browser:\n  ${e.verificationUrl}\n  user code: ${e.userCode}\n\ndevice_code: ${e.deviceCode}\n(not polling. After authorizing, run: ${cmdNs} login --device-code ${e.deviceCode})`,
          );
          return { data: { device_code: e.deviceCode, verification_url: e.verificationUrl } };
        }
        throw e;
      }
    },
  });
}
