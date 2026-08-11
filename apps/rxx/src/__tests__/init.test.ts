/**
 * rxx —— commands/init.ts 单元测试
 *
 * 补全:
 *   - guessNameFromUrl 各后缀/通用名/非法名跳过(纯函数全覆盖)
 *   - TOFU fallback:pinned key 验签失败 → 降级 manifest 自带公钥
 *   - 正常 init 流程(有/无 pinning key)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guessNameFromUrl } from "../commands/init.js";

describe("guessNameFromUrl", () => {
  it(".json 后缀 → strip", () => {
    expect(guessNameFromUrl("https://x.example.com/manifests/svc-a.json")).toBe("svc-a");
  });
  it(".yaml 后缀 → strip", () => {
    expect(guessNameFromUrl("https://x.example.com/manifests/svc-b.yaml")).toBe("svc-b");
  });
  it(".yml 后缀 → strip", () => {
    expect(guessNameFromUrl("https://x.example.com/manifests/svc-c.yml")).toBe("svc-c");
  });
  it(".json5 后缀 → strip", () => {
    expect(guessNameFromUrl("https://x.example.com/manifests/svc-d.json5")).toBe("svc-d");
  });
  it("无后缀 → 原样", () => {
    expect(guessNameFromUrl("https://x.example.com/manifests/svc-e")).toBe("svc-e");
  });
  it("通用名 manifest → 不猜(undefined)", () => {
    expect(guessNameFromUrl("https://x.example.com/manifest")).toBeUndefined();
  });
  it("通用名 index → 不猜", () => {
    expect(guessNameFromUrl("https://x.example.com/index.json")).toBeUndefined();
  });
  it("通用名 latest → 不猜", () => {
    expect(guessNameFromUrl("https://x.example.com/latest.json")).toBeUndefined();
  });
  it("大写名(非法)→ 不猜", () => {
    expect(guessNameFromUrl("https://x.example.com/MyService.json")).toBeUndefined();
  });
  it("下划线名(非法)→ 不猜", () => {
    expect(guessNameFromUrl("https://x.example.com/my_service.json")).toBeUndefined();
  });
  it("单字符名(太短,非法)→ 不猜", () => {
    expect(guessNameFromUrl("https://x.example.com/a.json")).toBeUndefined();
  });
  it("无效 URL → undefined", () => {
    expect(guessNameFromUrl("not-a-url")).toBeUndefined();
  });
  it("无 pathname 末段 → undefined", () => {
    expect(guessNameFromUrl("https://x.example.com/")).toBeUndefined();
  });
  it("带查询参数的 URL → 取 pathname 末段", () => {
    expect(guessNameFromUrl("https://x.example.com/manifests/svc-f.json?v=2")).toBe("svc-f");
  });
});

describe("initCommand —— TOFU fallback", () => {
  let tmpHome: string;
  const ORIG_RXX_HOME = process.env.RXX_HOME;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-init-"));
    process.env.RXX_HOME = tmpHome;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("pinned key 验签失败 → TOFU fallback 重新 fetch 无 pinning key", async () => {
    const { LoaderError } = await import("../manifest/loader.js");

    let fetchCallCount = 0;
    const fetchManifestMock = vi.fn().mockImplementation((_url: string, opts: any) => {
      fetchCallCount++;
      if (fetchCallCount === 1 && opts.trustedPublicKeyPem) {
        throw new LoaderError("sig mismatch", "signature_failed");
      }
      return {
        manifest: {
          name: "tofu-test",
          description: "d",
          version: "1.0.0",
          api: { baseUrl: "https://api.example.com" },
          commands: {
            ping: {
              description: "p",
              http: { method: "GET", path: "/p" },
              response: { data: "." },
            },
          },
        },
        sourceUrl: "https://x.example.com/tofu-test.json",
        signatureVerified: true,
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\nnew\n-----END PUBLIC KEY-----\n",
        keyFingerprint: "sha256:new",
        unsigned: false,
      };
    });

    // doMock 必须在 import init.ts 之前(否则 initCommand 绑定真实 fetchManifest)
    vi.doMock("../manifest/loader.js", () => ({ fetchManifest: fetchManifestMock, LoaderError }));
    const installFlowMock = vi
      .fn()
      .mockResolvedValue({ data: { installed: true, name: "tofu-test" } });
    vi.doMock("../install-flow.js", () => ({ installFlow: installFlowMock }));
    vi.doMock("../registry.js", () => ({
      isInstalled: () => true,
      readPublicKey: () => "-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----\n",
      readService: () => ({
        name: "tofu-test",
        version: "1.0.0",
        publicKey: "old",
        keyFingerprint: "sha256:old",
      }),
    }));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // doMock 后再 import,initCommand 才会绑定 mock 过的 fetchManifest
    const { initCommand } = await import("../commands/init.js");
    const args = {
      url: "https://x.example.com/tofu-test.json",
      autoConfirm: true,
      lang: "en" as const,
    };
    const result = await initCommand.run!({} as any, args as any);

    expect(fetchCallCount).toBe(2);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/TOFU/i));
    expect(installFlowMock).toHaveBeenCalled();
    expect(result.data).toMatchObject({ installed: true });
    vi.doUnmock("../manifest/loader.js");
    vi.doUnmock("../install-flow.js");
    vi.doUnmock("../registry.js");
  });

  it("未装服务(无 pinning key)→ 单次 fetch,走首次 TOFU", async () => {
    const { LoaderError } = await import("../manifest/loader.js");
    let fetchCallCount = 0;
    const fetchManifestMock = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      return {
        manifest: {
          name: "fresh-svc",
          description: "d",
          version: "1.0.0",
          api: { baseUrl: "https://api.example.com" },
          commands: {
            ping: {
              description: "p",
              http: { method: "GET", path: "/p" },
              response: { data: "." },
            },
          },
        },
        sourceUrl: "https://x.example.com/fresh-svc.json",
        signatureVerified: true,
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfresh\n-----END PUBLIC KEY-----\n",
        keyFingerprint: "sha256:fresh",
        unsigned: false,
      };
    });
    vi.doMock("../manifest/loader.js", () => ({ fetchManifest: fetchManifestMock, LoaderError }));
    vi.doMock("../install-flow.js", () => ({
      installFlow: vi.fn().mockResolvedValue({ data: { installed: true } }),
    }));
    vi.doMock("../registry.js", () => ({
      isInstalled: () => false,
      readPublicKey: () => null,
      readService: () => null,
    }));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { initCommand } = await import("../commands/init.js");
    const args = {
      url: "https://x.example.com/fresh-svc.json",
      autoConfirm: true,
      lang: "en" as const,
    };
    await initCommand.run!({} as any, args as any);
    expect(fetchCallCount).toBe(1);
    vi.doUnmock("../manifest/loader.js");
    vi.doUnmock("../install-flow.js");
    vi.doUnmock("../registry.js");
  });

  it("fetch 非 signature_failed 错误 → 不 fallback,直接抛", async () => {
    const { LoaderError } = await import("../manifest/loader.js");
    const fetchManifestMock = vi.fn().mockImplementation(() => {
      throw new LoaderError("net down", "network");
    });
    vi.doMock("../manifest/loader.js", () => ({ fetchManifest: fetchManifestMock, LoaderError }));
    vi.doMock("../install-flow.js", () => ({ installFlow: vi.fn() }));
    vi.doMock("../registry.js", () => ({
      isInstalled: () => true,
      readPublicKey: () => "old-key",
      readService: () => ({
        name: "x",
        version: "1",
        publicKey: "old",
        keyFingerprint: "sha256:o",
      }),
    }));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { initCommand } = await import("../commands/init.js");
    const args = { url: "https://x.example.com/x.json", autoConfirm: true, lang: "en" as const };
    await expect(initCommand.run!({} as any, args as any)).rejects.toThrow(/net down/);
    expect(fetchManifestMock).toHaveBeenCalledTimes(1);
    vi.doUnmock("../manifest/loader.js");
    vi.doUnmock("../install-flow.js");
    vi.doUnmock("../registry.js");
  });
});
