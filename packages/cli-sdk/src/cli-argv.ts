import type { ArgsSpec, CommandSpec } from "./types.js";
import { MISSING_FLAG_VALUE } from "./args.js";
import { ValidationError } from "./errs/index.js";

export const RESERVED_FRAMEWORK_ARGS = new Set(["json", "api-key", "help", "version"]);

export interface FrameworkArgs {
  commandArgv: string[];
  format?: "json" | "human";
  apiKey?: unknown;
  leadingHelp: boolean;
  leadingVersion: boolean;
}

export interface RoutedCommand {
  route: string[];
  spec: CommandSpec;
}

export interface MatchResult {
  matched: RoutedCommand | null;
  rest: string[];
}

/**
 * 提取框架保留参数，同时保留命令参数的相对顺序。
 *
 * `--json` / `--no-json` / `--api-key` 可放在命令路径前后；`--` 后不再解释。
 * help/version 只有位于首个命令 token 前才是顶层动作，命令后的 help 由命令帮助处理，
 * 命令后的 version 作为未知命令参数报错。
 */
export function parseFrameworkArgs(argv: string[]): FrameworkArgs {
  const commandArgv: string[] = [];
  let format: "json" | "human" | undefined;
  let apiKey: unknown;
  let leadingHelp = false;
  let leadingVersion = false;
  let commandStarted = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") {
      commandArgv.push(...argv.slice(i));
      break;
    }
    if (token === "--json") {
      format = "json";
      continue;
    }
    if (token === "--no-json") {
      format = "human";
      continue;
    }
    if (token.startsWith("--api-key=")) {
      apiKey = token.slice("--api-key=".length);
      continue;
    }
    if (token === "--api-key") {
      const next = argv[i + 1];
      if (next === undefined || next === "--" || isFrameworkFlag(next)) {
        apiKey = MISSING_FLAG_VALUE;
      } else {
        apiKey = next;
        i++;
      }
      continue;
    }
    if (!commandStarted && (token === "--help" || token === "-h")) {
      leadingHelp = true;
      continue;
    }
    if (!commandStarted && (token === "--version" || token === "-v")) {
      leadingVersion = true;
      continue;
    }

    commandArgv.push(token);
    if (!token.startsWith("-")) commandStarted = true;
  }

  return { commandArgv, format, apiKey, leadingHelp, leadingVersion };
}

/** 命令路径必须是去掉框架参数后的 argv 前缀；优先匹配最长路径。 */
export function matchRoute(argv: string[], routed: RoutedCommand[]): MatchResult {
  const sorted = [...routed].sort((a, b) => b.route.length - a.route.length);
  for (const candidate of sorted) {
    if (
      argv.length >= candidate.route.length &&
      candidate.route.every((segment, index) => argv[index] === segment)
    ) {
      return { matched: candidate, rest: argv.slice(candidate.route.length) };
    }
  }
  return { matched: null, rest: argv };
}

/** 解析命令自己的 long flags 与 positional 参数。框架保留参数已在上一层移除。 */
export function parseCommandFlags(
  tokens: string[],
  argsSpec: ArgsSpec | undefined,
): { options: Record<string, unknown>; positionals: string[] } {
  const options: Record<string, unknown> = {};
  const positionals: string[] = [];
  const booleanKeys = new Set<string>();
  const valueKeys = new Set<string>();
  const arrayKeys = new Set<string>();

  for (const [key, spec] of Object.entries(argsSpec ?? {})) {
    if (spec.type === "boolean") booleanKeys.add(key);
    else {
      valueKeys.add(key);
      if (spec.type === "array") arrayKeys.add(key);
    }
  }

  let onlyPositionals = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!onlyPositionals && token === "--") {
      onlyPositionals = true;
      continue;
    }
    if (onlyPositionals) {
      positionals.push(token);
      continue;
    }
    if (!token.startsWith("--")) {
      if (token.startsWith("-") && token.length > 1 && !isNegativeNumber(token)) {
        throw new ValidationError({
          subtype: "invalid_argument",
          param: token,
          message: `Unknown short flag ${token} (this framework only supports long flags --xxx)`,
          hint: `To pass a negative number, use -- as a separator: command -- ${token}`,
        });
      }
      positionals.push(token);
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex >= 0) {
      const key = token.slice(2, equalsIndex);
      setParsedOption(options, key, token.slice(equalsIndex + 1), arrayKeys);
      continue;
    }

    const key = token.slice(2);
    if (key.startsWith("no-") && booleanKeys.has(key.slice(3))) {
      options[key.slice(3)] = false;
      continue;
    }
    if (booleanKeys.has(key)) {
      options[key] = true;
      continue;
    }
    const next = tokens[i + 1];
    if (valueKeys.has(key) && next !== undefined && isNegativeNumber(next)) {
      setParsedOption(options, key, next, arrayKeys);
      i++;
      continue;
    }
    if (next !== undefined && !next.startsWith("-")) {
      setParsedOption(options, key, next, arrayKeys);
      i++;
    } else {
      options[key] = valueKeys.has(key) ? MISSING_FLAG_VALUE : true;
    }
  }

  return { options, positionals };
}

export function hasCommandHelp(argv: string[]): boolean {
  const separator = argv.indexOf("--");
  const searchable = separator < 0 ? argv : argv.slice(0, separator);
  return searchable.some((arg) => arg === "-h" || arg === "--help");
}

function isFrameworkFlag(token: string): boolean {
  return (
    token === "--json" ||
    token === "--no-json" ||
    token === "--api-key" ||
    token.startsWith("--api-key=") ||
    token === "--help" ||
    token === "-h" ||
    token === "--version" ||
    token === "-v"
  );
}

function setParsedOption(
  options: Record<string, unknown>,
  key: string,
  value: unknown,
  arrayKeys: Set<string>,
): void {
  if (!arrayKeys.has(key)) {
    options[key] = value;
    return;
  }
  const existing = options[key];
  options[key] =
    existing === undefined
      ? [value]
      : [...(Array.isArray(existing) ? existing : [existing]), value];
}

function isNegativeNumber(token: string): boolean {
  return /^-\d+(\.\d+)?$/.test(token);
}
