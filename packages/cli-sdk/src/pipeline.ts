/** 命令运行时：生命周期、输出契约和错误决策只有这一处拥有。 */

import type { CommandContext, CommandResult, CommandSpec, Plugin } from "./types.js";
import { BareError, InternalError, exitCodeOf, toCliError } from "./errs/index.js";
import { serializeError, serializeSuccess } from "./envelope.js";
import { prettyError, prettyPrint } from "./pretty.js";
import { handleError, observeError, runBeforeCommand, transformOutput } from "./plugin.js";
import { credentialArgsKey } from "./context.js";
import { isRawTextResult, isStructuredData } from "./output.js";

export interface RunCommandOptions<State> {
  spec: CommandSpec<any, unknown, State>;
  /** 延迟解析让参数错误也经过统一错误边界。 */
  args: Record<string, unknown> | (() => Record<string, unknown>);
  ctx: CommandContext<State>;
  plugins: Plugin<State>[];
  identity?: "user" | "bot" | (() => "user" | "bot" | undefined);
  route: string[];
  humanReadable?: boolean;
  pluginArgs?: Record<string, unknown>;
  ownedRoutes?: ReadonlyMap<Plugin<State>, string[][]>;
  source: string;
}

interface RenderOptions {
  identity?: "user" | "bot";
  humanReadable?: boolean;
  source: string;
}

/** 执行一个命令并渲染输出；调用方只负责把返回值设为进程退出码。 */
export async function runCommand<State>(options: RunCommandOptions<State>): Promise<number> {
  const { spec, ctx, plugins } = options;
  const resolveIdentity = (): "user" | "bot" | undefined =>
    typeof options.identity === "function" ? options.identity() : options.identity;

  try {
    const args = typeof options.args === "function" ? options.args() : options.args;
    if (options.pluginArgs) {
      (ctx as CommandContext<State> & { [credentialArgsKey]?: Record<string, unknown> })[
        credentialArgsKey
      ] = options.pluginArgs;
    }

    if (!spec.internal) {
      await runBeforeCommand(plugins, ctx, options.route, options.ownedRoutes);
    }

    const result = await spec.run(args, ctx);
    return await renderCommandResult(result, spec, ctx, plugins, {
      identity: resolveIdentity(),
      humanReadable: options.humanReadable,
      source: options.source,
    });
  } catch (error) {
    return handleCommandError(error, spec, ctx, plugins, {
      identity: resolveIdentity(),
      humanReadable: options.humanReadable,
      source: options.source,
    });
  }
}

async function renderCommandResult<State>(
  result: CommandResult<unknown> | void,
  spec: CommandSpec<any, unknown, State>,
  ctx: CommandContext<State>,
  plugins: Plugin<State>[],
  options: RenderOptions,
): Promise<number> {
  if (result === undefined) {
    if (options.humanReadable) {
      process.stdout.write("(no output)\n");
    } else {
      process.stdout.write(
        serializeSuccess(null, undefined, {
          identity: options.identity,
          source: options.source,
        }),
      );
    }
    return 0;
  }

  if (isRawTextResult(result)) {
    process.stdout.write(result.text);
    return 0;
  }

  if (
    !result ||
    typeof result !== "object" ||
    !Object.prototype.hasOwnProperty.call(result, "data") ||
    !("data" in result) ||
    result.data === undefined
  ) {
    throw contractViolation(`Command ${spec.name} must return { data }, rawText(), or void`);
  }
  if (!isStructuredData(result.data)) {
    throw contractViolation(
      `Command ${spec.name} data must be object/array/null, got ${typeof result.data}`,
    );
  }

  const transformed = await transformOutput(plugins, ctx, result.data);
  const meta = "meta" in result ? result.meta : undefined;
  if (options.humanReadable) {
    const format = spec.humanFormat ?? prettyPrint;
    process.stdout.write(format(transformed, meta) + "\n");
  } else {
    process.stdout.write(
      serializeSuccess(transformed, meta, {
        identity: options.identity,
        source: options.source,
      }),
    );
  }
  return 0;
}

async function handleCommandError<State>(
  error: unknown,
  spec: CommandSpec<any, unknown, State>,
  ctx: CommandContext<State>,
  plugins: Plugin<State>[],
  options: RenderOptions,
): Promise<number> {
  if (error instanceof BareError) return error.exitCode;

  let cliError = toCliError(error);
  await observeError(plugins, ctx, cliError);
  const decision = await handleError(plugins, ctx, cliError);

  if (decision.action === "recover") {
    try {
      return await renderCommandResult(decision.result, spec, ctx, plugins, options);
    } catch (recoveryError) {
      cliError = toCliError(recoveryError);
    }
  } else {
    cliError = toCliError(decision.error);
  }

  if (options.humanReadable) {
    process.stderr.write(prettyError(cliError) + "\n");
  } else {
    process.stderr.write(serializeError(cliError, { identity: options.identity }) + "\n");
  }
  return exitCodeOf(cliError.category);
}

function contractViolation(message: string): InternalError {
  return new InternalError({ subtype: "contract_violation", message });
}
