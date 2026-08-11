/**
 * invoices —— 发票(invoice)模块。
 *
 * 端点:
 *   GET    /invoice/view/list       视图列表
 *   GET    /invoice/{id}            详情
 *   POST   /invoice/page            分页列表
 *   GET    /invoice/module/form     表单定义
 *   POST   /invoice/add             新增
 *   POST   /invoice/update          更新
 *
 * 注:发票无全局搜索路径;通过 contracts/accounts 的 invoice-stat 获取统计。
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
import { assertHasId } from "./leads.js";

const MODULE = "invoice";

export const invoicesCommands: CommandGroup = defineCommands({
  list: defineCommand({
    name: "list",
    description: "发票视图列表",
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
    description: "发票详情",
    args: {
      schema: z.object({ id: z.string().describe("发票 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(MODULE, id));
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand({
    name: "page",
    description: "发票分页列表",
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

  form: defineCommand({
    name: "form",
    description: "发票表单字段定义",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand({
    name: "add",
    description: "新增发票",
    args: {
      schema: z.object({ data: z.string().describe("发票数据 JSON") }),
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
    description: "更新发票(全量更新,需含 id)",
    args: {
      schema: z.object({ data: z.string().describe("发票数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update invoice");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),
});
