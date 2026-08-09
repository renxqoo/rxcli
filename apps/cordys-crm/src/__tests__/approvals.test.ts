import { describe, it, expect } from "vitest";
import { errs } from "@renxqoo/agent-data-cli";
import { createTestCtx } from "@renxqoo/agent-data-cli";
import { approvalsCommands } from "../commands/approvals.js";

function ok(data: unknown) {
  return { code: 100200, message: null, messageDetail: null, data };
}

function captureCtx() {
  let last: { method: string; path: string; body?: unknown; query?: unknown } | null = null;
  const ctx = createTestCtx({
    request: async (opts) => {
      last = { method: opts.method, path: opts.path, body: opts.body, query: opts.query };
      if (opts.path.includes("/page")) {
        return {
          status: 200,
          data: ok({ list: [], total: 0, current: 1, pageSize: 30 }),
          headers: {},
        };
      }
      return { status: 200, data: ok({ done: true }), headers: {} };
    },
  });
  return { ctx, getLast: () => last };
}

describe("approvals todo", () => {
  it("pending 走 POST /approval-todo/pending/page", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.todo.run({ kind: "pending", payload: "" }, ctx);
    expect(getLast()?.method).toBe("POST");
    expect(getLast()?.path).toBe("/approval-todo/pending/page");
  });

  it("count 走 GET /approval-todo/pending/count", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.todo.run({ kind: "count", payload: "" }, ctx);
    expect(getLast()?.method).toBe("GET");
    expect(getLast()?.path).toBe("/approval-todo/pending/count");
  });

  it("非法 kind 抛 ValidationError", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.todo.run({ kind: "invalid", payload: "" }, ctx),
    ).rejects.toMatchObject({
      subtype: "invalid_argument",
    });
  });
});

describe("approvals action", () => {
  it("缺 --yes 抛 ConfirmationRequiredError", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.action.run(
        { action: "approve", data: '{"id":"X"}', dryRun: false, yes: false },
        ctx,
      ),
    ).rejects.toMatchObject({ category: "confirmation" });
  });

  it("--dry-run 不发请求", async () => {
    const { ctx, getLast } = captureCtx();
    const result = await approvalsCommands.action.run(
      { action: "approve", data: '{"id":"X"}', dryRun: true, yes: false },
      ctx,
    );
    expect(result!.data).toBeNull();
    expect(getLast()).toBeNull();
  });

  it("approve + --yes → POST /approval-action/approve", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.action.run(
      { action: "approve", data: '{"id":"X"}', dryRun: false, yes: true },
      ctx,
    );
    expect(getLast()?.path).toBe("/approval-action/approve");
  });
});

describe("approvals flow", () => {
  it("page → POST /approval-flow/page", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(
      { action: "page", arg: "", payload: "", dryRun: false, yes: false },
      ctx,
    );
    expect(getLast()?.path).toBe("/approval-flow/page");
  });

  it("enable F1 → GET /approval-flow/enable/F1?enable=true", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(
      { action: "enable", arg: "F1", payload: "", dryRun: false, yes: false },
      ctx,
    );
    expect(getLast()?.method).toBe("GET");
    expect(getLast()?.path).toBe("/approval-flow/enable/F1?enable=true");
  });

  it("disable F1 → /enable/F1?enable=false", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(
      { action: "disable", arg: "F1", payload: "", dryRun: false, yes: false },
      ctx,
    );
    expect(getLast()?.path).toBe("/approval-flow/enable/F1?enable=false");
  });

  it("by-form → GET /approval-flow/get-by-form-type/{formType}", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(
      { action: "by-form", arg: "CONTRACT", payload: "", dryRun: false, yes: false },
      ctx,
    );
    expect(getLast()?.path).toBe("/approval-flow/get-by-form-type/CONTRACT");
  });

  it("setting → GET /approval-flow/status-permission/setting/{formType}", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(
      { action: "setting", arg: "ORDER", payload: "", dryRun: false, yes: false },
      ctx,
    );
    expect(getLast()?.path).toBe("/approval-flow/status-permission/setting/ORDER");
  });

  it("缺 arg 抛 missing_required", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.flow.run(
        { action: "enable", arg: "", payload: "", dryRun: false, yes: false },
        ctx,
      ),
    ).rejects.toMatchObject({ subtype: "missing_required" });
  });
});

describe("approvals resource", () => {
  it("push → POST /approval-resource/push", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.resource.run({ action: "push", arg: '{"resourceId":"R1"}' }, ctx);
    expect(getLast()?.method).toBe("POST");
    expect(getLast()?.path).toBe("/approval-resource/push");
  });

  it("simple-detail → GET /approval-resource/simple-detail/{id}", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.resource.run({ action: "simple-detail", arg: "R1" }, ctx);
    expect(getLast()?.method).toBe("GET");
    expect(getLast()?.path).toBe("/approval-resource/simple-detail/R1");
  });

  it("simple-detail 缺 arg 抛 missing_required", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.resource.run({ action: "simple-detail", arg: "" }, ctx),
    ).rejects.toBeInstanceOf(errs.ValidationError);
  });
});
