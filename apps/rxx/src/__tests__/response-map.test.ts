import { describe, it, expect } from "vitest";
import { extractData, mapPagination, mapResponse } from "../executor/response-map.js";

describe("extractData", () => {
  it("点号 = 整个对象", () => {
    const obj = { x: 1 };
    expect(extractData(obj, ".")).toBe(obj);
  });

  it("单层字段", () => {
    expect(extractData({ orders: [1, 2] }, "orders")).toEqual([1, 2]);
  });

  it("嵌套字段 a.b", () => {
    expect(extractData({ a: { b: { c: 1 } } }, "a.b")).toEqual({ c: 1 });
  });

  it("深层嵌套 data.items", () => {
    expect(extractData({ data: { items: [1] } }, "data.items")).toEqual([1]);
  });

  it("字段不存在返回 null", () => {
    expect(extractData({ x: 1 }, "y")).toBeNull();
  });

  it("中途非对象返回 null", () => {
    expect(extractData({ a: "string" }, "a.b")).toBeNull();
  });

  it("中途 null 返回 null", () => {
    expect(extractData({ a: null }, "a.b")).toBeNull();
  });
});

describe("mapPagination", () => {
  it("标准映射 hasMore + nextCursor", () => {
    expect(
      mapPagination(
        { hasMore: true, nextCursor: "abc" },
        {
          complete: { field: "hasMore", invert: true },
          nextToken: { field: "nextCursor" },
        },
      ),
    ).toEqual({ complete: false, nextToken: "abc" });
  });

  it("invert: false=complete", () => {
    expect(mapPagination({ done: true }, { complete: { field: "done" } })).toEqual({
      complete: true,
    });
  });

  it("无 nextCursor 省略 nextToken", () => {
    expect(
      mapPagination(
        { hasMore: false, nextCursor: null },
        {
          complete: { field: "hasMore", invert: true },
          nextToken: { field: "nextCursor" },
        },
      ),
    ).toEqual({ complete: true });
  });

  it("嵌套字段 paging.next", () => {
    expect(
      mapPagination(
        { paging: { next: "tok" } },
        {
          complete: { field: "paging.next", invert: true },
          nextToken: { field: "paging.next" },
        },
      ),
    ).toEqual({ complete: false, nextToken: "tok" });
  });

  it("items 从数组字段推断", () => {
    expect(mapPagination({ data: [1, 2, 3] }, { items: { field: "data" } })).toEqual({
      complete: true,
      items: 3,
    });
  });

  it("items 从数字字段读取(如 total_count)", () => {
    expect(
      mapPagination({ total_count: 500, data: [1, 2] }, { items: { field: "total_count" } }),
    ).toEqual({ complete: true, items: 500 });
  });

  it("items 字段缺失 → 不设 items", () => {
    expect(mapPagination({ data: [1] }, { items: { field: "total" } })).toEqual({ complete: true });
  });

  it("complete 字段为 falsy 值 0 时不被当成缺失(invert 场景)", () => {
    // raw=0,invert=false → complete = !!0 = false(0 是合法信号,非缺失)
    expect(mapPagination({ status: 0 }, { complete: { field: "status" } })).toEqual({
      complete: false,
    });
  });
});

describe("mapResponse", () => {
  it("完整映射:标准 SaaS 响应", () => {
    const res = {
      orders: [{ id: "ord_001" }, { id: "ord_002" }],
      hasMore: true,
      nextCursor: "eyJwYWdlIjoyfQ",
    };
    const result = mapResponse(res, {
      data: "orders",
      pagination: {
        complete: { field: "hasMore", invert: true },
        nextToken: { field: "nextCursor" },
      },
    });
    expect(result.data).toEqual([{ id: "ord_001" }, { id: "ord_002" }]);
    expect(result.meta).toEqual({
      pagination: { complete: false, nextToken: "eyJwYWdlIjoyfQ", items: 2 },
      count: 2,
    });
  });

  it("异构 SaaS:data.items + paging.next", () => {
    const res = {
      data: { items: [{ id: "p1" }] },
      paging: { next: "next_tok" },
    };
    const result = mapResponse(res, {
      data: "data.items",
      pagination: {
        complete: { field: "paging.next", invert: true },
        nextToken: { field: "paging.next" },
      },
    });
    expect(result.data).toEqual([{ id: "p1" }]);
    expect(result.meta?.pagination).toEqual({ complete: false, nextToken: "next_tok", items: 1 });
  });

  it("无分页:数组自动 count", () => {
    const result = mapResponse({ x: [1, 2, 3] }, { data: "x" });
    expect(result.data).toEqual([1, 2, 3]);
    expect(result.meta).toEqual({ count: 3 });
  });

  it("data 为整个 body", () => {
    const obj = { a: 1 };
    const result = mapResponse(obj, { data: "." });
    expect(result.data).toBe(obj);
    expect(result.meta).toBeUndefined();
  });

  // —— TDD:prototype pollution 防护(通过 mapResponse 端到端)——
  it("响应含 __proto__ 不污染原型链", () => {
    const malicious = JSON.parse('{"data": [1], "__proto__": {"polluted": true}}');
    const result = mapResponse(malicious, { data: "data" });
    expect(result.data).toEqual([1]);
    expect(({} as any).polluted).toBeUndefined();
  });

  // —— TDD:count 与 items 字段不一致时的契约 ——
  it("pagination.items 指向别处时,count 反映 items 字段值而非 data 长度", () => {
    const res = { items: [{ id: 1 }, { id: 2 }], total_count: 500 };
    const result = mapResponse(res, {
      data: "items",
      pagination: { items: { field: "total_count" } },
    });
    // items 字段(total_count=500)优先生效,data 是 2 元素数组不再覆盖
    expect(result.meta?.count).toBe(500);
    expect(result.meta?.pagination?.items).toBe(500);
  });

  it("不 mutate 输入 resData", () => {
    const res = { items: [1, 2], hasMore: true };
    const snapshot = JSON.stringify(res);
    mapResponse(res, {
      data: "items",
      pagination: { complete: { field: "hasMore", invert: true } },
    });
    expect(JSON.stringify(res)).toBe(snapshot);
  });

  it("data 提取 falsy 值 0 不返回 null", () => {
    // 依赖 safeGetField 修复后:count=0 是合法值
    const result = mapResponse({ count: 0 }, { data: "count" });
    expect(result.data).toBe(0);
  });
});
