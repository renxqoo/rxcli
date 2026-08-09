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

/** 构造带 auth plugin 的 ctx(模拟 createContext 的 beforeCommand/beforeRequest 调用)。 */
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

describe("auth beforeRequest:双 header 注入", () => {
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
    await auth.beforeRequest!(ctx, req);
    expect(req.headers?.["X-Access-Key"]).toBe("ak_123");
    expect(req.headers?.["X-Secret-Key"]).toBe("sk_456");
    expect(req.headers?.["X-Request-Source"]).toBe("SKILL");
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

  it("无凭证时 beforeRequest 不注入 header(不崩)", async () => {
    const { auth, ctx } = makeCtxWithAuth(null);
    // state.credentials 仍为 null(beforeCommand 虽抛错,但模拟内部命令场景)
    const req: RequestOptions = { method: "GET", path: "/x", headers: {} };
    await auth.beforeRequest!(ctx, req);
    expect(req.headers?.["X-Access-Key"]).toBeUndefined();
  });

  it("部分凭证(缺 secretKey)视为无效,抛错", async () => {
    const { auth, ctx } = makeCtxWithAuth({ accessKey: "ak_only" });
    await expect(auth.beforeCommand!(ctx)).rejects.toBeInstanceOf(errs.AuthenticationError);
  });
});

describe("auth login 命令", () => {
  beforeEach(() => {
    delete process.env.CORDYS_ACCESS_KEY;
    delete process.env.CORDYS_SECRET_KEY;
  });
  afterEach(() => {
    delete process.env.CORDYS_ACCESS_KEY;
    delete process.env.CORDYS_SECRET_KEY;
  });

  it("login 写入凭证文件", async () => {
    const { auth } = makeCtxWithAuth(null);
    const loginCmd = auth.provides?.namespaces?.auth?.login;
    expect(loginCmd).toBeDefined();
    const ctx = {
      state: { credentials: null, credentialSource: null },
      log: { info: () => {}, warn: () => {}, error: () => {} },
      credentials: {
        get: async () => null,
        save: async (_ns: string, d: Record<string, unknown>) => {
          savedData = d;
        },
        clear: async () => {},
      },
    } as unknown as CommandContext<RxCordysState>;
    let savedData: Record<string, unknown> | undefined;
    const result = await loginCmd!.run({ accessKey: "new_ak", secretKey: "new_sk" }, ctx);
    expect(result!.data).toMatchObject({ saved: true });
    expect(savedData).toEqual({ accessKey: "new_ak", secretKey: "new_sk" });
  });
});
