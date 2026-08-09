import { describe, it, expect } from "vitest";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { errs } from "@renxqoo/agent-data-cli";

describe("unwrap", () => {
  it("成功(code=100200)返回 data", () => {
    const res = {
      status: 200,
      data: { code: 100200, message: null, data: { id: "L1" } },
      headers: {},
    };
    expect(unwrap(res)).toEqual({ id: "L1" });
  });

  it("业务错误(code≠100200)抛 APIError", () => {
    const res = {
      status: 200,
      data: { code: 100500, message: "参数错误", messageDetail: "name 必填" },
      headers: {},
    };
    expect(() => unwrap(res)).toThrow();
    try {
      unwrap(res);
    } catch (e) {
      expect(e).toBeInstanceOf(errs.APIError);
      expect((e as errs.APIError).message).toContain("参数错误");
      expect((e as errs.APIError).message).toContain("name 必填");
    }
  });

  it("非标准统一输出格式(无 code)原样返回 data", () => {
    const res = { status: 200, data: { foo: "bar" }, headers: {} };
    expect(unwrap(res)).toEqual({ foo: "bar" });
  });

  it("data 为 null 时返回 null", () => {
    const res = { status: 200, data: { code: 100200, data: null }, headers: {} };
    expect(unwrap(res)).toBeNull();
  });
});

describe("buildPagePayload", () => {
  it("无入参返回默认载荷", () => {
    const payload = buildPagePayload();
    expect(payload.current).toBe(1);
    expect(payload.pageSize).toBe(30);
    expect(payload.viewId).toBe("ALL");
    expect(payload.combineSearch).toEqual({ searchMode: "AND", conditions: [] });
  });

  it("非 JSON 字符串当 keyword", () => {
    const payload = buildPagePayload("张三的公司");
    expect(payload.keyword).toBe("张三的公司");
  });

  it("JSON 字符串对象合并覆盖默认值", () => {
    const payload = buildPagePayload('{"current":3,"pageSize":50,"keyword":"测试"}');
    expect(payload.current).toBe(3);
    expect(payload.pageSize).toBe(50);
    expect(payload.keyword).toBe("测试");
  });

  it("JSON 对象入参合并", () => {
    const payload = buildPagePayload({ current: 2, keyword: "abc" });
    expect(payload.current).toBe(2);
    expect(payload.keyword).toBe("abc");
    expect(payload.pageSize).toBe(30); // 未覆盖保留默认
  });

  it("非法 current/pageSize 回退默认", () => {
    const payload = buildPagePayload({ current: -1, pageSize: 0 });
    expect(payload.current).toBe(1);
    expect(payload.pageSize).toBe(30);
  });

  it("纯数字 JSON 字符串当 keyword(非对象)", () => {
    const payload = buildPagePayload("123");
    expect(payload.keyword).toBe("123");
  });
});

describe("pagedMeta", () => {
  it("未拉完:complete=false,nextToken=下一页", () => {
    const paged: PagedData = { list: [1, 2, 3], total: 100, current: 1, pageSize: 30 };
    const meta = pagedMeta(paged);
    expect(meta.count).toBe(3);
    expect(meta.pagination?.complete).toBe(false);
    expect(meta.pagination?.nextToken).toBe("2");
  });

  it("已拉完:complete=true,无 nextToken", () => {
    const paged: PagedData = { list: [1, 2], total: 32, current: 2, pageSize: 30 };
    const meta = pagedMeta(paged);
    expect(meta.pagination?.complete).toBe(true);
    expect(meta.pagination?.nextToken).toBeUndefined();
  });

  it("刚好拉满:total=pageSize,complete=true", () => {
    const paged: PagedData = { list: [1], total: 30, current: 1, pageSize: 30 };
    const meta = pagedMeta(paged);
    expect(meta.pagination?.complete).toBe(true);
  });
});

describe("parseJsonBody", () => {
  it("合法 JSON 解析", () => {
    expect(parseJsonBody('{"a":1}', "data")).toEqual({ a: 1 });
  });

  it("空字符串抛 missing_required", () => {
    expect(() => parseJsonBody("", "data")).toThrow();
    try {
      parseJsonBody(undefined, "data");
    } catch (e) {
      expect((e as errs.ValidationError).subtype).toBe("missing_required");
    }
  });

  it("非法 JSON 抛 invalid_argument", () => {
    expect(() => parseJsonBody("{bad", "data")).toThrow();
    try {
      parseJsonBody("{bad", "data");
    } catch (e) {
      expect((e as errs.ValidationError).subtype).toBe("invalid_argument");
      expect((e as errs.ValidationError).param).toBe("data");
    }
  });
});
