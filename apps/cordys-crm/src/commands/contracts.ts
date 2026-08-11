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

const MODULE = "contract";

const writePolicy = { mode: "write", dryRun: true, confirmation: "required" } as const;

export const contractsCommands: CommandGroup = defineCommands({
  list: defineCommand({
    name: "list",
    description: "合同视图列表",
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
    description: "合同详情",
    args: {
      schema: z.object({ id: z.string().describe("合同 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(MODULE, id));
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand({
    name: "page",
    description: "合同分页列表",
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
    description: "全局搜索合同",
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
    description: "合同表单字段定义",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand({
    name: "add",
    description: "新增合同",
    args: {
      schema: z.object({ data: z.string().describe("合同数据 JSON") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand({
    name: "update",
    description: "更新合同(全量更新,需含 id)",
    args: {
      schema: z.object({ data: z.string().describe("合同数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update contract");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand({
    name: "batch-update",
    description: "批量更新合同(ids[], fieldId, fieldValue)",
    args: {
      schema: z.object({ data: z.string().describe("批量数据 JSON") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/${MODULE}/batch/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** stat:合同金额统计(/contract/statistic)。 */
  stat: defineCommand({
    name: "stat",
    description: "合同金额统计(返回 {amount, averageAmount})",
    args: {
      schema: z.object({ payload: z.string().describe("统计载荷 JSON(含筛选条件)").optional() }),
    },
    async run(ctx, { payload }) {
      const body = payload ? parseJsonBody(payload, "<payload>") : {};
      const res = await ctx.post(`/${MODULE}/statistic`, body);
      return { data: unwrap(res) };
    },
  }),

  // —— 回款计划(contract/payment-plan)—

  "payment-plan-page": defineCommand({
    name: "payment-plan-page",
    description: "回款计划分页列表",
    args: {
      schema: z.object({ payload: z.string().describe("分页载荷(JSON 或关键词)").optional() }),
      pos: ["payload"],
    },
    async run(ctx, { payload }) {
      const res = await ctx.post(`/${MODULE}/payment-plan/page`, buildPagePayload(payload));
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  "payment-plan-get": defineCommand({
    name: "payment-plan-get",
    description: "回款计划详情",
    args: {
      schema: z.object({ id: z.string().describe("回款计划 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(`${MODULE}/payment-plan`, id));
      return { data: unwrap(res) };
    },
  }),

  "payment-plan-form": defineCommand({
    name: "payment-plan-form",
    description: "回款计划表单字段定义",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/payment-plan/module/form`);
      return { data: unwrap(res) };
    },
  }),

  "payment-plan-add": defineCommand({
    name: "payment-plan-add",
    description: "新增回款计划",
    args: {
      schema: z.object({ data: z.string().describe("回款计划数据 JSON") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/${MODULE}/payment-plan/add`, body);
      return { data: unwrap(res) };
    },
  }),

  "payment-plan-update": defineCommand({
    name: "payment-plan-update",
    description: "更新回款计划(需含 id)",
    args: {
      schema: z.object({ data: z.string().describe("回款计划数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update payment plan");
      const res = await ctx.post(`/${MODULE}/payment-plan/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "payment-plan-stat": defineCommand({
    name: "payment-plan-stat",
    description: "回款计划金额统计",
    args: {
      schema: z.object({ payload: z.string().describe("统计载荷 JSON").optional() }),
    },
    async run(ctx, { payload }) {
      const body = payload ? parseJsonBody(payload, "<payload>") : {};
      const res = await ctx.post(`/${MODULE}/payment-plan/statistic`, body);
      return { data: unwrap(res) };
    },
  }),

  // —— 回款记录(contract/payment-record)—

  "payment-record-page": defineCommand({
    name: "payment-record-page",
    description: "回款记录分页列表",
    args: {
      schema: z.object({ payload: z.string().describe("分页载荷(JSON 或关键词)").optional() }),
      pos: ["payload"],
    },
    async run(ctx, { payload }) {
      const res = await ctx.post(`/${MODULE}/payment-record/page`, buildPagePayload(payload));
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  "payment-record-get": defineCommand({
    name: "payment-record-get",
    description: "回款记录详情",
    args: {
      schema: z.object({ id: z.string().describe("回款记录 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(`${MODULE}/payment-record`, id));
      return { data: unwrap(res) };
    },
  }),

  "payment-record-form": defineCommand({
    name: "payment-record-form",
    description: "回款记录表单字段定义",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/payment-record/module/form`);
      return { data: unwrap(res) };
    },
  }),

  "payment-record-add": defineCommand({
    name: "payment-record-add",
    description: "新增回款记录",
    args: {
      schema: z.object({ data: z.string().describe("回款记录数据 JSON") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/${MODULE}/payment-record/add`, body);
      return { data: unwrap(res) };
    },
  }),

  "payment-record-update": defineCommand({
    name: "payment-record-update",
    description: "更新回款记录(需含 id)",
    args: {
      schema: z.object({ data: z.string().describe("回款记录数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update payment record");
      const res = await ctx.post(`/${MODULE}/payment-record/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "payment-record-stat": defineCommand({
    name: "payment-record-stat",
    description: "回款记录金额统计",
    args: {
      schema: z.object({ payload: z.string().describe("统计载荷 JSON").optional() }),
    },
    async run(ctx, { payload }) {
      const body = payload ? parseJsonBody(payload, "<payload>") : {};
      const res = await ctx.post(`/${MODULE}/payment-record/statistic`, body);
      return { data: unwrap(res) };
    },
  }),

  // —— 工商抬头(contract/business-title)—

  "business-title-page": defineCommand({
    name: "business-title-page",
    description: "工商抬头分页列表",
    args: {
      schema: z.object({ payload: z.string().describe("分页载荷(JSON 或关键词)").optional() }),
      pos: ["payload"],
    },
    async run(ctx, { payload }) {
      const res = await ctx.post(`/${MODULE}/business-title/page`, buildPagePayload(payload));
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  "business-title-form": defineCommand({
    name: "business-title-form",
    description: "工商抬头表单字段定义",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/business-title/module/form`);
      return { data: unwrap(res) };
    },
  }),

  "business-title-add": defineCommand({
    name: "business-title-add",
    description: "新增工商抬头",
    args: {
      schema: z.object({ data: z.string().describe("工商抬头数据 JSON") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/${MODULE}/business-title/add`, body);
      return { data: unwrap(res) };
    },
  }),

  "business-title-update": defineCommand({
    name: "business-title-update",
    description: "更新工商抬头(需含 id)",
    args: {
      schema: z.object({ data: z.string().describe("工商抬头数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update business header");
      const res = await ctx.post(`/${MODULE}/business-title/update`, body);
      return { data: unwrap(res) };
    },
  }),
});
