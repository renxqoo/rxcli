/**
 * contacts —— 联系人(account/contact)模块。
 *
 * 端点(account/contact 是 account 的子资源,路径带 /account/contact 前缀):
 *   GET    /account/contact/view/list       视图列表
 *   GET    /account/contact/{id}            详情
 *   POST   /account/contact/page            分页列表
 *   POST   /global/search/account/contact   全局搜索
 *   GET    /account/contact/module/form     表单定义
 *   POST   /account/contact/add             新增(必填 customerId, name)
 *   POST   /account/contact/update          更新
 *   POST   /account/contact/batch/update    批量更新
 */

import { defineCommands, defineCommand, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { ensureConfirmed, assertHasId, assertHasField } from "./leads.js";

const MODULE = "account/contact";

export const contactsCommands: CommandGroup = defineCommands({
  list: defineCommand<{ opts: string }>({
    name: "list",
    description: "联系人视图列表",
    args: { opts: { type: "string", desc: "查询参数 JSON" } },
    async run(args, ctx) {
      const query = args.opts ? (JSON.parse(args.opts) as Record<string, unknown>) : {};
      const res = await ctx.get(`/${MODULE}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  get: defineCommand<{ id: string }>({
    name: "get",
    description: "联系人详情",
    args: { id: { type: "string", required: true, positional: true, desc: "联系人 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand<{ payload: string }>({
    name: "page",
    description: "联系人分页列表",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  search: defineCommand<{ payload: string }>({
    name: "search",
    description: "全局搜索联系人",
    args: { payload: { type: "string", positional: true, desc: "搜索载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/global/search/${MODULE}`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  form: defineCommand({
    name: "form",
    description: "联系人表单字段定义",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "add",
    description: "新增联系人(必填 customerId, name)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "联系人数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasField(body, "新增联系人", "customerId");
      assertHasField(body, "新增联系人", "name");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "新增联系人", "rxcordys contacts add '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "update",
    description: "更新联系人(全量更新,需含 id + 必填字段)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "联系人数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "更新联系人");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "更新联系人", "rxcordys contacts update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "batch-update",
    description: "批量更新联系人(ids[], fieldId, fieldValue)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "批量数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "批量更新联系人", "rxcordys contacts batch-update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/batch/update`, body);
      return { data: unwrap(res) };
    },
  }),
});
