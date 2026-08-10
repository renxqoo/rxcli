/**
 * request.ts 的测试 —— transport 层:errorOnStatus 自动 throw + 401 on401 hook。
 *
 * 验证 H3(errorOnStatus 按 subtype 隐含的 category 选构造器,覆盖全 9 类)
 * 和 H4(401 refresh 失败后不应把 401 body 当成功数据返回)。
 *
 * transport 直接 mock global fetch(不走 ctx/plugin),聚焦请求层逻辑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTransport } from "../request.js";
import {
  ValidationError,
  AuthenticationError,
  PermissionError,
  ConfigError,
  NetworkError,
  APIError,
  PolicyError,
  InternalError,
  ConfirmationRequiredError,
} from "../errs/index.js";

// mock global fetch
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("H3: errorOnStatus 按 subtype 隐含 category 选构造器(全 9 类)", () => {
  // 04-errors.md:239-246 契约:subtype 隐含 category → 自动选构造器 + exit code。
  // 修复前 throwBySubtype 只有 authorization/authentication/api 三分支,其余全 default → APIError。
  it("400 → invalid_argument(validation)→ ValidationError", async () => {
    const t = createTransport({ errorOnStatus: { 400: "invalid_argument" } });
    fetchMock.mockResolvedValue(jsonResponse(400, { message: "bad" }));
    await expect(t.get("/x")).rejects.toBeInstanceOf(ValidationError);
  });

  it("401 → no_token(authentication)→ AuthenticationError", async () => {
    const t = createTransport({ errorOnStatus: { 401: "no_token" } });
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("403 → forbidden(authorization)→ PermissionError", async () => {
    const t = createTransport({ errorOnStatus: { 403: "forbidden" } });
    fetchMock.mockResolvedValue(jsonResponse(403, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(PermissionError);
  });

  it("→ missing_config(config)→ ConfigError", async () => {
    const t = createTransport({ errorOnStatus: { 550: "missing_config" } });
    fetchMock.mockResolvedValue(jsonResponse(550, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(ConfigError);
  });

  it("→ timeout(network)→ NetworkError", async () => {
    const t = createTransport({ errorOnStatus: { 408: "timeout" } });
    fetchMock.mockResolvedValue(jsonResponse(408, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(NetworkError);
  });

  it("→ content_blocked(policy)→ PolicyError", async () => {
    const t = createTransport({ errorOnStatus: { 451: "content_blocked" } });
    fetchMock.mockResolvedValue(jsonResponse(451, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(PolicyError);
  });

  it("→ decode_failure(internal)→ InternalError", async () => {
    const t = createTransport({ errorOnStatus: { 500: "decode_failure" } });
    fetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(InternalError);
  });

  it("→ high_risk_write(confirmation)→ ConfirmationRequiredError", async () => {
    const t = createTransport({ errorOnStatus: { 422: "high_risk_write" } });
    fetchMock.mockResolvedValue(jsonResponse(422, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(ConfirmationRequiredError);
  });

  it("→ not_found(api)→ APIError(原有逻辑保留)", async () => {
    const t = createTransport({ errorOnStatus: { 404: "not_found" } });
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(APIError);
  });

  // D2/D3:04-errors.md:247 承诺"未登记 subtype 启动时校验失败",
  // 但 categoryOfSubtype 实现为运行时容错(回退 internal)。这里固化现状:
  // 未登记 subtype → category internal → InternalError(而非崩溃)。
  // 文档与实现的差距留待后续补 CI 校验;此测试确保行为可预测。
  it("D2: 未登记 subtype → 回退 internal(运行时容错,不崩)", async () => {
    const t = createTransport({ errorOnStatus: { 400: "totally_made_up_subtype" } });
    fetchMock.mockResolvedValue(jsonResponse(400, {}));
    await expect(t.get("/x")).rejects.toBeInstanceOf(InternalError);
  });

  it("错误实例携带 code(原 status)+ message + retryable", async () => {
    const t = createTransport({ errorOnStatus: { 429: "rate_limited" } });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "too many" }), {
        status: 429,
        headers: { "Retry-After": "30" },
      }),
    );
    try {
      await t.get("/x");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as APIError;
      expect(e.code).toBe(429);
      expect(e.message).toBe("too many");
      expect(e.retryable).toBe(true);
      expect(e.hint).toContain("Retry-After");
    }
  });
});

describe("H4: 401 on401 返回 null(refresh 失败)应抛 AuthenticationError,不透传 401 当数据", () => {
  it("未配置 on401/errorOnStatus 的 401 也不会作为成功响应返回", async () => {
    const t = createTransport();
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "unauthorized" }));
    await expect(t.get("/x")).rejects.toBeInstanceOf(AuthenticationError);
  });
  it("on401 返回 null + 401 响应 → 抛 AuthenticationError(token_expired)", async () => {
    // 无 errorOnStatus 配 401 时,修复前 401 body 会被当成功数据返回
    const t = createTransport({
      on401: async () => null, // refresh 失败
    });
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "expired" }));
    await expect(t.get("/x")).rejects.toBeInstanceOf(AuthenticationError);
    try {
      await t.get("/y");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as AuthenticationError;
      expect(e.subtype).toBe("token_expired");
    }
  });

  it("on401 返回 undefined 表示凭证不可刷新,保留普通 401 分类", async () => {
    const t = createTransport({ on401: async () => undefined });
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "invalid api key" }));

    await expect(t.get("/x")).rejects.toMatchObject({
      subtype: "no_token",
      message: "invalid api key",
    });
  });

  it("on401 返回新 token → 用新 token 重试一次", async () => {
    const t = createTransport({
      on401: async () => "new-token",
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const res = await t.get("/x");
    expect(res.status).toBe(200);
    // 第二次请求(fetch 的第 2 次调用)应带新 token 的 Authorization header
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallOpts = fetchMock.mock.calls[1]![1] as { headers: Record<string, string> };
    const authHeader = secondCallOpts.headers.authorization ?? secondCallOpts.headers.Authorization;
    expect(authHeader).toBe("Bearer new-token");
  });

  it("401 重试会替换大小写不同的旧 authorization header,不发送重复凭证", async () => {
    const t = createTransport({ on401: async () => "new-token" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    await t.request({ method: "GET", path: "/x", headers: { authorization: "Bearer old" } });
    const headers = (fetchMock.mock.calls[1]![1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe("Bearer new-token");
    expect(headers.Authorization).toBeUndefined();
  });

  it("401 retry reruns the configured request preparation hook", async () => {
    const beforeRetry = vi.fn(async (req: { headers?: Record<string, string> }) => {
      req.headers = { ...req.headers, "x-signature": "fresh" };
    });
    const t = createTransport({ on401: async () => "new-token", beforeRetry });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    await t.get("/x");
    expect(beforeRetry).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({
      "x-signature": "fresh",
    });
  });

  it("向已有 query 的 path 追加参数时使用 &,不会生成第二个 ?", async () => {
    const t = createTransport({ baseUrl: "https://example.test" });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await t.get("/items?fixed=1", { page: 2 });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://example.test/items?fixed=1&page=2");
  });

  it("on401 刷新成功但重试仍是 401 → 走 errorOnStatus 抛错,不当成功数据返回", async () => {
    // 回归:重试响应必须同样经过 errorOnStatus,否则重试 401 的 body 会被当 data 返回(exit 0)
    const t = createTransport({
      on401: async () => "refreshed-token",
      errorOnStatus: { 401: "token_expired" },
    });
    // 第一次 401(触发 refresh)→ 重试也 401(新 token 仍被拒)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "invalid_token" }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "invalid_token" }));
    await expect(t.get("/x")).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("请求层: 网络错误包装", () => {
  it("merges default/request headers case-insensitively", async () => {
    const t = createTransport({ defaultHeaders: { Authorization: "Bearer default" } });
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await t.request({
      method: "GET",
      path: "/x",
      headers: { authorization: "Bearer request" },
    });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(
      Object.keys(headers).filter((key) => key.toLowerCase() === "authorization"),
    ).toHaveLength(1);
    expect(headers.authorization ?? headers.Authorization).toBe("Bearer request");
  });

  it("fetch reject → NetworkError(retryable)", async () => {
    const t = createTransport();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(t.get("/x")).rejects.toBeInstanceOf(NetworkError);
  });

  it("fetch 超时 → NetworkError(timeout subtype)", async () => {
    const t = createTransport({ timeout: 10 });
    const timeoutErr = new Error("timeout");
    timeoutErr.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeoutErr);
    try {
      await t.get("/x");
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as NetworkError;
      expect(e.subtype).toBe("timeout");
      expect(e.retryable).toBe(true);
    }
  });
});

describe("绝对 URL 不拼 baseUrl(path 是 http(s):// 开头时直连)", () => {
  it("绝对 URL 直连,不拼接 baseUrl", async () => {
    const transport = createTransport({ baseUrl: "https://api.example.com" });
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await transport.get("https://other.host.com/data");
    // fetch 收到的 URL 应是绝对 URL 原样,不是 baseUrl + path 拼接
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toBe("https://other.host.com/data");
  });

  it("相对路径仍拼 baseUrl", async () => {
    const transport = createTransport({ baseUrl: "https://api.example.com" });
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await transport.get("/orders");
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toBe("https://api.example.com/orders");
  });
});
