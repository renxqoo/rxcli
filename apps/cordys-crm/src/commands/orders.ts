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

import * as z from "zod";
import { defineCommands, defineCommand, type CommandGroup } from "@renxqoo/agent-data-cli";
import {
  unwrap,
  detailPath,
  unwrapPaged,
  buildPagePayload,
  pagedMeta,
  parseJsonBody,
} from "../envelope.js";
import { assertHasId, assertHasField } from "./leads.js";

const MODULE = "order";

export const ordersCommands: CommandGroup = defineCommands({
  list: defineCommand({
    name: "list",
    description: "订单视图列表",
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
    description: "订单详情",
    args: {
      schema: z.object({ id: z.string().describe("订单 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(MODULE, id));
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand({
    name: "page",
    description: "订单分页列表",
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
    description: "全局搜索订单",
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
    description: "订单表单字段定义",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand({
    name: "add",
    description: "新增订单",
    args: {
      schema: z.object({ data: z.string().describe("订单数据 JSON") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand({
    name: "update",
    description: "更新订单(全量更新,需含 id)",
    args: {
      schema: z.object({ data: z.string().describe("订单数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update order");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand({
    name: "batch-update",
    description: "批量更新订单(ids[], fieldId, fieldValue)",
    args: {
      schema: z.object({
        data: z.string().describe("批量数据 JSON(含 ids[]/fieldId/fieldValue)"),
      }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasField(body, "Batch update order", "ids");
      assertHasField(body, "Batch update order", "fieldId");
      assertHasField(body, "Batch update order", "fieldValue");
      const res = await ctx.post(`/${MODULE}/batch/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** stat:订单金额统计(/order/statistic)。 */
  stat: defineCommand({
    name: "stat",
    description: "订单金额统计(返回 {amount, averageAmount})",
    args: {
      schema: z.object({ payload: z.string().describe("统计载荷 JSON(含筛选条件)").optional() }),
    },
    async run(ctx, { payload }) {
      const body = payload ? parseJsonBody(payload, "<payload>") : {};
      const res = await ctx.post(`/${MODULE}/statistic`, body);
      return { data: unwrap(res) };
    },
  }),
});
