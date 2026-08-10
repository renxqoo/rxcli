#!/usr/bin/env node
/**
 * 一键发布所有公开包到 npm。
 *
 * 功能:
 *   1. 自动发现 workspace 里的公开包(packages/* + apps/*),跳过 private 包
 *   2. 发布顺序:无内部依赖的包先(@renxqoo/agent-data-cli),依赖它的包后
 *   3. 每个包发布前校验 CHANGELOG 正式版本条目，并查询 npm 远程最新版本。
 *      本地版本必须高于远程版本；发布流程不再临时改 package.json 或自动 bump。
 *   4. 先 pnpm build,再 npm publish(npm 会自动把 workspace:* 替换为真实版本号)
 *
 * 用法:
 *   node scripts/publish.mjs              # 默认:build + publish 全部
 *   node scripts/publish.mjs --dry-run    # 只看会发布什么,不真发
 *   node scripts/publish.mjs --skip-build # 跳过 build(已经 build 过)
 *   node scripts/publish.mjs --only=@renxqoo/rxstock  # 只发指定包
 *   node scripts/publish.mjs --otp=123456  # 带 npm 2FA 验证码发布
 *
 * 前置条件:
 *   - npm login(检查 npm whoami)
 *   - pnpm install 已执行(workspace 链接就绪)
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── CLI 参数 ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_BUILD = args.includes("--skip-build");
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.split("=")[1] : null;
const otpArg = args.find((a) => a.startsWith("--otp="));
const OTP = otpArg ? otpArg.split("=")[1] : null;

// ─── 工具函数 ───────────────────────────────────────────────────────────

function runInherit(cmd, cwd = ROOT) {
  if (DRY_RUN) {
    console.log(`  [dry-run] ${cmd}`);
    return;
  }
  execSync(cmd, { stdio: "inherit", cwd, encoding: "utf8" });
}

/** 从 npm registry 查包的最新版本。不存在或出错返回 null。 */
function getRemoteVersion(pkgName) {
  try {
    const out = execSync(`npm view ${pkgName} version`, {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 15000,
    });
    return out.trim() || null;
  } catch {
    return null; // 包不存在(首次发布)或网络错误
  }
}

/** semver 比较:a vs b → 1(a>b) | -1(a<b) | 0(相等) */
function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 发布必须对应经过 PR 审查的正式 changelog 条目，不能只留在 Unreleased。 */
function hasReleaseChangelog(name, version) {
  const path = join(ROOT, "CHANGELOG.md");
  if (!existsSync(path)) return false;
  const changelog = readFileSync(path, "utf8");
  return new RegExp(
    `^## \\[${escapeRegExp(name)}@${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`,
    "m",
  ).test(changelog);
}

// ─── 发现包 ─────────────────────────────────────────────────────────────

/** 发现 workspace 里所有公开包,跳过 private:true 的。 */
function discoverPackages() {
  const dirs = [
    ...readdirSync(join(ROOT, "packages")).map((d) => join(ROOT, "packages", d)),
    ...readdirSync(join(ROOT, "apps")).map((d) => join(ROOT, "apps", d)),
  ];

  const pkgs = [];
  for (const dir of dirs) {
    if (!existsSync(join(dir, "package.json"))) continue;
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (pkg.private) continue;

    const internalDeps = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }).filter((d) => d.startsWith("@renxqoo/"));

    pkgs.push({ name: pkg.name, version: pkg.version, dir, deps: internalDeps });
  }
  return pkgs;
}

/** 拓扑排序:无内部依赖的排前面(保证 cli-sdk 在 apps 之前)。 */
function topoSort(pkgs) {
  const sorted = [];
  const visited = new Set();
  const pkgNames = new Set(pkgs.map((p) => p.name));

  function visit(pkg) {
    if (visited.has(pkg.name)) return;
    visited.add(pkg.name);
    for (const dep of pkg.deps) {
      if (pkgNames.has(dep)) {
        const depPkg = pkgs.find((p) => p.name === dep);
        if (depPkg) visit(depPkg);
      }
    }
    sorted.push(pkg);
  }

  for (const pkg of pkgs) visit(pkg);
  return sorted;
}

// ─── 交互确认 ───────────────────────────────────────────────────────────

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}

// ─── 主流程 ─────────────────────────────────────────────────────────────

async function main() {
  console.log("━".repeat(60));
  console.log("  rxcli monorepo publish");
  console.log(`  mode: ${DRY_RUN ? "🔍 dry-run (no real publish)" : "🚀 live publish"}`);
  console.log(`  skip-build: ${SKIP_BUILD}`);
  if (ONLY) console.log(`  only: ${ONLY}`);
  if (OTP) console.log(`  otp: ${OTP}`);
  console.log("━".repeat(60));

  // OTP 提醒(2FA 账号发布需要)
  if (!DRY_RUN && !OTP) {
    console.log(
      "\n⚠️  No --otp provided. If your npm account uses 2FA, publishing will fail.\n   Usage: node scripts/publish.mjs --otp=123456\n",
    );
  }

  // 1. 检查 npm 登录
  if (!DRY_RUN) {
    try {
      const whoami = execSync("npm whoami", { stdio: "pipe", encoding: "utf8" }).trim();
      console.log(`\n✓ npm logged in as: ${whoami}`);
    } catch {
      console.error("\n✗ Not logged in to npm. Run: npm login");
      process.exit(1);
    }
  }

  // 2. 发现 + 排序包
  let pkgs = discoverPackages();
  console.log(`\n📦 Found ${pkgs.length} public package(s):`);
  pkgs.forEach((p) =>
    console.log(`   ${p.name}@${p.version}  (deps: ${p.deps.length ? p.deps.join(", ") : "none"})`),
  );

  if (ONLY) {
    pkgs = pkgs.filter((p) => p.name === ONLY);
    if (pkgs.length === 0) {
      console.error(`\n✗ Package not found: ${ONLY}`);
      process.exit(1);
    }
    console.log(`\n🔒 Only: ${pkgs.map((p) => p.name).join(", ")}`);
  }

  const sorted = topoSort(pkgs);
  console.log(`\n📋 Publish order: ${sorted.map((p) => p.name).join(" → ")}`);

  // 3. Build first (global build is required before publish)
  if (!SKIP_BUILD) {
    console.log("\n🔨 Building all packages...");
    try {
      runInherit("pnpm -r run build");
      console.log("✓ Build completed");
    } catch {
      console.error("✗ Build failed, aborting publish");
      process.exit(1);
    }
  } else {
    console.log("\n⏭️  Skipping build (--skip-build)");
  }

  // 4. 确认
  if (!DRY_RUN) {
    console.log("");
    const ok = await confirm("Publish the above package(s) to npm? (y/N)");
    if (!ok) {
      console.log("Cancelled.");
      process.exit(0);
    }
  }

  // 5. 逐包发布
  console.log("\n📦 Publishing...\n");
  const results = [];

  for (const pkg of sorted) {
    console.log("─".repeat(50));
    console.log(`📦 ${pkg.name}`);

    if (!hasReleaseChangelog(pkg.name, pkg.version)) {
      console.error(
        `   ❌ CHANGELOG.md 缺少正式条目: ## [${pkg.name}@${pkg.version}] - YYYY-MM-DD`,
      );
      results.push({ name: pkg.name, version: pkg.version, ok: false });
      continue;
    }

    // 版本必须在 PR 中显式更新；发布过程不修改工作树。
    const remoteVer = getRemoteVersion(pkg.name);
    const localVer = pkg.version;

    if (remoteVer === null) {
      console.log(`   First publish (not on registry) → ${localVer}`);
    } else {
      const cmp = compareVersions(localVer, remoteVer);
      if (cmp > 0) {
        console.log(`   Local ${localVer} > remote ${remoteVer} → publish local version`);
      } else {
        console.error(
          `   ❌ Local ${localVer} is not newer than remote ${remoteVer}. ` +
            "Submit a version + CHANGELOG PR before publishing.",
        );
        results.push({ name: pkg.name, version: localVer, ok: false });
        continue;
      }
    }

    // 发布
    const otpFlag = OTP ? ` --otp=${OTP}` : "";
    const publishCmd = `pnpm publish --access public --no-git-checks${DRY_RUN ? " --dry-run" : ""}${otpFlag}`;
    try {
      runInherit(publishCmd, pkg.dir);
      console.log(`   ✅ ${pkg.name}@${localVer} published`);
      results.push({ name: pkg.name, version: localVer, ok: true });
    } catch {
      console.error(`   ❌ ${pkg.name}@${localVer} failed`);
      results.push({ name: pkg.name, version: localVer, ok: false });
    }
  }

  // 6. 汇总
  console.log(`\n${"═".repeat(50)}`);
  console.log("  Summary");
  console.log("═".repeat(50));
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}@${r.version}`);
  }
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;
  console.log(`\n  ${okCount} succeeded, ${failCount} failed`);

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("发布出错:", err);
  process.exit(1);
});
