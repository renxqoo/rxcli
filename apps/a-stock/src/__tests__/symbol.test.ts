/**
 * 单元测试 —— 股票代码解析(http/cache 等需要 mock,这里测核心纯逻辑)
 */

import { describe, it, expect } from "vitest";
import { parseSymbol } from "../utils/symbol.js";
import { InvalidSymbolError } from "../utils/symbol.js";

describe("parseSymbol", () => {
  it("解析纯 6 位代码 → 自动判定市场", () => {
    expect(parseSymbol("600519")).toEqual({
      code: "600519",
      market: "sh",
      tencent: "sh600519",
      secid: "1.600519",
    });
    expect(parseSymbol("000001")).toEqual({
      code: "000001",
      market: "sz",
      tencent: "sz000001",
      secid: "0.000001",
    });
    expect(parseSymbol("300750")).toEqual({
      code: "300750",
      market: "sz",
      tencent: "sz300750",
      secid: "0.300750",
    });
    expect(parseSymbol("688981")).toEqual({
      code: "688981",
      market: "sh",
      tencent: "sh688981",
      secid: "1.688981",
    });
    expect(parseSymbol("836473")).toEqual({
      code: "836473",
      market: "bj",
      tencent: "bj836473",
      secid: "0.836473",
    });
    expect(parseSymbol("510500")).toEqual({
      code: "510500",
      market: "sh",
      tencent: "sh510500",
      secid: "1.510500",
    });
  });

  it("解析 sh/sz/bj 前缀", () => {
    expect(parseSymbol("sh600519").code).toBe("600519");
    expect(parseSymbol("sh600519").market).toBe("sh");
    expect(parseSymbol("sz000001").code).toBe("000001");
    expect(parseSymbol("bj836473").code).toBe("836473");
    expect(parseSymbol("BJ836473").code).toBe("836473"); // 大小写不敏感
  });

  it("解析 .SH/.SZ/.BJ 后缀", () => {
    expect(parseSymbol("600519.SH").code).toBe("600519");
    expect(parseSymbol("000001.sz").code).toBe("000001");
    expect(parseSymbol("836473.BJ").code).toBe("836473");
  });

  it("解析东财 secid 形态 1.600519", () => {
    expect(parseSymbol("1.600519").code).toBe("600519");
    expect(parseSymbol("1.600519").market).toBe("sh");
    expect(parseSymbol("0.000001").code).toBe("000001");
    expect(parseSymbol("0.000001").market).toBe("sz");
  });

  it("拒绝非法输入", () => {
    expect(() => parseSymbol("abc")).toThrow(InvalidSymbolError);
    expect(() => parseSymbol("12345")).toThrow(InvalidSymbolError); // 5 位
    expect(() => parseSymbol("1234567")).toThrow(InvalidSymbolError); // 7 位
    expect(() => parseSymbol("")).toThrow(InvalidSymbolError);
  });

  it("支持指数代码", () => {
    // sh000001 上证、sz399001 深证
    expect(parseSymbol("sh000001").tencent).toBe("sh000001");
    expect(parseSymbol("sz399001").tencent).toBe("sz399001");
    expect(parseSymbol("sz399006").tencent).toBe("sz399006"); // 创业板
  });

  it("去除前后空格", () => {
    expect(parseSymbol("  600519  ").code).toBe("600519");
    expect(parseSymbol(" sh600519 ").code).toBe("600519");
  });

  it("显式前缀优先于自动判定", () => {
    // 600519 默认沪市,但显式 sz 前缀强制深市
    expect(parseSymbol("sz600519").market).toBe("sz");
    expect(parseSymbol("sz600519").tencent).toBe("sz600519");
  });

  it("InvalidSymbolError 属于 validation 类别", () => {
    // 阶段3 改造:继承 ValidationError,category=validation
    const err = new InvalidSymbolError("test");
    expect(err.category).toBe("validation");
    expect(err.subtype).toBe("invalid_argument");
    expect(err.name).toBe("InvalidSymbolError");
  });
});

describe("cache.memoize", () => {
  it("基础缓存 + singleflight", async () => {
    const { memoize } = await import("../utils/cache.js");
    let calls = 0;
    const loader = memoize(async (key: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return `value-${key}`;
    }, 1000);

    const [a, b, c] = await Promise.all([loader("x"), loader("x"), loader("y")]);
    expect(calls).toBe(2); // x 一次,y 一次
    expect(a).toBe("value-x");
    expect(b).toBe("value-x");
    expect(c).toBe("value-y");

    const d = await loader("x");
    expect(calls).toBe(2); // 命中缓存
    expect(d).toBe("value-x");
  });

  it("TTL 过期后重新加载", async () => {
    const { memoize } = await import("../utils/cache.js");
    let calls = 0;
    const loader = memoize(async () => {
      calls++;
      return ++calls;
    }, 30);

    const a = await loader();
    await new Promise((r) => setTimeout(r, 60));
    const b = await loader();
    expect(a).not.toBe(b); // 过期 → 重新加载
  });
});
