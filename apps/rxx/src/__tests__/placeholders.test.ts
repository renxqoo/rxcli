import { describe, it, expect } from "vitest";
import { fillPath, fillMap, fillBody, PlaceholderError } from "../executor/placeholders.js";

describe("fillPath", () => {
  it("替换单个占位符", () => {
    expect(fillPath("/orders/{id}", { id: "ord_001" })).toBe("/orders/ord_001");
  });

  it("替换多个占位符", () => {
    expect(fillPath("/a/{x}/b/{y}", { x: "1", y: "2" })).toBe("/a/1/b/2");
  });

  it("encodeURIComponent 特殊字符", () => {
    expect(fillPath("/q/{q}", { q: "hello world&foo=bar" })).toBe("/q/hello%20world%26foo%3Dbar");
  });

  it("缺失参数抛错", () => {
    expect(() => fillPath("/orders/{id}", {})).toThrow(PlaceholderError);
    expect(() => fillPath("/orders/{id}", { id: null })).toThrow(PlaceholderError);
  });

  // —— 安全关键:path traversal 防护(用 isSafePathSegment)——
  it("拒绝含 / 的 path 参数(path traversal)", () => {
    expect(() => fillPath("/orders/{id}", { id: "../../etc/passwd" })).toThrow(PlaceholderError);
    expect(() => fillPath("/orders/{id}", { id: "a/b" })).toThrow(PlaceholderError);
  });

  it("拒绝 .. (目录跳转)", () => {
    expect(() => fillPath("/orders/{id}", { id: ".." })).toThrow(PlaceholderError);
  });

  it("拒绝 . (当前目录)", () => {
    expect(() => fillPath("/orders/{id}", { id: "." })).toThrow(PlaceholderError);
  });

  it("拒绝空串 → 错误信息提示空值(非 path traversal)", () => {
    try {
      fillPath("/orders/{id}", { id: "" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PlaceholderError);
      expect((e as Error).message).toMatch(/empty/i);
      expect((e as Error).message).not.toMatch(/traversal/i);
    }
  });

  it("拒绝纯空格(AI 复制粘贴常见错误)", () => {
    expect(() => fillPath("/orders/{id}", { id: "   " })).toThrow(PlaceholderError);
  });

  it("拒绝带前后空格的值(AI 复制错误)→ 提示 trim", () => {
    expect(() => fillPath("/orders/{id}", { id: " ord_001 " })).toThrow(PlaceholderError);
  });

  it("拒绝裸引号包裹的值(AI 常把引号当代码传)", () => {
    expect(() => fillPath("/orders/{id}", { id: "'ord_001'" })).toThrow(PlaceholderError);
    expect(() => fillPath("/orders/{id}", { id: '"ord_001"' })).toThrow(PlaceholderError);
  });

  it("拒绝预编码 %2e (绕过尝试)", () => {
    expect(() => fillPath("/orders/{id}", { id: "%2e%2e" })).toThrow(PlaceholderError);
  });
});

describe("fillMap", () => {
  it("替换并省略空值", () => {
    expect(fillMap({ limit: "{limit}", cursor: "{cursor}" }, { limit: 10 })).toEqual({
      limit: "10",
    });
  });

  it("多占位符替换", () => {
    expect(fillMap({ q: "{a}+{b}", lang: "{lang}" }, { a: "x", b: "y", lang: "zh" })).toEqual({
      q: "x+y",
      lang: "zh",
    });
  });

  it("非字符串值转字符串", () => {
    expect(fillMap({ n: 123 } as any, {})).toEqual({ n: "123" });
  });

  it("全空返回空对象", () => {
    expect(fillMap({ a: "{x}" }, {})).toEqual({});
  });
});

describe("fillBody", () => {
  it("替换字符串占位符", () => {
    expect(fillBody({ name: "{name}", price: "{price}" }, { name: "Widget", price: 990 })).toEqual({
      name: "Widget",
      price: "990",
    });
  });

  it("不含占位符的字符串原样保留", () => {
    expect(fillBody({ fixed: "abc" }, {})).toEqual({ fixed: "abc" });
  });

  it("非 string 值原样保留(数字/布尔/null)", () => {
    expect(fillBody({ n: 123, b: true, z: null }, {})).toEqual({ n: 123, b: true, z: null });
  });

  it("含占位符但缺失 → 省略该键", () => {
    expect(fillBody({ a: "{x}" }, {})).toEqual({});
  });

  it("部分缺失只省略缺失的键", () => {
    expect(fillBody({ a: "{x}", b: "{y}" }, { x: "1" })).toEqual({ a: "1" });
  });

  it("支持多个占位符在同一字符串里", () => {
    expect(fillBody({ q: "{a}+{b}" }, { a: "x", b: "y" })).toEqual({ q: "x+y" });
  });

  // —— TDD 新行为:hyphen 参数名 ——
  it("支持 hyphen 参数名 {my-arg}", () => {
    expect(fillBody({ name: "{my-arg}" }, { "my-arg": "v" })).toEqual({ name: "v" });
  });

  it("hyphen 参数名缺失 → 省略", () => {
    expect(fillBody({ name: "{my-arg}" }, {})).toEqual({});
  });

  // —— TDD 新行为:嵌套对象 ——
  it("递归替换嵌套对象里的字符串占位符", () => {
    expect(fillBody({ outer: { inner: "{x}", fixed: "ok" } }, { x: "v" })).toEqual({
      outer: { inner: "v", fixed: "ok" },
    });
  });

  it("嵌套对象里占位符缺失 → 省略该嵌套键", () => {
    expect(fillBody({ outer: { inner: "{x}" } }, {})).toEqual({ outer: {} });
  });

  it("递归替换嵌套数组里的字符串占位符", () => {
    expect(fillBody({ tags: ["{a}", "{b}", "fixed"] }, { a: "x", b: "y" })).toEqual({
      tags: ["x", "y", "fixed"],
    });
  });

  it("嵌套数组里占位符缺失 → 该元素省略(数组收缩)", () => {
    expect(fillBody({ tags: ["{a}", "{b}"] }, { a: "x" })).toEqual({ tags: ["x"] });
  });

  it("深层嵌套(对象套对象套数组)", () => {
    expect(fillBody({ l1: { l2: [{ k: "{v}" }, { k2: 1 }] } }, { v: "deep" })).toEqual({
      l1: { l2: [{ k: "deep" }, { k2: 1 }] },
    });
  });

  it("嵌套对象里的非 string 值原样保留", () => {
    expect(fillBody({ outer: { n: 1, b: false, obj: { z: 0 } } }, {})).toEqual({
      outer: { n: 1, b: false, obj: { z: 0 } },
    });
  });

  it("空模板返回空对象", () => {
    expect(fillBody({}, { x: 1 })).toEqual({});
  });

  it("不修改输入模板", () => {
    const template = { a: "{x}", outer: { inner: "{y}" } };
    fillBody(template, { x: "1", y: "2" });
    expect(template).toEqual({ a: "{x}", outer: { inner: "{y}" } });
  });
});
