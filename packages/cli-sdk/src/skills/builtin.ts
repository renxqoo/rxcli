/**
 * @renxqoo/agent-data-cli/skills —— 内置 skills 命令(list/read/sync/gen)
 *
 * 设计依据:docs/06-skills.md、docs/01-cli-usage.md "skill 自服务发现"。
 * 这些命令由 defineCli 在有 skillsDir 时自动注入(作为 'skills' 子命名空间)。
 *
 * 输出约定:
 *   - list / sync:走标准成功输出 {ok, data, meta}
 *   - gen:写到文件 + 返回统一输出(生成的路径)
 *   - read:**输出契约例外**(stdout 吐 SKILL.md 原文,见 03-envelopes.md)
 */

import { defineCommand, defineCommands } from "../define.js";
import {
  listSkills,
  listPath,
  readSkill,
  readReference,
  splitArg,
  prepareSkillDir,
} from "./reader.js";
import { syncSkills } from "./sync.js";
import { refreshAutogen, generateSkillSkeleton } from "./gen.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DefineCliOptions } from "../types.js";

/**
 * 创建内置 skills 命令组(注入 defineCli 的 namespaces.skills)。
 *
 * @param binName bin 名(defineCli.name,用于签名/gen)
 * @param skillsDir skill 目录
 * @param cliOptions defineCli 的 options(gen 用 commands/namespaces 提取签名)
 */
export function createBuiltinSkillsCommands(
  binName: string,
  skillsDir: string,
  cliOptions: Pick<DefineCliOptions<any>, "commands" | "namespaces" | "name" | "binName">,
) {
  return defineCommands({
    // list:列出所有 skill(统一输出格式),或列举一层(带 name/path 参数)
    list: defineCommand<any, unknown>({
      name: "list",
      description: "List all skills, or list one level under a skill",
      internal: true,
      args: { name: { type: "string", positional: true, desc: "skill name or name/subpath" } },
      async run(args) {
        if (!args.name) {
          const all = listSkills(skillsDir);
          return { data: all, meta: { count: all.length } };
        }
        const { entries, listed } = listPath(skillsDir, args.name);
        return { data: entries, meta: { count: entries.length, path: listed } };
      },
    }),

    // read:读 SKILL.md 或 reference。**输出契约例外**:stdout 吐原文
    read: defineCommand<any, unknown>({
      name: "read",
      description:
        "Read a skill's SKILL.md or reference (raw content to stdout, output contract exception)",
      internal: true,
      args: {
        name: {
          type: "string",
          required: true,
          positional: true,
          desc: "skill name or name/subpath",
        },
      },
      async run(args) {
        const [skillName, rest] = splitArg(args.name);
        let content: string;
        let pathLabel: string;
        if (!rest) {
          content = readSkill(skillsDir, skillName).toString("utf8");
          pathLabel = "SKILL.md";
        } else {
          const r = readReference(skillsDir, skillName, rest);
          content = r.content.toString("utf8");
          pathLabel = r.cleaned;
        }
        // 输出契约例外:meta._rawOutput=true 让 pipeline 直接吐 data 原文(不走统一输出格式)
        return { data: content, meta: { skill: skillName, path: pathLabel, _rawOutput: true } };
      },
    }),

    // sync:同步到 ~/.agents/skills/
    sync: defineCommand<any, unknown>({
      name: "sync",
      description: "Sync skills to ~/.agents/skills/ (for AI agent discovery)",
      internal: true,
      async run() {
        const { count, destDir } = syncSkills(skillsDir);
        return { data: { synced: count, destDir } };
      },
    }),

    // gen:自动生成命令文档(刷新 AUTO-GEN 块 / --init 吐骨架)
    gen: defineCommand<any, unknown>({
      name: "gen",
      description:
        "Generate SKILL.md command docs from defineCommands (refreshes the AUTO-GEN block)",
      internal: true,
      args: {
        name: {
          type: "string",
          required: true,
          positional: true,
          desc: "skill name (= directory name)",
        },
        init: {
          type: "boolean",
          desc: "Generate the full SKILL.md skeleton on first run (with {{FILL}} placeholders)",
        },
        lang: { type: "string", desc: "Skeleton language: 'en' (default) or 'zh'", default: "en" },
      },
      async run(args) {
        const skillName = args.name;
        const skillDir = prepareSkillDir(skillsDir, skillName);
        const skillMdPath = join(skillDir, "SKILL.md");
        const lang = args.lang === "zh" ? "zh" : "en";

        if (args.init || !existsSync(skillMdPath)) {
          // 策略 B:吐整份骨架
          const desc = `${binName} business skill`;
          const content = generateSkillSkeleton(skillName, desc, binName, cliOptions, lang);
          writeFileSync(skillMdPath, content);
          return { data: { generated: skillMdPath, mode: "init" } };
        }

        // 策略 A:刷新 AUTO-GEN 块(块外语义内容保留)
        const existing = readFileSync(skillMdPath, "utf8");
        const updated = refreshAutogen(existing, binName, cliOptions, lang);
        writeFileSync(skillMdPath, updated);
        return { data: { refreshed: skillMdPath, mode: "refresh" } };
      },
    }),
  });
}
