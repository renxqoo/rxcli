/**
 * @renxqoo/agent-data-cli —— 插件编排(vite 式)
 *
 * 设计依据:docs/02-sdk-guide.md "插件系统"。
 * 6 个钩子(beforeCommand/beforeRequest/afterRequest/onUnauthorized/beforeOutput/onError)
 * + enforce 三档(pre/normal/post)+ onError 链式。
 */

import type {
  Plugin,
  CommandContext,
  RequestOptions,
  TransportResponse,
  StructuredData,
} from "./types.js";

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
 * @param route 当前命令的路径段(如 ['auth','login']);不传 = 不豁免(单测直接调 runCommand 用)。
 */
export async function runBeforeCommand<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  route?: string[],
  ownedRoutes?: ReadonlyMap<Plugin<State>, string[][]>,
): Promise<void> {
  for (const p of withHook(plugins, "beforeCommand")) {
    // 精确豁免:plugin 自己的命令跳自己的 beforeCommand(不跳别的 plugin)
    if (route && isOwnedRoute(ownedRoutes?.get(p), route)) continue;
    await p.beforeCommand!(ctx);
  }
}

/** 判断 route 是否在 ownedRoutes 里(长度 + 逐段相等)。 */
function isOwnedRoute(owned: string[][] | undefined, route: string[]): boolean {
  if (!owned || owned.length === 0) return false;
  return owned.some((r) => r.length === route.length && r.every((seg, i) => seg === route[i]));
}

/** beforeRequest:每次 ctx.get/post 前,可改 req。 */
export async function runBeforeRequest<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  req: RequestOptions,
): Promise<void> {
  for (const p of withHook(plugins, "beforeRequest")) {
    await p.beforeRequest!(ctx, req);
  }
}

/** afterRequest:每次请求返回后,res 只读(副作用:审计/metric)。 */
export async function runAfterRequest<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  res: TransportResponse,
): Promise<void> {
  for (const p of withHook(plugins, "afterRequest")) {
    await p.afterRequest!(ctx, res);
  }
}

/**
 * 401 续期链。第一个明确返回 string/null 的插件负责本次 401；undefined 继续寻找下一个。
 */
export async function runOnUnauthorized<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  req: RequestOptions,
): Promise<string | null | undefined> {
  for (const plugin of withHook(plugins, "onUnauthorized")) {
    const result = await plugin.onUnauthorized!(ctx, req);
    if (result !== undefined) return result;
  }
  return undefined;
}

/**
 * beforeOutput:run 返回后、序列化前,transform data(返回新 StructuredData)。
 * 每个 beforeOutput 插件拿到上一个的输出,链式 transform。
 */
export async function runBeforeOutput<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  data: unknown,
): Promise<StructuredData> {
  let current: StructuredData = data as StructuredData;
  for (const p of withHook(plugins, "beforeOutput")) {
    current = await p.beforeOutput!(ctx, current);
  }
  return current;
}

// ============================================================================
// onError 链式
// ============================================================================

/**
 * onError 链式:每个插件都跑一遍,结果传给下一个。
 *
 * 返回值约定(对齐 docs/04-errors.md):
 *   - 返回新 error → 用它替换,传给下一个插件
 *   - 返回 undefined → **吞掉错误**(命令变成功)。危险操作,慎用。
 *   - 不处理应返回传入的 err(即 return err),而非 undefined
 *
 * 注意:链上任一插件返回 undefined 即吞掉;后续插件拿到 undefined 作为入参,
 * 可选择重新抛出(return 新 error)或保持吞掉(返回 undefined)。
 *
 * @returns 最终 error(undefined 表示被吞掉)。调用方需处理 undefined。
 */
export async function runOnError<State>(
  plugins: Plugin<State>[],
  ctx: CommandContext<State>,
  err: unknown,
): Promise<unknown> {
  let current: unknown = err;
  for (const p of withHook(plugins, "onError")) {
    try {
      current = await p.onError!(ctx, current);
    } catch {
      // 错误观察器失效不能覆盖原始业务错误；后续观察器仍继续处理 current。
    }
    // undefined = 吞掉;但继续跑后续插件(它们可能重新抛出)
  }
  return current;
}
