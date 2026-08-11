/**
 * rxx —— registry.ts 异常路径补全测试
 *
 * 覆盖:损坏 manifest/meta/pubkey 文件读取返回 null、isInstalled、removeService 未装返回 false。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, writeFileSync as wfs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIG_RXX_HOME = process.env.RXX_HOME;

describe("registry 异常路径", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-reg-x-"));
    process.env.RXX_HOME = tmpHome;
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
  });

  it("readManifest 损坏 JSON → null", async () => {
    const { writeService, readManifest } = await import("../registry.js");
    writeService({
      manifest: {
        name: "corrupt",
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
    // 覆盖 manifest.json 为损坏内容
    const regDir = join(tmpHome, "registry", "corrupt");
    wfs(join(regDir, "manifest.json"), "{ broken json {{{", "utf8");
    expect(readManifest("corrupt")).toBeNull();
  });

  it("readMeta 损坏 JSON → null", async () => {
    const { writeService, readMeta } = await import("../registry.js");
    writeService({
      manifest: {
        name: "corrupt-meta",
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
    const regDir = join(tmpHome, "registry", "corrupt-meta");
    wfs(join(regDir, "meta.json"), "not json", "utf8");
    expect(readMeta("corrupt-meta")).toBeNull();
  });

  it("readService 缺 meta → null", async () => {
    const { writeService, readService, removeService } = await import("../registry.js");
    const { unlinkSync } = await import("node:fs");
    writeService({
      manifest: {
        name: "no-meta",
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
    unlinkSync(join(tmpHome, "registry", "no-meta", "meta.json"));
    expect(readService("no-meta")).toBeNull();
  });

  it("readService 非法 name → null(防御)", async () => {
    const { readService } = await import("../registry.js");
    expect(readService("BAD NAME")).toBeNull();
    expect(readService("../etc")).toBeNull();
  });

  it("readPublicKey 未装 → null", async () => {
    const { readPublicKey } = await import("../registry.js");
    expect(readPublicKey("nope")).toBeNull();
  });

  it("readManifest 未装 → null", async () => {
    const { readManifest } = await import("../registry.js");
    expect(readManifest("nope")).toBeNull();
  });

  it("isInstalled 未装 → false", async () => {
    const { isInstalled } = await import("../registry.js");
    expect(isInstalled("nope")).toBe(false);
  });

  it("removeService 未装 → false", async () => {
    const { removeService } = await import("../registry.js");
    expect(removeService("nope")).toBe(false);
  });

  it("writeService 不带 publicKey → 不写 pubkey.pem", async () => {
    const { writeService, readPublicKey } = await import("../registry.js");
    writeService({
      manifest: {
        name: "no-pubkey",
        description: "d",
        version: "1.0.0",
        api: { baseUrl: "https://a.example.com" },
        commands: {
          x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
        },
      },
      sourceUrl: "https://a.example.com/m",
      signatureVerified: true,
      // 不传 publicKey
    });
    expect(readPublicKey("no-pubkey")).toBeNull();
  });

  it("writeService 返回的 meta 含 sha256 + fetchedAt", async () => {
    const { writeService } = await import("../registry.js");
    const meta = writeService({
      manifest: {
        name: "meta-check",
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
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.signatureVerified).toBe(true);
  });
});
