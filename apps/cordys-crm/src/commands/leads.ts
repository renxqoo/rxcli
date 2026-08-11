/**
 * leads —— 线索(lead)模块。
 *
 * 端点:
 *   GET    /lead/view/list          视图列表
 *   GET    /lead/{id}               详情
 *   POST   /lead/page               分页列表
 *   POST   /global/search/lead      全局搜索
 *   GET    /lead/module/form        表单定义
 *   POST   /lead/add                新增
 *   POST   /lead/update             更新(全量,需含 id + 必填)
 *   POST   /lead/batch/update       批量更新
 *   POST   /lead/transition/account 线索转客户(clueId, name)
 *   POST   /lead/transform          线索转商机(clueId, oppCreated?, oppName?)
 *   POST   /lead/follow/plan/page   跟进计划(follows 模块覆盖)
 *   POST   /lead/follow/record/page 跟进记录(follows 模块覆盖)
 */

import * as z from "zod";
import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import {
  unwrap,
  detailPath,
  unwrapPaged,
  buildPagePayload,
  pagedMeta,
  parseJsonBody,
} from "../envelope.js";

const MODULE = "lead";

export const leadsCommands: CommandGroup = defineCommands({
  list: defineCommand({
    name: "list",
    description: "线索视图列表(/{module}/view/list)",
    args: {
      schema: z.object({ opts: z.string().describe("查询参数 JSON").optional() }),
    },
    async run(ctx, { opts }) {
      const query = opts ? (JSON.parse(opts) as Record<string, unknown>) : {};
      const res = await ctx.get(`/${MODULE}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  get: defineCommand({
    name: "get",
    description: "线索详情",
    args: {
      schema: z.object({ id: z.string().describe("线索 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(MODULE, id));
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand({
    name: "page",
    description: "线索分页列表(带筛选/排序/关键词)",
    args: {
      schema: z.object({ payload: z.string().describe("分页载荷(JSON 或关键词)").optional() }),
      pos: ["payload"],
    },
    async run(ctx, { payload }) {
      const res = await ctx.post(`/${MODULE}/page`, buildPagePayload(payload));
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  search: defineCommand({
    name: "search",
    description: "全局搜索线索",
    args: {
      schema: z.object({ payload: z.string().describe("搜索载荷(JSON 或关键词)").optional() }),
      pos: ["payload"],
    },
    async run(ctx, { payload }) {
      const res = await ctx.post(`/global/search/${MODULE}`, buildPagePayload(payload));
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  form: defineCommand({
    name: "form",
    description: "线索表单字段定义(写入前必读)",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand({
    name: "add",
    description: "新增线索(必填:name, phone, products[])",
    args: {
      schema: z.object({ data: z.string().describe("线索数据 JSON") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      // 业务字段校验(真实执行路径;--dry-run 由框架在 run 前拦截)
      assertHasField(body, "Create lead", "name");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return {
        data: unwrap(res),
        meta: { rollback: `线索创建后可通过管理界面删除` },
      };
    },
  }),

  update: defineCommand({
    name: "update",
    description: "更新线索(全量更新,需含 id + 全部必填字段)",
    args: {
      schema: z.object({ data: z.string().describe("线索数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Lead");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand({
    name: "batch-update",
    description: "批量更新线索(ids[], fieldId, fieldValue)",
    args: {
      schema: z.object({
        data: z.string().describe("批量数据 JSON(含 ids[]/fieldId/fieldValue)"),
      }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/${MODULE}/batch/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** transition:线索转客户(/lead/transition/account,必填 clueId + name)。 */
  transition: defineCommand({
    name: "transition",
    description: "线索转客户(必填 clueId, name)",
    args: {
      schema: z.object({
        data: z.string().describe('转换数据 JSON(如 {"clueId":"L1","name":"客户A"})'),
      }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasField(body, "Lead to account", "clueId");
      assertHasField(body, "Lead to account", "name");
      const res = await ctx.post(`/${MODULE}/transition/account`, body);
      return {
        data: unwrap(res),
        meta: { rollback: "转换后线索状态变更,需在管理界面手动还原" },
      };
    },
  }),

  /** transform:线索转商机(/lead/transform,必填 clueId)。 */
  transform: defineCommand({
    name: "transform",
    description: "线索转商机(必填 clueId,可选 oppCreated/oppName)",
    args: {
      schema: z.object({
        data: z
          .string()
          .describe('转换数据 JSON(如 {"clueId":"L1","oppCreated":true,"oppName":"商机X"})'),
      }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasField(body, "Lead to opportunity", "clueId");
      const res = await ctx.post(`/${MODULE}/transform`, body);
      return {
        data: unwrap(res),
        meta: { rollback: "转换后线索状态变更,需在管理界面手动还原" },
      };
    },
  }),
});

// ============================================================================
// 共享写入校验辅助(供各模块命令复用)
// ============================================================================
// 注:高危写入的 --yes 确认与 --dry-run 预览由 cli-sdk 的 write policy 接管
// (policy: { mode: "write", dryRun: true, confirmation: "required" }),
// 框架在 run 前强制校验;此处仅保留 body 结构校验辅助。

/** 校验 body 含 id 字段(更新操作)。 */
export function assertHasId(body: unknown, label: string): void {
  assertHasField(body, label, "id");
}

/** 校验 body 含指定字段。 */
export function assertHasField(body: unknown, label: string, field: string): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new errs.ValidationError({
      subtype: "invalid_argument",
      param: "<data>",
      message: `${label}: data must be a JSON object`,
    });
  }
  const obj = body as Record<string, unknown>;
  if (obj[field] === undefined || obj[field] === null || obj[field] === "") {
    throw new errs.ValidationError({
      subtype: "missing_required",
      param: field,
      message: `${label}: missing required field ${field}`,
      hint: `Provide "${field}" in the JSON`,
    });
  }
}
