/**
 * @renxqoo/agent-data-cli —— 命令执行器(pipeline)
 *
 * 设计依据:docs/02-sdk-guide.md "生命周期总图"、docs/03-envelopes.md。
 *
 * 执行顺序:
 *   1. 跑插件 beforeCommand(pre→normal→post) 填 state
 *   2. 跑命令 run(args, ctx) 业务逻辑,ctx.get 发请求,return {data,meta}
 *      ├ 每次 ctx.get/post:
 *      │    插件 beforeRequest → 真正发请求 → 插件 afterRequest
 *   3. 若有返回值:跑插件 beforeOutput(pre→normal→post) transform data
 *   4. 框架包信封 + 序列化到 stdout(process.stdout.write,无 \n)
 *
 *   任意阶段抛错 → 非 CliError 包装 InternalError → onError 链 → 渲染错误信封到 stderr + exit code
 *   BareError → 直接 exit code,不渲染信封(谓词命令例外)
 */

import type { CommandSpec, CommandContext, Plugin, Meta, StructuredData } from "./types.js";
import { CliError, BareError, InternalError, toCliError, exitCodeOf } from "./errs/index.js";
import { serializeSuccess, serializeError } from "./envelope.js";
import { prettyPrint, prettyError } from "./pretty.js";
import { runBeforeCommand, runBeforeOutput, runOnError } from "./plugin.js";
import { credentialArgsKey } from "./context.js";

// ============================================================================
// 执行单个命令(返回 exit code;信封已写到 stdout/stderr)
// ============================================================================

export interface RunCommandOptions<State> {
  spec: CommandSpec;
  /** 可延迟解析，使参数错误也经过 plugin onError 与统一输出格式。 */
  args: Record<string, unknown> | (() => Record<string, unknown>);
  ctx: CommandContext<State>;
  plugins: Plugin<State>[];
  /** identity(由 auth 插件注入;信封顶层用)。可传函数延迟读(beforeCommand 后才有值)。 */
  identity?: "user" | "bot" | (() => "user" | "bot" | undefined);
  /** 当前命令路径段(如 ['auth','login']);用于精确豁免 plugin 自己的 beforeCommand。 */
  route?: string[];
  /** --no-json 文本输出模式(已做管道保护:被管道时为 false)。 */
  humanReadable?: boolean;
  /** 框架级凭证参数；通过内部 Symbol 只暴露给 auth，不传给 command 或其他 plugin。 */
  pluginArgs?: Record<string, unknown>;
  /** App 装配期计算的 plugin route ownership，避免把运行时元数据绑在可复用 plugin 对象上。 */
  ownedRoutes?: ReadonlyMap<Plugin<State>, string[][]>;
  /** 输出信封的来源 namespace，供下游 pipe 保留上游类型。 */
  source?: string;
}

/**
 * 执行一个命令并渲染输出。返回 exit code(0 成功,非 0 失败)。
 * 不直接 process.exit —— 由调用方(defineCli.run)统一设 process.exitCode。
 */
export async function runCommand<State>(opts: RunCommandOptions<State>): Promise<number> {
  const { spec, ctx, plugins } = opts;

  // resolve identity:支持函数形式(beforeCommand 后才有值)和静态值
  const resolveIdentity = (): "user" | "bot" | undefined =>
    typeof opts.identity === "function" ? opts.identity() : opts.identity;

  try {
    const args = typeof opts.args === "function" ? opts.args() : opts.args;
    if (opts.pluginArgs) {
      (ctx as CommandContext<State> & { [credentialArgsKey]?: Record<string, unknown> })[
        credentialArgsKey
      ] = opts.pluginArgs;
    }
    // 1. beforeCommand(填 state)—— internal 命令跳过(不走 auth/凭证校验)
    //    业务权限不做本地预检,交给服务端 403 拒绝(对齐 v1)。
    //    route 传给 runBeforeCommand:plugin 自己贡献的命令精确豁免自身 beforeCommand。
    if (!spec.internal) {
      await runBeforeCommand(plugins, ctx, opts.route, opts.ownedRoutes);
    }

    // 2. run(业务逻辑)
    const result = await spec.run(args, ctx);

    // 3. void 返回(纯副作用命令,如管道下游边读边写)→ 输出空成功信封
    if (result === undefined || result === null) {
      if (opts.humanReadable) {
        process.stdout.write("（无输出）\n");
      } else {
        process.stdout.write(
          serializeSuccess(null, undefined, { identity: resolveIdentity(), source: opts.source }),
        );
      }
      return 0;
    }
    if (
      typeof result !== "object" ||
      !Object.prototype.hasOwnProperty.call(result, "data") ||
      result.data === undefined
    ) {
      throw new InternalError({
        subtype: "contract_violation",
        message: `命令 ${spec.name} 必须返回 { data } 或 void`,
      });
    }

    // 3'. beforeOutput transform data
    const transformed: StructuredData = await runBeforeOutput(plugins, ctx, result.data);
    if (transformed === undefined) {
      throw new InternalError({
        subtype: "contract_violation",
        message: `命令 ${spec.name} 的 beforeOutput 返回了 undefined`,
      });
    }
    const meta = result.meta;

    // 4. 序列化输出到 stdout
    // 信封例外:meta._rawOutput=true 的命令(如 skills read)直接吐 data 原文,不走信封
    if (meta && meta._rawOutput) {
      process.stdout.write(
        typeof transformed === "string" ? transformed : String(transformed ?? ""),
      );
      return 0;
    }

    // 标准输出:--no-json(且非管道)→ 人类可读文本;否则 JSON 信封
    const cleanMeta = meta ? stripInternalMeta(meta) : undefined;
    if (opts.humanReadable) {
      // 命令声明了 humanFormat 用命令的;否则用框架通用兜底 prettyPrint
      const render = spec.humanFormat ?? prettyPrint;
      process.stdout.write(render(transformed, cleanMeta) + "\n");
    } else {
      process.stdout.write(
        serializeSuccess(transformed, cleanMeta, {
          identity: resolveIdentity(),
          source: opts.source,
        }),
      );
    }
    return 0;
  } catch (err) {
    return handleCommandError(
      err,
      ctx,
      plugins,
      resolveIdentity(),
      opts.humanReadable,
      opts.source,
    );
  }
}

// ============================================================================
// 辅助:去掉 meta 里下划线前缀的内部标记字段(不进 wire)
// ============================================================================

function stripInternalMeta(meta: Meta): Meta {
  const out: Meta = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k.startsWith("_")) continue; // 内部标记(_rawOutput 等)不进 wire
    out[k] = v;
  }
  return out;
}

// ============================================================================
// 错误处理:onError 链 → 渲染错误信封 → exit code
// ============================================================================

async function handleCommandError<State>(
  err: unknown,
  ctx: CommandContext<State>,
  plugins: Plugin<State>[],
  identity?: "user" | "bot",
  humanReadable?: boolean,
  source?: string,
): Promise<number> {
  // BareError:唯一绕过信封的特例,只设 exit code
  if (err instanceof BareError) {
    return err.exitCode;
  }

  // 非 CliError → 包装 InternalError(unknown)(裸 Error 会被兜底成 internal/unknown,exit 5)
  let cliErr: CliError = toCliError(err);

  // onError 链:每个插件跑一遍,可归一化/脱敏/吞掉
  let after: unknown;
  try {
    after = await runOnError(plugins, ctx, cliErr);
  } catch (hookError) {
    // 错误钩子本身也是不可信扩展边界；不能让它破坏 CLI 的结构化错误契约。
    after = hookError;
  }
  if (after === undefined) {
    // 被插件吞掉(命令变成功)—— 输出空成功信封,exit 0
    if (humanReadable) {
      process.stdout.write("（无输出）\n");
    } else {
      process.stdout.write(serializeSuccess(null, undefined, { identity, source }));
    }
    return 0;
  }
  cliErr = toCliError(after);

  // 渲染错误到 stderr:--no-json(且非管道)→ 人类可读文本;否则 JSON 信封
  if (humanReadable) {
    process.stderr.write(prettyError(cliErr) + "\n");
  } else {
    process.stderr.write(serializeError(cliErr, { identity }) + "\n");
  }
  return exitCodeOf(cliErr.category);
}
