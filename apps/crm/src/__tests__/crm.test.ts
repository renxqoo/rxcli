import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as z from "zod";
import { createTestCtx } from "@renxqoo/agent-data-cli";
import { ordersCommands } from "../commands/orders.js";
import { productsCommands } from "../commands/products.js";
import { invoicesCommands } from "../commands/invoices.js";
import { accountCommands } from "../commands/account.js";

// 所有业务命令都经 gateway GET,用 createTestCtx mock request
function mockCtx(responseByPath: Record<string, { status?: number; data: unknown }>) {
  return createTestCtx({
    request: async (opts) => {
      const key = opts.path;
      const mock = responseByPath[key];
      if (mock) return { status: mock.status ?? 200, data: mock.data, headers: {} };
      // 通配:路径前缀匹配
      for (const [pattern, res] of Object.entries(responseByPath)) {
        if (pattern.endsWith("*") && key.startsWith(pattern.slice(0, -1))) {
          return { status: res.status ?? 200, data: res.data, headers: {} };
        }
      }
      throw new Error(`unexpected ${opts.method} ${opts.path}`);
    },
  });
}

describe("orders", () => {
  it("cursor 帮助引用统一 JSON wire 字段 next_token", () => {
    const jsonSchema = z.toJSONSchema(ordersCommands.list.args!.schema as z.ZodObject, {
      io: "input",
    }) as { properties: Record<string, { description?: string }> };
    expect(jsonSchema.properties.cursor?.description).toContain("meta.pagination.next_token");
  });

  it("list 返回订单数组", async () => {
    const ctx = mockCtx({
      "/proxy/api/orders": {
        data: { orders: [{ id: "o_1001", total: 168 }], hasMore: false, nextCursor: null },
      },
    });
    const result = await ordersCommands.list.run(ctx, {});
    expect(result!.data).toEqual({
      orders: [{ id: "o_1001", total: 168 }],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("list --limit 透传 query", async () => {
    let capturedQuery: Record<string, unknown> = {};
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedQuery = opts.query ?? {};
        return { status: 200, data: { orders: [] }, headers: {} };
      },
    });
    await ordersCommands.list.run(ctx, { limit: 5 });
    expect(capturedQuery.limit).toBe(5);
  });

  it("list 透传 cursor 并返回可续拉的 pagination 元数据", async () => {
    let capturedQuery: Record<string, unknown> = {};
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedQuery = opts.query ?? {};
        return {
          status: 200,
          data: {
            orders: [{ id: "o_1002" }],
            hasMore: true,
            nextCursor: "o_1002",
          },
          headers: {},
        };
      },
    });

    const result = await ordersCommands.list.run(ctx, { limit: 1, cursor: "o_1001" });

    expect(capturedQuery).toEqual({ limit: 1, cursor: "o_1001" });
    expect(result!.meta).toEqual({
      count: 1,
      pagination: {
        complete: false,
        items: 1,
        nextToken: "o_1002",
      },
    });
  });

  it("get 404 → NotFoundError", async () => {
    const ctx = mockCtx({ "/proxy/api/orders/o_x": { status: 404, data: {} } });
    await expect(ordersCommands.get.run(ctx, { id: "o_x" })).rejects.toMatchObject({
      category: "api",
      subtype: "not_found",
    });
  });
});

describe("products", () => {
  it("list --category 透传", async () => {
    let capturedQuery: Record<string, unknown> = {};
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedQuery = opts.query ?? {};
        return { status: 200, data: { products: [] }, headers: {} };
      },
    });
    await productsCommands.list.run(ctx, { category: "电脑外设" });
    expect(capturedQuery.category).toBe("电脑外设");
  });

  it("get 返回商品详情", async () => {
    const ctx = mockCtx({
      "/proxy/api/products/p_002": { data: { id: "p_002", name: "机械键盘" } },
    });
    const result = await productsCommands.get.run(ctx, { id: "p_002" });
    expect(result!.data).toMatchObject({ id: "p_002", name: "机械键盘" });
  });
});

describe("invoices", () => {
  it("list 返回发票列表", async () => {
    const ctx = mockCtx({ "/proxy/api/invoices": { data: { invoices: [{ id: "inv_2001" }] } } });
    const result = await invoicesCommands.list.run(ctx, {});
    expect(result!.data).toEqual({ invoices: [{ id: "inv_2001" }] });
  });
});

describe("account", () => {
  it("profile 返回当前用户资料", async () => {
    const ctx = mockCtx({
      "/proxy/api/profile": { data: { id: "u_alice", email: "alice@example.com" } },
    });
    const result = await accountCommands.profile.run(ctx, {});
    expect(result!.data).toMatchObject({ id: "u_alice" });
  });

  it("admin-users 返回全量用户(权限由服务端 403 拦截,本地不预检)", async () => {
    const ctx = mockCtx({ "/proxy/api/admin/users": { data: { users: [{ id: "u_alice" }] } } });
    const result = await accountCommands["admin-users"].run(ctx, {});
    expect(result!.data).toEqual({ users: [{ id: "u_alice" }] });
  });
});

describe("published CRM contract", () => {
  const readProjectFile = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  it("面向使用者的分页文档使用 wire 字段 next_token", () => {
    const docs = [
      readProjectFile("README.md"),
      readProjectFile("README.zh-CN.md"),
      readProjectFile("skills/rx-orders/SKILL.md"),
      readProjectFile("skills/rx-orders/references/orders-list.md"),
    ];

    for (const doc of docs) {
      expect(doc).not.toContain("nextToken");
    }
    expect(docs.join("\n")).toContain("next_token");
  });

  it("双语 README 的 o_1002 金额与 mock 数据一致", () => {
    for (const readme of [readProjectFile("README.md"), readProjectFile("README.zh-CN.md")]) {
      expect(readme).toMatch(/o_1002\s+u_alice\s+shipped\s+39\s+CNY/);
      expect(readme).not.toContain("58.5");
    }
  });
});
