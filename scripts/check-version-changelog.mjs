#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2];

if (!base) {
  console.error("Usage: node scripts/check-version-changelog.mjs <base-commit>");
  process.exit(2);
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function readPackageAt(ref, path) {
  try {
    return JSON.parse(git(["show", `${ref}:${path}`]));
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const changedFiles = new Set(
  git(["diff", "--name-only", `${base}...HEAD`])
    .split("\n")
    .filter(Boolean),
);
const manifests = [...changedFiles].filter(
  (path) => path === "package.json" || path.endsWith("/package.json"),
);
const versionChanges = [];

for (const manifest of manifests) {
  if (!existsSync(join(root, manifest))) continue;
  const previous = readPackageAt(base, manifest);
  const current = JSON.parse(readFileSync(join(root, manifest), "utf8"));
  if (previous?.version === current.version) continue;
  versionChanges.push({
    manifest,
    name: current.name,
    previousVersion: previous?.version ?? null,
    version: current.version,
  });
}

if (versionChanges.length === 0) {
  console.log("No package version changes detected; changelog gate passed.");
  process.exit(0);
}

if (!changedFiles.has("CHANGELOG.md")) {
  console.error("CHANGELOG.md must be updated whenever a package version changes.");
  process.exit(1);
}

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const missing = versionChanges.filter(({ name, version }) => {
  const heading = new RegExp(
    `^## \\[${escapeRegExp(name)}@${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`,
    "m",
  );
  return !heading.test(changelog);
});

if (missing.length > 0) {
  for (const change of missing) {
    console.error(
      `Missing changelog heading for ${change.name}@${change.version}: ` +
        `## [${change.name}@${change.version}] - YYYY-MM-DD`,
    );
  }
  process.exit(1);
}

console.log(
  `Changelog gate passed for: ${versionChanges.map(({ name, version }) => `${name}@${version}`).join(", ")}`,
);
