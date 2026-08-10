import { describe, expect, it, vi } from "vitest";
import { createContext } from "../context.js";
import type { Plugin, TransportResponse } from "../types.js";

function brokenObserver(): Plugin {
  return {
    name: "broken-observer",
    async afterRequest() {
      throw new Error("observer crashed");
    },
  };
}

describe("request observer isolation", () => {
  it("does not mask the original transport error", async () => {
    const original = new Error("request failed");
    const warn = vi.fn();
    const ctx = createContext({
      state: {},
      plugins: [brokenObserver()],
      log: { info: vi.fn(), warn, error: vi.fn() },
      transport: {
        async request(): Promise<TransportResponse> {
          throw original;
        },
      },
    });

    await expect(ctx.get("/orders")).rejects.toBe(original);
    expect(warn).toHaveBeenCalledWith("afterRequest hook failed: observer crashed");
  });

  it("does not turn a successful request into a failure", async () => {
    const ctx = createContext({
      state: {},
      plugins: [brokenObserver()],
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      transport: {
        async request<T>(): Promise<TransportResponse<T>> {
          return { status: 200, data: { ok: true } as T, headers: {} };
        },
      },
    });

    await expect(ctx.get("/orders")).resolves.toMatchObject({ status: 200 });
  });
});
