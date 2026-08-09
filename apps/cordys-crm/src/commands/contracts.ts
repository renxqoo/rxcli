/**
 * contracts —— 合同(contract)模块 + 子模块(payment-plan/payment-record/business-title)+ 统计。
 *
 * 端点:
 *   GET    /contract/view/list              视图列表
 *   GET    /contract/{id}                   详情
 *   POST   /contract/page                   分页列表
 *   POST   /global/search/contract          全局搜索
 *   GET    /contract/module/form            表单定义
 *   POST   /contract/add                    新增
 *   POST   /contract/update                 更新
 *   POST   /contract/batch/update           批量更新
 *   POST   /contract/statistic              合同统计({amount, averageAmount})
 *   — 子模块(回款计划/回款记录/工商抬头)—
 *   POST   /contract/payment-plan/page      回款计划列表
 *   GET    /contract/payment-plan/{id}      回款计划详情
 *   GET    /contract/payment-plan/module/form
 *   POST   /contract/payment-plan/add       新增
 *   POST   /contract/payment-plan/update    更新
 *   POST   /contract/payment-plan/statistic 统计
 *   (payment-record 同构,路径换 payment-record)
 *   POST   /contract/business-title/page    工商抬头列表
 *   GET    /contract/business-title/module/form
 *   POST   /contract/business-title/add     新增
 *   POST   /contract/business-title/update  更新
 *   GET    /contract/invoice/statistic/{id} 合同发票统计
 */

import { defineCommands, defineCommand, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { ensureConfirmed, assertHasId } from "./leads.js";

const MODULE = "contract";

export const contractsCommands: CommandGroup = defineCommands({
  list: defineCommand<{ opts: string }>({
    name: "list",
    description: "合同视图列表",
    args: { opts: { type: "string", desc: "查询参数 JSON" } },
    async run(args, ctx) {
      const query = args.opts ? (JSON.parse(args.opts) as Record<string, unknown>) : {};
      const res = await ctx.get(`/${MODULE}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  get: defineCommand<{ id: string }>({
    name: "get",
    description: "合同详情",
    args: { id: { type: "string", required: true, positional: true, desc: "合同 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand<{ payload: string }>({
    name: "page",
    description: "合同分页列表",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  search: defineCommand<{ payload: string }>({
    name: "search",
    description: "全局搜索合同",
    args: { payload: { type: "string", positional: true, desc: "搜索载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/global/search/${MODULE}`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  form: defineCommand({
    name: "form",
    description: "合同表单字段定义",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "add",
    description: "新增合同",
    args: {
      data: { type: "string", required: true, positional: true, desc: "合同数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "新增合同", "rxcordys contracts add '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "update",
    description: "更新合同(全量更新,需含 id)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "合同数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update contract");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "Update contract", "rxcordys contracts update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "batch-update",
    description: "批量更新合同(ids[], fieldId, fieldValue)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "批量数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "批量更新合同", "rxcordys contracts batch-update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/batch/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** stat:合同金额统计(/contract/statistic)。 */
  stat: defineCommand<{ payload: string }>({
    name: "stat",
    description: "合同金额统计(返回 {amount, averageAmount})",
    args: { payload: { type: "string", desc: "统计载荷 JSON(含筛选条件)" } },
    async run(args, ctx) {
      const body = args.payload ? parseJsonBody(args.payload, "<payload>") : {};
      const res = await ctx.post(`/${MODULE}/statistic`, body);
      return { data: unwrap(res) };
    },
  }),

  // —— 回款计划(contract/payment-plan)—

  "payment-plan-page": defineCommand<{ payload: string }>({
    name: "payment-plan-page",
    description: "回款计划分页列表",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/payment-plan/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  "payment-plan-get": defineCommand<{ id: string }>({
    name: "payment-plan-get",
    description: "回款计划详情",
    args: { id: { type: "string", required: true, positional: true, desc: "回款计划 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/payment-plan/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  "payment-plan-form": defineCommand({
    name: "payment-plan-form",
    description: "回款计划表单字段定义",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/payment-plan/module/form`);
      return { data: unwrap(res) };
    },
  }),

  "payment-plan-add": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "payment-plan-add",
    description: "新增回款计划",
    args: {
      data: { type: "string", required: true, positional: true, desc: "回款计划数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "新增回款计划",
        "rxcordys contracts payment-plan-add '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/payment-plan/add`, body);
      return { data: unwrap(res) };
    },
  }),

  "payment-plan-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "payment-plan-update",
    description: "更新回款计划(需含 id)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "回款计划数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update payment plan");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Update payment plan",
        "rxcordys contracts payment-plan-update '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/payment-plan/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "payment-plan-stat": defineCommand<{ payload: string }>({
    name: "payment-plan-stat",
    description: "回款计划金额统计",
    args: { payload: { type: "string", desc: "统计载荷 JSON" } },
    async run(args, ctx) {
      const body = args.payload ? parseJsonBody(args.payload, "<payload>") : {};
      const res = await ctx.post(`/${MODULE}/payment-plan/statistic`, body);
      return { data: unwrap(res) };
    },
  }),

  // —— 回款记录(contract/payment-record)—

  "payment-record-page": defineCommand<{ payload: string }>({
    name: "payment-record-page",
    description: "回款记录分页列表",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/payment-record/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  "payment-record-get": defineCommand<{ id: string }>({
    name: "payment-record-get",
    description: "回款记录详情",
    args: { id: { type: "string", required: true, positional: true, desc: "回款记录 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/payment-record/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  "payment-record-form": defineCommand({
    name: "payment-record-form",
    description: "回款记录表单字段定义",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/payment-record/module/form`);
      return { data: unwrap(res) };
    },
  }),

  "payment-record-add": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "payment-record-add",
    description: "新增回款记录",
    args: {
      data: { type: "string", required: true, positional: true, desc: "回款记录数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "新增回款记录",
        "rxcordys contracts payment-record-add '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/payment-record/add`, body);
      return { data: unwrap(res) };
    },
  }),

  "payment-record-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "payment-record-update",
    description: "更新回款记录(需含 id)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "回款记录数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update payment record");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Update payment record",
        "rxcordys contracts payment-record-update '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/payment-record/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "payment-record-stat": defineCommand<{ payload: string }>({
    name: "payment-record-stat",
    description: "回款记录金额统计",
    args: { payload: { type: "string", desc: "统计载荷 JSON" } },
    async run(args, ctx) {
      const body = args.payload ? parseJsonBody(args.payload, "<payload>") : {};
      const res = await ctx.post(`/${MODULE}/payment-record/statistic`, body);
      return { data: unwrap(res) };
    },
  }),

  // —— 工商抬头(contract/business-title)—

  "business-title-page": defineCommand<{ payload: string }>({
    name: "business-title-page",
    description: "工商抬头分页列表",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/business-title/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  "business-title-form": defineCommand({
    name: "business-title-form",
    description: "工商抬头表单字段定义",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/business-title/module/form`);
      return { data: unwrap(res) };
    },
  }),

  "business-title-add": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "business-title-add",
    description: "新增工商抬头",
    args: {
      data: { type: "string", required: true, positional: true, desc: "工商抬头数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "新增工商抬头",
        "rxcordys contracts business-title-add '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/business-title/add`, body);
      return { data: unwrap(res) };
    },
  }),

  "business-title-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "business-title-update",
    description: "更新工商抬头(需含 id)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "工商抬头数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update business header");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        "Update business header",
        "rxcordys contracts business-title-update '<json>' --yes",
      );
      const res = await ctx.post(`/${MODULE}/business-title/update`, body);
      return { data: unwrap(res) };
    },
  }),
});
