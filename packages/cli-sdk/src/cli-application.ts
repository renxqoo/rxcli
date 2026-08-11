/**
 * Compiled CLI application runtime.
 *
 * This module owns application assembly and `App.run(argv)` orchestration. Callers provide one
 * declarative `DefineCliOptions` value; the runtime hides registry composition, framework flags,
 * routing, output-mode selection, context creation, and top-level error rendering.
 */

import type {
  App,
  CommandContext,
  CommandSpec,
  DefineCliOptions,
  ErrorOnStatus,
  Plugin,
} from "./types.js";
import type { IdentityHint } from "./credentials/types.js";
import { MISSING_FLAG_VALUE } from "./args.js";
import {
  hasCommandHelp,
  matchRoute,
  parseFrameworkArgs,
  type FrameworkArgs,
  type RoutedCommand,
} from "./cli-argv.js";
import {
  assertRouteIdentifier,
  CommandRegistry,
  validateErrorOnStatus,
} from "./command-registry.js";
import { createContext, identityKey } from "./context.js";
import { serializeError } from "./envelope.js";
import { errs, exitCodeOf, toCliError } from "./errs/index.js";
import { renderCommandHelp, renderHelp } from "./help.js";
import { detectBinName, detectVersion } from "./package-detect.js";
import { createPipeReader, emptyPipe } from "./pipe.js";
import { runCommand } from "./pipeline.js";
import { qrcodeCommand } from "./qrcode.js";
import { createFetchAdapter } from "./request.js";
import { createBuiltinSkillsCommands } from "./skills/builtin.js";

type DefaultFormat = "auto" | "json" | "human";

interface CompiledApplication<State> {
  name: string;
  description: string;
  binName: string;
  defaultFormat: DefaultFormat;
  routed: RoutedCommand<State>[];
  plugins: Plugin<State>[];
  ownedRoutes: ReadonlyMap<Plugin<State>, string[][]>;
  createState: () => State;
  baseUrl?: string;
  errorOnStatus?: ErrorOnStatus;
}

interface CommandInvocation<State> {
  matched: RoutedCommand<State>;
  rawOptions: Record<string, unknown>;
  rawPositionals: string[];
  humanReadable: boolean;
  pluginArgs?: Record<string, unknown>;
}

export function createCliApplication<State>(options: DefineCliOptions<State>): App {
  return new CliApplicationRuntime(compileApplication(options));
}

class CliApplicationRuntime<State> implements App {
  readonly name: string;
  readonly #compiled: CompiledApplication<State>;

  constructor(compiled: CompiledApplication<State>) {
    this.name = compiled.name;
    this.#compiled = compiled;
  }

  async run(argv: string[]): Promise<void> {
    try {
      await this.#dispatch(argv);
    } catch (error) {
      this.#renderFailure(error);
    }
  }

  async #dispatch(argv: string[]): Promise<void> {
    const framework = parseFrameworkArgs(argv);
    const { matched, rest } = matchRoute(framework.commandArgv, this.#compiled.routed);

    if (framework.leadingVersion) {
      process.stdout.write(`${this.#compiled.binName}/${detectVersion()}\n`);
      process.exitCode = 0;
      return;
    }

    if (!matched) {
      this.#renderMissingRoute(argv, framework.leadingHelp, framework.commandArgv.length === 0);
      return;
    }

    if (hasCommandHelp(rest)) {
      process.stdout.write(renderCommandHelp(this.#compiled.binName, matched) + "\n");
      process.exitCode = 0;
      return;
    }

    const parsed = matched.schema.tokenize(rest);
    const pluginArgs = framework.apiKey === undefined ? undefined : { apiKey: framework.apiKey };
    const exitCode = await this.#execute({
      matched,
      rawOptions: parsed.options,
      rawPositionals: parsed.positionals,
      humanReadable: resolveHumanReadable(framework.format, this.#compiled.defaultFormat),
      ...(pluginArgs ? { pluginArgs } : {}),
    });
    process.exitCode = exitCode;
  }

  #renderMissingRoute(argv: string[], leadingHelp: boolean, emptyCommand: boolean): void {
    if (leadingHelp || emptyCommand) {
      process.stdout.write(
        renderHelp(this.#compiled.binName, this.#compiled.description, this.#compiled.routed) +
          "\n",
      );
      process.exitCode = 0;
      return;
    }

    const attempted =
      argv.filter((argument) => !argument.startsWith("-")).join(" ") || argv.join(" ");
    throw new errs.ValidationError({
      subtype: "invalid_argument",
      message: `Unknown command: ${attempted}`,
      hint: `Run \`${this.#compiled.binName} --help\` to see available commands`,
    });
  }

  async #execute(invocation: CommandInvocation<State>): Promise<number> {
    const { matched } = invocation;
    const adapter = createFetchAdapter({ baseUrl: this.#compiled.baseUrl });
    const pipe = process.stdin.isTTY ? emptyPipe() : createPipeReader(process.stdin);
    const ctx = createContext<State>({
      state: this.#compiled.createState(),
      adapter,
      plugins: this.#compiled.plugins,
      errorOnStatus: this.#compiled.errorOnStatus,
      pipe,
    });

    return runCommand<State>({
      spec: matched.spec,
      args: () => parseInvocationArgs(invocation),
      ctx,
      plugins: this.#compiled.plugins,
      identity: () => readIdentity(ctx),
      route: matched.route,
      humanReadable: invocation.humanReadable,
      pluginArgs: invocation.pluginArgs,
      ownedRoutes: this.#compiled.ownedRoutes,
      source: this.#compiled.name,
    });
  }

  #renderFailure(error: unknown): void {
    if (error instanceof errs.BareError) {
      process.exitCode = error.exitCode;
      return;
    }
    const cliError = toCliError(error);
    process.stderr.write(serializeError(cliError) + "\n");
    process.exitCode = exitCodeOf(cliError.category);
  }
}

function compileApplication<State>(options: DefineCliOptions<State>): CompiledApplication<State> {
  assertRouteIdentifier(options.name, "app");
  validateErrorOnStatus(options.errorOnStatus);

  const plugins = [...(options.plugins ?? [])];
  const binName = options.binName ?? detectBinName() ?? options.name;
  const createState = resolveStateFactory(options);
  const registry = new CommandRegistry<State>();
  for (const plugin of plugins) registry.registerPlugin(plugin);
  registry.registerApplication(options.commands, options.namespaces);

  const commands = registry.commands();
  const namespaces = registry.namespaces();
  registry.registerDefault(["qrcode"], qrcodeCommand as CommandSpec<any, unknown, State>);

  if (options.skillsDir) {
    const builtins = createBuiltinSkillsCommands(
      binName,
      options.skillsDir,
      { name: options.name, binName, commands, namespaces },
      options.skillsTargets,
      options.skillsScopes,
    );
    for (const [name, spec] of Object.entries(builtins)) {
      registry.registerDefault(["skills", name], spec as CommandSpec<any, unknown, State>);
    }
  }

  return {
    name: options.name,
    description: options.description,
    binName,
    defaultFormat: options.defaultFormat ?? "auto",
    routed: registry.routed(),
    plugins,
    ownedRoutes: registry.ownedRoutes(plugins),
    createState,
    baseUrl: options.baseUrl,
    errorOnStatus: options.errorOnStatus,
  };
}

function resolveStateFactory<State>(options: DefineCliOptions<State>): () => State {
  if (typeof options.createState === "function") return options.createState;
  return () => ({}) as State;
}

function resolveHumanReadable(format: FrameworkArgs["format"], fallback: DefaultFormat): boolean {
  const stdinIsPipe = !process.stdin.isTTY;
  if (format === "json") return false;
  if (format === "human") return !stdinIsPipe;
  if (fallback === "json") return false;
  if (fallback === "human") return !stdinIsPipe;
  return !!process.stdout.isTTY && !stdinIsPipe;
}

function parseInvocationArgs<State>(invocation: CommandInvocation<State>): Record<string, unknown> {
  if (invocation.pluginArgs?.apiKey === MISSING_FLAG_VALUE) {
    throw new errs.ValidationError({
      subtype: "missing_required",
      param: "--api-key",
      message: "Argument --api-key requires a value",
    });
  }
  return invocation.matched.schema.parseTokens(invocation.rawOptions, invocation.rawPositionals);
}

function readIdentity<State>(ctx: CommandContext<State>): "user" | "bot" | undefined {
  return (ctx as CommandContext<State> & { [identityKey]?: IdentityHint })[identityKey]?.identity;
}
