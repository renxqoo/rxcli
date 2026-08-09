/**
 * @renxqoo/agent-data-cli —— defineCli(App 工厂)+ defineCommand + defineCommands
 *
 * 设计依据:docs/02-sdk-guide.md "命令:defineCommand"、"装载方式"。
 * 启动模型:轻量路由/参数解析 + App.run(argv)。
 *   defineCli 返回 App 对象 { name, run(argv) };
 *   run 内部遍历 commands + namespaces 装配不可变 registry,解析 argv → pipeline.runCommand。
 *
 * 命名空间规则(方案 C,已批准):
 *   - commands:key=命令名 → rxcli-<name> <cmd>
 *   - namespaces:key=子命名空间 → rxcli-<name> <ns> <cmd>
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  App,
  CommandSpec,
  CommandGroup,
  CommandContext,
  DefineCliOptions,
  Plugin,
  ArgsSpec,
} from "./types.js";
import { createTransport } from "./request.js";
import { createContext } from "./context.js";
import { createPipeReader, emptyPipe } from "./pipe.js";
import { MISSING_FLAG_VALUE, parseArgs, signatureOfArgs } from "./args.js";
import { runCommand } from "./pipeline.js";
import { serializeError } from "./envelope.js";
import { toCliError, exitCodeOf, errs, SUBTYPE_REGISTRY } from "./errs/index.js";
import { createBuiltinSkillsCommands } from "./skills/builtin.js";
import { qrcodeCommand } from "./qrcode.js";
import { runBeforeRequest } from "./plugin.js";

// ============================================================================
// defineCommand / defineCommands(identity + 运行时校验)
// ============================================================================

/**
 * 声明单个命令。identity 函数(返回 spec 本身)+ 运行时校验 name/run 必填。
 * 泛型:<Args, Result>(State 由 defineCli<State> 统一注入)。
 */
export function defineCommand<Args = any, Result = unknown>(
  spec: CommandSpec<Args, Result>,
): CommandSpec<Args, Result> {
  if (!spec.name) throw new Error("defineCommand: name 必填");
  if (typeof spec.run !== "function")
    throw new Error(`defineCommand(${spec.name}): run 必填且为函数`);
  validateArgsSpec(spec.name, spec.args);
  return spec;
}

/** 声明命令组(key=命令名)。identity 函数。 */
export function defineCommands(group: CommandGroup): CommandGroup {
  for (const [key, cmd] of Object.entries(group)) {
    if (!cmd.name) throw new Error(`defineCommands(${key}): 命令缺少 name`);
    if (typeof cmd.run !== "function")
      throw new Error(`defineCommands(${key}.${cmd.name}): run 必填且为函数`);
    validateArgsSpec(cmd.name, cmd.args);
  }
  return group;
}

function validateArgsSpec(commandName: string, spec: ArgsSpec | undefined): void {
  let sawOptionalPositional = false;
  for (const [name, arg] of Object.entries(spec ?? {})) {
    if (arg.required && arg.default !== undefined) {
      throw new Error(
        `defineCommand(${commandName}): 参数 ${name} 不能同时声明 required 和 default`,
      );
    }
    if (!arg.positional) continue;
    if (!arg.required) sawOptionalPositional = true;
    else if (sawOptionalPositional) {
      throw new Error(
        `defineCommand(${commandName}): 必填位置参数 ${name} 不能位于可选位置参数之后`,
      );
    }
  }
}

// ============================================================================
// defineCli(App 工厂)
// ============================================================================

export function defineCli<State = Record<string, never>>(options: DefineCliOptions<State>): App {
  const { name, description, errorOnStatus, baseUrl } = options;
  // 启动期校验 errorOnStatus:
  //   (a) key 必须是合法的 HTTP status 形态(纯数字如 "404",或 Nxx 段如 "5xx")——
  //       拼写错误(如 "5x"/"500s")会让该配置项永不匹配,静默失效。
  //   (b) subtype 必须在 SUBTYPE_REGISTRY 登记——避免拼写错误悄悄降级成 internal(exit 5)。
  if (errorOnStatus) {
    for (const [statusKey, subtype] of Object.entries(errorOnStatus)) {
      if (!/^\d+$|^\dxx$/.test(statusKey)) {
        throw new Error(
          `defineCli({ errorOnStatus }): 非法 status key "${statusKey}"。` +
            `必须是数字(如 "404")或 Nxx 形态(如 "5xx")。`,
        );
      }
      if (!(subtype in SUBTYPE_REGISTRY)) {
        throw new Error(
          `defineCli({ errorOnStatus }): subtype "${subtype}"(配在 status ${statusKey})未在 SUBTYPE_REGISTRY 登记。` +
            `用标准 subtype(见 error-catalog)或先登记:SUBTYPE_REGISTRY['${subtype}'] = { category: 'api' }。`,
        );
      }
    }
  }
  // 默认输出格式:'auto'(stdout TTY→文本/非 TTY→JSON)/ 'json' / 'human'
  const defaultFormat = options.defaultFormat ?? "auto";
  // plugins 可选(README 入门示例 defineCli({name, commands}) 不带 plugins);
  // 缺省 [] 避免 executeOne 里 opts.plugins.find 在 undefined 上崩。
  const sourcePlugins = options.plugins ?? [];
  const plugins = sourcePlugins;
  // binName:终端命令名(help/SKILL.md 签名用)
  // 优先级:显式传 binName > 自动探测 package.json 的 bin > 回退 name
  const binName = options.binName ?? detectBinName() ?? name;
  const skillsDir = options.skillsDir;

  // —— 命令合并:plugin.provides(默认值) + defineCli 显式声明(业务赢) ——
  // 规则:同 namespace 不同命令 → 合并;同 namespace 同命令 → defineCli 覆盖 plugin。
  // plugin 贡献的命令记录到 p._ownedRoutes(pipeline 据此精确豁免该 plugin 的 beforeCommand)。
  const mergedNamespaces: Record<string, CommandGroup> = {};
  const mergedCommands: CommandGroup = {};

  const routeOwners = new Map<string, Plugin<State>>();
  const routeKey = (route: string[]) => JSON.stringify(route);

  // (1) 先收 plugin 贡献(默认值)。同一路由后注册的 plugin 赢并成为 owner。
  for (const p of plugins) {
    if (p.provides?.namespaces) {
      for (const [ns, group] of Object.entries(p.provides.namespaces)) {
        mergedNamespaces[ns] ??= {};
        for (const [cmd, spec] of Object.entries(group)) {
          mergedNamespaces[ns]![cmd] = spec;
          routeOwners.set(routeKey([ns, cmd]), p);
        }
      }
    }
    if (p.provides?.commands) {
      for (const [cmd, spec] of Object.entries(p.provides.commands)) {
        mergedCommands[cmd] = spec;
        routeOwners.set(routeKey([cmd]), p);
      }
    }
  }
  // (2) 再收 defineCli 显式声明(后写覆盖 = 业务赢)
  for (const [ns, group] of Object.entries(options.namespaces ?? {})) {
    mergedNamespaces[ns] = { ...mergedNamespaces[ns], ...group };
    for (const cmd of Object.keys(group)) routeOwners.delete(routeKey([ns, cmd]));
  }
  for (const [cmd, spec] of Object.entries(options.commands)) {
    mergedCommands[cmd] = spec;
    routeOwners.delete(routeKey([cmd]));
  }

  const ownedRoutes = new Map<Plugin<State>, string[][]>(plugins.map((plugin) => [plugin, []]));
  for (const [key, owner] of routeOwners) ownedRoutes.get(owner)!.push(JSON.parse(key) as string[]);

  const commands = mergedCommands;

  // 收集所有命令(扁平化成"完整命令路径" → CommandSpec),供路由匹配
  type RoutedCommand = { route: string[]; spec: CommandSpec };
  const routed: RoutedCommand[] = [];
  for (const [cmdName, spec] of Object.entries(commands)) {
    routed.push({ route: [cmdName], spec });
  }

  // 内置 qrcode 命令(顶层):业务包没占 'qrcode' 名时自动注入
  if (!commands.qrcode) {
    routed.push({ route: ["qrcode"], spec: qrcodeCommand });
  }

  // 内置 skills 命令:有 skillsDir 时注入 namespaces.skills
  // gen/help 用 binName(终端命令名);命名空间用 name
  const namespaces = { ...mergedNamespaces };
  if (skillsDir) {
    const builtins = createBuiltinSkillsCommands(binName, skillsDir, {
      name,
      binName,
      commands,
      namespaces: mergedNamespaces,
    });
    namespaces.skills = { ...builtins, ...mergedNamespaces.skills };
  }

  for (const [nsName, group] of Object.entries(namespaces)) {
    for (const [cmdName, spec] of Object.entries(group)) {
      routed.push({ route: [nsName, cmdName], spec });
    }
  }

  const app: App = {
    name,
    async run(argv: string[]): Promise<void> {
      try {
        // —— 路由:匹配最长 route ——
        // matchRoute 会跳过顶层 flag(--json/--no-json 等),使 `bin --json list` 也能路由到 list。
        const { matched, rest } = matchRoute(argv, routed);

        // 顶层 flag 区 = argv 开头的连续 flag(--开头 或 -x),直到首个非 flag token(命令名/位置参数)。
        // --version/-v、顶层 --help/-h 只在这个区出现才算全局动作;
        // 出现在命令名之后则交给命令解析(未知 flag 报错 / 命令自处理)。
        const leadingFlags: string[] = [];
        for (const t of argv) {
          if (!t.startsWith("-")) break;
          leadingFlags.push(t);
        }

        // —— 顶层 flag:--version / -v(只在命令名之前才触发)——
        if (hasFlagBeforeSeparator(leadingFlags, "-v", "--version")) {
          process.stdout.write(`${binName}/${detectVersion()}\n`);
          process.exitCode = 0;
          return;
        }

        if (!matched) {
          // 无匹配:help / 空 argv → 显示 help(exit 0);其余视为未知命令 → 错误输出(exit 2)
          // agent-native CLI 不允许"拼错命令 exit 0"(会被 agent 误判为成功)。
          if (hasFlagBeforeSeparator(leadingFlags, "-h", "--help") || argv.length === 0) {
            process.stdout.write(renderHelp(binName, description, routed) + "\n");
            process.exitCode = 0;
          } else {
            throw new errs.ValidationError({
              subtype: "invalid_argument",
              message: `未知命令: ${argv.filter((a) => !a.startsWith("-")).join(" ") || argv.join(" ")}`,
              hint: `运行 \`${binName} --help\` 查看可用命令`,
            });
          }
          return;
        }

        // 匹配到命令:若用户显式要帮助(-h/--help),显示该命令帮助而非执行
        if (hasFlagBeforeSeparator(rest, "-h", "--help")) {
          process.stdout.write(renderCommandHelp(binName, matched) + "\n");
          process.exitCode = 0;
          return;
        }

        // 解析剩余 token(分离 positional + flag,正确配对 flag-value)
        const { options, positionals } = parseFlags(rest, matched.spec.args);

        // 提取全局 flag json(--no-json→false / --json→true / 不传→undefined)
        // 从 rawOptions 剔除:json 是框架 flag,不进命令 args
        const jsonFlag = options.json;
        if (!matched.spec.args?.json) delete options.json;
        // --api-key 是框架级一次性凭证 —— 仅当命令未声明 api-key arg 时才归框架(给 plugin provider chain);
        // 命令声明了自己的 api-key 时,它就是普通命令 arg,不剔除、不进 pluginArgs。
        const commandOwnsApiKey = !!matched.spec.args?.["api-key"];
        const apiKeyFlag = commandOwnsApiKey ? undefined : options["api-key"];
        if (!commandOwnsApiKey) delete options["api-key"];
        // 输出格式决策(优先级:显式 flag > defaultFormat > 管道保护):
        //   --json       → JSON(强制)
        //   --no-json    → 文本(强制,但管道保护:stdin 非 TTY 时仍 JSON)
        //   不传 + auto  → stdout TTY ? 文本 : JSON
        //   不传 + json  → JSON
        //   不传 + human → 文本(管道保护同上)
        const stdinIsPipe = !process.stdin.isTTY;
        let humanReadable: boolean;
        if (jsonFlag === true) {
          humanReadable = false;
        } else if (jsonFlag === false) {
          humanReadable = !stdinIsPipe;
        } else if (defaultFormat === "human") {
          humanReadable = !stdinIsPipe;
        } else if (defaultFormat === "json") {
          humanReadable = false;
        } else {
          // auto:stdout 是 TTY(人在终端)→ 文本;非 TTY(管道/脚本)→ JSON
          humanReadable = !!process.stdout.isTTY && !stdinIsPipe;
        }

        const exitCode = await executeOne<State>({
          spec: matched.spec,
          argsSpec: matched.spec.args,
          rawOptions: options,
          rawPositionals: positionals,
          plugins,
          name,
          errorOnStatus,
          baseUrl,
          route: matched.route,
          humanReadable,
          pluginArgs: apiKeyFlag === undefined ? undefined : { apiKey: apiKeyFlag },
          ownedRoutes,
        });
        process.exitCode = exitCode;
      } catch (err) {
        // BareError:保留其 exitCode,不降级成 InternalError(toCliError 会把它包成 internal)
        if (err instanceof errs.BareError) {
          process.exitCode = err.exitCode;
          return;
        }
        const cliErr = toCliError(err);
        process.stderr.write(serializeError(cliErr) + "\n");
        process.exitCode = exitCodeOf(cliErr.category);
      }
    },
  };

  return app;
}

// ============================================================================
// 路由匹配 + flag 解析
// ============================================================================

interface MatchResult {
  matched: { route: string[]; spec: CommandSpec } | null;
  /** route 之后的剩余 token(原样,含 positional + flag,未分离)。 */
  rest: string[];
}

/**
 * 顶层全局 flag:出现在任何命令 token 之前时具有框架级语义。
 *   --json / --no-json : 输出格式(路由匹配时跳过,使 `bin --json list` 能路由)
 *   --version / -v     : 版本(只在 argv 头部连续 flag 区触发)
 *   --help / -h        : 帮助(只在 argv 头部连续 flag 区触发)
 * 路由匹配时跳过这些 flag,使 `bin --json list` 能路由到 list。
 */
const TOP_LEVEL_FLAGS = new Set(["--json", "--no-json", "--version", "-v", "--help", "-h"]);

/**
 * 从 argv 头部取连续非 flag token 匹配最长 route。
 * 跳过前导的顶层 flag(--json/--no-json 等),其余 - 开头 token 视为命令专属 flag,终止路由匹配。
 * 只剥离 route 部分,剩余 token 原样返回(交给 parseFlags 分离 positional/flag,保留 flag-value 配对)。
 * 例:argv=['--json','list','--limit','1'] → matched route=['list'],rest=['--limit','1']
 */
function matchRoute(
  argv: string[],
  routed: Array<{ route: string[]; spec: CommandSpec }>,
): MatchResult {
  const sorted = [...routed].sort((a, b) => b.route.length - a.route.length);

  // 收集头部 token:跳过顶层 flag,其余 - 开头 token 终止(route 段是连续非 flag 的)。
  const headTokens: string[] = [];
  for (const t of argv) {
    if (TOP_LEVEL_FLAGS.has(t)) continue;
    if (t.startsWith("-")) break;
    headTokens.push(t);
  }

  for (const r of sorted) {
    const routeLen = r.route.length;
    if (headTokens.length >= routeLen && r.route.every((seg, j) => headTokens[j] === seg)) {
      // route 占据 headTokens 前 routeLen 个;argv 中对应区段 = 跳过的顶层 flag + route 段
      let taken = 0;
      let end = 0;
      for (let k = 0; k < argv.length && taken < routeLen; k++) {
        const t = argv[k]!;
        if (TOP_LEVEL_FLAGS.has(t)) continue;
        if (t.startsWith("-")) break;
        taken++;
        end = k + 1;
      }
      return { matched: r, rest: argv.slice(end) };
    }
  }
  return { matched: null, rest: [] };
}

/**
 * 解析剩余 token 数组:分离 positional + flag,正确配对 flag-value。
 * 处理:
 *   - --key value / --key=value / --bool(无值)
 *   - --no-<bool>(boolean 取反:H1,如 --no-wait → wait=false)
 *   - 负数 flag 值(M2:--limit -1 → limit=-1,而非把 -1 当 positional)
 *   - -- 分隔符(M10:-- 之后的 token 全部视为 positional,即使以 - 开头)
 *
 * boolean flag(在 argsSpec 声明 type:boolean)不消费下一个 token。
 */
function parseFlags(
  tokens: string[],
  argsSpec: ArgsSpec | undefined,
): { options: Record<string, unknown>; positionals: string[] } {
  const options: Record<string, unknown> = {};
  const positionals: string[] = [];
  // json 是框架级全局 flag(同 help/version):--no-json 文本输出 / --json 强制 JSON
  const booleanKeys = new Set<string>(["help", "version", "json"]);
  // 需要 value 的 flag(number/string/array):它们的下一个 token 即使以 - 开头(负数)也视为值
  const valueKeys = new Set<string>();
  const arrayKeys = new Set<string>();
  // --api-key 是框架级一次性凭证 flag —— 但仅当命令未声明同名 arg 时才归框架;
  // 命令声明了自己的 api-key 参数时,它就是普通命令 arg,原样透传。
  if (!argsSpec || !("api-key" in argsSpec)) valueKeys.add("api-key");
  if (argsSpec) {
    for (const [k, s] of Object.entries(argsSpec)) {
      if (s.type === "boolean") booleanKeys.add(k);
      else {
        valueKeys.add(k);
        if (s.type === "array") arrayKeys.add(k);
      }
    }
  }

  let onlyPositionals = false; // 遇到 -- 后置位
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;

    // M10:-- 分隔符,之后的 token 全为 positional(即使以 - 开头)
    if (!onlyPositionals && t === "--") {
      onlyPositionals = true;
      continue;
    }
    if (onlyPositionals) {
      positionals.push(t);
      continue;
    }

    if (!t.startsWith("--")) {
      // 单短氢 flag(如 -x):不是负数(-1/-1.5)、不是单个 - → 报错(未知短 flag)
      // 负数 / 单个 - 仍当 positional(合法值)
      if (t.startsWith("-") && t.length > 1 && !isNegativeNumber(t)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: t,
          message: `未知短 flag ${t}(本框架只支持长 flag --xxx)`,
          hint: `如需传负数值,用 -- 分隔:rxcordys cmd -- ${t}`,
        });
      }
      // 非 flag → positional
      positionals.push(t);
      continue;
    }
    const eqIdx = t.indexOf("=");
    if (eqIdx >= 0) {
      const key = t.slice(2, eqIdx);
      setParsedOption(options, key, t.slice(eqIdx + 1), arrayKeys);
      continue;
    }
    const key = t.slice(2);
    // H1:--no-<bool> 对 boolean flag 取反
    if (key.startsWith("no-")) {
      const inner = key.slice(3);
      if (booleanKeys.has(inner)) {
        options[inner] = false;
        continue;
      }
    }
    if (booleanKeys.has(key)) {
      options[key] = true;
      continue;
    }
    // M2:若是 value flag 且下一个 token 是负数(如 -1),视为值而非 positional/flag
    if (valueKeys.has(key) && i + 1 < tokens.length && isNegativeNumber(tokens[i + 1]!)) {
      setParsedOption(options, key, tokens[++i], arrayKeys);
      continue;
    }
    if (i + 1 < tokens.length && !tokens[i + 1]!.startsWith("-")) {
      // --key value:value 是下一个非 flag token
      setParsedOption(options, key, tokens[++i], arrayKeys);
    } else {
      options[key] = valueKeys.has(key) ? MISSING_FLAG_VALUE : true;
    }
  }
  return { options, positionals };
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

function hasFlagBeforeSeparator(argv: string[], ...flags: string[]): boolean {
  const end = argv.indexOf("--");
  const searchable = end < 0 ? argv : argv.slice(0, end);
  return searchable.some((arg) => flags.includes(arg));
}

/** 判断 token 是否负数字符串(如 -1、-1.5),用于 --key -1 的负数 value 识别(M2)。 */
function isNegativeNumber(token: string): boolean {
  return /^-\d+(\.\d+)?$/.test(token);
}

/** 渲染 help 文本(简单版:列出所有命令)。 */
function renderHelp(
  binName: string,
  description: string,
  routed: Array<{ route: string[]; spec: CommandSpec }>,
): string {
  const lines: string[] = [];
  lines.push(`${binName}/${detectVersion()}`);
  // 应用描述(defineCli 的 description,非空才显示;版本行后紧跟)
  if (description) {
    lines.push(description);
  }
  lines.push("");
  lines.push("Usage:");
  lines.push(`  $ ${binName} <command> [options]`);
  lines.push("");
  lines.push("Commands:");
  // 计算对齐宽度
  const entries = routed.map((r) => {
    const sig = signatureOfArgs(r.spec.args);
    const pos = sig.positionals.join(" ");
    const cmdStr = `${r.route.join(" ")}${pos ? " " + pos : ""}`;
    return { cmdStr, desc: r.spec.description };
  });
  const maxLen = Math.max(...entries.map((e) => e.cmdStr.length), 0);
  for (const e of entries) {
    lines.push(`  ${e.cmdStr.padEnd(maxLen + 2)}${e.desc}`);
  }
  lines.push("");
  lines.push("Options:");
  lines.push("  -h, --help     Display this message");
  lines.push("  -v, --version  Display version number");
  return lines.join("\n");
}

/** 渲染单个命令的帮助(子命令 -h 时用)。 */
function renderCommandHelp(
  binName: string,
  matched: { route: string[]; spec: CommandSpec },
): string {
  const sig = signatureOfArgs(matched.spec.args);
  const pos = sig.positionals.join(" ");
  const usage =
    `${binName} ${matched.route.join(" ")}${pos ? " " + pos : ""} ${sig.options.join(" ")}`.trim();
  const lines: string[] = [];
  lines.push(`${matched.spec.description}`);
  lines.push("");
  lines.push("Usage:");
  lines.push(`  $ ${usage}`);
  if (sig.options.length > 0) {
    lines.push("");
    lines.push("Options:");
    for (const o of sig.options) lines.push(`  ${o}`);
  }
  return lines.join("\n");
}

/**
 * 取入口脚本路径(realpath 解软链)。npm 全局安装时 process.argv[1] 是 bin 软链,
 * realpath 后才是真实文件路径(detectBinName/detectVersion/detectBizPackage 往上找 package.json 用)。
 */
function entryPath(): string | undefined {
  const entry = process.argv[1];
  if (!entry) return undefined;
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}

/**
 * 自动探测 bin 名:从实际运行的入口(process.argv[1])往上找 package.json,读 bin 第一个 key。
 * 业务包的 dist/index.js 是入口,其 package.json 在包根目录(往上找能命中)。
 * 找不到(bun compile / 测试 / 无 bin)返回 undefined,调用方回退到 name。
 * 避免业务包手写 binName 造成与 package.json 不一致。
 */
function detectBinName(): string | undefined {
  try {
    const entry = entryPath();
    if (!entry) return undefined;
    let dir = dirname(entry);
    for (let i = 0; i < 10; i++) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
          bin?: string | Record<string, string>;
        };
        // 跳过 cli-sdk 自己 / monorepo 根(无 bin 或 bin 不是业务命令)
        if (pkg.name === "@renxqoo/agent-data-cli" || !pkg.bin) {
          dir = dirname(dir);
          continue;
        }
        return typeof pkg.bin === "string" ? pkg.name : Object.keys(pkg.bin)[0];
      }
      dir = dirname(dir);
    }
  } catch {
    /* 找不到就回退 name */
  }
  return undefined;
}

/**
 * 探测业务包版本:从入口 package.json 读 version(H5:不再硬编码 0.1.0)。
 * 找不到回退 cli-sdk 自身版本(VERSION)。测试/无入口场景用兜底值。
 */
function detectVersion(): string {
  try {
    const entry = entryPath();
    if (entry) {
      let dir = dirname(entry);
      for (let i = 0; i < 10; i++) {
        const pkgPath = join(dir, "package.json");
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
            name?: string;
            version?: string;
          };
          // 跳过 cli-sdk 自己 / monorepo 根(cli-sdk 版本 ≠ 业务包版本)
          if (pkg.name === "@renxqoo/agent-data-cli" || !pkg.version) {
            dir = dirname(dir);
            continue;
          }
          return pkg.version;
        }
        dir = dirname(dir);
      }
    }
  } catch {
    /* 找不到就回退兜底 */
  }
  return "0.0.0";
}

/**
 * 探测当前业务包的 { name, bin, version }(install 向导用)。
 * 从 process.argv[1](实际入口)往上找 package.json,跳过 cli-sdk 自己 / monorepo 根。
 * 用于 install 向导:`npm install -g <name>` 目标、whichRxcli 找的 bin 名、版本对比。
 */
export interface BizPackageInfo {
  name: string;
  bin: string;
  version: string;
}

export function detectBizPackage(): BizPackageInfo | null {
  try {
    const entry = entryPath();
    if (!entry) return null;
    let dir = dirname(entry);
    for (let i = 0; i < 10; i++) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
          version?: string;
          bin?: string | Record<string, string>;
        };
        // 跳过 cli-sdk 自己 / monorepo 根(无 bin 或不是业务命令)
        if (pkg.name === "@renxqoo/agent-data-cli" || !pkg.bin) {
          dir = dirname(dir);
          continue;
        }
        const binName = typeof pkg.bin === "string" ? pkg.name : Object.keys(pkg.bin)[0];
        if (!pkg.name || !binName) {
          dir = dirname(dir);
          continue;
        }
        return { name: pkg.name, bin: binName, version: pkg.version ?? "0.0.0" };
      }
      dir = dirname(dir);
    }
  } catch {
    /* 找不到就返回 null,向导回退 */
  }
  return null;
}

interface ExecuteOneOptions<State> {
  spec: CommandSpec;
  argsSpec: ArgsSpec | undefined;
  rawOptions: Record<string, unknown>;
  rawPositionals: string[];
  plugins: Plugin<State>[];
  name: string;
  errorOnStatus?: DefineCliOptions<State>["errorOnStatus"];
  baseUrl?: string;
  /** 当前命令路径段(精确豁免 plugin 自身 beforeCommand 用)。 */
  route: string[];
  /** --no-json 文本输出模式(已做管道保护:被管道时为 false)。 */
  humanReadable?: boolean;
  pluginArgs?: Record<string, unknown>;
  ownedRoutes?: ReadonlyMap<Plugin<State>, string[][]>;
}

async function executeOne<State>(opts: ExecuteOneOptions<State>): Promise<number> {
  // auth 插件持有的 transport 配置(on401 hook,用 oauth singleflight)
  // 从 plugins 里找带 _transportConfig 的 auth 插件
  const authPlugin = opts.plugins.find(
    (p): p is Plugin<State> & { _transportConfig?: { on401?: () => Promise<string | null> } } =>
      "_transportConfig" in p &&
      (p as { _transportConfig?: unknown })._transportConfig !== undefined,
  );
  const on401 = authPlugin?._transportConfig?.on401;

  // 创建 transport(注入 auth 的 on401 hook)
  let retryRequest: ((req: import("./types.js").RequestOptions) => Promise<void>) | undefined;
  const transport = createTransport({
    baseUrl: opts.baseUrl,
    errorOnStatus: opts.errorOnStatus,
    ...(on401 ? { on401 } : {}),
    beforeRetry: async (req) => retryRequest?.(req),
  });

  // 管道:检测 stdin(阶段 1 给基础能力;阶段 3 完整接入)
  const pipe = process.stdin.isTTY ? emptyPipe() : createPipeReader(process.stdin, opts.name);

  const ctx = createContext<State>({
    state: {} as State,
    transport,
    plugins: opts.plugins,
    pipe,
  });
  retryRequest = (req) => runBeforeRequest(opts.plugins, ctx, req);

  // runCommand 从 ctx 读 auth 插件填的 _identity(统一输出格式顶层 user/bot)
  return runCommand<State>({
    spec: opts.spec,
    args: () => {
      if (opts.pluginArgs?.apiKey === MISSING_FLAG_VALUE) {
        throw new errs.ValidationError({
          subtype: "missing_required",
          param: "--api-key",
          message: "参数 --api-key 缺少值",
        });
      }
      return parseArgs(opts.argsSpec, opts.rawOptions, opts.rawPositionals);
    },
    ctx,
    plugins: opts.plugins,
    identity: () => readIdentity(ctx),
    route: opts.route,
    humanReadable: opts.humanReadable,
    pluginArgs: opts.pluginArgs,
    ownedRoutes: opts.ownedRoutes,
    source: opts.name,
  });
}

/** 从 ctx 读 auth 插件填的 _identity(beforeCommand 后才有值,故用函数延迟读)。 */
function readIdentity(ctx: CommandContext<any>): "user" | "bot" | undefined {
  const hint = (ctx as unknown as { _identity?: { identity?: "user" | "bot" } })._identity;
  return hint?.identity;
}
