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

const MODULE = "account/contact";

export const contactsCommands: CommandGroup = defineCommands({
  list: defineCommand({
    name: "list",
    description: "联系人视图列表",
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
    description: "联系人详情",
    args: {
      schema: z.object({ id: z.string().describe("联系人 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(MODULE, id));
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand({
    name: "page",
    description: "联系人分页列表",
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
    description: "全局搜索联系人",
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
    description: "联系人表单字段定义",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand({
    name: "add",
    description: "新增联系人(必填 customerId, name)",
    args: {
      schema: z.object({ data: z.string().describe("联系人数据 JSON") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasField(body, "Create contact", "customerId");
      assertHasField(body, "Create contact", "name");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand({
    name: "update",
    description: "更新联系人(全量更新,需含 id + 必填字段)",
    args: {
      schema: z.object({ data: z.string().describe("联系人数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update contact");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand({
    name: "batch-update",
    description: "批量更新联系人(ids[], fieldId, fieldValue)",
    args: {
      schema: z.object({ data: z.string().describe("批量数据 JSON") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/${MODULE}/batch/update`, body);
      return { data: unwrap(res) };
    },
  }),
});
