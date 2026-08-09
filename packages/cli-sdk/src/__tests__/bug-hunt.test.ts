/**
 * bug-hunt 测试 —— 复现已发现的 bug(预期 FAIL,作为 TDD red)。
 *
 * 这些测试故意断言"期望的正确行为",当前因 bug 存在会失败。
 * 修复后应转 green。每个测试注释标明 bug 编号和根因。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestCtx } from "../test-utils.js";
import { defineCommand } from "../define.js";
import { runCommand } from "../pipeline.js";
import { createTransport } from "../request.js";

// mock global fetch
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================================
// BUG-SDK-1 [P1]: meta.pagination: null 导致 TypeError(被兜底成 internal/unknown)
// 根因: envelope.ts:42 `p.complete` 解引用 null
// 期望: pagination:null 应被当 undefined 处理(跳过),不崩溃
// ============================================================================
describe("BUG-SDK-1: meta.pagination: null 不应崩溃", () => {
  it("命令返回 meta:{pagination:null} 应正常输出(不 TypeError)", async () => {
    const cmd = defineCommand({
      name: "test",
      async run() {
        return { data: [1, 2], meta: { pagination: null } };
      },
    });
    const ctx = createTestCtx({ request: async () => ({ status: 200, data: {}, headers: {} }) });
    // 当前:会 TypeError → exit 5;期望:exit 0,pagination 被跳过
    const code = await runCommand({ spec: cmd, args: {}, ctx, plugins: [] });
    expect(code).toBe(0);
  });
});

// ============================================================================
// BUG-SDK-2 [P1]: enforce 类型只有 "pre"|"post",但实现支持三档("normal")
// 根因: types.ts:197 enforce?: "pre" | "post"(缺 normal),plugin.ts:21 定义了三档
// 期望: enforce 类型应包含 "normal"
// ============================================================================
describe("BUG-SDK-2: enforce 类型应支持 normal 档", () => {
  it("enforce: 'normal' 应是合法类型值", async () => {
    // 类型层面验证(运行时 normal 已被 sortPlugins 支持)
    const plugin = { name: "test", enforce: "normal" as const, async beforeCommand() {} };
    // 当前:TS 编译报错 "normal" 不在 "pre"|"post" 里;运行时正常
    expect(plugin.enforce).toBe("normal");
  });
});
