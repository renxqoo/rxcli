/**
 * rxx —— `rxx list` / `rxx update` / `rxx remove`:已装服务管理
 *
 * update 复用 installFlow(O4:不再跳过信任确认),支持指纹变更高亮(C7)。
 */

import { defineCommand, type CommandResult } from "@renxqoo/agent-data-cli";
import {
  listInstalled,
  readService,
  removeService,
  type InstalledServiceFull,
} from "../registry.js";
import { removeSkill } from "../skill-gen.js";
import { removeShim } from "../shim.js";
import { fetchManifest } from "../manifest/loader.js";
import { installFlow } from "../install-flow.js";
import { rxxError } from "../errors.js";
import { countCommands } from "../skill-gen.js";
import { assertSafeServiceName } from "../security.js";

// ============================================================================
// list
// ============================================================================

export const listCommand = defineCommand({
  name: "list",
  description: "List all installed dynamic services",
  args: {},
  internal: true,
  async run(): Promise<CommandResult> {
    try {
      const services = listInstalled();
      return {
        data: {
          services: services.map((s) => ({
            name: s.name,
            version: s.version,
            source: s.sourceUrl,
            commands: countCommands(s.manifest).total,
            signatureVerified: s.signatureVerified,
            fetchedAt: s.fetchedAt,
          })),
          count: services.length,
        },
      };
    } catch (err) {
      throw rxxError(err);
    }
  },
});

// ============================================================================
// update(复用 installFlow:确认 → 缓存 → skill → shim)
// ============================================================================

export interface UpdateArgs {
  name: string;
  insecure?: boolean;
  "private-endpoints"?: boolean;
  unsigned?: boolean;
  yes?: boolean;
  lang?: "en" | "zh";
}

export const updateCommand = defineCommand<UpdateArgs>({
  name: "update",
  description: "Re-fetch and update an installed service's manifest",
  args: {
    name: { type: "string", required: true, positional: true, desc: "service name" },
    insecure: { type: "boolean", desc: "allow HTTP" },
    "private-endpoints": { type: "boolean", desc: "allow internal endpoints" },
    unsigned: { type: "boolean", desc: "allow unsigned manifest (WARNING: untrusted)" },
    yes: { type: "boolean", desc: "skip confirmation" },
    lang: { type: "string", desc: "skill document language (en/zh)", default: "en" },
  },
  internal: true,
  async run(args): Promise<CommandResult> {
    try {
      const existing = readService(args.name);
      if (!existing) {
        return { data: { updated: false, name: args.name, reason: "not installed" } };
      }

      // 用 pinning 的公钥拉取(C4:trustedPublicKeyPem 传入)
      const fetched = await fetchManifest(existing.sourceUrl, {
        allowInsecure: args.insecure,
        allowPrivateEndpoints: args["private-endpoints"],
        allowUnsigned: args.unsigned,
        trustedPublicKeyPem: existing.publicKey,
      });

      // 复用 installFlow(O4:有确认 + 指纹变更提示 C7)
      const result = await installFlow(fetched, {
        yes: args.yes,
        lang: args.lang === "zh" ? "zh" : "en",
        previousKeyFingerprint: existing.keyFingerprint,
      });

      // 给输出加 fromVersion/toVersion
      const data = ("data" in result ? result.data : {}) as Record<string, unknown>;
      return {
        data: {
          ...data,
          updated: data.installed,
          name: args.name,
          fromVersion: existing.version,
          toVersion: fetched.manifest.version,
          changed: existing.version !== fetched.manifest.version,
        },
      };
    } catch (err) {
      throw rxxError(err);
    }
  },
});

// ============================================================================
// remove
// ============================================================================

export interface RemoveArgs {
  name: string;
}

export const removeCommand = defineCommand<RemoveArgs>({
  name: "remove",
  description: "Remove an installed dynamic service (manifest + skill + shim)",
  args: {
    name: { type: "string", required: true, positional: true, desc: "service name" },
  },
  internal: true,
  async run(args): Promise<CommandResult> {
    try {
      // 先校验 name 合法性(非法 name 是参数错误 exit 2,不是清理失败)
      assertSafeServiceName(args.name);

      // 事务化:收集每步结果,部分失败时报告清单(不静默吞错)
      const steps: { name: string; ok: boolean; error?: string }[] = [];
      let existed = false;
      try {
        existed = removeService(args.name);
        steps.push({ name: "registry", ok: true });
      } catch (e) {
        steps.push({ name: "registry", ok: false, error: (e as Error).message });
      }
      try {
        removeSkill(args.name);
        steps.push({ name: "skill", ok: true });
      } catch (e) {
        steps.push({ name: "skill", ok: false, error: (e as Error).message });
      }
      try {
        removeShim(args.name);
        steps.push({ name: "shim", ok: true });
      } catch (e) {
        steps.push({ name: "shim", ok: false, error: (e as Error).message });
      }
      const failed = steps.filter((s) => !s.ok);
      return {
        data: {
          removed: existed,
          name: args.name,
          steps,
          ...(failed.length > 0 ? { partial: true, failedSteps: failed.map((s) => s.name) } : {}),
        },
      };
    } catch (err) {
      throw rxxError(err);
    }
  },
});
