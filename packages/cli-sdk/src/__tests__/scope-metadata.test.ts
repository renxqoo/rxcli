/**
 * 动态 scope 测试:CLI 从 metadata 端点获取 scopes_supported,
 * 不在代码里写死 scope。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchScopesFromMetadata, type OAuthClientConfig } from "../oauth.js";

const cfg: OAuthClientConfig = {
  baseUrl: "http://auth.test",
  clientId: "cid",
  clientSecret: "csec",
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchScopesFromMetadata", () => {
  it("从 /.well-known/oauth-authorization-server 读 scopes_supported", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        issuer: "http://auth.test",
        scopes_supported: ["orders:read", "products:read", "invoices:read", "offline_access"],
      }),
    );
    const scopes = await fetchScopesFromMetadata(cfg);
    expect(scopes).toEqual(["orders:read", "products:read", "invoices:read", "offline_access"]);
  });

  it("metadata 无 scopes_supported → 返回空数组(不报错)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { issuer: "http://auth.test" }));
    const scopes = await fetchScopesFromMetadata(cfg);
    expect(scopes).toEqual([]);
  });

  it("metadata 请求失败 → 返回空数组(降级,不阻断登录)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    const scopes = await fetchScopesFromMetadata(cfg);
    expect(scopes).toEqual([]);
  });

  it("返回的 scope 含 offline_access(用于 refresh token)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        issuer: "http://auth.test",
        scopes_supported: ["orders:read", "offline_access"],
      }),
    );
    const scopes = await fetchScopesFromMetadata(cfg);
    expect(scopes).toContain("offline_access");
  });
});
