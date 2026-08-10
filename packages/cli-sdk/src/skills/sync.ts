/**
 * @renxqoo/agent-data-cli/skills —— skill 同步(到多个 AI agent 工具发现目录)
 *
 * 设计依据:docs/06-skills.md "skill 同步机制"。
 * 实现 skills 同步:把业务包的 skills 目录同步到多个 AI agent 工具的标准发现路径。
 *
 * 组件分工:
 *   - targets.ts:定义"同步到哪"(默认 7 个工具目录 + 可覆盖)
 *   - sync.ts:定义"怎么同步"(本文件)—— 全量同步到单个目录的 syncOne + 遍历多 target 的 syncSkills
 *
 * 全量策略:先删旧再拷新(skill 数量小,简单可靠)。
 * 多 target 容错:逐个 target 独立同步,单个失败(权限/磁盘)不中断其余,最后汇总。
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
import {
  resolveSkillTargets,
  resolveActiveTargets,
  expandTargetDir,
  type SkillTarget,
} from "./targets.js";

/** 单个 target 的同步结果(汇总用)。 */
export interface SyncTargetResult {
  key: string;
  dir: string;
  /** 写入成功 true;跳过(未装)或失败 false。结合 skipped/error 区分。 */
  ok: boolean;
  /** 探测模式下该工具未安装,已跳过(未创建目录)。 */
  skipped?: boolean;
  /** 失败时的错误信息(成功省略)。 */
  error?: string;
}

export interface SyncResult {
  /** 同步的 skill 种数(各 target 一致)。 */
  count: number;
  /** 每个 target 的同步结果(成功/失败 + 错误)。 */
  targets: SyncTargetResult[];
  /** 第一个成功 target 的目录(保持返回形状兼容旧消费者/测试)。 */
  destDir: string;
}

/**
 * 把 skillsRoot 下所有 skill 全量同步到单个 destDir。
 * 含 manifest 清理:destDir 中存在、但源端已删除的 skill 会被清掉(多业务包隔离)。
 *
 * 这是原 syncSkills 的核心逻辑,抽出来供多 target 循环复用。
 */
function syncOne(skillsRoot: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const skills = listSkills(skillsRoot);
  const sourceNames = new Set(skills.map((s) => s.name));

  // 共享目标目录按 source 分别记账。只删除"这个 source 上次同步、这次已删除"的条目,
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

  for (const s of skills) {
    const target = join(destDir, s.name);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    cpSync(join(skillsRoot, s.name), target, { recursive: true });
  }
  writeFileSync(
    manifestPath,
    JSON.stringify({ source: resolve(skillsRoot), skills: [...sourceNames].sort() }, null, 2) +
      "\n",
  );
}

/**
 * 把 skillsRoot 下所有 skill 同步到一个或多个 AI agent 工具发现目录。
 *
 * @param skillsRoot 业务包的 skills 目录
 * @param optionsOrDestDir
 *   - **省略** → 探测模式:~/.agents 始终写 + 探测到的已装工具(父目录存在)。
 *     避免给只装 1-2 个工具的用户创建一堆空目录。
 *   - **string**(兼容旧 API)→ 只同步到这一个目录(老测试 `syncSkills(root, tmpDest)` 继续工作)
 *   - **{ targets }** → 同步到指定 target 列表(**强制全写,不探测**;业务包显式指定 = 强制)
 *   - **{ targets, detect: true }** → 对指定列表也走探测(只写已装的)
 *   - **{ destDir }** → 只同步到这一个目录(等价于传 string)
 *
 * 多 target 容错:逐个 target 独立 try/catch,单个失败不中断其余,最后汇总返回。
 * 探测模式:未安装的工具记 `skipped: true`(不创建目录、不算失败)。
 */
export function syncSkills(
  skillsRoot: string,
  optionsOrDestDir?:
    | string
    | {
        targets?: SkillTarget[];
        destDir?: string;
        /** 对 targets 也走探测(只写父目录已存在的);默认 false(targets 强制全写)。 */
        detect?: boolean;
      },
): SyncResult {
  // 解析 candidates(候选 target 列表)+ 是否探测。
  let candidates: SkillTarget[];
  let detect = false;
  if (optionsOrDestDir === undefined) {
    // 默认:探测模式(~/.agents 始终写 + 已装的)
    candidates = resolveSkillTargets();
    detect = true;
  } else if (typeof optionsOrDestDir === "string") {
    // 兼容旧 API:第二参数是字符串 → 只同步到这一个目录。
    candidates = [{ key: "custom", dir: optionsOrDestDir }];
  } else {
    if (optionsOrDestDir.destDir) {
      candidates = [{ key: "custom", dir: optionsOrDestDir.destDir }];
    } else {
      candidates = resolveSkillTargets(optionsOrDestDir.targets);
      detect = optionsOrDestDir.detect ?? false;
    }
  }

  // 探测模式:resolveActiveTargets 保证 ~/.agents 始终在 + 其余只留已装的。
  const activeTargets = detect ? resolveActiveTargets(candidates) : candidates;
  // skipped 集合:探测时被过滤掉的 target(汇总输出用,告诉用户哪些工具没装所以没写)。
  const skippedKeys = new Set(
    candidates.filter((c) => !activeTargets.some((a) => a.key === c.key)).map((c) => c.key),
  );

  const count = listSkills(skillsRoot).length;
  const results: SyncTargetResult[] = [];
  let firstOkDir = "";

  for (const t of activeTargets) {
    const expanded = expandTargetDir(t.dir);
    try {
      syncOne(skillsRoot, expanded);
      results.push({ key: t.key, dir: expanded, ok: true });
      if (!firstOkDir) firstOkDir = expanded;
    } catch (err) {
      // 单个 target 失败(权限/磁盘/路径非法)不中断其余 target。
      results.push({
        key: t.key,
        dir: expanded,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // 探测跳过的 target 记入结果(skipped:true,不算失败,汇总提示用)
  for (const c of candidates) {
    if (skippedKeys.has(c.key)) {
      results.push({ key: c.key, dir: expandTargetDir(c.dir), ok: false, skipped: true });
    }
  }

  // 兼容:全部失败时 destDir 回退到默认 agents 路径(保持返回非空,不破坏形状)。
  return {
    count,
    targets: results,
    destDir: firstOkDir || join(homedir(), ".agents", "skills"),
  };
}
