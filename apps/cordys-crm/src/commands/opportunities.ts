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

const MODULE = "opportunity";

export const opportunitiesCommands: CommandGroup = defineCommands({
  list: defineCommand({
    name: "list",
    description: "商机视图列表",
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
    description: "商机详情",
    args: {
      schema: z.object({ id: z.string().describe("商机 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(MODULE, id));
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand({
    name: "page",
    description: "商机会分页列表(带筛选/排序/关键词)",
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
    description: "全局搜索商机",
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
    description: "商机表单字段定义(写入前必读)",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand({
    name: "add",
    description: "新增商机(必填 name, customerId, contactId, amount, owner, products[])",
    args: {
      schema: z.object({ data: z.string().describe("商机数据 JSON") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      for (const f of ["name", "customerId", "contactId", "amount", "owner"]) {
        assertHasField(body, "Create opportunity", f);
      }
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand({
    name: "update",
    description: "更新商机(全量更新,需含 id + 必填字段)",
    args: {
      schema: z.object({ data: z.string().describe("商机数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update opportunity");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  // —— 报价单(opportunity/quotation)special-case ——

  "quotation-get": defineCommand({
    name: "quotation-get",
    description: "报价单详情(注意路径带 /get/ 前缀)",
    args: {
      schema: z.object({ id: z.string().describe("报价单 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(`/${MODULE}/quotation/get/${encodeURIComponent(id)}`);
      return { data: unwrap(res) };
    },
  }),

  "quotation-page": defineCommand({
    name: "quotation-page",
    description: "报价单分页列表(报价单无全局搜索,用本命令)",
    args: {
      schema: z.object({ payload: z.string().describe("分页载荷(JSON 或关键词)").optional() }),
      pos: ["payload"],
    },
    async run(ctx, { payload }) {
      const res = await ctx.post(`/${MODULE}/quotation/page`, buildPagePayload(payload));
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  "quotation-form": defineCommand({
    name: "quotation-form",
    description: "报价单表单字段定义(含 moduleFields/moduleFormConfigDTO 配置)",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/quotation/module/form`);
      return { data: unwrap(res) };
    },
  }),

  "quotation-add": defineCommand({
    name: "quotation-add",
    description:
      "新增报价单(必填 name, opportunityId, untilTime, products, moduleFields, moduleFormConfigDTO)",
    args: {
      schema: z.object({ data: z.string().describe("报价单数据 JSON") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      for (const f of ["name", "opportunityId", "untilTime"]) {
        assertHasField(body, "Create quotation", f);
      }
      const res = await ctx.post(`/${MODULE}/quotation/add`, body);
      return { data: unwrap(res) };
    },
  }),

  "quotation-update": defineCommand({
    name: "quotation-update",
    description: "更新报价单(需 id + approvalStatus,建议先 quotation-get 再合并单字段)",
    args: {
      schema: z.object({
        data: z.string().describe("报价单数据 JSON(含 id, approvalStatus)"),
      }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update quotation");
      assertHasField(body, "Update quotation", "approvalStatus");
      const res = await ctx.post(`/${MODULE}/quotation/update`, body);
      return { data: unwrap(res) };
    },
  }),
});
