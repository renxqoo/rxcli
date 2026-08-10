#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(appDir, "skills");
const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
const binName = Object.keys(pkg.bin ?? {})[0];
const checkOnly = process.argv.includes("--check");

if (!binName || !pkg.name) {
  throw new Error("package.json must define name and bin");
}

const installReference = `<!-- 此文件由 build 自动生成，不要手改 -->

# 安装 ${binName}

仅在 \`${binName}\` 命令不可用时读取本指引。

安装要求:Node.js ${pkg.engines?.node ?? ">=20"}。先告知用户下面的命令会全局安装 CLI 并同步整套 ${binName} skills；获得用户同意后再执行:

\`\`\`bash
npx ${pkg.name} install
\`\`\`

安装后验证:

\`\`\`bash
${binName} --help
\`\`\`

安装失败时返回原始错误和可执行的修复建议，不要循环重试。
`;

const entries = await readdir(skillsDir, { withFileTypes: true });
const stale = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const skillDir = join(skillsDir, entry.name);
  try {
    await access(join(skillDir, "SKILL.md"));
  } catch {
    continue;
  }

  const target = join(skillDir, "references", "install.md");
  let current = "";
  try {
    current = await readFile(target, "utf8");
  } catch {
    // Missing generated file is handled below.
  }

  if (current === installReference) continue;
  stale.push(target);
  if (!checkOnly) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, installReference);
  }
}

if (checkOnly && stale.length > 0) {
  process.stderr.write(`Outdated generated skill references:\n${stale.join("\n")}\n`);
  process.exitCode = 1;
} else if (!checkOnly && stale.length > 0) {
  process.stdout.write(`Generated ${stale.length} skill install reference(s).\n`);
}
