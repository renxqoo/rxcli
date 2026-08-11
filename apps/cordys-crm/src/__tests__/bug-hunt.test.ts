/**
 * rxcordys bug-hunt 测试 —— 回归已修复的 bug。
 *
 * 用 createTestCtx mock 请求层,模拟真实异常场景。
 * 每个测试注释标明 bug 编号和根因。
 */
import { describe, it, expect } from "vitest";
import { createTestCtx } from "@renxqoo/agent-data-cli";
import { utilCommands } from "../commands/util.js";

// ============================================================================
// BUG-RX-1 [严重]: util raw 空响应体(200 + 空 body)→ contract_violation
// 根因: raw 命令 return { data: res.data },res.data 是 undefined(空 body)
//       → 框架判 { data: undefined } 违反契约
// 场景: Cordys 对不存在的端点返回 200 + 空 body
// 期望: raw 应处理空 body,返回 data:null
// ============================================================================
describe("BUG-RX-1: util raw 空响应体不应 contract_violation", () => {
  it("200 空 body → 应返回 data:null(非 contract_violation)", async () => {
    // 模拟 Cordys 对不存在端点返回 200 + 空 body
    const ctx = createTestCtx({
      request: async () => ({ status: 200, data: undefined, headers: {} }),
    });
    const result = await utilCommands.raw.run(ctx, { method: "GET", path: "/nonexistent" });
    expect(result!.data).toBeNull();
  });
});

// 注:原 BUG-RX-2(leads add --dryRun 应校验必填字段)已随 cli-sdk 统一 Zod 输入契约移除——
// --dry-run 现由框架在 run 前接管(仅做 Zod 参数校验 + 脱敏,不调 run),
// body 深校验改在 run 内的真实执行路径完成(见 leads.test.ts 的 add 缺 name 用例)。
