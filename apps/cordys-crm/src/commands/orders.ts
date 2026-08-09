/**
 * orders —— 订单(order)模块 + 统计。
 *
 * 端点:
 *   GET    /order/view/list        视图列表
 *   GET    /order/{id}             详情
 *   POST   /order/page             分页列表
 *   POST   /global/search/order    全局搜索
 *   GET    /order/module/form      表单定义
 *   POST   /order/add              新增
 *   POST   /order/update           更新
 *   POST   /order/batch/update     批量更新
 *   POST   /order/statistic        订单统计({amount, averageAmount})
 */

import { defineCommands, defineCommand, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { ensureConfirmed, assertHasId } from "./leads.js";

const MODULE = "order";

export const ordersCommands: CommandGroup = defineCommands({
  list: defineCommand<{ opts: string }>({
    name: "list",
    description: "订单视图列表",
    args: { opts: { type: "string", desc: "查询参数 JSON" } },
    async run(args, ctx) {
      const query = args.opts ? (JSON.parse(args.opts) as Record<string, unknown>) : {};
      const res = await ctx.get(`/${MODULE}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  get: defineCommand<{ id: string }>({
    name: "get",
    description: "订单详情",
    args: { id: { type: "string", required: true, positional: true, desc: "订单 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand<{ payload: string }>({
    name: "page",
    description: "订单分页列表",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  search: defineCommand<{ payload: string }>({
    name: "search",
    description: "全局搜索订单",
    args: { payload: { type: "string", positional: true, desc: "搜索载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/global/search/${MODULE}`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  form: defineCommand({
    name: "form",
    description: "订单表单字段定义",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "add",
    description: "新增订单",
    args: {
      data: { type: "string", required: true, positional: true, desc: "订单数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "新增订单", "rxcordys orders add '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "update",
    description: "更新订单(全量更新,需含 id)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "订单数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "Update order");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "Update order", "rxcordys orders update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "batch-update",
    description: "批量更新订单(ids[], fieldId, fieldValue)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "批量数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "批量更新订单", "rxcordys orders batch-update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/batch/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** stat:订单金额统计(/order/statistic)。 */
  stat: defineCommand<{ payload: string }>({
    name: "stat",
    description: "订单金额统计(返回 {amount, averageAmount})",
    args: { payload: { type: "string", desc: "统计载荷 JSON(含筛选条件)" } },
    async run(args, ctx) {
      const body = args.payload ? parseJsonBody(args.payload, "<payload>") : {};
      const res = await ctx.post(`/${MODULE}/statistic`, body);
      return { data: unwrap(res) };
    },
  }),
});
