/**
 * CLI 帮助文本渲染(renderHelp / renderCommandHelp)。
 *
 * 从 define.ts 抽出:输出渲染与命令定义/App 装配解耦。
 * 依赖 signatureOfArgs(参数签名)与 detectVersion(版本行)。
 */
import type { CommandSpec } from "./types.js";
import type { CompiledCommandSchema } from "./command-schema.js";
import { detectVersion } from "./package-detect.js";

/** 渲染 help 文本(简单版:列出所有命令)。 */
export function renderHelp<State>(
  binName: string,
  description: string,
  routed: Array<{
    route: string[];
    spec: CommandSpec<any, unknown, State>;
    schema: CompiledCommandSchema;
  }>,
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
    const sig = r.schema.signature;
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
export function renderCommandHelp<State>(
  binName: string,
  matched: {
    route: string[];
    spec: CommandSpec<any, unknown, State>;
    schema: CompiledCommandSchema;
  },
): string {
  const sig = matched.schema.signature;
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
  if (matched.schema.mode === "json") {
    lines.push("");
    lines.push("JSON arguments:");
    lines.push("  Provide one complete JSON document with --input, --input-file, or native stdin.");
    lines.push("  JSON cannot be combined with business flags or positional operands.");
    lines.push("  Discovery: --input-schema or --input-example");
    lines.push("  Security: prefer --input-file or stdin for sensitive values.");
  }
  return lines.join("\n");
}
