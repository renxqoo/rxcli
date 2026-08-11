/**
 * @renxqoo/agent-data-cli —— 插件编排(vite 式)
 *
 * 设计依据:docs/02-sdk-guide.md "插件系统"。
 * 生命周期钩子按职责拆成 prepare / observe / handle / transform，避免 void 被解释为控制流。
 */

import type {
  Plugin,
  CommandContext,
  RequestOptions,
  RequestAttemptEvent,
  UnauthorizedDecision,
  StructuredData,
  CommandResult,
} from "./types.js";
import { InternalError } from "./errs/index.js";
import { isStructuredData } from "./output.js";

// ============================================================================
// enforce 三档排序
// ============================================================================

type EnforceLevel = "pre" | "normal" | "post";

function enforceLevel(p: Plugin<any>): EnforceLevel {
  return p.enforce ?? "normal";
}

/**
 * 按 enforce 三档排序:pre → normal → post,档内保持注册序。
 * 用于同一钩子内确定插件执行顺序。
 */
export function sortPlugins<State>(plugins: Plugin<State>[]): Plugin<State>[] {
  const order: Record<EnforceLevel, number> = { pre: 0, normal: 1, post: 2 };
  return [...plugins].sort((a, b) => order[enforceLevel(a)] - order[enforceLevel(b)]);
}

/** 挑出实现了指定钩子的插件(已排序)。 */
function withHook<State, K extends keyof Plugin<State>>(
  plugins: Plugin<State>[],
  hook: K,
): Plugin<State>[] {
  return sortPlugins(plugins).filter((p) => typeof p[hook] === "function");
}

// ============================================================================
// 钩子执行器
// ============================================================================

/**
 * beforeCommand:命令 run 前,填 state。无返回值。
 *
 * 精确豁免:plugin 自己贡献的命令(由 App-local ownership map 标记)跳自身 beforeCommand,
 * 不跳别的 plugin。比 spec.internal 的"全跳"更细 —— auth 的 login 命令豁免 auth plugin 的
 * "必须登录"校验,但日志/审计 plugin 照跑。
 *
 * @param route 当前命令的路径段(如 ['auth','login'])。
 */
export async function runBeforeCommand<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  route: string[],
  ownedRoutes?: ReadonlyMap<Plugin<State>, string[][]>,
): Promise<void> {
  for (const p of withHook(plugins, "beforeCommand")) {
    // 精确豁免:plugin 自己的命令跳自己的 beforeCommand(不跳别的 plugin)
    if (isOwnedRoute(ownedRoutes?.get(p), route)) continue;
    await p.beforeCommand!(ctx);
  }
}

/** 判断 route 是否在 ownedRoutes 里(长度 + 逐段相等)。 */
function isOwnedRoute(owned: string[][] | undefined, route: string[]): boolean {
  if (!owned || owned.length === 0) return false;
  return owned.some((r) => r.length === route.length && r.every((seg, i) => seg === route[i]));
}

/** 每次 attempt 都从不可变逻辑请求重新构建待发送请求。 */
export async function prepareRequest<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  logicalRequest: Readonly<RequestOptions>,
): Promise<RequestOptions> {
  let current = cloneRequest(logicalRequest);
  for (const plugin of withHook(plugins, "prepareRequest")) {
    const next = await plugin.prepareRequest!(ctx, Object.freeze(cloneRequest(current)));
    if (!next || typeof next !== "object") {
      throw new InternalError({
        subtype: "contract_violation",
        message: `Plugin ${plugin.name} prepareRequest must return a request`,
      });
    }
    current = cloneRequest(next);
  }
  return current;
}

/** 每次物理请求恰好观察一次；观察器失败只记 warning，不改变业务结果。 */
export async function observeRequest<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  event: Readonly<RequestAttemptEvent>,
): Promise<void> {
  for (const plugin of withHook(plugins, "observeRequest")) {
    try {
      await plugin.observeRequest!(ctx, event);
    } catch (error) {
      ctx.log.warn(
        `observeRequest hook failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** 401 决策链：第一个 retry/reject 胜出；decline/undefined 继续。 */
export async function handleUnauthorized<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  event: Readonly<RequestAttemptEvent>,
): Promise<UnauthorizedDecision | undefined> {
  for (const plugin of withHook(plugins, "handleUnauthorized")) {
    const decision = await plugin.handleUnauthorized!(ctx, event);
    if (decision && decision.action !== "decline") return decision;
  }
  return undefined;
}

function cloneRequest(request: Readonly<RequestOptions>): RequestOptions {
  return {
    ...request,
    ...(request.query ? { query: { ...request.query } } : {}),
    ...(request.headers ? { headers: { ...request.headers } } : {}),
  };
}

/** 每个 transform 拿到上一个结构化输出；任一步返回标量都立即违反契约。 */
export async function transformOutput<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  data: unknown,
): Promise<StructuredData> {
  let current: StructuredData = data as StructuredData;
  for (const plugin of withHook(plugins, "transformOutput")) {
    current = await plugin.transformOutput!(ctx, current);
    if (!isStructuredData(current)) {
      throw new InternalError({
        subtype: "contract_violation",
        message: `Plugin ${plugin.name} transformOutput must return object/array/null`,
      });
    }
  }
  return current;
}

// ============================================================================
// 错误观察与显式恢复
// ============================================================================

/** 观察器失败只记录告警，绝不能覆盖或恢复原始错误。 */
export async function observeError<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  err: unknown,
): Promise<void> {
  for (const plugin of withHook(plugins, "observeError")) {
    try {
      await plugin.observeError!(ctx, err);
    } catch (hookErr) {
      ctx.log.warn(
        `observeError hook failed: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`,
      );
    }
  }
}

export type ResolvedErrorDecision =
  | { action: "pass"; error: unknown }
  | { action: "recover"; result?: CommandResult<StructuredData> };

/** replace 会把新错误传给后续 handler；recover 是唯一成功出口。 */
export async function handleError<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  error: unknown,
): Promise<ResolvedErrorDecision> {
  let current = error;
  for (const plugin of withHook(plugins, "handleError")) {
    try {
      const decision = await plugin.handleError!(ctx, current);
      if (decision === undefined) {
        ctx.log.warn(`Plugin ${plugin.name} handleError returned undefined; treating as pass`);
        continue;
      }
      if (decision.action === "recover") return decision;
      if (decision.action === "replace") current = decision.error;
    } catch (hookError) {
      ctx.log.warn(
        `handleError hook failed: ${hookError instanceof Error ? hookError.message : String(hookError)}`,
      );
    }
  }
  return { action: "pass", error: current };
}
