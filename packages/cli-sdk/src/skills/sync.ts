/**
 * @renxqoo/agentdatacli/skills —— skill 同步(到 ~/.agents/skills/)
 *
 * 设计依据:docs/06-skills.md "skill 同步机制"。
 * 从 v1 commands/skills.ts 的 sync action 移植。
 * 把业务包的 skills 目录全量同步到 ~/.agents/skills/(主流 agent 工具的标准发现路径)。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { listSkills } from './reader.js'

/**
 * 把 skillsRoot 下所有 skill 同步到 destDir(默认 ~/.agents/skills/)。
 * 全量策略:先删旧再拷新(skill 数量小,简单可靠)。
 *
 * M4:真正的"全量同步" —— destDir 中存在、但源端已删除的 skill 会被清理掉,
 * 避免源端删了 skill 后 ~/.agents/skills/ 残留旧副本。
 * 安全:只清理"看起来是 skill"的条目(destDir 子目录含 SKILL.md),不误删其他工具放的无关目录。
 *
 * @returns 同步的 skill 数量 + 目标路径
 */
export function syncSkills(skillsRoot: string, destDir: string = join(homedir(), '.agents', 'skills')): {
  count: number
  destDir: string
} {
  mkdirSync(destDir, { recursive: true })
  const skills = listSkills(skillsRoot)
  const sourceNames = new Set(skills.map((s) => s.name))

  // M4:清理 destDir 中源端已删除的 skill(仅清理是 skill 的目录:含 SKILL.md)
  if (existsSync(destDir)) {
    for (const entry of readdirSync(destDir)) {
      if (sourceNames.has(entry)) continue // 源端仍存在,跳过(下面会覆盖)
      const destChild = join(destDir, entry)
      try {
        if (!statSync(destChild).isDirectory()) continue
      } catch {
        continue
      }
      // 只清理"是 skill"的目录(含 SKILL.md),不误删其他工具的目录
      if (existsSync(join(destChild, 'SKILL.md'))) {
        rmSync(destChild, { recursive: true, force: true })
      }
    }
  }

  let count = 0
  for (const s of skills) {
    const target = join(destDir, s.name)
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    cpSync(join(skillsRoot, s.name), target, { recursive: true })
    count++
  }
  return { count, destDir }
}
