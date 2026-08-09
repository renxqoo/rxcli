import { describe, it, expect } from "vitest";
import { createTestCtx, errs } from "@renxqoo/agent-data-cli";
import { recordsCommands } from "../commands/records.js";

function ok(data: unknown) {
  return { code: 100200, message: null, messageDetail: null, data };
}

describe("records view", () => {
  it("GET /{module}/view/list 返回数据", async () => {
    let capturedPath = "";
    let capturedQuery: Record<string, unknown> = {};
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        capturedQuery = opts.query ?? {};
        return { status: 200, data: ok({ list: [] }), headers: {} };
      },
    });
    await recordsCommands.view.run({ module: "lead", opts: '{"pageSize":10}' }, ctx);
    expect(capturedPath).toBe("/lead/view/list");
    expect(capturedQuery.pageSize).toBe(10);
  });

  it("不支持模块抛 ValidationError", async () => {
    const ctx = createTestCtx({ request: async () => ({ status: 200, data: {}, headers: {} }) });
    await expect(
      recordsCommands.view.run({ module: "invoice", opts: "" }, ctx),
    ).rejects.toMatchObject({
      subtype: "invalid_argument",
      param: "<module>",
    });
  });
});

describe("records get", () => {
  it("普通模块 /{module}/{id}", async () => {
    let capturedPath = "";
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return { status: 200, data: ok({ id: "A1" }), headers: {} };
      },
    });
    await recordsCommands.get.run({ module: "account", id: "A1" }, ctx);
    expect(capturedPath).toBe("/account/A1");
  });

  it("opportunity/quotation special-case 用 /get/ 前缀", async () => {
    let capturedPath = "";
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return { status: 200, data: ok({ id: "Q1" }), headers: {} };
      },
    });
    await recordsCommands.get.run({ module: "opportunity/quotation", id: "Q1" }, ctx);
    expect(capturedPath).toBe("/opportunity/quotation/get/Q1");
  });
});

describe("records page", () => {
  it("POST /{module}/page 带分页载荷", async () => {
    let capturedPath = "";
    let capturedBody: unknown;
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        capturedBody = opts.body;
        return {
          status: 200,
          data: ok({ list: [{ id: "X" }], total: 1, current: 1, pageSize: 30 }),
          headers: {},
        };
      },
    });
    const result = await recordsCommands.page.run({ module: "contract", payload: "" }, ctx);
    expect(capturedPath).toBe("/contract/page");
    expect((capturedBody as { current: number }).current).toBe(1);
    expect(result!.data).toEqual([{ id: "X" }]);
  });
});

describe("records search", () => {
  it("全局搜索 /global/search/{module}", async () => {
    let capturedPath = "";
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return {
          status: 200,
          data: ok({ list: [], total: 0, current: 1, pageSize: 30 }),
          headers: {},
        };
      },
    });
    await recordsCommands.search.run({ module: "account", payload: "测试" }, ctx);
    expect(capturedPath).toBe("/global/search/account");
  });

  it("opportunity/quotation 回退 /opportunity/quotation/page", async () => {
    let capturedPath = "";
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return {
          status: 200,
          data: ok({ list: [], total: 0, current: 1, pageSize: 30 }),
          headers: {},
        };
      },
    });
    await recordsCommands.search.run({ module: "opportunity/quotation", payload: "测试" }, ctx);
    expect(capturedPath).toBe("/opportunity/quotation/page");
  });
});

describe("records contact", () => {
  it("GET /{module}/contact/list/{id}", async () => {
    let capturedPath = "";
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return { status: 200, data: ok([]), headers: {} };
      },
    });
    await recordsCommands.contact.run({ module: "account", id: "A1" }, ctx);
    expect(capturedPath).toBe("/account/contact/list/A1");
  });

  it("不支持模块抛 ValidationError", async () => {
    const ctx = createTestCtx({ request: async () => ({ status: 200, data: {}, headers: {} }) });
    await expect(
      recordsCommands.contact.run({ module: "contract", id: "X" }, ctx),
    ).rejects.toBeInstanceOf(errs.ValidationError);
  });
});

describe("records form", () => {
  it("GET /{module}/module/form", async () => {
    let capturedPath = "";
    const ctx = createTestCtx({
      request: async (opts) => {
        capturedPath = opts.path;
        return { status: 200, data: ok({ fields: [] }), headers: {} };
      },
    });
    await recordsCommands.form.run({ module: "lead/follow/plan" }, ctx);
    expect(capturedPath).toBe("/lead/follow/plan/module/form");
  });
});
