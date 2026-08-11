import type { ArgsSpec } from "./types.js";
import {
  compileCommandSchema,
  MISSING_ARGUMENT_VALUE,
  type CommandSignature,
} from "./command-schema.js";

export const MISSING_FLAG_VALUE = MISSING_ARGUMENT_VALUE;

type ParsedArgValue<Spec extends ArgsSpec[string]> = Spec["type"] extends "array"
  ? string[]
  : Spec["type"] extends "number"
    ? number
    : Spec["type"] extends "boolean"
      ? boolean
      : string;

type PresentArgKeys<S extends ArgsSpec> = {
  [K in keyof S]-?: S[K] extends { required: true } | { default: unknown } ? K : never;
}[keyof S];

export type ParsedArgs<S extends ArgsSpec> = {
  [K in PresentArgKeys<S>]: ParsedArgValue<S[K]>;
} & {
  [K in Exclude<keyof S, PresentArgKeys<S>>]?: ParsedArgValue<S[K]>;
};

/** Public functional façade over the compiled schema model. */
export function parseArgs(
  spec: ArgsSpec | undefined,
  options: Record<string, unknown>,
  positionals: string[],
): Record<string, unknown> {
  return compileCommandSchema("command", spec).parseTokens(options, positionals);
}

export function positionalLabel(name: string, argSpec: { positional?: boolean }): string {
  return argSpec.positional ? name : `--${name}`;
}

export function signatureOfArgs(spec: ArgsSpec | undefined): CommandSignature {
  return compileCommandSchema("command", spec).signature;
}
