import { describe, it, expect } from "vitest";
import { errs, createTestCtx } from "@renxqoo/agent-data-cli";
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
    await approvalsCommands.todo.run(ctx, { kind: "pending", payload: "" });
    expect(getLast()?.method).toBe("POST");
    expect(getLast()?.path).toBe("/approval-todo/pending/page");
  });

  it("count 走 GET /approval-todo/pending/count", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.todo.run(ctx, { kind: "count", payload: "" });
    expect(getLast()?.method).toBe("GET");
    expect(getLast()?.path).toBe("/approval-todo/pending/count");
  });

  it("非法 kind 抛 ValidationError", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.todo.run(ctx, { kind: "invalid", payload: "" }),
    ).rejects.toMatchObject({
      subtype: "invalid_argument",
    });
  });
});

describe("approvals action", () => {
  // 注:--dry-run / --yes 由 cli-sdk write policy 接管,直接调用 run 走真实执行路径。

  it("approve → POST /approval-action/approve", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.action.run(ctx, { action: "approve", data: '{"id":"X"}' });
    expect(getLast()?.path).toBe("/approval-action/approve");
  });

  it("非法 action 抛 ValidationError", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.action.run(ctx, { action: "bogus", data: '{"id":"X"}' }),
    ).rejects.toMatchObject({ subtype: "invalid_argument" });
  });
});

describe("approvals flow", () => {
  // flow 是读/写混合 dispatch(命令级 policy 无法对部分 action 生效),此处验证路径分发。
  it("page → POST /approval-flow/page", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(ctx, { action: "page", arg: "", payload: "" });
    expect(getLast()?.path).toBe("/approval-flow/page");
  });

  it("enable F1 → GET /approval-flow/enable/F1?enable=true", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(ctx, { action: "enable", arg: "F1", payload: "" });
    expect(getLast()?.method).toBe("GET");
    expect(getLast()?.path).toBe("/approval-flow/enable/F1?enable=true");
  });

  it("disable F1 → /enable/F1?enable=false", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(ctx, { action: "disable", arg: "F1", payload: "" });
    expect(getLast()?.path).toBe("/approval-flow/enable/F1?enable=false");
  });

  it("by-form → GET /approval-flow/get-by-form-type/{formType}", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(ctx, { action: "by-form", arg: "CONTRACT", payload: "" });
    expect(getLast()?.path).toBe("/approval-flow/get-by-form-type/CONTRACT");
  });

  it("setting → GET /approval-flow/status-permission/setting/{formType}", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.flow.run(ctx, { action: "setting", arg: "ORDER", payload: "" });
    expect(getLast()?.path).toBe("/approval-flow/status-permission/setting/ORDER");
  });

  it("缺 arg 抛 missing_required", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.flow.run(ctx, { action: "enable", arg: "", payload: "" }),
    ).rejects.toMatchObject({ subtype: "missing_required" });
  });

  it("add/update/webhook-test 已拆出 → flow 抛 invalid_argument 迁移提示", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.flow.run(ctx, { action: "add", arg: "", payload: '{"name":"flow1"}' }),
    ).rejects.toMatchObject({ subtype: "invalid_argument" });
  });
});

describe("approvals flow-add / flow-update / flow-webhook-test", () => {
  // 写操作从 flow 拆出为独立命令,各自套用 write policy(--dry-run / --yes 由框架接管)。
  it("flow-add → POST /approval-flow/add", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands["flow-add"].run(ctx, { data: '{"name":"flow1"}' });
    expect(getLast()?.method).toBe("POST");
    expect(getLast()?.path).toBe("/approval-flow/add");
  });

  it("flow-update → POST /approval-flow/update", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands["flow-update"].run(ctx, { data: '{"id":"F1"}' });
    expect(getLast()?.path).toBe("/approval-flow/update");
  });

  it("flow-webhook-test → POST /approval-flow/webhook/test", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands["flow-webhook-test"].run(ctx, { data: "{}" });
    expect(getLast()?.path).toBe("/approval-flow/webhook/test");
  });
});

describe("approvals resource", () => {
  it("push → POST /approval-resource/push", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.resource.run(ctx, { action: "push", arg: '{"resourceId":"R1"}' });
    expect(getLast()?.method).toBe("POST");
    expect(getLast()?.path).toBe("/approval-resource/push");
  });

  it("simple-detail → GET /approval-resource/simple-detail/{id}", async () => {
    const { ctx, getLast } = captureCtx();
    await approvalsCommands.resource.run(ctx, { action: "simple-detail", arg: "R1" });
    expect(getLast()?.method).toBe("GET");
    expect(getLast()?.path).toBe("/approval-resource/simple-detail/R1");
  });

  it("simple-detail 缺 arg 抛 missing_required", async () => {
    const { ctx } = captureCtx();
    await expect(
      approvalsCommands.resource.run(ctx, { action: "simple-detail", arg: "" }),
    ).rejects.toBeInstanceOf(errs.ValidationError);
  });
});
