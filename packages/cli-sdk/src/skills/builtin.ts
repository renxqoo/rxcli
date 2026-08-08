/**
 * @renxqoo/agent-data-cli/skills —— 内置 skills 命令(list/read/sync/gen)
 *
 * 设计依据:docs/06-skills.md、docs/01-cli-usage.md "skill 自服务发现"。
 * 这些命令由 defineCli 在有 skillsDir 时自动注入(作为 'skills' 子命名空间)。
 *
 * 输出约定:
 *   - list / sync:走标准成功信封 {ok, data, meta}
 *   - gen:写到文件 + 返回信封(生成的路径)
 *   - read:**信封契约例外**(stdout 吐 SKILL.md 原文,见 03-envelopes.md)
 */

import { defineCommand, defineCommands } from "../define.js";
import { listSkills, listPath, readSkill, readReference, splitArg } from "./reader.js";
import { syncSkills } from "./sync.js";
import { refreshAutogen, generateSkillSkeleton } from "./gen.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
    // list:列出所有 skill(信封),或列举一层(带 name/path 参数)
    list: defineCommand<any, unknown>({
      name: "list",
      description: "列出所有 skill,或列举某 skill 下的一层",
      internal: true,
      args: { name: { type: "string", positional: true, desc: "skill 名或 name/subpath" } },
      async run(args) {
        if (!args.name) {
          const all = listSkills(skillsDir);
          return { data: all, meta: { count: all.length } };
        }
        const { entries, listed } = listPath(skillsDir, args.name);
        return { data: entries, meta: { count: entries.length, path: listed } };
      },
    }),

    // read:读 SKILL.md 或 reference。**信封契约例外**:stdout 吐原文
    read: defineCommand<any, unknown>({
      name: "read",
      description: "读 skill 的 SKILL.md 或 reference(原文到 stdout,信封例外)",
      internal: true,
      args: {
        name: {
          type: "string",
          required: true,
          positional: true,
          desc: "skill 名 或 name/subpath",
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
        // 信封例外:meta._rawOutput=true 让 pipeline 直接吐 data 原文(不走信封)
        return { data: content, meta: { skill: skillName, path: pathLabel, _rawOutput: true } };
      },
    }),

    // sync:同步到 ~/.agents/skills/
    sync: defineCommand<any, unknown>({
      name: "sync",
      description: "把 skills 同步到 ~/.agents/skills/(供 AI agent 发现)",
      internal: true,
      async run() {
        const { count, destDir } = syncSkills(skillsDir);
        return { data: { synced: count, destDir } };
      },
    }),

    // gen:自动生成命令文档(刷新 AUTO-GEN 块 / --init 吐骨架)
    gen: defineCommand<any, unknown>({
      name: "gen",
      description: "从 defineCommands 生成 SKILL.md 命令文档(刷新 AUTO-GEN 块)",
      internal: true,
      args: {
        name: { type: "string", required: true, positional: true, desc: "skill 名(= 目录名)" },
        init: { type: "boolean", desc: "首次生成整份 SKILL.md 骨架(带 {{FILL}} 占位)" },
      },
      async run(args) {
        const skillName = args.name;
        const skillMdPath = join(skillsDir, skillName, "SKILL.md");
        const skillDir = join(skillsDir, skillName);

        if (args.init || !existsSync(skillMdPath)) {
          // 策略 B:吐整份骨架
          mkdirSync(skillDir, { recursive: true });
          const desc = `${binName} 业务 skill`;
          const content = generateSkillSkeleton(skillName, desc, binName, cliOptions);
          writeFileSync(skillMdPath, content);
          return { data: { generated: skillMdPath, mode: "init" } };
        }

        // 策略 A:刷新 AUTO-GEN 块(块外语义内容保留)
        const existing = readFileSync(skillMdPath, "utf8");
        const updated = refreshAutogen(existing, binName, cliOptions);
        writeFileSync(skillMdPath, updated);
        return { data: { refreshed: skillMdPath, mode: "refresh" } };
      },
    }),
  });
}
