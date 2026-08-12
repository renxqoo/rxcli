/**
 * rxx —— security / auth / config 异常路径补全
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIG_RXX_HOME = process.env.RXX_HOME;

describe("security —— urlIsPrivate + isSafePathSegment 边界", () => {
  it("urlIsPrivate 无效 URL → true(视为不安全)", async () => {
    const { urlIsPrivate } = await import("../security.js");
    expect(urlIsPrivate("not-a-url")).toBe(true);
  });
  it("urlIsPrivate 公网 https → false", async () => {
    const { urlIsPrivate } = await import("../security.js");
    expect(urlIsPrivate("https://example.com/x")).toBe(false);
  });
  it("urlIsPrivate 内网 → true", async () => {
    const { urlIsPrivate } = await import("../security.js");
    expect(urlIsPrivate("https://127.0.0.1/x")).toBe(true);
  });
  it("isSafePathSegment 非 string → false", async () => {
    const { isSafePathSegment } = await import("../security.js");
    expect(isSafePathSegment(123 as any)).toBe(false);
    expect(isSafePathSegment(null as any)).toBe(false);
    expect(isSafePathSegment(undefined as any)).toBe(false);
  });
  it("isSafePathSegment 正常值 → true", async () => {
    const { isSafePathSegment } = await import("../security.js");
    expect(isSafePathSegment("ord_001")).toBe(true);
    expect(isSafePathSegment("abc-def_123")).toBe(true);
  });
  it("safeGetField 路径含 constructor → null", async () => {
    const { safeGetField } = await import("../security.js");
    expect(safeGetField({ a: 1 }, "constructor")).toBeNull();
    expect(safeGetField({ a: 1 }, "prototype.x")).toBeNull();
  });
  it("safeGetField 嵌套数组索引路径 → 正确下钻(数组是 object,Object.hasOwn 生效)", async () => {
    const { safeGetField } = await import("../security.js");
    expect(safeGetField([{ x: 1 }], "0.x")).toBe(1);
    // 越界索引 → null
    expect(safeGetField([{ x: 1 }], "5.x")).toBeNull();
  });
  it("safeObjectFrom 跳过危险键 + 生成 null-prototype 对象", async () => {
    const { safeObjectFrom } = await import("../security.js");
    const obj = safeObjectFrom([
      ["a", 1],
      ["__proto__", "evil"],
      ["b", 2],
    ]);
    expect(obj.a).toBe(1);
    expect(obj.b).toBe(2);
    expect((obj as any).__proto__).toBeUndefined();
    expect(Object.getPrototypeOf(obj)).toBeNull();
  });
});

describe("security —— assertSafeHost IPv6 内网", () => {
  it("解析到 IPv6 回环 ::1 → 拒绝", async () => {
    const { assertSafeHost } = await import("../security.js");
    await expect(assertSafeHost("evil.com", { lookup: async () => ["::1"] })).rejects.toThrow(
      /private/i,
    );
  });
  it("解析到 IPv6 ULA fc00:: → 拒绝", async () => {
    const { assertSafeHost } = await import("../security.js");
    await expect(assertSafeHost("evil.com", { lookup: async () => ["fc00::1"] })).rejects.toThrow(
      /private/i,
    );
  });
  it("解析到 IPv6 链路本地 fe80:: → 拒绝", async () => {
    const { assertSafeHost } = await import("../security.js");
    await expect(assertSafeHost("evil.com", { lookup: async () => ["fe80::1"] })).rejects.toThrow(
      /private/i,
    );
  });
  it("解析到 IPv4-mapped IPv6 内网 → 拒绝", async () => {
    const { assertSafeHost } = await import("../security.js");
    await expect(
      assertSafeHost("evil.com", { lookup: async () => ["::ffff:127.0.0.1"] }),
    ).rejects.toThrow(/private/i);
  });
  it("解析到公网 IPv6 → 通过", async () => {
    const { assertSafeHost } = await import("../security.js");
    await expect(
      assertSafeHost("good.com", { lookup: async () => ["2606:4700:4700::1111"] }),
    ).resolves.toBeUndefined();
  });
});

describe("auth/from-manifest —— buildAuthFromManifest", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("无 auth 段 → no-op plugin", async () => {
    const { buildAuthFromManifest } = await import("../auth/from-manifest.js");
    const plugin = buildAuthFromManifest({
      name: "noauth-svc",
      description: "d",
      version: "1.0.0",
      api: { baseUrl: "https://api.example.com" },
      commands: {
        x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
      },
    } as any);
    expect(plugin.name).toBe("no-auth");
    // no-op plugin 的钩子不抛
    await expect((plugin as any).beforeCommand?.({})).resolves.toBeUndefined();
  });

  it("client_name 非 string → 抛错", async () => {
    const { buildAuthFromManifest } = await import("../auth/from-manifest.js");
    expect(() =>
      buildAuthFromManifest({
        name: "badcm",
        description: "d",
        version: "1.0.0",
        api: { baseUrl: "https://api.example.com" },
        auth: {
          type: "oauth2",
          baseUrl: "https://auth.example.com",
          credentialNamespace: "badcm",
          clientMetadata: { client_name: 123 },
        },
        commands: {
          x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
        },
      } as any),
    ).toThrow(/client_name must be a string/i);
  });

  it("client_name 合法 string → 正常构造(不抛)", async () => {
    const { buildAuthFromManifest } = await import("../auth/from-manifest.js");
    const plugin = buildAuthFromManifest({
      name: "goodcm",
      description: "d",
      version: "1.0.0",
      api: { baseUrl: "https://api.example.com" },
      auth: {
        type: "oauth2",
        baseUrl: "https://auth.example.com",
        credentialNamespace: "goodcm",
        clientMetadata: { client_name: "MyApp", redirect_uris: ["http://localhost/cb"] },
      },
      commands: {
        x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
      },
    } as any);
    expect(plugin).toBeDefined();
  });

  it("env BEARER_TOKEN 注入(命名空间转大写下划线)", async () => {
    const { buildAuthFromManifest } = await import("../auth/from-manifest.js");
    process.env.MY_DASH_SVC_BEARER_TOKEN = "env-token-xyz";
    const plugin = buildAuthFromManifest({
      name: "my-dash-svc",
      description: "d",
      version: "1.0.0",
      api: { baseUrl: "https://api.example.com" },
      auth: { type: "oauth2", baseUrl: "https://auth.example.com", credentialNamespace: "myns" },
      commands: {
        x: { description: "x", http: { method: "GET", path: "/x" }, response: { data: "." } },
      },
    } as any);
    expect(plugin).toBeDefined();
    delete process.env.MY_DASH_SVC_BEARER_TOKEN;
  });
});

describe("config —— getRxDir + readVersion", () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-cfg-"));
    process.env.RXX_HOME = tmpHome;
    vi.resetModules();
  });
  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
  });

  it("getRxDir 读 RXX_HOME", async () => {
    const { getRxDir } = await import("../config.js");
    expect(getRxDir()).toBe(tmpHome);
  });
  it("getRxBinDir = getRxDir/bin", async () => {
    const { getRxDir, getRxBinDir } = await import("../config.js");
    expect(getRxBinDir()).toBe(join(tmpHome, "bin"));
  });
  it("getRxRegistryDir = getRxDir/registry", async () => {
    const { getRxRegistryDir } = await import("../config.js");
    expect(getRxRegistryDir()).toBe(join(tmpHome, "registry"));
  });
  it("RXX_VERSION 读到真实 package.json 版本(非 0.0.0)", async () => {
    const { RXX_VERSION } = await import("../config.js");
    expect(RXX_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(RXX_VERSION).not.toBe("0.0.0");
  });
});
