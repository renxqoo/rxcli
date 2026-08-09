/**
 * fallback 执行器单测
 */
import { describe, it, expect, vi } from "vitest";
import { trySources, type Source } from "../utils/fallback.js";

describe("trySources", () => {
  it("首个源成功则直接返回", async () => {
    const sources: Source<string>[] = [
      { name: "a", fetch: async () => "from-a" },
      { name: "b", fetch: async () => "from-b" },
    ];
    await expect(trySources(sources)).resolves.toBe("from-a");
  });

  it("首个源失败则回落下一个", async () => {
    const sources: Source<string>[] = [
      {
        name: "a",
        fetch: async () => {
          throw new Error("a down");
        },
      },
      { name: "b", fetch: async () => "from-b" },
    ];
    await expect(trySources(sources)).resolves.toBe("from-b");
  });

  it("全部失败时抛 NetworkError 并含诊断", async () => {
    const sources: Source<string>[] = [
      {
        name: "a",
        fetch: async () => {
          throw new Error("a down");
        },
      },
      {
        name: "b",
        fetch: async () => {
          throw new Error("b down");
        },
      },
    ];
    await expect(trySources(sources)).rejects.toThrow(/All data sources failed/);
    await expect(trySources(sources)).rejects.toThrow(/a\(a down\)/);
    await expect(trySources(sources)).rejects.toThrow(/b\(b down\)/);
  });

  it("isEmpty 判定为空的源视为失败", async () => {
    const sources: Source<string | null>[] = [
      { name: "a", fetch: async () => null },
      { name: "b", fetch: async () => "from-b" },
    ];
    await expect(trySources(sources, { isEmpty: (v) => v == null })).resolves.toBe("from-b");
  });

  it("空源列表直接抛错", async () => {
    await expect(trySources([])).rejects.toThrow(/No data sources configured/);
  });

  it("log 回调被调用(失败时)", async () => {
    const log = vi.fn();
    const sources: Source<string>[] = [
      {
        name: "a",
        fetch: async () => {
          throw new Error("a down");
        },
      },
      { name: "b", fetch: async () => "from-b" },
    ];
    await trySources(sources, { log });
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("a failed"));
    expect(log).toHaveBeenCalledWith("info", expect.stringContaining("b hit"));
  });
});
