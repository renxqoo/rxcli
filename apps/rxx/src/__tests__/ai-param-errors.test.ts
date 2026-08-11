/**
 * rxx —— AI 参数错误回归测试(fuzz 场景固化)
 *
 * 这些测试来自真实 fuzz:模拟 AI agent 在调用动态服务时会犯的高频参数错误。
 * 每个 case 对应一个已修复的真实问题,锁定期望的精确错误响应(让 AI 能据此自我纠正)。
 *
 * 前置:之前这些错误要么放行到 server 返回混乱结果(connection_refused/全部数据),
 * 要么错误信息误导(空串叫 path traversal)。现在都在 client 侧精确拦截。
 */

import { describe, it, expect } from "vitest";
import { createTestCtx } from "@renxqoo/agent-data-cli";
import { manifestToCommand } from "../executor/dynamic-command.js";
import type { ManifestCommand } from "../manifest/schema.js";

const noopCtx = createTestCtx({ request: async () => ({ status: 200, data: [] }) });

// 模拟带约束的 list 命令(分页场景,limit 1-100 整数)
const listCmd: ManifestCommand = {
  description: "list",
  args: { limit: { type: "number", min: 1, max: 100, desc: "limit" } },
  http: { method: "GET", path: "/items", query: { limit: "{limit}" } },
  response: { data: "." },
};
// 模拟 get 命令(path 参数)
const getCmd: ManifestCommand = {
  description: "get",
  args: { id: { type: "string", required: true, positional: true, desc: "id" } },
  http: { method: "GET", path: "/items/{id}" },
  response: { data: "." },
};

describe("AI 参数错误 —— 数值范围(AI 高频传错 limit)", () => {
  it("超大数(精度丢失)→ out_of_range + param + 精确值", () => {
    const cmd = manifestToCommand("list", listCmd);
    return expect(cmd.run({ limit: 999999999999999999999 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });
  it("负数 → out_of_range + message 含 >= 1", () => {
    const cmd = manifestToCommand("list", listCmd);
    return expect(cmd.run({ limit: -5 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });
  it("0(< min:1)→ out_of_range", () => {
    const cmd = manifestToCommand("list", listCmd);
    return expect(cmd.run({ limit: 0 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });
  it("小数(默认必须整数)→ out_of_range", () => {
    const cmd = manifestToCommand("list", listCmd);
    return expect(cmd.run({ limit: 3.5 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });
  it("超过 max → out_of_range + message 含 <= 100", () => {
    const cmd = manifestToCommand("list", listCmd);
    return expect(cmd.run({ limit: 101 }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });
  it("Infinity → out_of_range(非有限)", () => {
    const cmd = manifestToCommand("list", listCmd);
    return expect(cmd.run({ limit: Infinity }, noopCtx as any)).rejects.toMatchObject({
      subtype: "out_of_range",
      param: "limit",
    });
  });
});

describe("AI 参数错误 —— path 参数(AI 复制粘贴常见错误)", () => {
  it("空串 → 精确提示 empty(非 path traversal)", async () => {
    const cmd = manifestToCommand("get", getCmd);
    try {
      await cmd.run({ id: "" }, noopCtx as any);
      throw new Error("should throw");
    } catch (e: any) {
      expect(e.subtype).toBe("missing_required");
      expect(e.message).toMatch(/empty/i);
      expect(e.message).not.toMatch(/traversal/i);
    }
  });
  it("纯空格 → 提示 all whitespace", async () => {
    const cmd = manifestToCommand("get", getCmd);
    try {
      await cmd.run({ id: "   " }, noopCtx as any);
      throw new Error("should throw");
    } catch (e: any) {
      expect(e.message).toMatch(/whitespace/i);
    }
  });
  it("前后空格 → 提示 trim(含原值)", async () => {
    const cmd = manifestToCommand("get", getCmd);
    try {
      await cmd.run({ id: " ord_001 " }, noopCtx as any);
      throw new Error("should throw");
    } catch (e: any) {
      expect(e.message).toMatch(/whitespace/i);
      expect(e.message).toContain("ord_001");
    }
  });
  it("单引号包裹 → 提示 remove quotes", async () => {
    const cmd = manifestToCommand("get", getCmd);
    try {
      await cmd.run({ id: "'ord_001'" }, noopCtx as any);
      throw new Error("should throw");
    } catch (e: any) {
      expect(e.message).toMatch(/quotes/i);
    }
  });
  it("双引号包裹 → 提示 remove quotes", async () => {
    const cmd = manifestToCommand("get", getCmd);
    try {
      await cmd.run({ id: '"ord_001"' }, noopCtx as any);
      throw new Error("should throw");
    } catch (e: any) {
      expect(e.message).toMatch(/quotes/i);
    }
  });
  it("path traversal 仍被拦(../etc)→ traversal 提示", async () => {
    const cmd = manifestToCommand("get", getCmd);
    try {
      await cmd.run({ id: "../etc/passwd" }, noopCtx as any);
      throw new Error("should throw");
    } catch (e: any) {
      expect(e.message).toMatch(/traversal|safe path/i);
    }
  });
});

describe("AI 参数错误 —— 正常值不被误伤", () => {
  it("合法 limit(50)→ 正常请求", () => {
    const cmd = manifestToCommand("list", listCmd);
    return expect(cmd.run({ limit: 50 }, noopCtx as any)).resolves.toBeDefined();
  });
  it("合法 id(ord_001)→ 正常请求", () => {
    const cmd = manifestToCommand("get", getCmd);
    return expect(cmd.run({ id: "ord_001" }, noopCtx as any)).resolves.toBeDefined();
  });
  it("id 含合法特殊字符(下划线/连字符/数字)→ 正常", () => {
    const cmd = manifestToCommand("get", getCmd);
    return expect(cmd.run({ id: "ord_001-v2" }, noopCtx as any)).resolves.toBeDefined();
  });
});
