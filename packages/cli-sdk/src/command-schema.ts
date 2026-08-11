import { ValidationError } from "./errs/index.js";
import type { ArgSpec, ArgsSpec } from "./types.js";

export const MISSING_ARGUMENT_VALUE = Symbol("missing-argument-value");
export const RESERVED_ARGUMENT_NAMES = new Set(["json", "api-key", "help", "version"]);
const ARGUMENT_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*$/;

export interface ArgumentDescriptor {
  name: string;
  type: ArgSpec["type"];
  required: boolean;
  positional: boolean;
  defaultValue?: unknown;
  description?: string;
  displayName: string;
  signature: string;
}

export interface CommandSignature {
  positionals: string[];
  options: string[];
}

export interface ParsedCommandTokens {
  options: Record<string, unknown>;
  positionals: string[];
}

export interface CompiledCommandSchema {
  readonly descriptors: readonly ArgumentDescriptor[];
  readonly signature: CommandSignature;
  tokenize(argv: readonly string[]): ParsedCommandTokens;
  parse(argv: readonly string[]): Record<string, unknown>;
  parseTokens(
    options: Record<string, unknown>,
    positionals: readonly string[],
  ): Record<string, unknown>;
}

export function compileCommandSchema(
  commandName: string,
  specification: ArgsSpec | undefined,
): CompiledCommandSchema {
  return new DefaultCommandSchema(commandName, specification ?? {});
}

class DefaultCommandSchema implements CompiledCommandSchema {
  readonly descriptors: readonly ArgumentDescriptor[];
  readonly signature: CommandSignature;
  readonly #byName: ReadonlyMap<string, ArgumentDescriptor>;

  constructor(commandName: string, specification: ArgsSpec) {
    this.descriptors = compileDescriptors(commandName, specification);
    this.#byName = new Map(this.descriptors.map((descriptor) => [descriptor.name, descriptor]));
    this.signature = Object.freeze({
      positionals: this.descriptors.filter((arg) => arg.positional).map((arg) => arg.signature),
      options: this.descriptors.filter((arg) => !arg.positional).map((arg) => arg.signature),
    });
  }

  tokenize(argv: readonly string[]): ParsedCommandTokens {
    const options: Record<string, unknown> = {};
    const positionals: string[] = [];
    let onlyPositionals = false;

    for (let index = 0; index < argv.length; index++) {
      const token = argv[index]!;
      if (!onlyPositionals && token === "--") {
        onlyPositionals = true;
        continue;
      }
      if (onlyPositionals || !token.startsWith("--")) {
        if (
          !onlyPositionals &&
          token.startsWith("-") &&
          token.length > 1 &&
          !isNegativeNumber(token)
        ) {
          throw invalidShortFlag(token);
        }
        positionals.push(token);
        continue;
      }

      const equalsIndex = token.indexOf("=");
      if (equalsIndex >= 0) {
        const name = token.slice(2, equalsIndex);
        this.#setOption(options, name, token.slice(equalsIndex + 1));
        continue;
      }

      const name = token.slice(2);
      if (name.startsWith("no-")) {
        const positiveName = name.slice(3);
        const descriptor = this.#byName.get(positiveName);
        if (!descriptor || descriptor.type !== "boolean") {
          throw new ValidationError({
            subtype: "invalid_argument",
            param: `--${name}`,
            message: `Unknown flag --${name} (no boolean arg named "${positiveName}")`,
            hint: "Check the spelling or declare the argument as boolean.",
          });
        }
        options[positiveName] = false;
        continue;
      }

      const descriptor = this.#byName.get(name);
      if (descriptor?.type === "boolean") {
        options[name] = true;
        continue;
      }
      const next = argv[index + 1];
      if (descriptor && next !== undefined && (isNegativeNumber(next) || !next.startsWith("-"))) {
        this.#setOption(options, name, next);
        index++;
      } else if (!descriptor && next !== undefined && !next.startsWith("-")) {
        options[name] = next;
        index++;
      } else {
        options[name] = descriptor ? MISSING_ARGUMENT_VALUE : true;
      }
    }
    return { options, positionals };
  }

  parse(argv: readonly string[]): Record<string, unknown> {
    const tokens = this.tokenize(argv);
    return this.parseTokens(tokens.options, tokens.positionals);
  }

  parseTokens(
    options: Record<string, unknown>,
    positionals: readonly string[],
  ): Record<string, unknown> {
    for (const name of Object.keys(options)) {
      if (!this.#byName.has(name)) throw unknownArgument(name);
    }

    const output: Record<string, unknown> = {};
    let positionalIndex = 0;
    for (const descriptor of this.descriptors) {
      let value = descriptor.positional ? positionals[positionalIndex++] : options[descriptor.name];
      if (descriptor.positional && value === undefined) value = options[descriptor.name];

      if ((value === undefined || value === null) && descriptor.required) {
        throw new ValidationError({
          subtype: "missing_required",
          param: descriptor.displayName,
          message: `Missing required argument ${descriptor.displayName}`,
          hint: descriptor.description ? `See: ${descriptor.description}` : undefined,
        });
      }
      if (value === undefined || value === null) {
        if (descriptor.defaultValue !== undefined) {
          output[descriptor.name] = coerce(descriptor, descriptor.defaultValue);
        }
        continue;
      }
      output[descriptor.name] = coerce(descriptor, value);
    }

    if (positionalIndex < positionals.length) {
      throw new ValidationError({
        subtype: "invalid_argument",
        param: positionals[positionalIndex],
        message: `Unexpected positional argument(s): ${positionals.slice(positionalIndex).join(" ")}`,
      });
    }
    return output;
  }

  #setOption(options: Record<string, unknown>, name: string, value: unknown): void {
    if (this.#byName.get(name)?.type !== "array") {
      options[name] = value;
      return;
    }
    const current = options[name];
    options[name] =
      current === undefined ? [value] : [...(Array.isArray(current) ? current : [current]), value];
  }
}

function compileDescriptors(commandName: string, specification: ArgsSpec): ArgumentDescriptor[] {
  let sawOptionalPositional = false;
  return Object.entries(specification).map(([name, argument]) => {
    if (!ARGUMENT_IDENTIFIER.test(name)) {
      throw new Error(
        `argument identifier "${name}" is invalid; use letters, digits, and single hyphens`,
      );
    }
    if (RESERVED_ARGUMENT_NAMES.has(name)) {
      throw new Error(
        `defineCommand(${commandName}): argument ${name} is reserved by the CLI framework`,
      );
    }
    if (argument.required && argument.default !== undefined) {
      throw new Error(
        `defineCommand(${commandName}): argument ${name} cannot declare both required and default`,
      );
    }
    if (argument.positional) {
      if (!argument.required) sawOptionalPositional = true;
      else if (sawOptionalPositional) {
        throw new Error(
          `defineCommand(${commandName}): required positional argument ${name} cannot follow an optional positional argument`,
        );
      }
    }
    const positional = Boolean(argument.positional);
    const required = Boolean(argument.required);
    return Object.freeze({
      name,
      type: argument.type,
      required,
      positional,
      ...(argument.default !== undefined ? { defaultValue: argument.default } : {}),
      ...(argument.desc ? { description: argument.desc } : {}),
      displayName: positional ? name : `--${name}`,
      signature: signature(name, argument),
    });
  });
}

function signature(name: string, argument: ArgSpec): string {
  if (argument.positional) return argument.required ? `<${name}>` : `[${name}]`;
  if (argument.type === "boolean") return argument.required ? `--${name}` : `[--${name}]`;
  const value = argument.type === "array" ? "<string>..." : `<${argument.type}>`;
  const token = `--${name} ${value}`;
  return argument.required ? token : `[${token}]`;
}

function coerce(descriptor: ArgumentDescriptor, value: unknown): unknown {
  if (value === MISSING_ARGUMENT_VALUE) {
    throw new ValidationError({
      subtype: "missing_required",
      param: `--${descriptor.name}`,
      message: `Argument --${descriptor.name} requires a value`,
    });
  }
  switch (descriptor.type) {
    case "string":
      return String(value);
    case "number": {
      const number = Number(value);
      if (value === "" || !Number.isFinite(number)) {
        throw new ValidationError({
          subtype: "invalid_argument",
          param: `--${descriptor.name}`,
          message: `--${descriptor.name} must be a number, got: ${String(value)}`,
        });
      }
      return number;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0" || value === "") return false;
      throw new ValidationError({
        subtype: "invalid_argument",
        param: `--${descriptor.name}`,
        message: `--${descriptor.name} must be a boolean (true/false/1/0), got: ${String(value)}`,
      });
    case "array":
      return (Array.isArray(value) ? value : [value]).map(String);
  }
}

function unknownArgument(name: string): ValidationError {
  return new ValidationError({
    subtype: "invalid_argument",
    param: `--${name}`,
    message: `Unknown argument --${name}`,
  });
}

function invalidShortFlag(token: string): ValidationError {
  return new ValidationError({
    subtype: "invalid_argument",
    param: token,
    message: `Unknown short flag ${token} (this framework only supports long flags --xxx)`,
    hint: `To pass a negative number, use -- as a separator: command -- ${token}`,
  });
}

function isNegativeNumber(token: string): boolean {
  return /^-\d+(\.\d+)?$/.test(token);
}
