import { describe, it, expect } from "vitest";
import { createTestCtx, errs } from "@renxqoo/agent-data-cli";
import { leadsCommands } from "../commands/leads.js";

/** mock ctx:按 method+path 返回预设响应。 */
function mockCtx(
  responses: Array<{ match: (m: string, p: string) => boolean; data: unknown; status?: number }>,
) {
  return createTestCtx({
    request: async (opts) => {
      for (const r of responses) {
        if (r.match(opts.method, opts.path)) {
          return { status: r.status ?? 200, data: r.data, headers: {} };
        }
      }
      throw new Error(`unexpected ${opts.method} ${opts.path}`);
    },
  });
}

/** 构造 Cordys 成功输出。 */
function ok(data: unknown) {
  return { code: 100200, message: null, messageDetail: null, data };
}

describe("leads page", () => {
  it("返回 list 数组 + 分页 meta", async () => {
    const ctx = mockCtx([
      {
        match: (m, p) => m === "POST" && p === "/lead/page",
        data: ok({ list: [{ id: "L1" }, { id: "L2" }], total: 2, current: 1, pageSize: 30 }),
      },
    ]);
    const result = await leadsCommands.page.run(ctx, { payload: "" });
    expect(result!.data).toEqual([{ id: "L1" }, { id: "L2" }]);
    expect(result!.meta?.pagination?.complete).toBe(true);
    expect(result!.meta?.count).toBe(2);
  });

  it("关键词字符串作为 page_payload 的 keyword", async () => {
    let captured: unknown;
    const ctx = createTestCtx({
      request: async (opts) => {
        captured = opts.body;
        return {
          status: 200,
          data: ok({ list: [], total: 0, current: 1, pageSize: 30 }),
          headers: {},
        };
      },
    });
    await leadsCommands.page.run(ctx, { payload: "张三" });
    expect((captured as { keyword: string }).keyword).toBe("张三");
  });

  it("分页未拉完 complete=false 带 nextToken", async () => {
    const ctx = mockCtx([
      {
        match: (m, p) => m === "POST" && p === "/lead/page",
        data: ok({ list: [{ id: "L1" }], total: 50, current: 1, pageSize: 30 }),
      },
    ]);
    const result = await leadsCommands.page.run(ctx, { payload: "" });
    expect(result!.meta?.pagination?.complete).toBe(false);
    expect(result!.meta?.pagination?.nextToken).toBe("2");
  });
});

describe("leads get", () => {
  it("拼路径 /lead/get/{id} 返回详情", async () => {
    const ctx = mockCtx([
      {
        match: (m, p) => m === "GET" && p === "/lead/get/L1",
        data: ok({ id: "L1", name: "线索1" }),
      },
    ]);
    const result = await leadsCommands.get.run(ctx, { id: "L1" });
    expect(result!.data).toEqual({ id: "L1", name: "线索1" });
  });
});

describe("leads add", () => {
  // 注:--dry-run / --yes 的预览与确认由 cli-sdk write policy 在 run 前接管,
  // 直接调用 run 走真实执行路径(此处只验证 run 内的业务逻辑:body 校验 + 请求)。

  it("缺 name 字段抛 ValidationError(missing_required)", async () => {
    await expect(
      leadsCommands.add.run(ctx_for_empty(), { data: '{"phone":"x"}' }),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "name" });
  });

  it("完整数据 → 发 POST /lead/add", async () => {
    let capturedBody: unknown;
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedBody = opts.body;
        return { status: 200, data: ok({ id: "L_new" }), headers: {} };
      },
    });
    const result = await leadsCommands.add.run(ctx, { data: '{"name":"X"}' });
    expect(capturedBody).toEqual({ name: "X" });
    expect(result!.data).toEqual({ id: "L_new" });
  });
});

/** 不会触发真实请求的 ctx(add 校验失败前不会发请求)。 */
function ctx_for_empty() {
  return createTestCtx({ request: async () => ({ status: 200, data: {}, headers: {} }) });
}

describe("leads update", () => {
  it("缺 id 字段抛 ValidationError(missing_required)", async () => {
    await expect(
      leadsCommands.update.run(ctx_for_empty(), { data: '{"name":"X"}' }),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "id" });
  });
});

describe("leads transition", () => {
  it("缺 clueId 抛 ValidationError", async () => {
    await expect(
      leadsCommands.transition.run(ctx_for_empty(), { data: '{"name":"客户A"}' }),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "clueId" });
  });

  it("缺 name 抛 ValidationError", async () => {
    await expect(
      leadsCommands.transition.run(ctx_for_empty(), { data: '{"clueId":"L1"}' }),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "name" });
  });

  it("完整字段 → 发 POST /lead/transition/account", async () => {
    let capturedPath = "";
    let capturedBody: unknown;
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        capturedBody = opts.body;
        return { status: 200, data: ok({ id: "A_new" }), headers: {} };
      },
    });
    const result = await leadsCommands.transition.run(ctx, {
      data: '{"clueId":"L1","name":"客户A"}',
    });
    expect(capturedPath).toBe("/lead/transition/account");
    expect(capturedBody).toEqual({ clueId: "L1", name: "客户A" });
    expect(result!.data).toEqual({ id: "A_new" });
  });
});

describe("leads transform", () => {
  it("缺 clueId 抛 ValidationError", async () => {
    await expect(
      leadsCommands.transform.run(ctx_for_empty(), { data: '{"oppName":"X"}' }),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "clueId" });
  });

  it("完整字段 → 发 POST /lead/transform", async () => {
    let capturedPath = "";
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return { status: 200, data: ok({ id: "O_new" }), headers: {} };
      },
    });
    await leadsCommands.transform.run(ctx, {
      data: '{"clueId":"L1","oppCreated":true,"oppName":"商机X"}',
    });
    expect(capturedPath).toBe("/lead/transform");
  });
});

describe("业务错误码解包", () => {
  it("code≠100200 抛 APIError", async () => {
    const ctx = mockCtx([
      {
        match: (m, p) => m === "GET" && p === "/lead/get/L1",
        data: { code: 100404, message: "线索不存在", messageDetail: null },
        status: 200,
      },
    ]);
    await expect(leadsCommands.get.run(ctx, { id: "L1" })).rejects.toBeInstanceOf(errs.APIError);
  });
});
