import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import type { Readable } from "node:stream";
import * as z from "zod";
import type { CommandArgs, CommandPolicy } from "./command-contracts.js";
import { ValidationError } from "./errs/index.js";
import { parseStrictJson, type JsonInputLimits } from "./strict-json.js";

export const RESERVED_ARGUMENT_NAMES = new Set([
  "json",
  "no-json",
  "api-key",
  "help",
  "version",
  "input",
  "input-file",
  "input-schema",
  "input-example",
  "dry-run",
  "yes",
  "idempotency-key",
]);

const ARGUMENT_IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DEFAULT_JSON_LIMITS: JsonInputLimits = {
  maxBytes: 1024 * 1024,
  maxDepth: 64,
  maxProperties: 10_000,
  maxArrayItems: 10_000,
  maxIssues: 100,
};

type CommandArgsMode = "argv" | "json";
type ArgumentType = "string" | "number" | "boolean" | "array";

export interface ArgumentDescriptor {
  /** Zod object property name passed to `run`. */
  name: string;
  /** Kebab-case CLI flag name. */
  flagName: string;
  type: ArgumentType;
  required: boolean;
  positional: boolean;
  defaultValue?: unknown;
  description?: string;
  displayName: string;
  signature: string;
}

interface CommandSignature {
  positionals: string[];
  options: string[];
}

interface ParsedCommandTokens {
  options: Record<string, unknown>;
  positionals: string[];
}

export interface JsonInputMeta {
  source: "inline" | "file" | "stdin";
  bytes: number;
  rawDigest: string;
  validatedDigest: string;
}

interface CommandExecutionState {
  dryRun: boolean;
  confirmed: boolean;
  idempotencyKey?: string;
  json?: JsonInputMeta;
}

export const commandExecutionKey: unique symbol = Symbol("rxcli.commandExecution");

/**
 * C1: a command spec is compiled exactly once. `defineCommand`/`defineCommands`
 * compile and stash the result here; the registry reuses it instead of recomputing
 * `z.toJSONSchema` on every registration path.
 */
export const compiledSchemaKey: unique symbol = Symbol("rxcli.compiledSchema");

export type ResolvedCommandArgs = Record<string, unknown> & {
  [commandExecutionKey]?: CommandExecutionState;
};

export interface CompiledCommandSchema {
  readonly mode: CommandArgsMode;
  readonly descriptors: readonly ArgumentDescriptor[];
  readonly signature: CommandSignature;
  readonly jsonSchema?: Record<string, unknown>;
  resolve(argv: readonly string[], stdin: Readable): Promise<ResolvedCommandArgs>;
}

export function compileCommandSchema(
  commandName: string,
  definition: CommandArgs | undefined,
  policy?: CommandPolicy<any, any>,
): CompiledCommandSchema {
  return new DefaultCommandSchema(commandName, definition, policy);
}

class DefaultCommandSchema implements CompiledCommandSchema {
  readonly mode: CommandArgsMode;
  readonly descriptors: readonly ArgumentDescriptor[];
  readonly signature: CommandSignature;
  readonly jsonSchema?: Record<string, unknown>;
  readonly #schema?: z.ZodObject;
  readonly #byFlag: ReadonlyMap<string, ArgumentDescriptor>;
  readonly #policy?: CommandPolicy<any, any>;

  constructor(
    commandName: string,
    definition: CommandArgs | undefined,
    policy?: CommandPolicy<any, any>,
  ) {
    this.mode = definition?.type === "json" ? "json" : "argv";
    this.#schema = definition?.schema;
    this.#policy = policy;
    if (definition) {
      assertZodObject(commandName, definition.schema);
      this.jsonSchema = z.toJSONSchema(definition.schema, { io: "input" }) as Record<
        string,
        unknown
      >;
    }
    this.descriptors =
      this.mode === "argv" && definition
        ? compileDescriptors(commandName, this.jsonSchema!, definition.pos ?? [])
        : Object.freeze([]);
    this.#byFlag = new Map(
      this.descriptors
        .filter((descriptor) => !descriptor.positional)
        .map((descriptor) => [descriptor.flagName, descriptor]),
    );
    this.signature = Object.freeze({
      positionals: this.descriptors.filter((arg) => arg.positional).map((arg) => arg.signature),
      options: [
        ...(this.mode === "json"
          ? ["[--input <json>]", "[--input-file <path>]"]
          : this.descriptors.filter((arg) => !arg.positional).map((arg) => arg.signature)),
        ...policySignatures(policy),
      ],
    });
  }

  #tokenize(argv: readonly string[]): ParsedCommandTokens {
    return this.mode === "json" ? tokenizeJson(argv, this.#policy) : this.#tokenizeArgv(argv);
  }

  async resolve(argv: readonly string[], stdin: Readable): Promise<ResolvedCommandArgs> {
    const tokens = this.#tokenize(argv);
    const execution = resolveExecution(tokens.options, this.#policy);
    let output: Record<string, unknown>;

    if (!this.#schema) {
      if (Object.keys(tokens.options).length > frameworkPolicyOptionCount(tokens.options)) {
        throw unknownArgument(Object.keys(tokens.options)[0]!);
      }
      if (tokens.positionals.length > 0) throw unexpectedPositionals(tokens.positionals);
      output = {};
    } else if (this.mode === "json") {
      const resolved = await resolveJson(tokens, stdin, this.#schema);
      output = resolved.data;
      execution.json = resolved.meta;
    } else {
      output = await this.#resolveArgv(tokens);
    }

    if (this.#policy?.mode === "write") validateWriteExecution(execution, this.#policy);
    Object.defineProperty(output, commandExecutionKey, { value: execution, enumerable: false });
    return output as ResolvedCommandArgs;
  }

  #tokenizeArgv(argv: readonly string[]): ParsedCommandTokens {
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
      const flagName = token.slice(2, equalsIndex < 0 ? undefined : equalsIndex);
      const inlineValue = equalsIndex < 0 ? undefined : token.slice(equalsIndex + 1);
      const policyType = policyOptionType(flagName, this.#policy);
      const descriptor = this.#byFlag.get(flagName);

      // L1: only interpret `--no-<x>` as negation when `<x>` is NOT itself a declared
      // field. A boolean field literally named e.g. `noCache` (flag `--no-cache`) must
      // be settable via its own flag, not hijacked by the negation heuristic.
      if (!descriptor && flagName.startsWith("no-") && inlineValue === undefined) {
        const positive = flagName.slice(3);
        const positiveDescriptor = this.#byFlag.get(positive);
        if (positiveDescriptor && positiveDescriptor.type === "boolean") {
          options[positiveDescriptor.name] = false;
          continue;
        }
      }
      if (!descriptor && !policyType) throw unknownArgument(flagName);
      const targetName = descriptor?.name ?? flagName;
      const type = descriptor?.type ?? policyType!;
      if (type === "boolean") {
        if (inlineValue !== undefined) {
          options[targetName] = parseBoolean(inlineValue, `--${flagName}`);
        } else {
          options[targetName] = true;
        }
        continue;
      }
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
        throw missingValue(flagName);
      }
      if (inlineValue === undefined) index++;
      setOption(options, targetName, value, type);
    }
    return { options, positionals };
  }

  async #resolveArgv(tokens: ParsedCommandTokens): Promise<Record<string, unknown>> {
    const raw: Record<string, unknown> = {};
    let positionalIndex = 0;
    for (const descriptor of this.descriptors) {
      if (descriptor.positional) {
        const value = tokens.positionals[positionalIndex++];
        if (value !== undefined) raw[descriptor.name] = value;
      } else if (Object.prototype.hasOwnProperty.call(tokens.options, descriptor.name)) {
        raw[descriptor.name] = tokens.options[descriptor.name];
      }
    }
    if (positionalIndex < tokens.positionals.length) {
      throw unexpectedPositionals(tokens.positionals.slice(positionalIndex));
    }
    return validateZod(this.#schema!, raw);
  }
}

function compileDescriptors(
  commandName: string,
  jsonSchema: Record<string, unknown>,
  pos: readonly string[],
): readonly ArgumentDescriptor[] {
  if (jsonSchema.type !== "object" || !isRecord(jsonSchema.properties)) {
    throw new Error(`defineCommand(${commandName}): args.schema must produce an object`);
  }
  const properties = jsonSchema.properties;
  const required = new Set(
    Array.isArray(jsonSchema.required) ? jsonSchema.required.map(String) : [],
  );
  const positionalNames = new Set(pos);
  if (positionalNames.size !== pos.length) {
    throw new Error(`defineCommand(${commandName}): args.pos cannot contain duplicate fields`);
  }
  for (const name of pos) {
    if (!(name in properties)) {
      throw new Error(
        `defineCommand(${commandName}): positional field "${name}" is not in args.schema`,
      );
    }
  }

  let sawOptionalPositional = false;
  const descriptors = Object.entries(properties).map(([name, property]) => {
    if (!isRecord(property)) {
      throw new Error(`defineCommand(${commandName}): field "${name}" has no usable JSON Schema`);
    }
    const flagName = toKebabCase(name);
    if (!ARGUMENT_IDENTIFIER.test(flagName)) {
      throw new Error(`defineCommand(${commandName}): field "${name}" cannot map to a CLI flag`);
    }
    if (RESERVED_ARGUMENT_NAMES.has(flagName)) {
      throw new Error(`defineCommand(${commandName}): argument --${flagName} is reserved`);
    }
    const positional = positionalNames.has(name);
    const isRequired = required.has(name);
    if (positional) {
      if (!isRequired) sawOptionalPositional = true;
      else if (sawOptionalPositional) {
        throw new Error(
          `defineCommand(${commandName}): required positional field "${name}" cannot follow an optional field`,
        );
      }
    }
    const type = propertyType(commandName, name, property);
    const description = typeof property.description === "string" ? property.description : undefined;
    const descriptor: ArgumentDescriptor = {
      name,
      flagName,
      type,
      required: isRequired,
      positional,
      ...(Object.prototype.hasOwnProperty.call(property, "default")
        ? { defaultValue: property.default }
        : {}),
      ...(description ? { description } : {}),
      displayName: positional ? name : `--${flagName}`,
      signature: argumentSignature(flagName, type, positional, isRequired),
    };
    return Object.freeze(descriptor);
  });

  descriptors.sort((left, right) => {
    const leftIndex = pos.indexOf(left.name);
    const rightIndex = pos.indexOf(right.name);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return 0;
  });
  return Object.freeze(descriptors);
}

function propertyType(
  commandName: string,
  name: string,
  schema: Record<string, unknown>,
): ArgumentType {
  const type = Array.isArray(schema.type)
    ? schema.type.find((candidate) => candidate !== "null")
    : schema.type;
  if (type === "integer" || type === "number") return "number";
  if (type === "string" || type === "boolean" || type === "array") return type;
  throw new Error(
    `defineCommand(${commandName}): argv field "${name}" must be string, number, boolean, or array; use args.type "json" for nested values`,
  );
}

function argumentSignature(
  name: string,
  type: ArgumentType,
  positional: boolean,
  required: boolean,
): string {
  if (positional) return required ? `<${name}>` : `[${name}]`;
  if (type === "boolean") return required ? `--${name}` : `[--${name}]`;
  const value = type === "array" ? "<value>..." : `<${type}>`;
  const token = `--${name} ${value}`;
  return required ? token : `[${token}]`;
}

function tokenizeJson(
  argv: readonly string[],
  policy: CommandPolicy<any, any> | undefined,
): ParsedCommandTokens {
  const options: Record<string, unknown> = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") {
      if (index !== argv.length - 1) throw unexpectedPositionals(argv.slice(index + 1));
      continue;
    }
    if (!token.startsWith("--")) throw unexpectedPositionals([token]);
    const equals = token.indexOf("=");
    const name = token.slice(2, equals < 0 ? undefined : equals);
    const inline = equals < 0 ? undefined : token.slice(equals + 1);
    const policyType = policyOptionType(name, policy);
    if (
      name === "input" ||
      name === "input-file" ||
      name === "input-schema" ||
      name === "input-example"
    ) {
      const boolean = name === "input-schema" || name === "input-example";
      if (boolean) {
        if (inline !== undefined)
          throw new ValidationError({
            subtype: "invalid_argument",
            param: `--${name}`,
            message: `--${name} does not accept a value`,
          });
        options[name] = true;
        continue;
      }
      const value = inline ?? argv[index + 1];
      if (value === undefined || (inline === undefined && value.startsWith("--")))
        throw missingValue(name);
      if (inline === undefined) index++;
      options[name] = value;
      continue;
    }
    if (!policyType) throw unknownArgument(name);
    if (policyType === "boolean") {
      options[name] = inline === undefined ? true : parseBoolean(inline, `--${name}`);
      continue;
    }
    const value = inline ?? argv[index + 1];
    if (value === undefined || (inline === undefined && value.startsWith("--")))
      throw missingValue(name);
    if (inline === undefined) index++;
    options[name] = value;
  }
  return { options, positionals: [] };
}

async function resolveJson(
  tokens: ParsedCommandTokens,
  stdin: Readable,
  schema: z.ZodObject,
): Promise<{ data: Record<string, unknown>; meta: JsonInputMeta }> {
  if (tokens.options["input-schema"] || tokens.options["input-example"]) {
    throw new ValidationError({
      subtype: "invalid_argument",
      param: tokens.options["input-schema"] ? "--input-schema" : "--input-example",
      message: "Input discovery is handled before command execution",
    });
  }
  const hasInline = typeof tokens.options.input === "string";
  const hasFile = typeof tokens.options["input-file"] === "string";
  if (hasInline && hasFile) {
    throw new ValidationError({
      subtype: "invalid_argument",
      param: "--input",
      message: "JSON input sources are mutually exclusive",
      hint: "Use exactly one of --input, --input-file, or native stdin.",
    });
  }
  const source: JsonInputMeta["source"] = hasInline ? "inline" : hasFile ? "file" : "stdin";
  if (source === "stdin" && (stdin as Readable & { isTTY?: boolean }).isTTY) {
    throw new ValidationError({
      subtype: "missing_required",
      param: "input",
      message: "JSON input is required",
      hint: "Use --input, --input-file, a pipe, or stdin redirection.",
    });
  }
  const bytes =
    source === "inline"
      ? bounded(Buffer.from(tokens.options.input as string, "utf8"), "--input")
      : source === "file"
        ? await readInputFile(tokens.options["input-file"] as string)
        : await readBoundedStream(stdin);
  const decoded = decodeUtf8(bytes);
  const input = parseStrictJson(decoded, DEFAULT_JSON_LIMITS);
  const data = await validateZod(schema, input);
  return {
    data,
    meta: {
      source,
      bytes: bytes.byteLength,
      rawDigest: digest(bytes),
      validatedDigest: digest(Buffer.from(canonicalize(data), "utf8")),
    },
  };
}

async function validateZod(schema: z.ZodObject, value: unknown): Promise<Record<string, unknown>> {
  const result = await z.safeParseAsync(schema, value);
  if (result.success) return result.data as Record<string, unknown>;
  const issues = result.error.issues.slice(0, DEFAULT_JSON_LIMITS.maxIssues).map((issue) => ({
    param: issue.path.length === 0 ? "args" : issue.path.map(String).join("."),
    message: issue.message,
  }));
  throw new ValidationError({
    subtype: "invalid_argument",
    param: issues[0]?.param ?? "args",
    params: issues,
    message: issues[0]?.message ?? "Arguments do not match the Zod schema",
  });
}

function resolveExecution(
  options: Record<string, unknown>,
  policy: CommandPolicy<any, any> | undefined,
): CommandExecutionState {
  return {
    dryRun: options["dry-run"] === true,
    confirmed: options.yes === true,
    ...(typeof options["idempotency-key"] === "string"
      ? { idempotencyKey: options["idempotency-key"] as string }
      : {}),
  };
}

function validateWriteExecution(
  execution: CommandExecutionState,
  policy: Extract<CommandPolicy<any, any>, { mode: "write" }>,
): void {
  if (execution.dryRun && !policy.dryRun) {
    throw new ValidationError({
      subtype: "invalid_argument",
      param: "--dry-run",
      message: "This command does not support --dry-run",
    });
  }
  if (policy.idempotency === "required" && !execution.dryRun && !execution.idempotencyKey?.trim()) {
    throw new ValidationError({
      subtype: "missing_required",
      param: "--idempotency-key",
      message: "Missing required argument --idempotency-key",
      hint: "Generate one key and reuse it for retries of the same operation.",
    });
  }
}

function policyOptionType(
  name: string,
  policy: CommandPolicy<any, any> | undefined,
): ArgumentType | undefined {
  if (policy?.mode !== "write") return undefined;
  if (name === "dry-run" && policy.dryRun) return "boolean";
  if (name === "yes" && policy.confirmation === "required") return "boolean";
  if (name === "idempotency-key" && policy.idempotency) return "string";
  return undefined;
}

function policySignatures(policy: CommandPolicy<any, any> | undefined): string[] {
  if (policy?.mode !== "write") return [];
  return [
    ...(policy.dryRun ? ["[--dry-run]"] : []),
    ...(policy.confirmation === "required" ? ["[--yes]"] : []),
    ...(policy.idempotency
      ? [
          policy.idempotency === "required"
            ? "--idempotency-key <string>"
            : "[--idempotency-key <string>]",
        ]
      : []),
  ];
}

function frameworkPolicyOptionCount(options: Record<string, unknown>): number {
  return ["dry-run", "yes", "idempotency-key"].filter((name) => name in options).length;
}

function setOption(
  options: Record<string, unknown>,
  name: string,
  value: string,
  type: ArgumentType,
): void {
  if (type !== "array") {
    if (Object.prototype.hasOwnProperty.call(options, name)) {
      throw new ValidationError({
        subtype: "invalid_argument",
        param: `--${toKebabCase(name)}`,
        message: `Argument --${toKebabCase(name)} cannot be repeated`,
      });
    }
    options[name] = value;
    return;
  }
  const current = options[name];
  options[name] = current === undefined ? [value] : [...(current as unknown[]), value];
}

async function readInputFile(path: string): Promise<Buffer> {
  let handle;
  try {
    // O_NOFOLLOW 在 Windows 上 constants.O_NOFOLLOW 为 undefined(?? 0 后失效),且 libuv
    // 对它的支持跨版本/平台不一致;改用 lstat(不跟随 symlink,全平台可移植)显式拒非常规文件。
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error("path is not a regular file");
    if (stat.size > DEFAULT_JSON_LIMITS.maxBytes) throw inputTooLarge("--input-file");
    return bounded(await handle.readFile(), "--input-file");
  } catch (cause) {
    if (cause instanceof ValidationError) throw cause;
    throw new ValidationError({
      subtype: "invalid_argument",
      param: "--input-file",
      message: "Unable to read JSON input file",
      hint: "Use a readable regular file; symlinks and device files are not accepted.",
      cause,
    });
  } finally {
    await handle?.close();
  }
}

async function readBoundedStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > DEFAULT_JSON_LIMITS.maxBytes) throw inputTooLarge("stdin");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

function bounded(bytes: Buffer, param: string): Buffer {
  if (bytes.byteLength > DEFAULT_JSON_LIMITS.maxBytes) throw inputTooLarge(param);
  return bytes;
}

function inputTooLarge(param: string): ValidationError {
  return new ValidationError({
    subtype: "out_of_range",
    param,
    message: `JSON input exceeds ${DEFAULT_JSON_LIMITS.maxBytes} bytes`,
  });
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ValidationError({
      subtype: "invalid_argument",
      param: "input",
      message: "JSON input must be valid UTF-8",
      cause,
    });
  }
}

function digest(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw nonJsonZodOutput();
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw nonJsonZodOutput();
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key) => !/^(?:0|[1-9]\d*)$/.test(key))) {
      throw nonJsonZodOutput();
    }
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw nonJsonZodOutput();
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function nonJsonZodOutput(): ValidationError {
  return new ValidationError({
    subtype: "invalid_argument",
    param: "args",
    message: "JSON argument schema output must remain JSON-compatible",
    hint: "Do not transform JSON arguments into Date, Map, BigInt, undefined, or class instances.",
  });
}

function assertZodObject(commandName: string, schema: unknown): asserts schema is z.ZodObject {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`defineCommand(${commandName}): args.schema must be a Zod object schema`);
  }
}

function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function parseBoolean(value: string, param: string): boolean {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new ValidationError({
    subtype: "invalid_argument",
    param,
    message: `${param} must be true, false, 1, or 0`,
  });
}

function missingValue(name: string): ValidationError {
  return new ValidationError({
    subtype: "missing_required",
    param: `--${name}`,
    message: `Argument --${name} requires a value`,
  });
}

function unknownArgument(name: string): ValidationError {
  return new ValidationError({
    subtype: "invalid_argument",
    param: `--${name}`,
    message: `Unknown argument --${name}`,
  });
}

function unexpectedPositionals(values: readonly string[]): ValidationError {
  return new ValidationError({
    subtype: "invalid_argument",
    param: values[0],
    message: `Unexpected positional argument(s): ${values.join(" ")}`,
  });
}

function invalidShortFlag(token: string): ValidationError {
  return new ValidationError({
    subtype: "invalid_argument",
    param: token,
    message: `Unknown short flag ${token} (only long flags are declared by command schemas)`,
    hint: `Use -- before a positional value that starts with '-': command -- ${token}`,
  });
}

function isNegativeNumber(token: string): boolean {
  return /^-\d+(\.\d+)?$/.test(token);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
