/**
 * rxx —— commands/manage.ts 单元测试
 *
 * 补全:
 *   - update:未装服务 → updated:false/reason:not installed
 *   - update:成功路径(fromVersion/toVersion/changed)
 *   - remove:partial 失败聚合(steps + failedSteps)
 *   - remove:非法 name → ValidationError
 *   - list:正常返回
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIG_RXX_HOME = process.env.RXX_HOME;
const ORIG_IS_TTY = process.stdin.isTTY;

describe("manage.ts", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-manage-"));
    process.env.RXX_HOME = tmpHome;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    Object.defineProperty(process.stdin, "isTTY", { value: ORIG_IS_TTY, configurable: true });
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("listCommand", () => {
    it("空 registry → count:0", async () => {
      const { listCommand } = await import("../commands/manage.js");
      const result = await listCommand.run!({} as any, {} as any);
      expect(result.data).toMatchObject({ services: [], count: 0 });
    });

    it("已装服务 → 列出含 commands 数", async () => {
      const { writeService } = await import("../registry.js");
      const { listCommand } = await import("../commands/manage.js");
      writeService({
        manifest: {
          name: "svc-list",
          description: "d",
          version: "1.0.0",
          api: { baseUrl: "https://a.example.com" },
          namespaces: {
            orders: {
              list: {
                description: "l",
                http: { method: "GET", path: "/l" },
                response: { data: "." },
              },
              get: {
                description: "g",
                http: { method: "GET", path: "/g" },
                response: { data: "." },
              },
            },
          },
        },
        sourceUrl: "https://a.example.com/m",
        signatureVerified: true,
      });
      const result = await listCommand.run!({} as any, {} as any);
      expect(result.data).toMatchObject({ count: 1 });
      expect((result.data as any).services[0]).toMatchObject({ name: "svc-list", commands: 2 });
    });
  });

  describe("updateCommand", () => {
    it("未装服务 → updated:false/reason:not installed", async () => {
      const { updateCommand } = await import("../commands/manage.js");
      const result = await updateCommand.run!(
        {} as any,
        { name: "nope", autoConfirm: true } as any,
      );
      expect(result.data).toMatchObject({ updated: false, reason: "not installed" });
    });

    it("成功更新 → fromVersion/toVersion/changed", async () => {
      const { writeService } = await import("../registry.js");
      writeService({
        manifest: {
          name: "svc-up",
          description: "d",
          version: "1.0.0",
          api: { baseUrl: "https://a.example.com" },
          commands: {
            x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
          },
        },
        sourceUrl: "https://a.example.com/m",
        signatureVerified: true,
      });
      // mock fetchManifest + installFlow(避免真实网络)
      vi.doMock("../manifest/loader.js", () => ({
        fetchManifest: vi.fn().mockResolvedValue({
          manifest: {
            name: "svc-up",
            description: "d2",
            version: "2.0.0",
            api: { baseUrl: "https://a.example.com" },
            commands: {
              x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
            },
          },
          sourceUrl: "https://a.example.com/m",
          signatureVerified: true,
          publicKeyPem: "pk",
          keyFingerprint: "sha256:x",
          unsigned: false,
        }),
      }));
      vi.doMock("../install-flow.js", () => ({
        installFlow: vi.fn().mockResolvedValue({ data: { installed: true } }),
      }));
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const { updateCommand } = await import("../commands/manage.js");
      const result = await updateCommand.run!(
        {} as any,
        { name: "svc-up", autoConfirm: true } as any,
      );
      expect(result.data).toMatchObject({
        updated: true,
        fromVersion: "1.0.0",
        toVersion: "2.0.0",
        changed: true,
      });
      vi.doUnmock("../manifest/loader.js");
      vi.doUnmock("../install-flow.js");
    });
  });

  describe("removeCommand", () => {
    it("未装服务 → removed:false", async () => {
      const { removeCommand } = await import("../commands/manage.js");
      const result = await removeCommand.run!({} as any, { name: "nope" } as any);
      expect(result.data).toMatchObject({ removed: false });
    });

    it("成功 remove → removed:true + 3 steps ok", async () => {
      const { writeService } = await import("../registry.js");
      const { removeCommand } = await import("../commands/manage.js");
      writeService({
        manifest: {
          name: "svc-rm",
          description: "d",
          version: "1.0.0",
          api: { baseUrl: "https://a.example.com" },
          commands: {
            x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
          },
        },
        sourceUrl: "https://a.example.com/m",
        signatureVerified: true,
      });
      const result = await removeCommand.run!({} as any, { name: "svc-rm" } as any);
      expect(result.data).toMatchObject({ removed: true });
      expect((result.data as any).steps).toHaveLength(3);
      expect((result.data as any).steps.every((s: any) => s.ok)).toBe(true);
      expect((result.data as any).partial).toBeUndefined();
    });

    it("removeSkill 失败 → partial:true + failedSteps 含 skill", async () => {
      const { writeService } = await import("../registry.js");
      writeService({
        manifest: {
          name: "svc-partial",
          description: "d",
          version: "1.0.0",
          api: { baseUrl: "https://a.example.com" },
          commands: {
            x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
          },
        },
        sourceUrl: "https://a.example.com/m",
        signatureVerified: true,
      });
      // mock removeSkill 抛错
      vi.doMock("../skill-gen.js", () => ({
        removeSkill: () => {
          throw new Error("skill rm boom");
        },
        countCommands: () => ({ total: 1, write: 0 }),
        collectHosts: () => ({}),
      }));
      const { removeCommand } = await import("../commands/manage.js");
      const result = await removeCommand.run!({} as any, { name: "svc-partial" } as any);
      expect(result.data).toMatchObject({ partial: true });
      expect((result.data as any).failedSteps).toContain("skill");
      expect((result.data as any).failedSteps).not.toContain("registry");
      vi.doUnmock("../skill-gen.js");
    });

    it("非法 name(大写)→ ValidationError(param:name)", async () => {
      const { removeCommand } = await import("../commands/manage.js");
      await expect(removeCommand.run!({} as any, { name: "BadName" } as any)).rejects.toMatchObject(
        {
          category: "validation",
          subtype: "invalid_argument",
        },
      );
    });

    it("非法 name(路径穿越)→ ValidationError", async () => {
      const { removeCommand } = await import("../commands/manage.js");
      await expect(removeCommand.run!({} as any, { name: "../etc" } as any)).rejects.toMatchObject({
        category: "validation",
      });
    });
  });
});
