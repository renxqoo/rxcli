/** Public command-definition API. Application assembly lives behind one deep runtime boundary. */

import type { App, ArgsSpec, CommandGroup, CommandSpec, DefineCliOptions } from "./types.js";
import type { ParsedArgs } from "./args.js";
import { createCliApplication } from "./cli-application.js";
import { validateCommandSpec } from "./command-registry.js";

/** Declare and validate one command. */
export function defineCommand<Args = any, Result = unknown, State = unknown>(
  spec: CommandSpec<Args, Result, State>,
): CommandSpec<Args, Result, State> {
  validateCommandSpec(spec.name, spec);
  return spec;
}

/** Infer command argument types directly from the declared schema. */
export function defineCommandFromArgs<
  const Schema extends ArgsSpec,
  Result = unknown,
  State = unknown,
>(
  spec: Omit<CommandSpec<ParsedArgs<Schema>, Result, State>, "args"> & { args: Schema },
): CommandSpec<ParsedArgs<Schema>, Result, State> {
  return defineCommand<ParsedArgs<Schema>, Result, State>(spec);
}

/** Declare a command group whose keys are the canonical command names. */
export function defineCommands<State = unknown>(group: CommandGroup<State>): CommandGroup<State> {
  for (const [key, command] of Object.entries(group)) validateCommandSpec(key, command);
  return group;
}

/** Compile a declarative CLI definition into an executable application. */
export function defineCli<State = Record<string, never>>(options: DefineCliOptions<State>): App {
  return createCliApplication(options);
}

export { detectBizPackage, type BizPackageInfo } from "./package-detect.js";
