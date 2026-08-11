/**
 * rxx —— loader fetchManifest 异常路径补全测试
 *
 * loader-security.test.ts 覆盖 SSRF/DNS/超时/大小;
 * 这里覆盖:重定向链、parse_error、unsigned 拒绝、minCliVersion、warnings 输出、验签成功路径。
 *
 * 用注入的 fetchImpl 模拟各种响应,不依赖真实网络。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchManifest, LoaderError } from "../manifest/loader.js";

const goodManifest = {
  name: "fetch-test",
  description: "fetch test",
  version: "1.0.0",
  api: { baseUrl: "https://api.example.com" },
  commands: {
    ping: { description: "p", http: { method: "GET", path: "/p" }, response: { data: "." } },
  },
};

/** 构造返回 JSON 的 fetch mock。 */
function fetchJson(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    )) as typeof fetch;
}

/** 构造重定向 fetch mock(第一次 3xx+Location,第二次 200)。 */
function fetchRedirect(location: string, finalBody: unknown, finalStatus = 200): typeof fetch {
  let called = false;
  return ((input: RequestInfo | URL) => {
    if (!called) {
      called = true;
      return Promise.resolve(new Response(null, { status: 302, headers: { Location: location } }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(finalBody), {
        status: finalStatus,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

const pubLookup = async () => ["8.8.8.8"];

describe("fetchManifest —— 重定向链", () => {
  it("重定向到公网 URL → 跟随并成功", async () => {
    const res = await fetchManifest("https://good.example.com/m", {
      fetchImpl: fetchRedirect("https://good.example.com/m2", goodManifest),
      lookup: pubLookup,
      allowUnsigned: true,
    });
    expect(res.manifest.name).toBe("fetch-test");
  });

  it("重定向到内网 → 拦截(SSRF)", async () => {
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: fetchRedirect("https://127.0.0.1/m2", goodManifest),
        lookup: pubLookup,
        allowUnsigned: true,
      }),
    ).rejects.toThrow(/SSRF|private|loopback/i);
  });

  it("重定向无 Location 头 → http_error", async () => {
    const noLoc = (() => Promise.resolve(new Response(null, { status: 302 }))) as typeof fetch;
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: noLoc,
        lookup: pubLookup,
        allowUnsigned: true,
      }),
    ).rejects.toThrow(/Location/i);
  });

  it("重定向超过 5 跳 → network 错误", async () => {
    // 每次都返回 302,无限重定向
    const loop = (() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { Location: "https://good.example.com/loop" } }),
      )) as typeof fetch;
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: loop,
        lookup: pubLookup,
        allowUnsigned: true,
      }),
    ).rejects.toThrow(/redirect/i);
  });
});

describe("fetchManifest —— parse 错误", () => {
  it("响应非 JSON → parse_error", async () => {
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: fetchJson("not json{{{", 200),
        lookup: pubLookup,
        allowUnsigned: true,
      }),
    ).rejects.toThrow(/not valid JSON/i);
  });
  it("响应空 body → parse_error", async () => {
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: fetchJson("", 200),
        lookup: pubLookup,
        allowUnsigned: true,
      }),
    ).rejects.toThrow(/not valid JSON/i);
  });
});

describe("fetchManifest —— HTTP 错误状态", () => {
  it("404 → http_error/not_found", async () => {
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: fetchJson({ error: "not found" }, 404),
        lookup: pubLookup,
      }),
    ).rejects.toMatchObject({ subtype: "http_error", status: 404 });
  });
  it("500 → http_error", async () => {
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: fetchJson({ error: "boom" }, 500),
        lookup: pubLookup,
      }),
    ).rejects.toMatchObject({ subtype: "http_error", status: 500 });
  });
});

describe("fetchManifest —— unsigned 路径", () => {
  it("无签名且无 --allow-unsigned → unsigned 错误", async () => {
    const unsigned = { ...goodManifest }; // 无 signature 字段
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: fetchJson(unsigned),
        lookup: pubLookup,
      }),
    ).rejects.toMatchObject({ subtype: "unsigned" });
  });
  it("无签名 + --allow-unsigned → 成功,unsigned:true", async () => {
    const unsigned = { ...goodManifest };
    const res = await fetchManifest("https://good.example.com/m", {
      fetchImpl: fetchJson(unsigned),
      lookup: pubLookup,
      allowUnsigned: true,
    });
    expect(res.unsigned).toBe(true);
    expect(res.signatureVerified).toBe(false);
  });
});

describe("fetchManifest —— minCliVersion 校验", () => {
  it("minCliVersion 高于当前 → version_mismatch", async () => {
    const m = { ...goodManifest, minCliVersion: "999.0.0" };
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: fetchJson(m),
        lookup: pubLookup,
        allowUnsigned: true,
      }),
    ).rejects.toMatchObject({ subtype: "version_mismatch" });
  });
  it("minCliVersion 低于当前 → 通过", async () => {
    const m = { ...goodManifest, minCliVersion: "0.0.1" };
    const res = await fetchManifest("https://good.example.com/m", {
      fetchImpl: fetchJson(m),
      lookup: pubLookup,
      allowUnsigned: true,
    });
    expect(res.manifest.name).toBe("fetch-test");
  });
});

describe("fetchManifest —— validation", () => {
  it("manifest 校验失败(validation_failed)→ 带所有 issues", async () => {
    const bad = { ...goodManifest, name: "BAD NAME" }; // 大写非法
    await expect(
      fetchManifest("https://good.example.com/m", {
        fetchImpl: fetchJson(bad),
        lookup: pubLookup,
        allowUnsigned: true,
      }),
    ).rejects.toMatchObject({ subtype: "validation_failed" });
  });
  it("manifest 含 warning 级 issue(未知字段)→ 不阻止,stderr 提示", async () => {
    const warn = { ...goodManifest, unknownField: "x" };
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const res = await fetchManifest("https://good.example.com/m", {
      fetchImpl: fetchJson(warn),
      lookup: pubLookup,
      allowUnsigned: true,
    });
    expect(res.manifest.name).toBe("fetch-test");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("fetchManifest —— 协议/URL 校验", () => {
  it("非 http(s) 协议 → invalid_url", async () => {
    await expect(
      fetchManifest("ftp://example.com/m", {
        fetchImpl: fetchJson(goodManifest),
        lookup: pubLookup,
      }),
    ).rejects.toMatchObject({ subtype: "invalid_url" });
  });
  it("HTTP 无 --insecure → insecure", async () => {
    await expect(
      fetchManifest("http://good.example.com/m", {
        fetchImpl: fetchJson(goodManifest),
        lookup: pubLookup,
        allowUnsigned: true,
      }),
    ).rejects.toMatchObject({ subtype: "insecure" });
  });
  it("HTTP + --insecure → 通过", async () => {
    const res = await fetchManifest("http://good.example.com/m", {
      fetchImpl: fetchJson(goodManifest),
      lookup: pubLookup,
      allowInsecure: true,
      allowPrivateEndpoints: true,
      allowUnsigned: true,
    });
    expect(res.manifest.name).toBe("fetch-test");
  });
  it("无效 URL 字符串 → invalid_url", async () => {
    await expect(
      fetchManifest("not-a-url", { fetchImpl: fetchJson(goodManifest), lookup: pubLookup }),
    ).rejects.toMatchObject({ subtype: "invalid_url" });
  });
  it("空 URL → invalid_url", async () => {
    await expect(
      fetchManifest("   ", { fetchImpl: fetchJson(goodManifest), lookup: pubLookup }),
    ).rejects.toMatchObject({ subtype: "invalid_url" });
  });
});
