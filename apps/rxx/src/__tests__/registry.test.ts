/**
 * rxx —— registry(已装服务读写)测试
 *
 * 从原 validator.test.ts 拆出。签名测试在 sign.test.ts,验证测试在 validate.test.ts。
 * validator.ts 已删除——签名函数在 manifest/sign.ts,验证在 manifest/validate.ts。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 测试 registry 要用临时目录,避免污染 ~/.rxx
const ORIG_RXX_HOME = process.env.RXX_HOME;

describe("registry", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-test-"));
    process.env.RXX_HOME = tmpHome;
    // resetModules:强制 registry.ts 重新求值 RX_REGISTRY_DIR(依赖 RXX_HOME)
    // 否则 module 缓存导致跨测试用错目录
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
  });

  it("write + read + list + remove 全流程", async () => {
    // 动态 import 让 RXX_HOME 生效
    const { writeService, readService, listInstalled, removeService, isInstalled } =
      await import("../registry.js");
    const manifest = {
      name: "svc-a",
      description: "test",
      version: "1.0.0",
      api: { baseUrl: "https://a.example.com" },
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    };
    expect(isInstalled("svc-a")).toBe(false);
    writeService({ manifest, sourceUrl: "https://a.example.com/m", signatureVerified: true });
    expect(isInstalled("svc-a")).toBe(true);

    const svc = readService("svc-a");
    expect(svc?.name).toBe("svc-a");
    expect(svc?.version).toBe("1.0.0");
    expect(svc?.signatureVerified).toBe(true);
    expect(svc?.manifest).toEqual(manifest);

    const list = listInstalled();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("svc-a");

    expect(removeService("svc-a")).toBe(true);
    expect(isInstalled("svc-a")).toBe(false);
    expect(removeService("svc-a")).toBe(false); // 再删返回 false
  });

  it("list 空 registry 返回 []", async () => {
    const { listInstalled } = await import("../registry.js");
    expect(listInstalled()).toEqual([]);
  });

  // —— TDD:listInstalled 遇非服务子目录不崩溃 ——
  it("listInstalled 跳过非服务子目录(如 .cache/trusted-keys/大写名)", async () => {
    const { writeService, listInstalled } = await import("../registry.js");
    const { mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    // 写一个合法服务
    writeService({
      manifest: {
        name: "svc-ok",
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
    // 在 registry 目录下创建会触发 assertSafeName 失败的子目录
    const regDir = join(tmpHome, "registry");
    mkdirSync(join(regDir, ".cache"), { recursive: true });
    mkdirSync(join(regDir, "trusted-keys"), { recursive: true });
    mkdirSync(join(regDir, "UPPER-CASE"), { recursive: true });
    mkdirSync(join(regDir, "1starts-with-digit"), { recursive: true });

    // listInstalled 不应抛,只返回合法服务
    const list = listInstalled();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("svc-ok");
  });

  // —— writeService 写 pubkey 用 atomicWrite(一致性)——
  it("writeService 同时写 manifest + meta + pubkey", async () => {
    const { writeService, readService, readPublicKey } = await import("../registry.js");
    writeService({
      manifest: {
        name: "svc-key",
        description: "d",
        version: "1.0.0",
        api: { baseUrl: "https://a.example.com" },
        commands: {
          x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
        },
      },
      sourceUrl: "https://a.example.com/m",
      signatureVerified: true,
      publicKey: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n",
      keyFingerprint: "sha256:abc",
    });
    expect(readPublicKey("svc-key")).toContain("PUBLIC KEY");
    expect(readService("svc-key")?.keyFingerprint).toBe("sha256:abc");
  });
});
