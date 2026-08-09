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
    const result = await leadsCommands.page.run({ payload: "" }, ctx);
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
    await leadsCommands.page.run({ payload: "张三" }, ctx);
    expect((captured as { keyword: string }).keyword).toBe("张三");
  });

  it("分页未拉完 complete=false 带 nextToken", async () => {
    const ctx = mockCtx([
      {
        match: (m, p) => m === "POST" && p === "/lead/page",
        data: ok({ list: [{ id: "L1" }], total: 50, current: 1, pageSize: 30 }),
      },
    ]);
    const result = await leadsCommands.page.run({ payload: "" }, ctx);
    expect(result!.meta?.pagination?.complete).toBe(false);
    expect(result!.meta?.pagination?.nextToken).toBe("2");
  });
});

describe("leads get", () => {
  it("拼路径 /lead/{id} 返回详情", async () => {
    const ctx = mockCtx([
      { match: (m, p) => m === "GET" && p === "/lead/L1", data: ok({ id: "L1", name: "线索1" }) },
    ]);
    const result = await leadsCommands.get.run({ id: "L1" }, ctx);
    expect(result!.data).toEqual({ id: "L1", name: "线索1" });
  });
});

describe("leads add", () => {
  it("缺 --yes 抛 ConfirmationRequiredError", async () => {
    await expect(
      leadsCommands.add.run({ data: '{"name":"X"}', dryRun: false, yes: false }, mockCtx([])),
    ).rejects.toMatchObject({
      category: "confirmation",
      subtype: "high_risk_write",
    });
  });

  it("--dry-run 不发请求,返回 dryRun meta", async () => {
    const result = await leadsCommands.add.run(
      { data: '{"name":"X"}', dryRun: true, yes: false },
      mockCtx([]),
    );
    expect(result!.data).toBeNull();
    expect(result!.meta?.dryRun).toBe(true);
  });

  it("--yes 发 POST /lead/add", async () => {
    let capturedBody: unknown;
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedBody = opts.body;
        return { status: 200, data: ok({ id: "L_new" }), headers: {} };
      },
    });
    const result = await leadsCommands.add.run(
      { data: '{"name":"X"}', dryRun: false, yes: true },
      ctx,
    );
    expect(capturedBody).toEqual({ name: "X" });
    expect(result!.data).toEqual({ id: "L_new" });
  });
});

describe("leads update", () => {
  it("缺 id 字段抛 ValidationError(missing_required)", async () => {
    await expect(
      leadsCommands.update.run({ data: '{"name":"X"}', dryRun: true, yes: false }, mockCtx([])),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "id" });
  });
});

describe("leads transition", () => {
  it("缺 clueId 抛 ValidationError", async () => {
    await expect(
      leadsCommands.transition.run(
        { data: '{"name":"客户A"}', dryRun: true, yes: false },
        mockCtx([]),
      ),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "clueId" });
  });

  it("缺 name 抛 ValidationError", async () => {
    await expect(
      leadsCommands.transition.run(
        { data: '{"clueId":"L1"}', dryRun: true, yes: false },
        mockCtx([]),
      ),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "name" });
  });

  it("完整字段 + --yes 发 POST /lead/transition/account", async () => {
    let capturedPath = "";
    let capturedBody: unknown;
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        capturedBody = opts.body;
        return { status: 200, data: ok({ id: "A_new" }), headers: {} };
      },
    });
    const result = await leadsCommands.transition.run(
      { data: '{"clueId":"L1","name":"客户A"}', dryRun: false, yes: true },
      ctx,
    );
    expect(capturedPath).toBe("/lead/transition/account");
    expect(capturedBody).toEqual({ clueId: "L1", name: "客户A" });
    expect(result!.data).toEqual({ id: "A_new" });
  });
});

describe("leads transform", () => {
  it("缺 clueId 抛 ValidationError", async () => {
    await expect(
      leadsCommands.transform.run(
        { data: '{"oppName":"X"}', dryRun: true, yes: false },
        mockCtx([]),
      ),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "clueId" });
  });

  it("完整字段 + --yes 发 POST /lead/transform", async () => {
    let capturedPath = "";
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return { status: 200, data: ok({ id: "O_new" }), headers: {} };
      },
    });
    await leadsCommands.transform.run(
      { data: '{"clueId":"L1","oppCreated":true,"oppName":"商机X"}', dryRun: false, yes: true },
      ctx,
    );
    expect(capturedPath).toBe("/lead/transform");
  });
});

describe("业务错误码解包", () => {
  it("code≠100200 抛 APIError", async () => {
    const ctx = mockCtx([
      {
        match: (m, p) => m === "GET" && p === "/lead/L1",
        data: { code: 100404, message: "线索不存在", messageDetail: null },
        status: 200,
      },
    ]);
    await expect(leadsCommands.get.run({ id: "L1" }, ctx)).rejects.toBeInstanceOf(errs.APIError);
  });
});
