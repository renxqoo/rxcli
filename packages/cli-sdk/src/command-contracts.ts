import type { CommandResult, Meta } from "./output-contracts.js";
import type { CommandContext } from "./runtime-contracts.js";

export type ArgType = "string" | "number" | "boolean" | "array";

export interface ArgSpec {
  type: ArgType;
  required?: boolean;
  positional?: boolean;
  desc?: string;
  default?: unknown;
}

export type ArgsSpec = Record<string, ArgSpec>;

export interface CommandSpec<Args = any, Result = unknown, State = unknown> {
  name: string;
  description: string;
  args?: ArgsSpec;
  internal?: boolean;
  humanFormat?: (data: unknown, meta?: Meta) => string;
  run: (args: Args, context: CommandContext<State>) => Promise<CommandResult<Result> | void>;
}

export type CommandGroup<State = unknown> = Record<string, CommandSpec<any, unknown, State>>;
