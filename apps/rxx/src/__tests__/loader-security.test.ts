/**
 * rxx —— loader 安全测试(SSRF / DNS rebinding / 超时 / body 大小)
 *
 * 这些是 fetchManifest 的安全关键路径,用注入的 fetchImpl/lookup 验证:
 *   1. fetch URL 本身的 SSRF(isPrivateHost,不只 manifest 内容)
 *   2. DNS rebinding(域名解析到内网 IP)
 *   3. fetch 超时(AbortController)
 *   4. body 大小限制(>1MB 拒绝)
 */

import { describe, it, expect } from "vitest";
import { fetchManifest, LoaderError } from "../manifest/loader.js";

// 一个合法的签名 manifest(供成功路径用)——这里不需要真签名,因为测的是 fetch 前的拦截
const minimalManifest = {
  name: "sec-test",
  description: "security test",
  version: "1.0.0",
  api: { baseUrl: "https://api.example.com" },
  commands: {
    ping: { description: "p", http: { method: "GET", path: "/p" }, response: { data: "." } },
  },
};

function mockFetch(manifest: unknown, status = 200): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(manifest), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

describe("fetchManifest —— SSRF(fetch URL 本身)", () => {
  it("fetch URL 指向 169.254.169.254 → 拦截(SSRF)", async () => {
    await expect(
      fetchManifest("https://169.254.169.254/latest/meta-data", {
        fetchImpl: mockFetch(minimalManifest),
      }),
    ).rejects.toThrow(/SSRF|private|loopback/i);
  });
  it("fetch URL 指向 127.0.0.1 → 拦截", async () => {
    await expect(
      fetchManifest("https://127.0.0.1/manifest", { fetchImpl: mockFetch(minimalManifest) }),
    ).rejects.toThrow(/SSRF|private|loopback/i);
  });
  it("fetch URL 指向 10.0.0.1 → 拦截", async () => {
    await expect(
      fetchManifest("https://10.0.0.1/manifest", { fetchImpl: mockFetch(minimalManifest) }),
    ).rejects.toThrow(/SSRF|private|loopback/i);
  });
  it("allowPrivateEndpoints=true → 放行(本地开发)", async () => {
    // 注意:DNS lookup 对字面量 IP 不调用,直接 isPrivateHost
    // 但 127.0.0.1 字面量在 allowPrivateEndpoints=true 时跳过
    await expect(
      fetchManifest("https://127.0.0.1/manifest", {
        fetchImpl: mockFetch(minimalManifest),
        allowInsecure: true,
        allowPrivateEndpoints: true,
        allowUnsigned: true,
      }),
    ).resolves.toBeDefined();
  });
});

describe("fetchManifest —— DNS rebinding", () => {
  it("公网域名解析到 169.254.169.254 → 拦截", async () => {
    await expect(
      fetchManifest("https://evil.example.com/manifest", {
        fetchImpl: mockFetch(minimalManifest),
        lookup: async () => ["169.254.169.254"],
      }),
    ).rejects.toThrow(/DNS rebinding|private/i);
  });
  it("公网域名解析到 127.0.0.1 → 拦截", async () => {
    await expect(
      fetchManifest("https://evil.example.com/manifest", {
        fetchImpl: mockFetch(minimalManifest),
        lookup: async () => ["127.0.0.1"],
      }),
    ).rejects.toThrow(/DNS rebinding|private/i);
  });
  it("公网域名解析到公网 IP → 放行(进一步校验失败是签名问题,非 SSRF)", async () => {
    // 解析到 8.8.8.8(公网),SSRF/DNS 通过;后续签名失败是预期
    await expect(
      fetchManifest("https://good.example.com/manifest", {
        fetchImpl: mockFetch(minimalManifest),
        lookup: async () => ["8.8.8.8"],
        allowUnsigned: true,
      }),
    ).resolves.toBeDefined();
  });
  it("DNS 解析失败 → 拒绝(不确定时不放行)", async () => {
    await expect(
      fetchManifest("https://broken.example.com/manifest", {
        fetchImpl: mockFetch(minimalManifest),
        lookup: async () => Promise.reject(new Error("ENOTFOUND")),
      }),
    ).rejects.toThrow(/DNS lookup failed/i);
  });
});

describe("fetchManifest —— 超时", () => {
  it("fetch 超时 → fetch_timeout", async () => {
    // 响应 abort signal 的慢 fetch(模拟挂连接)
    const slowFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) reject(new DOMException("aborted", "AbortError"));
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }
        // 永不 resolve(除非 abort)
      })) as typeof fetch;
    await expect(
      fetchManifest("https://good.example.com/manifest", {
        fetchImpl: slowFetch,
        lookup: async () => ["8.8.8.8"],
        fetchTimeoutMs: 50, // 50ms 超时
      }),
    ).rejects.toThrow(/timed out/i);
  });
});

describe("fetchManifest —— body 大小限制", () => {
  it("body > 1MB → response_too_large", async () => {
    // 构造 > 1MB 的 body
    const huge = "x".repeat(1_100_000);
    const hugeManifest = { ...minimalManifest, description: huge };
    await expect(
      fetchManifest("https://good.example.com/manifest", {
        fetchImpl: mockFetch(hugeManifest),
        lookup: async () => ["8.8.8.8"],
        maxBodyBytes: 1024, // 小限制便于测试
        allowUnsigned: true,
      }),
    ).rejects.toThrow(/exceeded/i);
  });
});
