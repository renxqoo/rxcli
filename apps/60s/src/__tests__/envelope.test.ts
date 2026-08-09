import { describe, it, expect } from "vitest";
import { unwrap, withQuery, countMeta, JSON_QUERY } from "../envelope.js";
import { errs } from "@renxqoo/agent-data-cli";

describe("unwrap", () => {
  it("成功(code=200)返回 data", () => {
    const res = {
      status: 200,
      data: { code: 200, message: "ok", data: { date: "2026-08-09" } },
      headers: {},
    };
    expect(unwrap(res)).toEqual({ date: "2026-08-09" });
  });

  it("业务错误(code≠200)抛 APIError", () => {
    const res = {
      status: 200,
      data: { code: 404, message: "未找到相关词条", data: null },
      headers: {},
    };
    expect(() => unwrap(res)).toThrow();
    try {
      unwrap(res);
    } catch (e) {
      expect(e).toBeInstanceOf(errs.APIError);
      expect((e as errs.APIError).message).toContain("未找到相关词条");
    }
  });

  it("非标准统一输出格式(无 code)原样返回 data", () => {
    const res = { status: 200, data: { foo: "bar" }, headers: {} };
    expect(unwrap(res)).toEqual({ foo: "bar" });
  });

  it("data 为 null 时返回 null", () => {
    const res = { status: 200, data: { code: 200, data: null }, headers: {} };
    expect(unwrap(res)).toBeNull();
  });

  it("code 500 映射到 server_error subtype", () => {
    const res = { status: 500, data: { code: 500, message: "服务异常", data: null }, headers: {} };
    try {
      unwrap(res);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(errs.APIError);
      expect((e as errs.APIError).subtype).toBe("server_error");
    }
  });

  it("HTTP 500 + 上游 parse failure(Unexpected token)消息被美化", () => {
    const res = {
      status: 500,
      data: {
        code: 500,
        message: "服务器出错了... Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
        data: null,
      },
      headers: {},
    };
    try {
      unwrap(res);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(errs.APIError);
      expect((e as errs.APIError).subtype).toBe("server_error");
      expect((e as errs.APIError).message).toBe("上游服务暂时不可用(数据源异常),请稍后重试");
      expect((e as errs.APIError).retryable).toBe(true);
    }
  });

  it("HTTP 500 + 有意义的上游 message(非 parse failure)保留原文", () => {
    const res = {
      status: 500,
      data: { code: 500, message: "获取奖牌榜数据失败: 520", data: null },
      headers: {},
    };
    try {
      unwrap(res);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as errs.APIError).message).toContain("获取奖牌榜数据失败");
    }
  });

  it("HTTP 502 无 message 时给兜底提示", () => {
    const res = { status: 502, data: "Bad Gateway", headers: {} };
    try {
      unwrap(res);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(errs.APIError);
      expect((e as errs.APIError).message).toContain("HTTP 502");
    }
  });
});

describe("withQuery", () => {
  it("默认带 encoding=json", () => {
    expect(withQuery()).toEqual({ encoding: "json" });
  });

  it("合并额外参数", () => {
    expect(withQuery({ limit: 20, region: "北京" })).toEqual({
      encoding: "json",
      limit: 20,
      region: "北京",
    });
  });

  it("过滤 undefined/null 值", () => {
    expect(withQuery({ a: undefined, b: null, c: 1 })).toEqual({ encoding: "json", c: 1 });
  });

  it("JSON_QUERY 是只读常量", () => {
    expect(JSON_QUERY).toEqual({ encoding: "json" });
  });
});

describe("countMeta", () => {
  it("构造 count + complete pagination", () => {
    const meta = countMeta([1, 2, 3]);
    expect(meta.count).toBe(3);
    expect(meta.pagination?.complete).toBe(true);
    expect(meta.pagination?.items).toBe(3);
    expect(meta.pagination?.pages).toBe(1);
  });

  it("空数组 count=0", () => {
    expect(countMeta([]).count).toBe(0);
  });
});
