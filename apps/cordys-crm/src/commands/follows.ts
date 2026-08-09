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

import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { FOLLOW_MODULES, isOneOf } from "../constants.js";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { ensureConfirmed, assertHasId, assertHasField } from "./leads.js";

export const followsCommands: CommandGroup = defineCommands({
  /** plan:跟进计划分页查询。 */
  plan: defineCommand<{ parent: string; payload: string }>({
    name: "plan",
    description: "跟进计划分页查询(parent ∈ lead/account/opportunity)",
    args: {
      parent: {
        type: "string",
        required: true,
        positional: true,
        desc: "父模块(lead/account/opportunity)",
      },
      payload: {
        type: "string",
        positional: true,
        desc: "分页载荷(JSON 或关键词,body 含 sourceId)",
      },
    },
    async run(args, ctx) {
      assertParent(args.parent);
      const res = await ctx.post(
        `/${args.parent}/follow/plan/page`,
        buildPagePayload(args.payload),
      );
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** record:跟进记录分页查询。 */
  record: defineCommand<{ parent: string; payload: string }>({
    name: "record",
    description: "跟进记录分页查询(parent ∈ lead/account/opportunity)",
    args: {
      parent: {
        type: "string",
        required: true,
        positional: true,
        desc: "父模块(lead/account/opportunity)",
      },
      payload: {
        type: "string",
        positional: true,
        desc: "分页载荷(JSON 或关键词,body 含 sourceId)",
      },
    },
    async run(args, ctx) {
      assertParent(args.parent);
      const res = await ctx.post(
        `/${args.parent}/follow/record/page`,
        buildPagePayload(args.payload),
      );
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** form:跟进计划/记录的表单定义(模块无关,统一路径)。 */
  form: defineCommand<{ type: string }>({
    name: "form",
    description: "跟进计划/记录的表单字段定义",
    args: {
      type: { type: "string", required: true, positional: true, desc: "类型(plan 或 record)" },
    },
    async run(args, ctx) {
      if (args.type !== "plan" && args.type !== "record") {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<type>",
          message: `form type must be plan or record, got "${args.type}"`,
        });
      }
      const res = await ctx.get(`/follow/${args.type}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  /** plan-add:新增跟进计划(必填 content, method, owner, type)。 */
  "plan-add": defineCommand<{ parent: string; data: string; dryRun: boolean; yes: boolean }>({
    name: "plan-add",
    description: "新增跟进计划(必填 content, method, owner, type)",
    args: {
      parent: {
        type: "string",
        required: true,
        positional: true,
        desc: "父模块(lead/account/opportunity)",
      },
      data: { type: "string", required: true, positional: true, desc: "跟进计划 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      assertParent(args.parent);
      const body = parseJsonBody(args.data, "<data>");
      for (const f of ["content", "method", "owner", "type"]) {
        assertHasField(body, "Create follow-up plan", f);
      }
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Create follow-up plan",
        "rxcordys follows plan-add <parent> '<json>' --yes",
      );
      const res = await ctx.post(`/${args.parent}/follow/plan/add`, body);
      return { data: unwrap(res) };
    },
  }),

  /** plan-update:更新跟进计划(需含 id)。 */
  "plan-update": defineCommand<{ parent: string; data: string; dryRun: boolean; yes: boolean }>({
    name: "plan-update",
    description: "更新跟进计划(需含 id + 必填字段)",
    args: {
      parent: {
        type: "string",
        required: true,
        positional: true,
        desc: "父模块(lead/account/opportunity)",
      },
      data: { type: "string", required: true, positional: true, desc: "跟进计划 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      assertParent(args.parent);
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update follow-up plan");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Update follow-up plan",
        "rxcordys follows plan-update <parent> '<json>' --yes",
      );
      const res = await ctx.post(`/${args.parent}/follow/plan/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** record-add:新增跟进记录(必填 content, followMethod, owner, type)。 */
  "record-add": defineCommand<{ parent: string; data: string; dryRun: boolean; yes: boolean }>({
    name: "record-add",
    description: "新增跟进记录(必填 content, followMethod, owner, type)",
    args: {
      parent: {
        type: "string",
        required: true,
        positional: true,
        desc: "父模块(lead/account/opportunity)",
      },
      data: { type: "string", required: true, positional: true, desc: "跟进记录 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      assertParent(args.parent);
      const body = parseJsonBody(args.data, "<data>");
      for (const f of ["content", "followMethod", "owner", "type"]) {
        assertHasField(body, "Create follow-up record", f);
      }
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Create follow-up record",
        "rxcordys follows record-add <parent> '<json>' --yes",
      );
      const res = await ctx.post(`/${args.parent}/follow/record/add`, body);
      return { data: unwrap(res) };
    },
  }),

  /** record-update:更新跟进记录(需含 id)。 */
  "record-update": defineCommand<{ parent: string; data: string; dryRun: boolean; yes: boolean }>({
    name: "record-update",
    description: "更新跟进记录(需含 id + 必填字段)",
    args: {
      parent: {
        type: "string",
        required: true,
        positional: true,
        desc: "父模块(lead/account/opportunity)",
      },
      data: { type: "string", required: true, positional: true, desc: "跟进记录 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      assertParent(args.parent);
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update follow-up record");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Update follow-up record",
        "rxcordys follows record-update <parent> '<json>' --yes",
      );
      const res = await ctx.post(`/${args.parent}/follow/record/update`, body);
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
