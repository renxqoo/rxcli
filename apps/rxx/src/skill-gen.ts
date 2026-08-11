/**
 * rxx —— skill 文档生成 + 多 agent 分发
 *
 * init 时:manifest → commands/namespaces → generateSkillSkeleton → syncSkills
 * 复用 cli-sdk 的 skill 系统(gen.ts + sync.ts),零自研。
 *
 * 产出的 skill 符合 Agent Skills 开放标准(agentskills.io):
 *   - SKILL.md 带 YAML frontmatter(name + description)
 *   - AUTO-GEN 块自动生成命令表
 *   - 分发到 ~/.agents/skills + 各 agent 发现目录
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  generateSkillSkeleton,
  syncSkills,
  resolveActiveTargets,
  expandTargetDir,
  type GenLang,
} from "@renxqoo/agent-data-cli";
import type { Manifest } from "./manifest/schema.js";
import { manifestToCommands } from "./executor/dynamic-command.js";
import { getRxSkillsDir } from "./config.js";
import { hostOf } from "./manifest/schema.js";
import { assertSafeServiceName } from "./security.js";

export interface SkillGenResult {
  /** 生成的 skill 目录(SKILL.md 所在)。 */
  skillDir: string;
  /** SKILL.md 内容。 */
  content: string;
  /** 分发结果。 */
  sync: ReturnType<typeof syncSkills>;
}

/**
 * 为一个已装服务生成 skill + 分发到各 agent 目录。
 *
 * @param m manifest
 * @param lang 文档语言
 */
export function generateAndSyncSkill(m: Manifest, lang: GenLang = "en"): SkillGenResult {
  // 纵深防御:写文件前校验名字
  assertSafeServiceName(m.name);
  const { commands, namespaces } = manifestToCommands(m);

  // bin 名 = 服务名(用户终端敲的,shim 转发后 rxx run <name> <cmd>)
  const binName = m.name;
  const skillName = m.name;

  // 生成骨架(带 frontmatter + AUTO-GEN 块)
  const skillMd = generateSkillSkeleton(
    skillName,
    m.description,
    binName,
    { commands, namespaces },
    lang,
  );

  // 写到临时 skill 目录(~/.rxx/skills/<name>/SKILL.md)
  const skillsDir = getRxSkillsDir();
  const skillDir = join(skillsDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), skillMd, "utf8");

  // 分发到各 agent 发现目录(复用 cli-sdk syncSkills)
  // 用探测模式:~/.agents 始终写 + 已装的 agent 工具目录
  const syncResult = syncSkills(skillsDir, { detect: true });

  return { skillDir, content: skillMd, sync: syncResult };
}

/** 移除一个服务的 skill(从临时目录 + 各 agent 目录)。 */
export function removeSkill(name: string): void {
  // 纵深防御:独立校验名字(不依赖 removeService 先执行)
  assertSafeServiceName(name);
  // 临时目录
  const skillDir = join(getRxSkillsDir(), name);
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true });
  }
  // 各 agent 目录(resolveActiveTargets + expandTargetDir 展开 ~)
  const targets = resolveActiveTargets();
  for (const t of targets) {
    // 用 cli-sdk 的 expandTargetDir 展开 ~(Q3b:不再 fallback /tmp 静默错误)
    const targetSkillDir = join(expandTargetDir(t.dir), name);
    if (existsSync(targetSkillDir)) {
      rmSync(targetSkillDir, { recursive: true, force: true });
    }
  }
}

/**
 * 统计 manifest 的命令数(用于 init 时展示)。
 */
export function countCommands(m: Manifest): { total: number; write: number } {
  let total = 0;
  let write = 0;
  const count = (group: Record<string, any>) => {
    for (const cmd of Object.values(group)) {
      total++;
      const method = (cmd as any).http?.method;
      if (method && method !== "GET") write++;
    }
  };
  if (m.commands) count(m.commands);
  if (m.namespaces) {
    for (const ns of Object.values(m.namespaces)) count(ns);
  }
  return { total, write };
}

/**
 * 统计 manifest 访问的 host 列表(init 信任确认展示用)。
 */
export function collectHosts(m: Manifest): { api?: string; auth?: string } {
  return {
    api: m.api?.baseUrl ? (hostOf(m.api.baseUrl) ?? undefined) : undefined,
    auth: m.auth?.baseUrl ? (hostOf(m.auth.baseUrl) ?? undefined) : undefined,
  };
}
