/**
 * @renxqoo/agentdatacli —— 参数解析与校验
 *
 * 设计依据:docs/02-sdk-guide.md "ArgsSpec + ArgSpec"、"args 字段规范"。
 * cli-sdk 只负责解析 + 校验类型 + 填默认值,不参与参数语义(后端要 page/pageSize 还是 cursor,
 * 业务包在 run 里自己翻译)。
 *
 * 注:cac 负责把 argv 切成 raw 选项/位置参数;本模块把 raw 值按 spec 校验 + 填默认 + 类型转换。
 */

import type { ArgsSpec } from './types.js'
import { ValidationError } from './errs/index.js'

/** 从 spec 推导出的参数解析结果类型(简单命令够用;复杂命令用 interface 显式声明泛型)。 */
export type ParsedArgs<S extends ArgsSpec> = {
  [K in keyof S]: S[K]['type'] extends 'array'
    ? unknown[]
    : S[K]['type'] extends 'number'
      ? number
      : S[K]['type'] extends 'boolean'
        ? boolean
        : unknown
}

/**
 * 把 cac 解析出的 raw 选项 + raw 位置参数,按 spec 校验 + 填默认值 + 类型转换。
 *
 * @param spec 命令声明的 args spec
 * @param options cac 解析出的 flag 选项(键名不含 --)
 * @param positionals cac 解析出的位置参数数组(按 spec 中 positional:true 的声明顺序对应)
 */
export function parseArgs(
  spec: ArgsSpec | undefined,
  options: Record<string, unknown>,
  positionals: string[],
): Record<string, unknown> {
  if (!spec) return {}

  const out: Record<string, unknown> = {}
  const positionalSpecs = Object.entries(spec).filter(([, s]) => s.positional)
  let posIdx = 0

  for (const [name, argSpec] of Object.entries(spec)) {
    let value: unknown

    if (argSpec.positional) {
      // positional 优先用位置参数;若没给位置值但同名 flag 传了(--url xxx),fallback 到 flag
      // → rxcli qrcode <url> 和 rxcli qrcode --url <url> 都能用
      value = positionals[posIdx]
      if (value === undefined && options[name] !== undefined) {
        value = options[name]
      }
      posIdx++
    } else {
      value = options[name]
    }

    // required 校验
    if ((value === undefined || value === null) && argSpec.required) {
      throw new ValidationError({
        subtype: 'missing_required',
        param: positionalLabel(name, argSpec),
        message: `缺少必填参数 ${positionalLabel(name, argSpec)}`,
        hint: argSpec.desc ? `参见: ${argSpec.desc}` : undefined,
      })
    }

    // 默认值
    if (value === undefined || value === null) {
      if (argSpec.default !== undefined) {
        out[name] = argSpec.default
      }
      continue
    }

    // 类型校验 + 转换
    out[name] = coerceType(name, argSpec.type, value)
  }

  // 检查多余的位置参数(spec 没声明但传了)
  if (posIdx < positionals.length) {
    throw new ValidationError({
      subtype: 'invalid_argument',
      param: positionals[posIdx],
      message: `未预期的位置参数: ${positionals.slice(posIdx).join(' ')}`,
    })
  }

  return out
}

/** 类型转换 + 校验。cac 解析出的值可能是 string(位置参数/字符串 flag)。 */
function coerceType(name: string, type: string, value: unknown): unknown {
  switch (type) {
    case 'string':
      return String(value)
    case 'number': {
      const n = Number(value)
      if (value === '' || Number.isNaN(n)) {
        throw new ValidationError({
          subtype: 'invalid_argument',
          param: `--${name}`,
          message: `--${name} 必须为数字,收到: ${String(value)}`,
        })
      }
      return n
    }
    case 'boolean':
      // cac 对 boolean flag 默认解析为 true/false;字符串形态也兼容
      if (typeof value === 'boolean') return value
      if (value === 'true' || value === '1') return true
      if (value === 'false' || value === '0' || value === '') return false
      return Boolean(value)
    case 'array': {
      // cac 的 array(flag 可多次)已解析为数组;单值包装成数组
      const arr = Array.isArray(value) ? value : [value]
      return arr.map(String)
    }
    default:
      return value
  }
}

/** 参数在命令行的展示形态(positional 用原名,flag 带 --)。 */
export function positionalLabel(name: string, argSpec: { positional?: boolean }): string {
  return argSpec.positional ? name : `--${name}`
}

/**
 * 生成命令签名片段(供 cac 注册命令 + skills gen 用)。
 * 规则(对齐 06-skills.md 签名规则):
 *   required + positional → <name>
 *   optional + positional → [<name>]
 *   required + flag       → --name <type>
 *   optional + flag       → [--name <type>]
 *   boolean flag          → [--name]
 *   array flag            → [--name <type>...]
 */
export function signatureOfArgs(spec: ArgsSpec | undefined): {
  positionals: string[]
  options: string[]
} {
  if (!spec) return { positionals: [], options: [] }
  const positionals: string[] = []
  const options: string[] = []

  for (const [name, s] of Object.entries(spec)) {
    const label = s.positional ? name : `--${name}`
    // typeTag 用 type(number/string/array),对齐 06-skills.md 签名规则
    const typeTag = s.type === 'boolean' ? null : s.type === 'array' ? `<${s.type}...>` : `<${s.type}>`

    if (s.positional) {
      positionals.push(s.required ? `<${label}>` : `[${label}]`)
    } else if (typeTag === null) {
      // boolean flag
      options.push(s.required ? `--${name}` : `[--${name}]`)
    } else {
      const token = `--${name} ${typeTag}`
      options.push(s.required ? token : `[${token}]`)
    }
  }
  return { positionals, options }
}
