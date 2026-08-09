/**
 * rxcordys bug-hunt 测试 —— 复现已发现的 bug(预期 FAIL,作为 TDD red)。
 *
 * 用 createTestCtx mock 请求层,模拟真实异常场景。
 * 每个测试注释标明 bug 编号和根因。
 */
import { describe, it, expect } from "vitest";
import { createTestCtx } from "@renxqoo/agent-data-cli";
import { utilCommands } from "../commands/util.js";
import { leadsCommands } from "../commands/leads.js";

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
    // 当前:throw contract_violation;期望:返回 data:null
    const result = await utilCommands.raw.run(
      { method: "GET", path: "/nonexistent", body: "" },
      ctx,
    );
    expect(result!.data).toBeNull();
  });
});

// ============================================================================
// BUG-RX-2 [中]: leads add dryRun 不校验必填字段
// 根因: add 命令的 dryRun 在字段校验之前 return,跳过了 name/phone/products 校验
// 期望: dryRun 也应校验必填字段(返回 validation 错误而非 dryRun:true)
// ============================================================================
describe("BUG-RX-2: leads add --dryRun 应校验必填字段", () => {
  it("dryRun + 空 JSON → 应报缺 name(非 dryRun:true)", async () => {
    const ctx = createTestCtx({ request: async () => ({ status: 200, data: {}, headers: {} }) });
    // 当前:dryRun 直接返回 { data:null, meta:{dryRun:true} }，不校验 name
    // 期望:报 missing_required(name)
    await expect(
      leadsCommands.add.run({ data: "{}", dryRun: true, yes: false }, ctx),
    ).rejects.toMatchObject({ subtype: "missing_required", param: "name" });
  });
});
