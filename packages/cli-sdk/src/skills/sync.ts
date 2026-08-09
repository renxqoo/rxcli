/**
 * @renxqoo/agent-data-cli/skills —— skill 同步(到 ~/.agents/skills/)
 *
 * 设计依据:docs/06-skills.md "skill 同步机制"。
 * 实现 skills 同步。
 * 把业务包的 skills 目录全量同步到 ~/.agents/skills/(主流 agent 工具的标准发现路径)。
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { listSkills } from "./reader.js";

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
export function syncSkills(
  skillsRoot: string,
  destDir: string = join(homedir(), ".agents", "skills"),
): {
  count: number;
  destDir: string;
} {
  mkdirSync(destDir, { recursive: true });
  const skills = listSkills(skillsRoot);
  const sourceNames = new Set(skills.map((s) => s.name));

  // 共享目标目录按 source 分别记账。只删除“这个 source 上次同步、这次已删除”的条目，
  // 绝不扫描并删除其他业务包/用户安装的 skill。
  const manifestsDir = join(destDir, ".rxcli-sync-manifests");
  mkdirSync(manifestsDir, { recursive: true });
  const sourceId = createHash("sha256").update(resolve(skillsRoot)).digest("hex");
  const manifestPath = join(manifestsDir, `${sourceId}.json`);
  let previousNames: string[] = [];
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { skills?: unknown };
      if (Array.isArray(parsed.skills)) {
        previousNames = parsed.skills.filter((name): name is string => typeof name === "string");
      }
    } catch {
      previousNames = [];
    }
  }

  const findOtherOwner = (name: string): string | undefined => {
    for (const file of readdirSync(manifestsDir)) {
      if (join(manifestsDir, file) === manifestPath || !file.endsWith(".json")) continue;
      try {
        const manifest = JSON.parse(readFileSync(join(manifestsDir, file), "utf8")) as {
          source?: unknown;
          skills?: unknown;
        };
        if (
          typeof manifest.source === "string" &&
          Array.isArray(manifest.skills) &&
          manifest.skills.includes(name) &&
          existsSync(join(manifest.source, name, "SKILL.md"))
        ) {
          return manifest.source;
        }
      } catch {
        // 损坏/并发中的其他 manifest 不影响当前 source 同步。
      }
    }
    return undefined;
  };

  for (const previous of previousNames) {
    if (!sourceNames.has(previous)) {
      const target = join(destDir, previous);
      const otherSource = findOtherOwner(previous);
      rmSync(target, { recursive: true, force: true });
      if (otherSource) cpSync(join(otherSource, previous), target, { recursive: true });
    }
  }

  let count = 0;
  for (const s of skills) {
    const target = join(destDir, s.name);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    cpSync(join(skillsRoot, s.name), target, { recursive: true });
    count++;
  }
  writeFileSync(
    manifestPath,
    JSON.stringify({ source: resolve(skillsRoot), skills: [...sourceNames].sort() }, null, 2) +
      "\n",
  );
  return { count, destDir };
}
