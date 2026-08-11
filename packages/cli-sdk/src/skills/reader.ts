/**
 * @renxqoo/agent-data-cli/skills —— skill 内容读取器
 *
 * 设计依据:docs/06-skills.md、docs/01-cli-usage.md "skill 自服务发现"。
 * 对齐 lark-cli skillcontent/reader.go 实现。
 *
 * 改造点(v1 → v2):
 *   - skillsRoot 不再写死探测,改由参数传入(业务包各自的 skills 目录不同)
 *   - 错误改用类型化错误(InternalError/NotFoundError),而非裸 Error
 *   - skills read 声明为输出契约例外(stdout 吐原文,见 03-envelopes.md)
 *
 * skill 是给 AI agent 读的 Markdown 指令文档(SKILL.md + references/)。
 * 本读取器负责扫描、列举、读取,带路径穿越校验(cleanSubPath)。
 */

import { readFileSync, readdirSync, lstatSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { NotFoundError, InternalError } from "../errs/index.js";
import { assertExistingPathInside, cleanSubPath, validateSkillName } from "./path-guard.js";

export { cleanSubPath, prepareSkillDir, validateSkillName } from "./path-guard.js";

// ============================================================================
// 类型
// ============================================================================

export interface SkillInfo {
  name: string;
  description: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface DirEntry {
  path: string;
  is_dir: boolean;
}

// ============================================================================
// skill 列举 / 读取(skillsRoot 由调用方传入)
// ============================================================================

/**
 * 列出所有 skill(扫描有 SKILL.md 的子目录),按 name 排序。
 *
 * BUG-3:用 lstatSync(不跟随符号链接)+ 单条 try/catch,跳过 broken symlink /
 * 不可读 / 损坏条目,而非让一个坏条目整列崩溃。lstatSync 对 broken symlink 返回
 * stats(不抛 ENOENT),其 isDirectory() 为 false → 跳过。
 */
export function listSkills(skillsRoot: string): SkillInfo[] {
  if (!existsSync(skillsRoot)) return [];
  const entries = readdirSync(skillsRoot);
  const out: SkillInfo[] = [];
  for (const e of entries) {
    const full = join(skillsRoot, e);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue; // 不可读条目:跳过,不影响其它 skill 的发现
    }
    if (!stat.isDirectory()) continue; // 普通文件 / 符号链接(含 broken)跳过
    assertExistingPathInside(skillsRoot, full, `skill "${e}"`);
    const skillMd = join(full, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    assertExistingPathInside(full, skillMd, `SKILL.md in skill "${e}"`);
    const { description, version, metadata } = parseFrontmatter(skillMd);
    const info: SkillInfo = { name: e, description };
    if (version) info.version = version;
    if (metadata && Object.keys(metadata).length > 0) info.metadata = metadata;
    out.push(info);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 列举一层目录(像 ls)。返回 entries + 实际列举的路径。 */
export function listPath(skillsRoot: string, arg: string): { entries: DirEntry[]; listed: string } {
  const [name, sub] = splitArg(arg);
  ensureSkill(skillsRoot, name);
  let dir = name;
  if (sub) {
    const cleaned = cleanSubPath(sub);
    dir = `${name}/${cleaned}`;
    // M7:子路径不存在 → NotFoundError(而非裸 statSync ENOENT 被兜底成 internal/unknown)
    const subFull = join(skillsRoot, dir);
    if (!existsSync(subFull)) {
      throw new NotFoundError(`path "${name}/${cleaned}" does not exist`);
    }
    const info = statSync(subFull);
    if (!info.isDirectory()) {
      throw new InternalError({
        subtype: "contract_violation",
        message: `path "${sub}" is a file, not a directory; use 'rxcli skills read ${name}/${cleaned}' to read it`,
      });
    }
    assertExistingPathInside(join(skillsRoot, name), subFull, `path in skill "${name}"`);
  }
  const listedDir = join(skillsRoot, dir);
  const entries = readdirSync(listedDir);
  return {
    entries: entries
      .map((e) => {
        const entry = join(listedDir, e);
        assertExistingPathInside(join(skillsRoot, name), entry, `path in skill "${name}"`);
        return { path: `${dir}/${e}`, is_dir: statSync(entry).isDirectory() };
      })
      .sort((a, b) => a.path.localeCompare(b.path)),
    listed: dir,
  };
}

/** 读 skill 的 SKILL.md,返回原始 Buffer(供 stdout 直接吐 bytes)。 */
export function readSkill(skillsRoot: string, name: string): Buffer {
  ensureSkill(skillsRoot, name);
  const p = join(skillsRoot, name, "SKILL.md");
  if (!existsSync(p)) {
    throw new NotFoundError(`skill "${name}" has no SKILL.md`);
  }
  assertInsideSkill(skillsRoot, name, p);
  return readFileSync(p);
}

/** 读 reference 文件。返回 { content, cleaned }。 */
export function readReference(
  skillsRoot: string,
  name: string,
  relpath: string,
): { content: Buffer; cleaned: string } {
  ensureSkill(skillsRoot, name);
  const cleaned = cleanSubPath(relpath);
  const full = join(skillsRoot, name, cleaned);
  if (!existsSync(full)) {
    throw new NotFoundError(`reference "${name}/${relpath}" does not exist`);
  }
  const info = statSync(full);
  if (info.isDirectory()) {
    throw new InternalError({
      subtype: "contract_violation",
      message: `reference "${relpath}" is a directory, not a file`,
    });
  }
  assertInsideSkill(skillsRoot, name, full);
  return { content: readFileSync(full), cleaned };
}

/** 拆分 "name/rest"。 */
export function splitArg(arg: string): [string, string] {
  const idx = arg.indexOf("/");
  if (idx < 0) return [arg, ""];
  return [arg.slice(0, idx), arg.slice(idx + 1)];
}

// ============================================================================
// 校验(内部)
// ============================================================================

/** 校验 skill 名存在(防把 skill 名当路径用)。skill 不存在视为 not_found。 */
function ensureSkill(skillsRoot: string, name: string): void {
  validateSkillName(name);
  const full = join(skillsRoot, name);
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    throw new NotFoundError(
      `unknown skill "${name}". run 'rxcli skills list' to see available skills`,
    );
  }
  assertExistingPathInside(skillsRoot, full, `skill "${name}"`);
}

function assertInsideSkill(skillsRoot: string, name: string, candidate: string): void {
  assertExistingPathInside(join(skillsRoot, name), candidate, `path in skill "${name}"`);
}

// ============================================================================
// frontmatter 解析(best-effort)
// ============================================================================

/** 解析 SKILL.md 的 frontmatter(首行 --- 到下一个 ---)。失败返回空字段,不抛。 */
export function parseFrontmatter(skillMdPath: string): {
  description: string;
  version: string;
  metadata: Record<string, unknown>;
} {
  if (!existsSync(skillMdPath)) return { description: "", version: "", metadata: {} };
  const data = readFileSync(skillMdPath, "utf8");
  const lines = data.split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    return { description: "", version: "", metadata: {} };
  }
  const block: string[] = [];
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === "---") {
      closed = true;
      break;
    }
    block.push(lines[i]!);
  }
  if (!closed) return { description: "", version: "", metadata: {} };
  try {
    const fm = parseYaml(block.join("\n")) as {
      description?: string;
      version?: string;
      metadata?: Record<string, unknown>;
    };
    return {
      description: fm.description ?? "",
      version: fm.version ?? "",
      metadata: fm.metadata ?? {},
    };
  } catch {
    return { description: "", version: "", metadata: {} };
  }
}
