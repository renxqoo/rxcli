/**
 * follows —— 跟进(plan 计划 / record 记录),跨 lead/account/opportunity。
 *
 * 端点(以 {parent} ∈ {lead, account, opportunity} 为例):
 *   POST   /{parent}/follow/plan/page       跟进计划分页
 *   GET    /follow/plan/module/form         跟进计划表单(模块无关)
 *   POST   /{parent}/follow/plan/add        新增计划(必填 content, method, owner, type)
 *   POST   /{parent}/follow/plan/update     更新计划
 *   POST   /{parent}/follow/record/page     跟进记录分页
 *   GET    /follow/record/module/form       跟进记录表单
 *   POST   /{parent}/follow/record/add      新增记录(必填 content, followMethod, owner, type)
 *   POST   /{parent}/follow/record/update   更新记录
 *
 * 设计:plan/record 作为命令,接受 <parent> 参数决定路径前缀;form 模块无关。
 */

import * as z from "zod";
import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { FOLLOW_MODULES, isOneOf } from "../constants.js";
import { unwrap, unwrapPaged, buildPagePayload, pagedMeta, parseJsonBody } from "../envelope.js";
import { assertHasId, assertHasField } from "./leads.js";

const writePolicy = { mode: "write", dryRun: true, confirmation: "required" } as const;

export const followsCommands: CommandGroup = defineCommands({
  /** plan:跟进计划分页查询。 */
  plan: defineCommand({
    name: "plan",
    description: "跟进计划分页查询(parent ∈ lead/account/opportunity)",
    args: {
      schema: z.object({
        parent: z.string().describe("父模块(lead/account/opportunity)"),
        payload: z.string().describe("分页载荷(JSON 或关键词,body 含 sourceId)").optional(),
      }),
      pos: ["parent"],
    },
    async run(ctx, { parent, payload }) {
      assertParent(parent);
      const body = buildPagePayload(payload);
      assertSourceId(body, parent, "plan");
      const res = await ctx.post(`/${parent}/follow/plan/page`, body);
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** record:跟进记录分页查询。 */
  record: defineCommand({
    name: "record",
    description: "跟进记录分页查询(parent ∈ lead/account/opportunity)",
    args: {
      schema: z.object({
        parent: z.string().describe("父模块(lead/account/opportunity)"),
        payload: z.string().describe("分页载荷(JSON 或关键词,body 含 sourceId)").optional(),
      }),
      pos: ["parent"],
    },
    async run(ctx, { parent, payload }) {
      assertParent(parent);
      const body = buildPagePayload(payload);
      assertSourceId(body, parent, "record");
      const res = await ctx.post(`/${parent}/follow/record/page`, body);
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** form:跟进计划/记录的表单定义(模块无关,统一路径)。 */
  form: defineCommand({
    name: "form",
    description: "跟进计划/记录的表单字段定义",
    args: {
      schema: z.object({ type: z.string().describe("类型(plan 或 record)") }),
      pos: ["type"],
    },
    async run(ctx, { type }) {
      if (type !== "plan" && type !== "record") {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<type>",
          message: `form type must be plan or record, got "${type}"`,
        });
      }
      const res = await ctx.get(`/follow/${type}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  /** plan-add:新增跟进计划(必填 content, method, owner, type)。 */
  "plan-add": defineCommand({
    name: "plan-add",
    description: "新增跟进计划(必填 content, method, owner, type)",
    args: {
      schema: z.object({
        parent: z.string().describe("父模块(lead/account/opportunity)"),
        data: z.string().describe("跟进计划 JSON"),
      }),
      pos: ["parent", "data"],
    },
    policy: writePolicy,
    async run(ctx, { parent, data }) {
      assertParent(parent);
      const body = parseJsonBody(data, "<data>");
      for (const f of ["content", "method", "owner", "type"]) {
        assertHasField(body, "Create follow-up plan", f);
      }
      const res = await ctx.post(`/${parent}/follow/plan/add`, body);
      return { data: unwrap(res) };
    },
  }),

  /** plan-update:更新跟进计划(需含 id)。 */
  "plan-update": defineCommand({
    name: "plan-update",
    description: "更新跟进计划(需含 id + 必填字段)",
    args: {
      schema: z.object({
        parent: z.string().describe("父模块(lead/account/opportunity)"),
        data: z.string().describe("跟进计划 JSON(含 id)"),
      }),
      pos: ["parent", "data"],
    },
    policy: writePolicy,
    async run(ctx, { parent, data }) {
      assertParent(parent);
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update follow-up plan");
      const res = await ctx.post(`/${parent}/follow/plan/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** record-add:新增跟进记录(必填 content, followMethod, owner, type)。 */
  "record-add": defineCommand({
    name: "record-add",
    description: "新增跟进记录(必填 content, followMethod, owner, type)",
    args: {
      schema: z.object({
        parent: z.string().describe("父模块(lead/account/opportunity)"),
        data: z.string().describe("跟进记录 JSON"),
      }),
      pos: ["parent", "data"],
    },
    policy: writePolicy,
    async run(ctx, { parent, data }) {
      assertParent(parent);
      const body = parseJsonBody(data, "<data>");
      for (const f of ["content", "followMethod", "owner", "type"]) {
        assertHasField(body, "Create follow-up record", f);
      }
      const res = await ctx.post(`/${parent}/follow/record/add`, body);
      return { data: unwrap(res) };
    },
  }),

  /** record-update:更新跟进记录(需含 id)。 */
  "record-update": defineCommand({
    name: "record-update",
    description: "更新跟进记录(需含 id + 必填字段)",
    args: {
      schema: z.object({
        parent: z.string().describe("父模块(lead/account/opportunity)"),
        data: z.string().describe("跟进记录 JSON(含 id)"),
      }),
      pos: ["parent", "data"],
    },
    policy: writePolicy,
    async run(ctx, { parent, data }) {
      assertParent(parent);
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update follow-up record");
      const res = await ctx.post(`/${parent}/follow/record/update`, body);
      return { data: unwrap(res) };
    },
  }),
});

/** 校验 parent ∈ {lead, account, opportunity}。 */
function assertParent(parent: string): void {
  if (!isOneOf(parent, FOLLOW_MODULES)) {
    throw new errs.ValidationError({
      subtype: "invalid_argument",
      param: "<parent>",
      message: `follow parent module must be lead/account/opportunity, got "${parent}"`,
      hint: `Valid: ${FOLLOW_MODULES.join(", ")}`,
    });
  }
}

/**
 * 校验分页载荷含 sourceId。跟进按父记录维度查询,缺 sourceId 时 Cordys 服务端
 * 返回误导性的 500「没有操作权限」;在此前置为清晰的 missing_required。
 */
function assertSourceId(body: Record<string, unknown>, parent: string, kind: string): void {
  const sid = body.sourceId;
  if (sid === undefined || sid === null || sid === "") {
    throw new errs.ValidationError({
      subtype: "missing_required",
      param: "sourceId",
      message: `follows ${kind} requires sourceId (the parent ${parent} record id)`,
      hint: `Provide via payload, e.g. --payload '{"sourceId":"<id>"}'`,
    });
  }
}
