/**
 * device flow 策略(RFC 8628)。
 *
 * 从 auth/index.ts 提取。只负责"申请设备码 + 轮询 token",不含落盘。
 * 支持 split-flow(通过 FlowDeps 的 args 传入 --no-wait / --device-code)。
 */
import { deviceAuthorization, pollDeviceToken, type TokenInfo, type PollResult } from "../oauth.js";
import { AuthenticationError } from "../errs/index.js";
import type { AuthFlow, FlowDeps } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 轮询 device token 直到拿到/超时/失败(RFC 8628)。
 * 收到 slow_down 时 interval 增加 5 秒(§3.2)。
 */
async function pollForToken(
  cfg: FlowDeps["cfg"],
  deviceCode: string,
  ttlSec: number,
  intervalMs: number,
  poller: (cfg: FlowDeps["cfg"], deviceCode: string) => Promise<PollResult>,
): Promise<TokenInfo> {
  let interval = intervalMs;
  const deadline = Date.now() + ttlSec * 1000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await sleep(Math.min(interval, remaining));
    if (Date.now() >= deadline) break;
    const r = await poller(cfg, deviceCode);
    if (r.status === "ok") return r.token;
    if (r.status === "slow_down") {
      interval += 5000;
      continue;
    }
    if (r.status === "pending") continue;
    throw new AuthenticationError({
      subtype: "token_revoked",
      message: `Login failed: ${r.message}`,
    });
  }
  throw new AuthenticationError({
    subtype: "token_expired",
    message: "Login timed out, please retry",
  });
}

export const deviceFlow: AuthFlow = {
  type: "device" as const,

  async login(deps: FlowDeps): Promise<TokenInfo> {
    const info = await deviceAuthorization(deps.cfg, deps.scope);

    // 提示用户打开浏览器
    const url = info.verification_uri_complete ?? info.verification_uri;
    deps.log?.info(
      `\nPlease complete login in your browser:\n  ${url}\n  user code: ${info.user_code}\n\nWaiting for login to complete...`,
    );

    // 阻塞轮询(用服务端返回的 interval)
    const poller = deps.poller ?? pollDeviceToken;
    return pollForToken(deps.cfg, info.device_code, info.expires_in, info.interval * 1000, poller);
  },
  // 不实现 refresh → 框架用默认 refreshAccessToken
};
