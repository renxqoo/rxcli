/**
 * @renxqoo/agentdatacli/skills —— skill 内容读取器
 *
 * 设计依据:docs/06-skills.md、docs/01-cli-usage.md "skill 自服务发现"。
 * 从 v1 skills/reader.ts 移植(已对齐 lark-cli skillcontent/reader.go)。
 *
 * 改造点(v1 → v2):
 *   - skillsRoot 不再写死探测,改由参数传入(业务包各自的 skills 目录不同)
 *   - 错误改用类型化错误(InternalError/NotFoundError),而非裸 Error
 *   - skills read 声明为信封契约例外(stdout 吐原文,见 03-envelopes.md)
 *
 * skill 是给 AI agent 读的 Markdown 指令文档(SKILL.md + references/)。
 * 本读取器负责扫描、列举、读取,带路径穿越校验(cleanSubPath)。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, sep, normalize } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { NotFoundError, InternalError } from '../errs/index.js'

// ============================================================================
// 类型
// ============================================================================

export interface SkillInfo {
  name: string
  description: string
  version?: string
  metadata?: Record<string, unknown>
}

export interface DirEntry {
  path: string
  is_dir: boolean
}

// ============================================================================
// skill 列举 / 读取(skillsRoot 由调用方传入)
// ============================================================================

/** 列出所有 skill(扫描有 SKILL.md 的子目录),按 name 排序。 */
export function listSkills(skillsRoot: string): SkillInfo[] {
  if (!existsSync(skillsRoot)) return []
  const entries = readdirSync(skillsRoot)
  const out: SkillInfo[] = []
  for (const e of entries) {
    const full = join(skillsRoot, e)
    if (!statSync(full).isDirectory()) continue
    const skillMd = join(full, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    const { description, version, metadata } = parseFrontmatter(skillMd)
    const info: SkillInfo = { name: e, description }
    if (version) info.version = version
    if (metadata && Object.keys(metadata).length > 0) info.metadata = metadata
    out.push(info)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 列举一层目录(像 ls)。返回 entries + 实际列举的路径。 */
export function listPath(skillsRoot: string, arg: string): { entries: DirEntry[]; listed: string } {
  const [name, sub] = splitArg(arg)
  ensureSkill(skillsRoot, name)
  let dir = name
  if (sub) {
    const cleaned = cleanSubPath(sub)
    dir = `${name}/${cleaned}`
    // M7:子路径不存在 → NotFoundError(而非裸 statSync ENOENT 被兜底成 internal/unknown)
    const subFull = join(skillsRoot, dir)
    if (!existsSync(subFull)) {
      throw new NotFoundError(`path "${name}/${cleaned}" 不存在`)
    }
    const info = statSync(subFull)
    if (!info.isDirectory()) {
      throw new InternalError({
        subtype: 'contract_violation',
        message: `path "${sub}" is a file, not a directory; use 'rxcli skills read ${name}/${cleaned}' to read it`,
      })
    }
  }
  const entries = readdirSync(join(skillsRoot, dir))
  return {
    entries: entries
      .map((e) => ({
        path: `${dir}/${e}`,
        is_dir: statSync(join(skillsRoot, dir, e)).isDirectory(),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    listed: dir,
  }
}

/** 读 skill 的 SKILL.md,返回原始 Buffer(供 stdout 直接吐 bytes)。 */
export function readSkill(skillsRoot: string, name: string): Buffer {
  ensureSkill(skillsRoot, name)
  const p = join(skillsRoot, name, 'SKILL.md')
  if (!existsSync(p)) {
    throw new NotFoundError(`skill "${name}" 无 SKILL.md`)
  }
  return readFileSync(p)
}

/** 读 reference 文件。返回 { content, cleaned }。 */
export function readReference(
  skillsRoot: string,
  name: string,
  relpath: string,
): { content: Buffer; cleaned: string } {
  ensureSkill(skillsRoot, name)
  const cleaned = cleanSubPath(relpath)
  const full = join(skillsRoot, name, cleaned)
  if (!existsSync(full)) {
    throw new NotFoundError(`reference "${name}/${relpath}" 不存在`)
  }
  const info = statSync(full)
  if (info.isDirectory()) {
    throw new InternalError({
      subtype: 'contract_violation',
      message: `reference "${relpath}" is a directory, not a file`,
    })
  }
  return { content: readFileSync(full), cleaned }
}

/** 拆分 "name/rest"。 */
export function splitArg(arg: string): [string, string] {
  const idx = arg.indexOf('/')
  if (idx < 0) return [arg, '']
  return [arg.slice(0, idx), arg.slice(idx + 1)]
}

// ============================================================================
// 校验(内部)
// ============================================================================

/** 校验 skill 名存在(防把 skill 名当路径用)。skill 不存在视为 not_found。 */
function ensureSkill(skillsRoot: string, name: string): void {
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..') {
    throw new NotFoundError(`unknown skill "${name}". run 'rxcli skills list' to see available skills`)
  }
  const full = join(skillsRoot, name)
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    throw new NotFoundError(`unknown skill "${name}". run 'rxcli skills list' to see available skills`)
  }
}

/**
 * 清理相对路径,拒绝绝对路径和 ".." 穿越(对齐 lark-cli cleanSubPath)。
 * 这是 skill 系统的安全边界,CLI 参数来自不可信的 agent,所有文件 IO 前必须校验。
 */
export function cleanSubPath(relpath: string): string {
  if (!relpath) {
    throw new InternalError({ subtype: 'contract_violation', message: `invalid path: must be a relative path without '..'` })
  }
  // 拒绝绝对路径(POSIX 和 Windows)
  if (relpath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(relpath)) {
    throw new InternalError({
      subtype: 'contract_violation',
      message: `invalid path "${relpath}": must be a relative path without '..'`,
    })
  }
  const cleaned = normalize(relpath).split(sep).join('/')
  if (cleaned === '.' || cleaned === '..' || cleaned.startsWith('../') || cleaned.startsWith('..\\')) {
    throw new InternalError({
      subtype: 'contract_violation',
      message: `invalid path "${relpath}": must be a relative path without '..'`,
    })
  }
  return cleaned
}

// ============================================================================
// frontmatter 解析(best-effort)
// ============================================================================

/** 解析 SKILL.md 的 frontmatter(首行 --- 到下一个 ---)。失败返回空字段,不抛。 */
export function parseFrontmatter(skillMdPath: string): {
  description: string
  version: string
  metadata: Record<string, unknown>
} {
  if (!existsSync(skillMdPath)) return { description: '', version: '', metadata: {} }
  const data = readFileSync(skillMdPath, 'utf8')
  const lines = data.split('\n')
  if (lines[0]?.trimEnd() !== '---') {
    return { description: '', version: '', metadata: {} }
  }
  const block: string[] = []
  let closed = false
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === '---') {
      closed = true
      break
    }
    block.push(lines[i]!)
  }
  if (!closed) return { description: '', version: '', metadata: {} }
  try {
    const fm = parseYaml(block.join('\n')) as {
      description?: string
      version?: string
      metadata?: Record<string, unknown>
    }
    return {
      description: fm.description ?? '',
      version: fm.version ?? '',
      metadata: fm.metadata ?? {},
    }
  } catch {
    return { description: '', version: '', metadata: {} }
  }
}
