/**
 * @renxqoo/agent-data-cli/skills —— skill 系统(reader + sync + gen)
 *
 * 子路径导出(供自定义 skill 处理用):
 *   import { listSkills, readSkill, syncSkills, refreshAutogen } from '@renxqoo/agent-data-cli/skills'
 */

export type { SkillInfo, DirEntry } from './reader.js'
export {
  listSkills,
  listPath,
  readSkill,
  readReference,
  splitArg,
  cleanSubPath,
  parseFrontmatter,
} from './reader.js'

export { syncSkills } from './sync.js'

export {
  flattenCommands,
  signatureLine,
  argsTable,
  generateAutogenBlock,
  refreshAutogen,
  generateSkillSkeleton,
  AUTOGEN_START,
  AUTOGEN_END,
} from './gen.js'
