/**
 * @renxqoo/agentdatacli/skills —— 命令文档自动生成(gen)
 *
 * 设计依据:docs/06-skills.md "自动文档生成"、"命令签名生成规则"。
 * 核心机制:AUTO-GEN 标记块(preserved regions)。
 *   - 标记块内:从 defineCommands 的 spec 自动生成(签名表 + 参数表),每次 gen 覆盖,人不要手改
 *   - 标记块外:人写的语义内容(何时用/错误处理),gen 永不触碰
 *
 * 两种策略(都用,决策清单 #15):
 *   - 策略 A(增量):只生成 ## 命令 + ### 参数说明 两节,塞进标记块 → gen <name>
 *   - 策略 B(骨架):首次吐整份 SKILL.md(带 {{FILL}} 占位),后续只刷标记块 → gen <name> --init
 */

import { signatureOfArgs } from '../args.js'
import type { CommandSpec, CommandGroup, DefineCliOptions, ArgsSpec, ArgSpec } from '../types.js'

// ============================================================================
// AUTO-GEN 标记块
// ============================================================================

export const AUTOGEN_START = '<!-- AUTO-GEN:START commands -->'
export const AUTOGEN_END = '<!-- AUTO-GEN:END -->'

// ============================================================================
// 从 defineCli 的 commands/namespaces 提取所有命令(扁平化)
// ============================================================================

interface FlatCommand {
  /** 完整命令路径(如 'list' 或 'orders list')。 */
  path: string
  spec: CommandSpec
}

/** 把 defineCli 的 commands + namespaces 扁平化成命令列表。 */
export function flattenCommands(options: Pick<DefineCliOptions<any>, 'commands' | 'namespaces'>): FlatCommand[] {
  const out: FlatCommand[] = []
  for (const [cmdName, spec] of Object.entries(options.commands ?? {})) {
    out.push({ path: cmdName, spec })
  }
  if (options.namespaces) {
    for (const [nsName, group] of Object.entries(options.namespaces)) {
      for (const [cmdName, spec] of Object.entries(group)) {
        out.push({ path: `${nsName} ${cmdName}`, spec })
      }
    }
  }
  return out
}

// ============================================================================
// 单个命令的签名 + 参数表生成
// ============================================================================

/** 生成单个命令的签名行(如 `rxcli-orders list [--limit <number>] [--status <string>]`)。 */
export function signatureLine(binName: string, cmd: FlatCommand): string {
  const sig = signatureOfArgs(cmd.spec.args)
  const pos = sig.positionals.join(' ')
  const opts = sig.options.join(' ')
  return [`${binName} ${cmd.path}`, pos, opts].filter(Boolean).join(' ').trim()
}

/** 生成参数说明表(markdown)。 */
export function argsTable(argsSpec: ArgsSpec | undefined): string {
  if (!argsSpec) return ''
  const rows = Object.entries(argsSpec).map(([name, spec]) => {
    return `| ${argFlag(name, spec)} | ${spec.type} | ${spec.required ? '是' : '否'} | ${formatDefault(spec.default)} | ${spec.desc ?? '—'} |`
  })
  if (rows.length === 0) return ''
  return [
    '| 参数 | 类型 | 必填 | 默认 | 说明 |',
    '|------|------|:----:|------|------|',
    ...rows,
  ].join('\n')
}

/** 参数在签名里的展示形态(对齐 args.ts 的 signatureOfArgs,但表格用 flag 名)。 */
function argFlag(name: string, spec: ArgSpec): string {
  if (spec.positional) {
    return spec.required ? `<${name}>` : `[<${name}>]`
  }
  if (spec.type === 'boolean') return `--${name}`
  return `--${name} <${spec.type}>`
}

function formatDefault(def: unknown): string {
  if (def === undefined) return '—'
  if (typeof def === 'string') return def
  return String(def)
}

// ============================================================================
// AUTO-GEN 块内容(## 命令 + ### 参数说明)
// ============================================================================

/** 生成 AUTO-GEN 块的完整内容(策略 A)。 */
export function generateAutogenBlock(binName: string, options: Pick<DefineCliOptions<any>, 'commands' | 'namespaces'>): string {
  const cmds = flattenCommands(options)
  if (cmds.length === 0) return ''

  const lines: string[] = []
  // ## 命令表(操作 / 命令)
  lines.push('## 命令')
  lines.push('')
  lines.push('| 操作 | 命令 |')
  lines.push('|------|------|')
  for (const cmd of cmds) {
    const desc = cmd.spec.description ?? ''
    const sig = signatureLine(binName, cmd)
    lines.push(`| ${desc} | \`${sig}\` |`)
  }
  lines.push('')

  // ### 参数说明(每个命令一节)
  lines.push('### 参数说明')
  lines.push('')
  for (const cmd of cmds) {
    lines.push(`**${cmd.path}**`)
    const table = argsTable(cmd.spec.args)
    if (table) {
      lines.push(table)
    } else {
      lines.push('(无参数)')
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

// ============================================================================
// 策略 A:刷新已有 SKILL.md 的 AUTO-GEN 块
// ============================================================================

/**
 * 刷新 SKILL.md 内容的 AUTO-GEN 块(策略 A)。
 * - 文件已有 AUTO-GEN 块:替换块内容,块外语义内容不动
 * - 文件无 AUTO-GEN 块(或不存在):返回带块的新内容(块接在末尾)
 *
 * @param existing 已有 SKILL.md 内容(空字符串表示无)
 * @returns 新的 SKILL.md 内容
 */
export function refreshAutogen(
  existing: string,
  binName: string,
  options: Pick<DefineCliOptions<any>, 'commands' | 'namespaces'>,
): string {
  const block = generateAutogenBlock(binName, options)
  const fullBlock = `${AUTOGEN_START}\n<!-- 本区块由 \`rxcli skills gen\` 自动生成,不要手改 -->\n${block}\n${AUTOGEN_END}`

  if (existing.includes(AUTOGEN_START)) {
    // 替换已有块(块外内容保留)
    const regex = new RegExp(`${escapeRegex(AUTOGEN_START)}[\\s\\S]*?${escapeRegex(AUTOGEN_END)}`, 'g')
    return existing.replace(regex, fullBlock).trimEnd() + '\n'
  }

  // 无块:接在已有内容末尾(或新文件)
  return (existing.trimEnd() + '\n\n' + fullBlock + '\n').trimStart()
}

// ============================================================================
// 策略 B:首次生成整份 SKILL.md 骨架(带 {{FILL}} 占位)
// ============================================================================

/** 生成整份 SKILL.md 骨架(策略 B,首次 --init 用)。 */
export function generateSkillSkeleton(
  skillName: string,
  description: string,
  binName: string,
  options: Pick<DefineCliOptions<any>, 'commands' | 'namespaces'>,
): string {
  const block = generateAutogenBlock(binName, options)
  return `---
name: ${skillName}
description: ${description || '{{FILL: 一句话描述何时用 —— agent 靠它语义匹配用户意图}}'}
version: 1.0.0
metadata:
  requires:
    bins: ["${binName}"]
  category: business
---

# ${skillName}

{{FILL: 简介 —— 支持哪些操作}}

${AUTOGEN_START}
<!-- 本区块由 \`rxcli skills gen\` 自动生成,不要手改 -->
${block}
${AUTOGEN_END}

## 何时用

| 用户说 | 命令 |
|--------|------|
| {{FILL: "查订单"}} | \`${binName} list\` |

## 前置条件

- 已登录:\`${binName} auth status\`

## 错误处理

| 错误 | 处理 |
|------|------|
| \`not_found\` / exit 1 | {{FILL: 记录不存在,用 list 查有效 ID}} |
| exit 4 网络错误 | 稍后重试 |
`
}

// ============================================================================
// 辅助
// ============================================================================

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
