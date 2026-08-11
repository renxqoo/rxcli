import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { errs, type CommandContext, type RequestOptions } from "@renxqoo/agent-data-cli";
import { createCordysAuthWithStore, type RxCordysState } from "../auth.js";

/** 内存 store(隔离 ~/.rxcli 磁盘)。 */
function makeMemoryStore(creds: Record<string, unknown> | null = null) {
  let data = creds;
  return {
    async loadCredentials() {
      return data;
    },
    async saveCredentials(_ns: string, d: Record<string, unknown>) {
      data = d;
    },
    async clearCredentials() {
      data = null;
    },
  };
}

/** 构造带 auth plugin 的 ctx(模拟 createContext 的 beforeCommand/prepareRequest 调用)。 */
function makeCtxWithAuth(storeCreds: Record<string, unknown> | null) {
  const store = makeMemoryStore(storeCreds);
  const auth = createCordysAuthWithStore(store);
  const state: RxCordysState = { credentials: null, credentialSource: null };
  const ctx = {
    state,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    credentials: {
      get: async (ns: string) => store.loadCredentials(ns),
      save: (ns: string, d: Record<string, unknown>) => store.saveCredentials(ns, d),
      clear: (ns: string) => store.clearCredentials(ns),
    },
  } as unknown as CommandContext<RxCordysState>;
  return { auth, ctx, store };
}

describe("auth prepareRequest:双 header 注入", () => {
  beforeEach(() => {
    delete process.env.CORDYS_ACCESS_KEY;
    delete process.env.CORDYS_SECRET_KEY;
  });
  afterEach(() => {
    delete process.env.CORDYS_ACCESS_KEY;
    delete process.env.CORDYS_SECRET_KEY;
  });

  it("从凭证文件读取并注入 X-Access-Key / X-Secret-Key / X-Request-Source", async () => {
    const { auth, ctx } = makeCtxWithAuth({ accessKey: "ak_123", secretKey: "sk_456" });
    await auth.beforeCommand!(ctx);
    const req: RequestOptions = { method: "GET", path: "/lead/page", headers: {} };
    const prepared = await auth.prepareRequest!(ctx, req);
    expect(prepared.headers?.["X-Access-Key"]).toBe("ak_123");
    expect(prepared.headers?.["X-Secret-Key"]).toBe("sk_456");
    expect(prepared.headers?.["X-Request-Source"]).toBe("SKILL");
  });

  it("环境变量优先于凭证文件", async () => {
    process.env.CORDYS_ACCESS_KEY = "env_ak";
    process.env.CORDYS_SECRET_KEY = "env_sk";
    const { auth, ctx } = makeCtxWithAuth({ accessKey: "file_ak", secretKey: "file_sk" });
    await auth.beforeCommand!(ctx);
    expect(ctx.state.credentials?.accessKey).toBe("env_ak");
    expect(ctx.state.credentialSource).toBe("env");
  });

  it("无凭证抛 AuthenticationError(no_credentials)", async () => {
    const { auth, ctx } = makeCtxWithAuth(null);
    await expect(auth.beforeCommand!(ctx)).rejects.toMatchObject({
      category: "authentication",
      subtype: "no_credentials",
    });
  });

  it("无凭证时 prepareRequest 不注入 header(不崩)", async () => {
    const { auth, ctx } = makeCtxWithAuth(null);
    // state.credentials 仍为 null(beforeCommand 虽抛错,但模拟内部命令场景)
    const req: RequestOptions = { method: "GET", path: "/x", headers: {} };
    const prepared = await auth.prepareRequest!(ctx, req);
    expect(prepared.headers?.["X-Access-Key"]).toBeUndefined();
  });

  it("部分凭证(缺 secretKey)视为无效,抛错", async () => {
    const { auth, ctx } = makeCtxWithAuth({ accessKey: "ak_only" });
    await expect(auth.beforeCommand!(ctx)).rejects.toBeInstanceOf(errs.AuthenticationError);
  });
});

describe("auth login/logout 命令(直接用 store 落盘,不依赖 ctx.credentials)", () => {
  beforeEach(() => {
    delete process.env.CORDYS_ACCESS_KEY;
    delete process.env.CORDYS_SECRET_KEY;
  });
  afterEach(() => {
    delete process.env.CORDYS_ACCESS_KEY;
    delete process.env.CORDYS_SECRET_KEY;
  });

  it("login 写入凭证文件(即使 ctx.credentials 是 no-op 也能落盘)", async () => {
    // login 被 auth plugin 豁免 beforeCommand → ctx.credentials 是框架 no-op。
    // 此测试验证 login 直接用注入 store 落盘,不靠 ctx.credentials。
    const { auth, store } = makeCtxWithAuth(null);
    const loginCmd = auth.provides?.namespaces?.auth?.login;
    expect(loginCmd).toBeDefined();
    // ctx.credentials.save 故意设成 no-op(模拟被豁免的场景)
    const ctx = {
      state: { credentials: null, credentialSource: null },
      log: { info: () => {}, warn: () => {}, error: () => {} },
      credentials: {
        get: async () => null,
        save: async () => {
          /* no-op:模拟框架默认,login 不应依赖它 */
        },
        clear: async () => {},
      },
    } as unknown as CommandContext<RxCordysState>;
    const result = await loginCmd!.run({ accessKey: "new_ak", secretKey: "new_sk" }, ctx);
    expect(result!.data).toMatchObject({ saved: true, namespace: "cordys" });
    await expect(store.loadCredentials("cordys")).resolves.toEqual({
      accessKey: "new_ak",
      secretKey: "new_sk",
    });
  });

  it("logout 清除凭证文件", async () => {
    const { auth, store } = makeCtxWithAuth({ accessKey: "x", secretKey: "y" });
    const logoutCmd = auth.provides?.namespaces?.auth?.logout;
    expect(logoutCmd).toBeDefined();
    const ctx = {
      state: { credentials: null, credentialSource: null },
      log: { info: () => {}, warn: () => {}, error: () => {} },
      credentials: { get: async () => null, save: async () => {}, clear: async () => {} },
    } as unknown as CommandContext<RxCordysState>;
    await logoutCmd!.run({}, ctx);
    await expect(store.loadCredentials("cordys")).resolves.toBeNull();
  });
});
