/**
 * rxx —— `rxx list` / `rxx update` / `rxx remove`:已装服务管理
 *
 * update 复用 installFlow(O4:不再跳过信任确认),支持指纹变更高亮(C7)。
 */

import * as z from "zod";
import { defineCommand, type CommandResult } from "@renxqoo/agent-data-cli";
import { listInstalled, readService, removeService } from "../registry.js";
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
  internal: true,
  async run(_ctx): Promise<CommandResult> {
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

export const updateCommand = defineCommand({
  name: "update",
  description: "Re-fetch and update an installed service's manifest",
  args: {
    schema: z.object({
      name: z.string().describe("service name"),
      insecure: z.boolean().describe("allow HTTP").optional(),
      "private-endpoints": z.boolean().describe("allow internal endpoints").optional(),
      unsigned: z.boolean().describe("allow unsigned manifest (WARNING: untrusted)").optional(),
      autoConfirm: z.boolean().describe("skip confirmation").optional(),
      lang: z.string().describe("skill document language (en/zh)").default("en"),
    }),
    pos: ["name"],
  },
  internal: true,
  async run(_ctx, args): Promise<CommandResult> {
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
        yes: args.autoConfirm,
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

export const removeCommand = defineCommand({
  name: "remove",
  description: "Remove an installed dynamic service (manifest + skill + shim)",
  args: {
    schema: z.object({ name: z.string().describe("service name") }),
    pos: ["name"],
  },
  internal: true,
  async run(_ctx, { name }): Promise<CommandResult> {
    try {
      // 先校验 name 合法性(非法 name 是参数错误 exit 2,不是清理失败)
      assertSafeServiceName(name);

      // 事务化:收集每步结果,部分失败时报告清单(不静默吞错)
      const steps: { name: string; ok: boolean; error?: string }[] = [];
      let existed = false;
      try {
        existed = removeService(name);
        steps.push({ name: "registry", ok: true });
      } catch (e) {
        steps.push({ name: "registry", ok: false, error: (e as Error).message });
      }
      try {
        removeSkill(name);
        steps.push({ name: "skill", ok: true });
      } catch (e) {
        steps.push({ name: "skill", ok: false, error: (e as Error).message });
      }
      try {
        removeShim(name);
        steps.push({ name: "shim", ok: true });
      } catch (e) {
        steps.push({ name: "shim", ok: false, error: (e as Error).message });
      }
      const failed = steps.filter((s) => !s.ok);
      return {
        data: {
          removed: existed,
          name,
          steps,
          ...(failed.length > 0 ? { partial: true, failedSteps: failed.map((s) => s.name) } : {}),
        },
      };
    } catch (err) {
      throw rxxError(err);
    }
  },
});
