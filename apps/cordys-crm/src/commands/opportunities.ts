/**
 * opportunities —— 商机(opportunity)模块 + 报价单(opportunity/quotation)。
 *
 * 端点:
 *   GET    /opportunity/view/list          视图列表
 *   GET    /opportunity/{id}               详情
 *   POST   /opportunity/page               分页列表
 *   POST   /opportunity/statistic          商机统计
 *   GET    /opportunity/module/form        表单定义
 *   POST   /opportunity/add                新增(必填 name, customerId, contactId, amount, owner, products[])
 *   POST   /opportunity/update             更新
 *   — 报价单 special-case —
 *   GET    /opportunity/quotation/get/{id} 报价单详情(注意 /get/ 前缀)
 *   POST   /opportunity/quotation/page     报价单列表(无全局搜索,回退 page)
 *   GET    /opportunity/quotation/module/form 报价单表单
 *   POST   /opportunity/quotation/add      报价单新增(必填 name, opportunityId, untilTime, products, moduleFields, moduleFormConfigDTO)
 *   POST   /opportunity/quotation/update   报价单更新(还需 id + approvalStatus,建议先 get 再合并)
 */

import {
  defineCommands,
  defineCommand,
  type CommandGroup,
  defineCommandFromArgs,
} from "@renxqoo/agent-data-cli";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { ensureConfirmed, assertHasId, assertHasField } from "./leads.js";

const MODULE = "opportunity";

export const opportunitiesCommands: CommandGroup = defineCommands({
  list: defineCommand<{ opts: string }>({
    name: "list",
    description: "商机视图列表",
    args: { opts: { type: "string", desc: "查询参数 JSON" } },
    async run(args, ctx) {
      const query = args.opts ? (JSON.parse(args.opts) as Record<string, unknown>) : {};
      const res = await ctx.get(`/${MODULE}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  get: defineCommand<{ id: string }>({
    name: "get",
    description: "商机详情",
    args: { id: { type: "string", required: true, positional: true, desc: "商机 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand<{ payload: string }>({
    name: "page",
    description: "商机会分页列表(带筛选/排序/关键词)",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  search: defineCommand<{ payload: string }>({
    name: "search",
    description: "全局搜索商机",
    args: { payload: { type: "string", positional: true, desc: "搜索载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/global/search/${MODULE}`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  form: defineCommandFromArgs({
    name: "form",
    description: "商机表单字段定义(写入前必读)",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "add",
    description: "新增商机(必填 name, customerId, contactId, amount, owner, products[])",
    args: {
      data: { type: "string", required: true, positional: true, desc: "商机数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      for (const f of ["name", "customerId", "contactId", "amount", "owner"]) {
        assertHasField(body, "Create opportunity", f);
      }
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "Create opportunity", "rxcordys opportunities add '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "update",
    description: "更新商机(全量更新,需含 id + 必填字段)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "商机数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update opportunity");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Update opportunity",
        "rxcordys opportunities update '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  // —— 报价单(opportunity/quotation)special-case ——

  "quotation-get": defineCommand<{ id: string }>({
    name: "quotation-get",
    description: "报价单详情(注意路径带 /get/ 前缀)",
    args: { id: { type: "string", required: true, positional: true, desc: "报价单 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/quotation/get/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  "quotation-page": defineCommand<{ payload: string }>({
    name: "quotation-page",
    description: "报价单分页列表(报价单无全局搜索,用本命令)",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/quotation/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  "quotation-form": defineCommandFromArgs({
    name: "quotation-form",
    description: "报价单表单字段定义(含 moduleFields/moduleFormConfigDTO 配置)",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/quotation/module/form`);
      return { data: unwrap(res) };
    },
  }),

  "quotation-add": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "quotation-add",
    description:
      "新增报价单(必填 name, opportunityId, untilTime, products, moduleFields, moduleFormConfigDTO)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "报价单数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      for (const f of ["name", "opportunityId", "untilTime"]) {
        assertHasField(body, "Create quotation", f);
      }
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Create quotation",
        "rxcordys opportunities quotation-add '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/quotation/add`, body);
      return { data: unwrap(res) };
    },
  }),

  "quotation-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "quotation-update",
    description: "更新报价单(需 id + approvalStatus,建议先 quotation-get 再合并单字段)",
    args: {
      data: {
        type: "string",
        required: true,
        positional: true,
        desc: "报价单数据 JSON(含 id, approvalStatus)",
      },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update quotation");
      assertHasField(body, "Update quotation", "approvalStatus");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Update quotation",
        "rxcordys opportunities quotation-update '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/quotation/update`, body);
      return { data: unwrap(res) };
    },
  }),
});
