import { describe, it, expect } from "vitest";
import { createTestCtx } from "@renxqoo/agent-data-cli";
import { manifestToCommand, manifestToCommands } from "../executor/dynamic-command.js";
import type { Manifest, ManifestCommand } from "../manifest/schema.js";

// 测试用 manifest
const testManifest: Manifest = {
  name: "test-svc",
  description: "test",
  version: "1.0.0",
  api: { baseUrl: "https://api.example.com" },
  namespaces: {
    orders: {
      list: {
        description: "list orders",
        args: {
          limit: { type: "number", desc: "limit" },
          cursor: { type: "string", desc: "cursor" },
        },
        http: {
          method: "GET",
          path: "/api/orders",
          query: { limit: "{limit}", cursor: "{cursor}" },
        },
        response: {
          data: "orders",
          pagination: {
            complete: { field: "hasMore", invert: true },
            nextToken: { field: "nextCursor" },
          },
        },
      },
      get: {
        description: "get one order",
        args: { id: { type: "string", required: true, positional: true, desc: "id" } },
        http: { method: "GET", path: "/api/orders/{id}" },
        response: { data: "." },
      },
      create: {
        description: "create order",
        args: {
          amount: { type: "number", required: true, desc: "amount" },
          customer: { type: "string", required: true, desc: "customer" },
        },
        http: {
          method: "POST",
          path: "/api/orders",
          body: { amount: "{amount}", customer: "{customer}" },
        },
        response: { data: "." },
      },
    },
  },
};

function mockCtx(responses: Record<string, (opts: any) => { status: number; data: unknown }>) {
  return createTestCtx({
    request: async (opts) => {
      const key = `${opts.method}:${opts.path}`;
      const handler = responses[key];
      if (!handler) throw new Error(`unexpected ${key}`);
      return handler(opts);
    },
  });
}

describe("manifestToCommand", () => {
  it("GET list:query 透传 + 分页映射", async () => {
    let capturedQuery: any;
    const ctx = mockCtx({
      "GET:/api/orders": (opts) => {
        capturedQuery = opts.query;
        return {
          status: 200,
          data: {
            orders: [{ id: "ord_001" }, { id: "ord_002" }],
            hasMore: true,
            nextCursor: "abc",
          },
        };
      },
    });
    const cmd = manifestToCommand("list", testManifest.namespaces!.orders!.list);
    const result = await cmd.run({ limit: 2 }, ctx as any);
    expect(result!.data).toEqual([{ id: "ord_001" }, { id: "ord_002" }]);
    expect(result!.meta?.pagination).toEqual({
      complete: false,
      nextToken: "abc",
      items: 2,
    });
    expect(capturedQuery).toEqual({ limit: "2" }); // cursor 空值省略
  });

  it("GET {id}:path 占位符替换", async () => {
    let capturedPath: string | undefined;
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return { status: 200, data: { id: "ord_001", amount: 100 } };
      },
    });
    const cmd = manifestToCommand("get", testManifest.namespaces!.orders!.get);
    const result = await cmd.run({ id: "ord_001" }, ctx as any);
    expect(capturedPath).toBe("/api/orders/ord_001");
    expect(result!.data).toEqual({ id: "ord_001", amount: 100 });
  });

  it("POST body 占位符替换", async () => {
    let capturedBody: any;
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedBody = opts.body;
        return { status: 201, data: { id: "new_1", amount: 990 } };
      },
    });
    const cmd = manifestToCommand("create", testManifest.namespaces!.orders!.create);
    const result = await cmd.run({ amount: 990, customer: "alice" }, ctx as any);
    expect(capturedBody).toEqual({ amount: "990", customer: "alice" });
    expect(result!.data).toEqual({ id: "new_1", amount: 990 });
  });

  it("path traversal 被拒", async () => {
    const ctx = mockCtx({});
    const cmd = manifestToCommand("get", testManifest.namespaces!.orders!.get);
    await expect(cmd.run({ id: "../../etc/passwd" }, ctx as any)).rejects.toThrow();
  });
});

describe("manifestToCommands", () => {
  it("完整 manifest 转 commands + namespaces", () => {
    const { commands, namespaces } = manifestToCommands(testManifest);
    expect(Object.keys(commands)).toHaveLength(0); // 全走 namespace
    expect(Object.keys(namespaces)).toEqual(["orders"]);
    expect(Object.keys(namespaces.orders!)).toEqual(["list", "get", "create"]);
  });
});

// ============================================================================
// 参数范围校验(AI 高频错误:超大/负数/小数 limit)
// ============================================================================

describe("参数范围校验 validateArgValues", () => {
  // 带约束的 manifest:limit 1-100 整数,offset>=0 整数
  const constrainedCmd: ManifestCommand = {
    description: "list with constraints",
    args: {
      limit: { type: "number", min: 1, max: 100, desc: "limit" },
      offset: { type: "number", min: 0, desc: "offset" },
      ratio: { type: "number", integer: false, desc: "ratio" },
    },
    http: {
      method: "GET",
      path: "/api/items",
      query: { limit: "{limit}", offset: "{offset}", ratio: "{ratio}" },
    },
    response: { data: "." },
  };
  const noopCtx = createTestCtx({ request: async () => ({ status: 200, data: [] }) });

  it("limit 在范围内 → 通过", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ limit: 50 }, noopCtx as any)).resolves.toBeDefined();
  });

  it("limit 超大数(精度丢失)→ out_of_range(Number.isFinite 拦不住,但 max 拦)", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ limit: 999999999999999999999 }, noopCtx as any)).rejects.toMatchObject({
      category: "validation",
      subtype: "out_of_range",
      param: "limit",
    });
  });

  it("limit 负数(< min)→ out_of_range", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ limit: -5 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });

  it("limit = 0(< min:1)→ out_of_range", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ limit: 0 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });

  it("limit 小数(默认 integer:true)→ out_of_range", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ limit: 3.5 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });

  it("ratio 小数(integer:false 声明)→ 通过", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ ratio: 0.5 }, noopCtx as any)).resolves.toBeDefined();
  });

  it("limit 超过 max:100 → out_of_range", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ limit: 101 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });

  it("limit = Infinity → out_of_range(非有限数)", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ limit: Infinity }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });

  it("limit = NaN → out_of_range", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    await expect(cmd.run({ limit: NaN }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });

  it("未声明 min/max 的 number 参数 → 仅查整数", async () => {
    const cmd = manifestToCommand("list", {
      description: "d",
      args: { n: { type: "number", desc: "n" } },
      http: { method: "GET", path: "/x", query: { n: "{n}" } },
      response: { data: "." },
    });
    await expect(cmd.run({ n: 42 }, noopCtx as any)).resolves.toBeDefined();
    await expect(cmd.run({ n: 3.14 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
    });
  });

  it("错误信息含 param 名(AI 可据此纠正)", async () => {
    const cmd = manifestToCommand("list", constrainedCmd);
    try {
      await cmd.run({ limit: -5 }, noopCtx as any);
      throw new Error("should throw");
    } catch (e: any) {
      expect(e.param).toBe("limit");
      expect(e.message).toMatch(/>= 1/);
    }
  });
});
