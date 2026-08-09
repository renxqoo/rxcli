/**
 * @renxqoo/agent-data-cli —— 参数解析与校验
 *
 * 设计依据:docs/02-sdk-guide.md "ArgsSpec + ArgSpec"、"args 字段规范"。
 * cli-sdk 只负责解析 + 校验类型 + 填默认值,不参与参数语义(后端要 page/pageSize 还是 cursor,
 * 业务包在 run 里自己翻译)。
 *
 * define.ts 负责把 argv 切成 raw 选项/位置参数;本模块作为统一 schema 边界做校验、默认值和转换。
 */

import type { ArgsSpec } from "./types.js";
import { ValidationError } from "./errs/index.js";

/** flag 在 argv 中出现但没有值；由路由解析器传给 schema 边界。 */
export const MISSING_FLAG_VALUE = Symbol("missing-flag-value");

/** 从 spec 推导出的参数解析结果类型(简单命令够用;复杂命令用 interface 显式声明泛型)。 */
export type ParsedArgs<S extends ArgsSpec> = {
  [K in keyof S]: S[K]["type"] extends "array"
    ? string[]
    : S[K]["type"] extends "number"
      ? number
      : S[K]["type"] extends "boolean"
        ? boolean
        : string;
};

/**
 * 把路由层解析出的 raw 选项 + raw 位置参数,按 spec 校验 + 填默认值 + 类型转换。
 *
 * @param spec 命令声明的 args spec
 * @param options 解析后的 flag 选项(键名不含 --)
 * @param positionals 原始位置参数数组(按 spec 中 positional:true 的声明顺序对应)
 */
export function parseArgs(
  spec: ArgsSpec | undefined,
  options: Record<string, unknown>,
  positionals: string[],
): Record<string, unknown> {
  const actualSpec = spec ?? {};

  for (const name of Object.keys(options)) {
    if (!(name in actualSpec)) {
      throw new ValidationError({
        subtype: "invalid_argument",
        param: `--${name}`,
        message: `未知参数 --${name}`,
      });
    }
  }

  const out: Record<string, unknown> = {};
  let posIdx = 0;

  for (const [name, argSpec] of Object.entries(actualSpec)) {
    let value: unknown;

    if (argSpec.positional) {
      // positional 优先用位置参数;若没给位置值但同名 flag 传了(--url xxx),fallback 到 flag
      // → rxcli qrcode <url> 和 rxcli qrcode --url <url> 都能用
      value = positionals[posIdx];
      if (value === undefined && options[name] !== undefined) {
        value = options[name];
      }
      posIdx++;
    } else {
      value = options[name];
    }

    // required 校验
    if ((value === undefined || value === null) && argSpec.required) {
      throw new ValidationError({
        subtype: "missing_required",
        param: positionalLabel(name, argSpec),
        message: `缺少必填参数 ${positionalLabel(name, argSpec)}`,
        hint: argSpec.desc ? `参见: ${argSpec.desc}` : undefined,
      });
    }

    // 默认值
    if (value === undefined || value === null) {
      if (argSpec.default !== undefined) {
        out[name] = coerceType(name, argSpec.type, argSpec.default);
      }
      continue;
    }

    // 类型校验 + 转换
    out[name] = coerceType(name, argSpec.type, value);
  }

  // 检查多余的位置参数(spec 没声明但传了)
  if (posIdx < positionals.length) {
    throw new ValidationError({
      subtype: "invalid_argument",
      param: positionals[posIdx],
      message: `未预期的位置参数: ${positionals.slice(posIdx).join(" ")}`,
    });
  }

  return out;
}

/** 类型转换 + 校验。路由层解析出的值可能是 string(位置参数/字符串 flag)。 */
function coerceType(name: string, type: string, value: unknown): unknown {
  if (value === MISSING_FLAG_VALUE) {
    throw new ValidationError({
      subtype: "missing_required",
      param: `--${name}`,
      message: `参数 --${name} 缺少值`,
    });
  }
  switch (type) {
    case "string":
      return String(value);
    case "number": {
      const n = Number(value);
      if (value === "" || !Number.isFinite(n)) {
        throw new ValidationError({
          subtype: "invalid_argument",
          param: `--${name}`,
          message: `--${name} 必须为数字,收到: ${String(value)}`,
        });
      }
      return n;
    }
    case "boolean":
      // boolean flag 通常已解析为 true/false;字符串形态也兼容
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0" || value === "") return false;
      throw new ValidationError({
        subtype: "invalid_argument",
        param: `--${name}`,
        message: `--${name} 必须为布尔值(true/false/1/0),收到: ${String(value)}`,
      });
    case "array": {
      // 重复 array flag 已聚合为数组;直接调用 parseArgs 时的单值也包装成数组
      const arr = Array.isArray(value) ? value : [value];
      return arr.map(String);
    }
    default:
      return value;
  }
}

/** 参数在命令行的展示形态(positional 用原名,flag 带 --)。 */
export function positionalLabel(name: string, argSpec: { positional?: boolean }): string {
  return argSpec.positional ? name : `--${name}`;
}

/**
 * 生成命令签名片段(供 help + skills gen 用)。
 * 规则(对齐 06-skills.md 签名规则):
 *   required + positional → <name>
 *   optional + positional → [<name>]
 *   required + flag       → --name <type>
 *   optional + flag       → [--name <type>]
 *   boolean flag          → [--name]
 *   array flag            → [--name <type>...]
 */
export function signatureOfArgs(spec: ArgsSpec | undefined): {
  positionals: string[];
  options: string[];
} {
  if (!spec) return { positionals: [], options: [] };
  const positionals: string[] = [];
  const options: string[] = [];

  for (const [name, s] of Object.entries(spec)) {
    const label = s.positional ? name : `--${name}`;
    // typeTag 用 type(number/string/array),对齐 06-skills.md 签名规则
    const typeTag =
      s.type === "boolean" ? null : s.type === "array" ? "<string>..." : `<${s.type}>`;

    if (s.positional) {
      positionals.push(s.required ? `<${label}>` : `[${label}]`);
    } else if (typeTag === null) {
      // boolean flag
      options.push(s.required ? `--${name}` : `[--${name}]`);
    } else {
      const token = `--${name} ${typeTag}`;
      options.push(s.required ? token : `[${token}]`);
    }
  }
  return { positionals, options };
}
