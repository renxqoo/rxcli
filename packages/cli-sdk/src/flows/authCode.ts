/**
 * authorization_code + PKCE 策略(RFC 6749 §4.1 + RFC 7636)。
 *
 * 组合 L1(协议原语)+ L2(浏览器 + 回调服务器):
 *  1. 生成 PKCE verifier + challenge(S256)
 *  2. 启动本地回调服务器
 *  3. 构建 authorize URL → 打开浏览器
 *  4. 等待回调拿到 code
 *  5. 用 code + code_verifier 换 token
 */
import {
  generateCodeVerifier,
  computeCodeChallenge,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  type TokenInfo,
} from "../oauth.js";
import { defaultBrowserOpener } from "../infra/browser.js";
import { waitForCallback } from "../infra/callback-server.js";
import { AuthenticationError } from "../errs/index.js";
import type { AuthFlow, FlowDeps } from "./types.js";

export const authCodeFlow: AuthFlow = {
  type: "authorization_code" as const,

  async login(deps: FlowDeps): Promise<TokenInfo> {
    // 1. PKCE
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier);

    // 2. 启动本地回调监听
    const handle = await waitForCallback({
      port: deps.callbackPort,
      timeoutMs: 5 * 60_000, // 5 分钟超时
    });

    // 3. 构建 authorize URL + 打开浏览器
    const state = deps.state ?? generateCodeVerifier().slice(0, 16); // 随机 state 防 CSRF
    const authUrl = buildAuthorizeUrl(deps.cfg, {
      redirectUri: handle.redirectUri,
      scope: deps.scope,
      codeChallenge: challenge,
      state,
    });

    deps.log?.info(`\nOpening browser for login:\n  ${authUrl}\n`);
    const browser = deps.browser ?? defaultBrowserOpener();
    await browser.open(authUrl);

    // 4. 等待回调
    let result;
    try {
      result = await handle.result;
    } finally {
      handle.close();
    }

    if (result.error) {
      throw new AuthenticationError({
        subtype: "token_revoked",
        message: `Authorization denied: ${result.error}`,
      });
    }
    // CSRF 校验:state 必须匹配(RFC 6749 §10.12)
    if (result.state !== state) {
      throw new AuthenticationError({
        subtype: "token_revoked",
        message: "State mismatch (possible CSRF attack)",
      });
    }
    if (!result.code) {
      throw new AuthenticationError({
        subtype: "token_revoked",
        message: "No authorization code received",
      });
    }

    // 5. 用 code + verifier 换 token
    return exchangeCodeForToken(deps.cfg, {
      code: result.code,
      codeVerifier: verifier,
      redirectUri: handle.redirectUri,
    });
  },
  // 不实现 refresh → 框架用默认 refreshAccessToken
};
