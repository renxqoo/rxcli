import { describe, it, expect } from "vitest";
import { createTestCtx } from "@renxqoo/agent-data-cli";
import { ordersCommands } from "./orders.js";

/** 构造 B 方案分页响应:{ data, total, page } */
function mockListResponse(opts: { items: unknown[]; total: number; page: number }) {
  return {
    status: 200,
    data: { data: opts.items, total: opts.total, page: opts.page },
    headers: {},
  };
}

describe("orders list", () => {
  it("返回当前页数据 + 分页 meta(complete 判断)", async () => {
    const items = [{ id: "o_1" }, { id: "o_2" }];
    const ctx = createTestCtx({
      request: async () => mockListResponse({ items, total: 5, page: 1 }),
    });
    const result = await ordersCommands.list.run({ page: 1, size: 2 }, ctx);
    expect(result).toBeDefined();
    expect(result!.data).toEqual(items);
    expect(result!.meta).toEqual({
      count: 2,
      pagination: {
        complete: false, // page(1)*size(2)=2 < total(5) → 还有更多
        pages: 3, // ceil(5/2)
        items: 5,
        nextToken: "2", // 续拉:下一页
      },
    });
  });

  it("最后一页 complete=true,无 nextToken", async () => {
    const ctx = createTestCtx({
      request: async () => mockListResponse({ items: [{ id: "o_5" }], total: 5, page: 3 }),
    });
    const result = await ordersCommands.list.run({ page: 3, size: 2 }, ctx);
    expect(result!.meta!.pagination).toEqual({
      complete: true, // page(3)*size(2)=6 >= total(5) → 已拉完
      pages: 3,
      items: 5,
      nextToken: undefined,
    });
  });

  it("透传 page/size 到 query", async () => {
    let capturedQuery: Record<string, unknown> | undefined;
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedQuery = opts.query;
        return mockListResponse({ items: [], total: 0, page: 2 });
      },
    });
    await ordersCommands.list.run({ page: 2, size: 50 }, ctx);
    expect(capturedQuery).toEqual({ page: 2, size: 50 });
  });
});

describe("orders get", () => {
  it("返回订单详情", async () => {
    const ctx = createTestCtx({
      request: async () => ({ status: 200, data: { id: "o_100" }, headers: {} }),
    });
    const result = await ordersCommands.get.run({ id: "o_100" }, ctx);
    expect(result!.data).toEqual({ id: "o_100" });
  });

  it("404 → NotFoundError", async () => {
    const ctx = createTestCtx({
      request: async () => ({ status: 404, data: { message: "not found" }, headers: {} }),
    });
    await expect(ordersCommands.get.run({ id: "missing" }, ctx)).rejects.toMatchObject({
      category: "api",
      subtype: "not_found",
    });
  });
});
