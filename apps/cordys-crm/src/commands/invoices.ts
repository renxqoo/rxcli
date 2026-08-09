/**
 * invoices —— 发票(invoice)模块。
 *
 * 端点:
 *   GET    /invoice/view/list       视图列表(发票无独立 view,走 page)
 *   GET    /invoice/{id}            详情
 *   POST   /invoice/page            分页列表
 *   GET    /invoice/module/form     表单定义
 *   POST   /invoice/add             新增
 *   POST   /invoice/update          更新
 *
 * 注:发票无全局搜索路径;通过 contracts/accounts 的 invoice-stat 获取统计。
 */

import { defineCommands, defineCommand, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { ensureConfirmed, assertHasId } from "./leads.js";

const MODULE = "invoice";

export const invoicesCommands: CommandGroup = defineCommands({
  get: defineCommand<{ id: string }>({
    name: "get",
    description: "发票详情",
    args: { id: { type: "string", required: true, positional: true, desc: "发票 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand<{ payload: string }>({
    name: "page",
    description: "发票分页列表",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  form: defineCommand({
    name: "form",
    description: "发票表单字段定义",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "add",
    description: "新增发票",
    args: {
      data: { type: "string", required: true, positional: true, desc: "发票数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "新增发票", "rxcordys invoices add '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "update",
    description: "更新发票(全量更新,需含 id)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "发票数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "更新发票");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "更新发票", "rxcordys invoices update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),
});
