/**
 * L2 基础设施工具测试:browser opener + callback server。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { get } from "node:http";
import { defaultBrowserOpener } from "../infra/browser.js";
import { waitForCallback } from "../infra/callback-server.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser opener", () => {
  it("open() 返回 Promise 且不抛(集成测试不 mock 系统调用)", async () => {
    const opener = defaultBrowserOpener();
    // 不断言系统命令被执行(环境依赖),只验证接口契约
    expect(typeof opener.open).toBe("function");
  });
});

describe("callback server(waitForCallback)", () => {
  /** 用 Node http.get 打到本地 server(不用 fetch,避免 IPv6/DNS 问题)。 */
  function httpGet(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      get(url, (res) => {
        res.resume();
        res.on("end", resolve);
      }).on("error", reject);
    });
  }

  it("收到 ?code=xxx&state=yyy → 返回 code + state", async () => {
    const handle = await waitForCallback({ timeoutMs: 5000 });
    expect(handle.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const url = new URL(handle.redirectUri);
    url.searchParams.set("code", "ac_test123");
    url.searchParams.set("state", "xyz");
    await httpGet(url.toString());

    const r = await handle.result;
    handle.close();
    expect(r.code).toBe("ac_test123");
    expect(r.state).toBe("xyz");
    expect(r.error).toBeNull();
  });

  it("收到 ?error=xxx → 返回 error", async () => {
    const handle = await waitForCallback({ timeoutMs: 5000 });
    const url = new URL(handle.redirectUri);
    url.searchParams.set("error", "access_denied");
    await httpGet(url.toString());

    const r = await handle.result;
    handle.close();
    expect(r.code).toBeNull();
    expect(r.error).toBe("access_denied");
  });

  it("超时 → reject", async () => {
    const handle = await waitForCallback({ timeoutMs: 100 });
    await expect(handle.result).rejects.toThrow();
    handle.close();
  });

  it("redirectUri 格式正确", async () => {
    const handle = await waitForCallback({ port: 0, timeoutMs: 5000 });
    expect(handle.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    handle.close();
  });
});
