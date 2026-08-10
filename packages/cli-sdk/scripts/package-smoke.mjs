#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageDir, "..", "..");
const temporaryDir = mkdtempSync(join(tmpdir(), "agent-data-cli-package-"));

function run(command, args, cwd = packageDir) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const packedOutput = run("pnpm", ["pack", "--pack-destination", temporaryDir]);
  const tarballName = packedOutput.split(/\r?\n/).at(-1);
  assert(tarballName, "pnpm pack did not return a tarball name");

  const tarballPath = isAbsolute(tarballName) ? tarballName : join(temporaryDir, tarballName);
  const entries = new Set(run("tar", ["-tzf", tarballPath]).split(/\r?\n/));
  const requiredEntries = [
    "package/LICENSE",
    "package/README.md",
    "package/README.zh-CN.md",
    "package/docs/00-overview.md",
    "package/docs/01-cli-usage.md",
    "package/docs/02-sdk-guide.md",
    "package/docs/03-envelopes.md",
    "package/docs/04-errors.md",
    "package/docs/05-credentials.md",
    "package/docs/06-skills.md",
    "package/src/index.ts",
  ];

  for (const entry of requiredEntries) {
    assert(entries.has(entry), `published package is missing ${entry}`);
  }
  for (const entry of entries) {
    assert(
      !entry.includes("/__tests__/") && !entry.endsWith(".test.ts"),
      `published package must not contain test source: ${entry}`,
    );
  }

  assert(
    readFileSync(join(packageDir, "LICENSE"), "utf8") ===
      readFileSync(join(repositoryRoot, "LICENSE"), "utf8"),
    "packages/cli-sdk/LICENSE must stay identical to the repository LICENSE",
  );

  const consumerDir = join(temporaryDir, "consumer");
  mkdirSync(consumerDir);
  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath], consumerDir);
  writeFileSync(
    join(consumerDir, "smoke.mjs"),
    [
      'import { defineCli, defineCommandFromArgs, errs } from "@renxqoo/agent-data-cli";',
      'import * as errorExports from "@renxqoo/agent-data-cli/errs";',
      'import * as credentialExports from "@renxqoo/agent-data-cli/credentials";',
      'import * as skillExports from "@renxqoo/agent-data-cli/skills";',
      "if (!defineCli || !defineCommandFromArgs || !errs) throw new Error('root export failed');",
      "if (!errorExports.errs) throw new Error('errs subpath failed');",
      "if (!credentialExports.memoryStore) throw new Error('credentials subpath failed');",
      "if (!skillExports.listSkills) throw new Error('skills subpath failed');",
    ].join("\n"),
  );
  run("node", ["smoke.mjs"], consumerDir);

  console.log(`Package smoke test passed: ${tarballName}`);
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}
