/**
 * defineAuth 重构后的纯函数测试。
 * 测试提取出来的 resolveAuthConfig / buildProviderChain / buildOn401Handler。
 */
import { describe, it, expect, vi } from "vitest";
import { memoryStore } from "../../credentials/config-store.js";
import { resolveAuthConfig, buildProviderChain, buildOn401Handler } from "../helpers.js";

describe("resolveAuthConfig", () => {
  it("显式传 clientId/clientSecret → 直接用", async () => {
    const cfg = await resolveAuthConfig(
      {
        baseUrl: "http://test",
        clientId: "cid",
        clientSecret: "csec",
      },
      memoryStore(),
    );
    expect(cfg.oauth.clientId).toBe("cid");
    expect(cfg.oauth.clientSecret).toBe("csec");
    expect(cfg.oauth.baseUrl).toBe("http://test");
  });

  it("env 传 clientId/clientSecret → 从 env 读", async () => {
    process.env.RXCLI_CLIENT_ID = "env-cid";
    process.env.RXCLI_CLIENT_SECRET = "env-csec";
    const cfg = await resolveAuthConfig(
      {
        baseUrl: "http://test",
      },
      memoryStore(),
    );
    expect(cfg.oauth.clientId).toBe("env-cid");
    delete process.env.RXCLI_CLIENT_ID;
    delete process.env.RXCLI_CLIENT_SECRET;
  });

  it("config.json 有 clientId → 回退读", async () => {
    const store = memoryStore();
    await store.saveConfig({ clientId: "cfg-cid", clientSecret: "cfg-csec" });
    const cfg = await resolveAuthConfig(
      {
        baseUrl: "http://test",
      },
      store,
    );
    expect(cfg.oauth.clientId).toBe("cfg-cid");
  });

  it("都没有 → 空(向后兼容未注册态)", async () => {
    const cfg = await resolveAuthConfig(
      {
        baseUrl: "http://test",
      },
      memoryStore(),
    );
    expect(cfg.oauth.clientId).toBe("");
    expect(cfg.oauth.clientSecret).toBe("");
  });

  it("authStyle 默认 bearer", async () => {
    const cfg = await resolveAuthConfig({ baseUrl: "http://test" }, memoryStore());
    expect(cfg.authStyle).toBe("bearer");
  });

  it("authStyle 显式 x-api-key", async () => {
    const cfg = await resolveAuthConfig(
      {
        baseUrl: "http://test",
        authStyle: "x-api-key",
      },
      memoryStore(),
    );
    expect(cfg.authStyle).toBe("x-api-key");
  });
});

describe("buildProviderChain", () => {
  it("无 bearerToken、无 providers → defaultProviders(5 个)", () => {
    const chain = buildProviderChain({});
    expect(chain).toHaveLength(5); // flag/env/envBearer/file/oauth
  });

  it("有 bearerToken → 插入 injected-bearer(priority 0,最高)", () => {
    const chain = buildProviderChain({ bearerToken: "jwt-xxx" });
    const names = chain.map((p) => p.name());
    expect(names).toContain("injected-bearer");
    const injected = chain.find((p) => p.name() === "injected-bearer")!;
    expect(injected.priority?.()).toBe(0);
  });

  it("有 providers → 用自定义的(不掺入 defaultProviders)", () => {
    const custom = {
      name: () => "custom",
      priority: () => 1,
      async resolveToken() {
        return { token: "x", type: "bearer" as const, source: "test" };
      },
    };
    const chain = buildProviderChain({ providers: [custom] });
    expect(chain).toHaveLength(1);
    expect(chain[0].name()).toBe("custom");
  });

  it("bearerToken + providers 同时传 → injected-bearer + 自定义", () => {
    const custom = {
      name: () => "custom",
      priority: () => 10,
      async resolveToken() {
        return null;
      },
    };
    const chain = buildProviderChain({ bearerToken: "jwt", providers: [custom] });
    expect(chain).toHaveLength(2);
    expect(chain.map((p) => p.name())).toEqual(["injected-bearer", "custom"]);
  });
});

describe("buildOn401Handler", () => {
  it("device flow(无 refresh) → 用 createOn401Hook(默认 refresh_token)", () => {
    const oauth = { baseUrl: "http://t", clientId: "c", clientSecret: "s" };
    const store = memoryStore();
    const handler = buildOn401Handler({
      flow: { type: "device", login: vi.fn() },
      oauth,
      store,
      namespace: "test",
      flowDeps: { cfg: oauth },
    });
    expect(typeof handler).toBe("function");
  });

  it("client_credentials flow(有 refresh) → 用 flow.refresh", () => {
    const oauth = { baseUrl: "http://t", clientId: "c", clientSecret: "s" };
    const store = memoryStore();
    const refreshFn = vi.fn().mockResolvedValue({
      access_token: "AT_new",
      expires_in: 3600,
    });
    const handler = buildOn401Handler({
      flow: { type: "client_credentials", login: vi.fn(), refresh: refreshFn },
      oauth,
      store,
      namespace: "test",
      flowDeps: { cfg: oauth },
    });
    expect(typeof handler).toBe("function");
  });

  it("handler 返回 null 时(refresh 失败)→ 返回 null", async () => {
    const oauth = { baseUrl: "http://t", clientId: "c", clientSecret: "s" };
    const store = memoryStore();
    const refreshFn = vi.fn().mockRejectedValue(new Error("fail"));
    const handler = buildOn401Handler({
      flow: { type: "client_credentials", login: vi.fn(), refresh: refreshFn },
      oauth,
      store,
      namespace: "test",
      flowDeps: { cfg: oauth },
    });
    const result = await handler();
    expect(result).toBeNull();
  });

  // BUG-12:client_credentials 的 flow.refresh 必须有 singleflight,
  // 并发 401 不能各自换 token(与默认 refresh_token 路径行为对齐)。
  it("BUG-12: 并发调用 handler 时 flow.refresh 只执行一次(singleflight)", async () => {
    const oauth = { baseUrl: "http://t", clientId: "c", clientSecret: "s" };
    const store = memoryStore();
    let calls = 0;
    const refreshFn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          calls++;
          // 模拟网络延迟,让并发请求在 in-flight 期间到达
          setTimeout(
            () =>
              resolve({ access_token: `AT_${calls}`, refresh_token: undefined, expires_in: 3600 }),
            20,
          );
        }),
    );
    const handler = buildOn401Handler({
      flow: { type: "client_credentials", login: vi.fn(), refresh: refreshFn },
      oauth,
      store,
      namespace: "test",
      flowDeps: { cfg: oauth },
    });
    // 并发 3 次
    const results = await Promise.all([handler(), handler(), handler()]);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    // 三次拿到同一个 token
    expect(results.every((r) => r === results[0])).toBe(true);
    expect(results[0]).toBe("AT_1");
  });
});
