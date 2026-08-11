/**
 * AuthFlow 策略契约(L3)。
 *
 * 每种 OAuth flow 实现这个接口。框架(defineAuth)根据 flow 类型选择策略,
 * 调用 login() 拿 TokenInfo,然后统一处理存储/身份/续期。
 */

import type { OAuthClientConfig, TokenInfo, PollResult } from "../oauth.js";
import type { OAuthClient } from "../oauth-client.js";
import type { BrowserOpener } from "../infra/browser.js";

export type FlowType = "device" | "authorization_code" | "client_credentials";

/**
 * Flow 执行依赖(注入协议配置 + 可选的基础设施工具)。
 * 各 flow 只读自己需要的字段,忽略不相关的。
 */
export interface FlowDeps {
  /** OAuth 客户端配置(baseUrl + clientId/clientSecret)。 */
  cfg: OAuthClientConfig;
  /** Compiled protocol client shared by this auth runtime. */
  client?: OAuthClient;
  /** 业务声明的 scope。 */
  scope?: string;
  /** 日志输出(进度提示)。 */
  log?: { info(...args: unknown[]): void };
  // device flow 专用:
  /** device flow 轮询函数(测试注入)。 */
  poller?: (cfg: OAuthClientConfig, deviceCode: string) => Promise<PollResult>;
  /** device flow split-flow:--no-wait(申请设备码但不轮询,返回 url 给 agent)。 */
  noWait?: boolean;
  /** device flow split-flow:--device-code(用已有设备码恢复轮询)。 */
  resumeDeviceCode?: string;
  // authorization_code flow 专用:
  /** OAuth state(测试注入;不传=随机生成)。 */
  state?: string;
  /** 浏览器打开器(authCode flow 用)。 */
  browser?: BrowserOpener;
  /** 本地回调端口(authCode flow 用;不传=随机)。 */
  callbackPort?: number;
}

/**
 * 认证流程策略。每个 OAuth flow 实现此接口。
 */
export interface AuthFlow {
  /** flow 类型标识。 */
  readonly type: FlowType;

  /**
   * 执行登录,返回 token 信息。
   * 不含落盘逻辑——框架统一存储(login 只负责"怎么拿 token")。
   */
  login(deps: FlowDeps): Promise<TokenInfo>;

  /**
   * 续期(401 刷新时调)。可选——不实现 = 框架用默认 refreshAccessToken。
   * 只有 client_credentials 覆盖(它没有 refresh_token,重新 login)。
   */
  refresh?(deps: FlowDeps, refreshToken?: string): Promise<TokenInfo>;
}
