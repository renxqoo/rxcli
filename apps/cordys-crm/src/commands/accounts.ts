/**
 * accounts —— 客户(account)模块 + Customer 360 子资源。
 *
 * 端点:
 *   GET    /account/view/list              视图列表
 *   GET    /account/{id}                   详情
 *   POST   /account/page                   分页列表
 *   POST   /global/search/account          全局搜索
 *   GET    /account/module/form            表单定义
 *   POST   /account/add                    新增(必填 name)
 *   POST   /account/update                 更新
 *   POST   /account/batch/update           批量更新
 *   — Customer 360 子资源(acct-sub)—
 *   POST   /account/contract/page          合同列表
 *   GET    /account/contract/statistic/{id} 合同统计
 *   POST   /account/opportunity/page       商机列表
 *   POST   /account/order/page             订单列表
 *   POST   /account/contract/payment-plan/page      回款计划
 *   GET    /account/contract/payment-plan/statistic/{id}
 *   POST   /account/contract/payment-record/page    回款记录
 *   GET    /account/contract/payment-record/statistic/{id}
 *   POST   /account/invoice/page           发票列表
 *   GET    /account/invoice/statistic/{id}
 */

import * as z from "zod";
import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import {
  unwrap,
  detailPath,
  unwrapPaged,
  buildPagePayload,
  pagedMeta,
  parseJsonBody,
} from "../envelope.js";
import { assertHasId, assertHasField } from "./leads.js";

const MODULE = "account";

/** acct-sub 支持的子资源(客户 360)。 */
const ACCT_SUB_GETS = [
  "contract-stat",
  "payment-plan-stat",
  "payment-record-stat",
  "invoice-stat",
] as const;
const ACCT_SUB_PAGES = [
  "contract",
  "opportunity",
  "order",
  "payment-plan",
  "payment-record",
  "invoice",
] as const;

export const accountsCommands: CommandGroup = defineCommands({
  list: defineCommand({
    name: "list",
    description: "客户视图列表",
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
    description: "客户详情",
    args: {
      schema: z.object({ id: z.string().describe("客户 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(detailPath(MODULE, id));
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand({
    name: "page",
    description: "客户分页列表(viewId 可用 ALL/SELF/CUSTOMER_COLLABORATION)",
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
    description: "全局搜索客户",
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
    description: "客户表单字段定义(写入前必读)",
    async run(ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand({
    name: "add",
    description: "新增客户(必填 name)",
    args: {
      schema: z.object({ data: z.string().describe("客户数据 JSON") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasField(body, "Create account", "name");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand({
    name: "update",
    description: "更新客户(全量更新,需含 id + 必填字段)",
    args: {
      schema: z.object({ data: z.string().describe("客户数据 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      assertHasId(body, "Update account");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand({
    name: "batch-update",
    description: "批量更新客户(ids[], fieldId, fieldValue)",
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

  /**
   * sub:客户 360 子资源查询。
   *   rxcordys accounts sub <type> <accountId> [payload]
   *   type ∈ {contract, opportunity, order, payment-plan, payment-record, invoice,
   *           contract-stat, payment-plan-stat, payment-record-stat, invoice-stat}
   *   带 -stat 的为 GET 统计,其余为 POST 分页。
   */
  sub: defineCommand({
    name: "sub",
    description: "客户 360 子资源查询(合同/商机/订单/回款/发票列表 + 对应统计)",
    args: {
      schema: z.object({
        type: z
          .string()
          .describe(
            "子资源类型(contract/opportunity/order/payment-plan/payment-record/invoice/*-stat)",
          ),
        id: z.string().describe("客户 ID"),
        payload: z.string().describe("分页载荷(仅分页类型需要,JSON 或关键词)").optional(),
      }),
      pos: ["type", "id"],
    },
    async run(ctx, { type, id, payload }) {
      // GET 统计类
      if ((ACCT_SUB_GETS as readonly string[]).includes(type)) {
        const res = await ctx.get(`/${MODULE}/${statPathOf(type)}/${encodeURIComponent(id)}`);
        return { data: unwrap(res) };
      }
      // POST 分页类(需把 accountId 作为 body 的 customerId 字段,Cordys 子资源按此过滤)
      if ((ACCT_SUB_PAGES as readonly string[]).includes(type)) {
        const body = buildPagePayload(payload);
        body.customerId = id;
        const res = await ctx.post(`/${MODULE}/${type}/page`, body);
        const data = unwrapPaged(res);
        return { data: data.list, meta: pagedMeta(data) };
      }
      throw new errs.ValidationError({
        subtype: "invalid_argument",
        param: "<type>",
        message: `Unsupported sub-resource type "${type}"`,
        hint: `Paged: ${ACCT_SUB_PAGES.join(", ")}; Stats: ${ACCT_SUB_GETS.join(", ")}`,
      });
    },
  }),
});

/** 子资源统计类型 → 路径段映射。 */
function statPathOf(type: string): string {
  switch (type) {
    case "contract-stat":
      return "contract/statistic";
    case "payment-plan-stat":
      return "contract/payment-plan/statistic";
    case "payment-record-stat":
      return "contract/payment-record/statistic";
    case "invoice-stat":
      return "invoice/statistic";
    default:
      return type;
  }
}
