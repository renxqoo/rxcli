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

import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";

const MODULE = "lead";

export const leadsCommands: CommandGroup = defineCommands({
  list: defineCommand<{ opts: string }>({
    name: "list",
    description: "线索视图列表(/{module}/view/list)",
    args: { opts: { type: "string", desc: "查询参数 JSON" } },
    async run(args, ctx) {
      const query = args.opts ? (JSON.parse(args.opts) as Record<string, unknown>) : {};
      const res = await ctx.get(`/${MODULE}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  get: defineCommand<{ id: string }>({
    name: "get",
    description: "线索详情",
    args: { id: { type: "string", required: true, positional: true, desc: "线索 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand<{ payload: string }>({
    name: "page",
    description: "线索分页列表(带筛选/排序/关键词)",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  search: defineCommand<{ payload: string }>({
    name: "search",
    description: "全局搜索线索",
    args: { payload: { type: "string", positional: true, desc: "搜索载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/global/search/${MODULE}`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  form: defineCommand({
    name: "form",
    description: "线索表单字段定义(写入前必读)",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "add",
    description: "新增线索(必填:name, phone, products[])",
    args: {
      data: { type: "string", required: true, positional: true, desc: "线索数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      // 字段校验在 dryRun/confirm 之前(dryRun 也要校验必填字段)
      assertHasField(body, "Create lead", "name");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "Create lead", "rxcordys leads add '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return {
        data: unwrap(res),
        meta: { rollback: `线索创建后可通过管理界面删除` },
      };
    },
  }),

  update: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "update",
    description: "更新线索(全量更新,需含 id + 全部必填字段)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "线索数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Lead");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "Update lead", "rxcordys leads update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "batch-update",
    description: "批量更新线索(ids[], fieldId, fieldValue)",
    args: {
      data: {
        type: "string",
        required: true,
        positional: true,
        desc: "批量数据 JSON(含 ids[]/fieldId/fieldValue)",
      },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "批量更新线索", "rxcordys leads batch-update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/batch/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** transition:线索转客户(/lead/transition/account,必填 clueId + name)。 */
  transition: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "transition",
    description: "线索转客户(必填 clueId, name)",
    args: {
      data: {
        type: "string",
        required: true,
        positional: true,
        desc: '转换数据 JSON(如 {"clueId":"L1","name":"客户A"})',
      },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasField(body, "Lead to account", "clueId");
      assertHasField(body, "Lead to account", "name");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "Lead to account", "rxcordys leads transition '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/transition/account`, body);
      return {
        data: unwrap(res),
        meta: { rollback: "转换后线索状态变更,需在管理界面手动还原" },
      };
    },
  }),

  /** transform:线索转商机(/lead/transform,必填 clueId)。 */
  transform: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "transform",
    description: "线索转商机(必填 clueId,可选 oppCreated/oppName)",
    args: {
      data: {
        type: "string",
        required: true,
        positional: true,
        desc: '转换数据 JSON(如 {"clueId":"L1","oppCreated":true,"oppName":"商机X"})',
      },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasField(body, "Lead to opportunity", "clueId");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "Lead to opportunity", "rxcordys leads transform '<json>' --yes");
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

/** 高危写入需 --yes 确认;未传则抛 ConfirmationRequiredError(exit 10)。 */
export function ensureConfirmed(yes: boolean | undefined, action: string, retryCmd: string): void {
  if (yes) return;
  throw new errs.ConfirmationRequiredError({
    subtype: "high_risk_write",
    message: `${action} is a high-risk operation and requires confirmation`,
    hint: `Add --yes to confirm, or use: ${retryCmd}`,
  });
}

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
