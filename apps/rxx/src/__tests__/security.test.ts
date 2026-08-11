/**
 * rxx —— 安全原语测试(TDD:先写测试定标准)
 *
 * 这些测试定义了安全原语的"真理标准"——每个攻击向量都有用例。
 * security.ts 是所有安全检查的唯一来源,消除 validate.ts/validator.ts 的双份维护。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPrivateHost,
  isSafePathSegment,
  isDangerousKey,
  safeObjectFrom,
  safeGetField,
  assertSafeServiceName,
  InvalidServiceNameError,
  isSafeServiceName,
  assertSafeHost,
  type SafeHostOptions,
} from "../security.js";
import { removeService, isInstalled } from "../registry.js";
import { removeShim } from "../shim.js";
import { removeSkill } from "../skill-gen.js";

// ============================================================================
// SSRF:isPrivateHost(覆盖所有已知绕过)
// ============================================================================

describe("isPrivateHost", () => {
  // 应该拦截的
  const blocked = [
    "127.0.0.1",
    "127.0.0.0",
    "127.255.255.255",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // AWS metadata
    "169.254.0.1",
    "0.0.0.0",
    "0.0.0.1",
    "::1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    // IPv4-mapped IPv6(C1 攻击向量)
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
    "::ffff:192.168.1.1",
    // 字面量变体
    "localhost",
    "[::1]",
    "[::]",
    "[::ffff:127.0.0.1]",
  ];
  for (const h of blocked) {
    it(`blocks ${h}`, () => {
      expect(isPrivateHost(h)).toBe(true);
    });
  }

  // 应该放行的
  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "example.com",
    "api.example.com",
    "2606:4700:4700::1111", // Cloudflare public
    "2001:4860:4860::8888", // Google public
  ];
  for (const h of allowed) {
    it(`allows ${h}`, () => {
      expect(isPrivateHost(h)).toBe(false);
    });
  }

  // —— TDD:整数/十六进制/八进制 IPv4 编码绕过 ——
  // 这些形式绕过纯字符串正则,Node 的 URL 也不解析,需显式处理
  describe("非点分 IPv4 编码绕过", () => {
    it("拦截十进制整数 IPv4 (2130706433 = 127.0.0.1)", () => {
      expect(isPrivateHost("2130706433")).toBe(true);
    });
    it("拦截十六进制 IPv4 (0x7f000001 = 127.0.0.1)", () => {
      expect(isPrivateHost("0x7f000001")).toBe(true);
    });
    it("拦截八进制 IPv4 (0177.0.0.1 = 127.0.0.1)", () => {
      expect(isPrivateHost("0177.0.0.1")).toBe(true);
    });
    it("拦截混合 hex 段 (0x7f.0.0.1 = 127.0.0.1)", () => {
      expect(isPrivateHost("0x7f.0.0.1")).toBe(true);
    });
    it("放行公网十进制 (134744072 = 8.8.8.8)", () => {
      expect(isPrivateHost("134744072")).toBe(false);
    });
  });

  describe("超范围 octet", () => {
    it("999.999.999.999 不被当成有效 IPv4(放行,不误判私有)", () => {
      // 当前正则 /^\d{1,3}(\.\d{1,3}){3}$/ 接受,但 BlockList 行为未定义。
      // 期望:要么判定为非法(不私有),要么解析后判定。不能误判为私有导致阻断合法请求。
      // 999.999.999.999 不是真实 IP,应放行(不私有)而非崩溃。
      expect(isPrivateHost("999.999.999.999")).toBe(false);
    });
  });
});

// ============================================================================
// DNS rebinding 防护:assertSafeHost(fetch 前解析+校验)
// ============================================================================

describe("assertSafeHost", () => {
  // 可注入 lookup 实现,便于测试 DNS rebinding 场景
  const opts = (lookup: (h: string) => Promise<string[]>): SafeHostOptions => ({
    allowPrivateEndpoints: false,
    lookup,
  });

  it("公网域名 + 解析公网 IP → 通过", async () => {
    await expect(
      assertSafeHost(
        "example.com",
        opts(async () => ["93.184.216.34"]),
      ),
    ).resolves.toBeUndefined();
  });

  it("公网域名 + 解析到内网 IP → 拒绝(DNS rebinding)", async () => {
    await expect(
      assertSafeHost(
        "evil.com",
        opts(async () => ["169.254.169.254"]),
      ),
    ).rejects.toThrow();
  });

  it("公网域名 + 解析到 127.0.0.1 → 拒绝", async () => {
    await expect(
      assertSafeHost(
        "evil.com",
        opts(async () => ["127.0.0.1"]),
      ),
    ).rejects.toThrow();
  });

  it("解析到多个 IP,任一为内网 → 拒绝", async () => {
    await expect(
      assertSafeHost(
        "evil.com",
        opts(async () => ["8.8.8.8", "10.0.0.1"]),
      ),
    ).rejects.toThrow();
  });

  it("allowPrivateEndpoints=true → 内网 IP 也通过", async () => {
    await expect(
      assertSafeHost("evil.com", {
        allowPrivateEndpoints: true,
        lookup: async () => ["127.0.0.1"],
      }),
    ).resolves.toBeUndefined();
  });

  it("DNS 解析失败(lookup reject)→ 抛错(不确定时不放行)", async () => {
    await expect(
      assertSafeHost(
        "nonexistent.invalid",
        opts(async () => Promise.reject(new Error("ENOTFOUND"))),
      ),
    ).rejects.toThrow();
  });

  it("DNS 解析返回空数组 → 抛错", async () => {
    await expect(
      assertSafeHost(
        "empty.com",
        opts(async () => []),
      ),
    ).rejects.toThrow();
  });

  it("字面量 IP 主机直接用 isPrivateHost(不调 lookup)", async () => {
    let lookupCalled = false;
    await assertSafeHost(
      "127.0.0.1",
      opts(async () => {
        lookupCalled = true;
        return [];
      }),
    ).catch(() => {
      /* 预期拒绝 */
    });
    expect(lookupCalled).toBe(false);
  });
});

// ============================================================================
// path traversal:isSafePathSegment(C2 攻击向量)
// ============================================================================

describe("isSafePathSegment", () => {
  it("rejects ..", () => {
    expect(isSafePathSegment("..")).toBe(false);
  });
  it("rejects .", () => {
    expect(isSafePathSegment(".")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isSafePathSegment("")).toBe(false);
  });
  it("rejects string with /", () => {
    expect(isSafePathSegment("a/b")).toBe(false);
  });
  it("rejects string with \\", () => {
    expect(isSafePathSegment("a\\b")).toBe(false);
  });
  it("rejects pre-encoded %2e (dot)", () => {
    expect(isSafePathSegment("%2e")).toBe(false);
    expect(isSafePathSegment("%2E")).toBe(false);
  });
  it("rejects %2f (slash)", () => {
    expect(isSafePathSegment("%2f")).toBe(false);
  });
  it("allows normal value", () => {
    expect(isSafePathSegment("ord_001")).toBe(true);
    expect(isSafePathSegment("abc-123")).toBe(true);
  });
  it("allows unicode", () => {
    expect(isSafePathSegment("订单001")).toBe(true);
  });
});

// ============================================================================
// 原型链污染:isDangerousKey / safeObjectFrom / safeGetField(C3)
// ============================================================================

describe("isDangerousKey", () => {
  it("rejects __proto__", () => expect(isDangerousKey("__proto__")).toBe(true));
  it("rejects prototype", () => expect(isDangerousKey("prototype")).toBe(true));
  it("rejects constructor", () => expect(isDangerousKey("constructor")).toBe(true));
  it("allows normal key", () => expect(isDangerousKey("name")).toBe(false));
});

describe("safeObjectFrom", () => {
  it("drops dangerous keys", () => {
    const obj = safeObjectFrom([
      ["name", "x"],
      ["__proto__", { evil: true }],
      ["constructor", "bad"],
    ]);
    expect(obj).toEqual({ name: "x" });
    expect((obj as any).evil).toBeUndefined();
  });
  it("produces null-prototype object", () => {
    const obj = safeObjectFrom([["a", 1]]);
    expect(Object.getPrototypeOf(obj)).toBeNull();
  });
});

describe("safeGetField", () => {
  it("reads own property", () => {
    expect(safeGetField({ a: { b: 1 } }, "a.b")).toBe(1);
  });
  it("returns null for missing path", () => {
    expect(safeGetField({ a: 1 }, "b")).toBeNull();
  });
  it("does not traverse __proto__", () => {
    // 即使响应里有 __proto__,也不走原型链
    const obj = JSON.parse('{"a": 1, "__proto__": {"evil": true}}');
    expect(safeGetField(obj, "__proto__")).toBeNull();
    expect(safeGetField(obj, "__proto__.evil")).toBeNull();
  });
  it("returns null on non-object", () => {
    expect(safeGetField("string", "length")).toBeNull();
    expect(safeGetField(null, "a")).toBeNull();
  });
  // —— TDD:falsy 值不应被当成缺失(原 bug: cur ?? null 把 0/false/"" 变 null)——
  it("preserves falsy values (0, false, empty string)", () => {
    expect(safeGetField({ count: 0 }, "count")).toBe(0);
    expect(safeGetField({ active: false }, "active")).toBe(false);
    expect(safeGetField({ name: "" }, "name")).toBe("");
  });
  it("区分 undefined(缺失→null)和 null(显式 null→null)", () => {
    // undefined 字段视为缺失
    expect(safeGetField({ a: undefined }, "a")).toBeNull();
    // null 字段是显式值,保留 null(与缺失同结果,但语义不同:null 是数据,undefined 是无)
    expect(safeGetField({ a: null }, "a")).toBeNull();
  });
  it("嵌套路径里的 falsy 值也保留", () => {
    expect(safeGetField({ outer: { n: 0 } }, "outer.n")).toBe(0);
    expect(safeGetField({ outer: { flag: false } }, "outer.flag")).toBe(false);
  });
});

// ============================================================================
// 路径穿越:registry remove(C14 攻击向量)
// ============================================================================

describe("registry remove 路径穿越防护(C14)", () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-sec-"));
    process.env.RXX_HOME = tmpHome;
  });
  afterEach(() => {
    delete process.env.RXX_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("拒绝 ../../.. (路径穿越,抛 InvalidServiceNameError)", () => {
    expect(() => removeService("../../..")).toThrow(InvalidServiceNameError);
  });
  it("拒绝 ../foo", () => {
    expect(() => removeService("../foo")).toThrow(InvalidServiceNameError);
  });
  it("合法 name 正常工作", () => {
    // 先写一个再删(不抛错即通过)
    expect(() => removeService("valid-svc")).not.toThrow();
    expect(isInstalled("valid-svc")).toBe(false);
  });
});

// ============================================================================
// 服务名校验:isSafeServiceName / assertSafeServiceName / InvalidServiceNameError
// ============================================================================

describe("isSafeServiceName", () => {
  it("拒绝路径穿越 ../.. ", () => {
    expect(isSafeServiceName("../../..")).toBe(false);
  });
  it("拒绝 ../foo", () => {
    expect(isSafeServiceName("../foo")).toBe(false);
  });
  it("拒绝含下划线", () => {
    expect(isSafeServiceName("bad_name")).toBe(false);
  });
  it("拒绝含大写", () => {
    expect(isSafeServiceName("BadName")).toBe(false);
  });
  it("拒绝太短(单字符)", () => {
    expect(isSafeServiceName("x")).toBe(false);
  });
  it("拒绝数字开头", () => {
    expect(isSafeServiceName("1svc")).toBe(false);
  });
  it("接受合法名字", () => {
    expect(isSafeServiceName("demo-svc")).toBe(true);
    expect(isSafeServiceName("rxcrm")).toBe(true);
    expect(isSafeServiceName("a1")).toBe(true);
  });
});

describe("assertSafeServiceName", () => {
  it("非法名字抛 InvalidServiceNameError", () => {
    expect(() => assertSafeServiceName("../foo")).toThrow(InvalidServiceNameError);
    expect(() => assertSafeServiceName("bad_name")).toThrow(InvalidServiceNameError);
  });
  it("错误对象带 serviceName 属性", () => {
    try {
      assertSafeServiceName("../evil");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidServiceNameError);
      expect((e as InvalidServiceNameError).serviceName).toBe("../evil");
    }
  });
  it("合法名字不抛", () => {
    expect(() => assertSafeServiceName("good-svc")).not.toThrow();
  });
});

// ============================================================================
// 纵深防御:removeSkill / removeShim 独立校验(不依赖 removeService 先执行)
// ============================================================================

describe("removeShim 纵深防御(独立名字校验)", () => {
  it("拒绝 ../evil(不依赖 removeService 先执行)", () => {
    expect(() => removeShim("../evil")).toThrow(InvalidServiceNameError);
  });
  it("拒绝 ../../etc(路径穿越)", () => {
    expect(() => removeShim("../../etc")).toThrow(InvalidServiceNameError);
  });
  it("合法名字不抛(即使文件不存在)", () => {
    expect(() => removeShim("nonexistent-svc")).not.toThrow();
  });
});

describe("removeSkill 纵深防御(独立名字校验)", () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-skill-sec-"));
    process.env.RXX_HOME = tmpHome;
  });
  afterEach(() => {
    delete process.env.RXX_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("拒绝 ../evil(不依赖 removeService 先执行)", () => {
    expect(() => removeSkill("../evil")).toThrow(InvalidServiceNameError);
  });
  it("拒绝 ../../etc(路径穿越)", () => {
    expect(() => removeSkill("../../etc")).toThrow(InvalidServiceNameError);
  });
  it("合法名字不抛(即使目录不存在)", () => {
    expect(() => removeSkill("nonexistent-svc")).not.toThrow();
  });
});
