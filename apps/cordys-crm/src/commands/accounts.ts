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

import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { ensureConfirmed, assertHasId, assertHasField } from "./leads.js";

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
  list: defineCommand<{ opts: string }>({
    name: "list",
    description: "客户视图列表",
    args: { opts: { type: "string", desc: "查询参数 JSON" } },
    async run(args, ctx) {
      const query = args.opts ? (JSON.parse(args.opts) as Record<string, unknown>) : {};
      const res = await ctx.get(`/${MODULE}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  get: defineCommand<{ id: string }>({
    name: "get",
    description: "客户详情",
    args: { id: { type: "string", required: true, positional: true, desc: "客户 ID" } },
    async run(args, ctx) {
      const res = await ctx.get(`/${MODULE}/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  page: defineCommand<{ payload: string }>({
    name: "page",
    description: "客户分页列表(viewId 可用 ALL/SELF/CUSTOMER_COLLABORATION)",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/${MODULE}/page`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  search: defineCommand<{ payload: string }>({
    name: "search",
    description: "全局搜索客户",
    args: { payload: { type: "string", positional: true, desc: "搜索载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/global/search/${MODULE}`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  form: defineCommand({
    name: "form",
    description: "客户表单字段定义(写入前必读)",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/${MODULE}/module/form`);
      return { data: unwrap(res) };
    },
  }),

  add: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "add",
    description: "新增客户(必填 name)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "客户数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasField(body, "新增客户", "name");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "新增客户", "rxcordys accounts add '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/add`, body);
      return { data: unwrap(res) };
    },
  }),

  update: defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "update",
    description: "更新客户(全量更新,需含 id + 必填字段)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "客户数据 JSON(含 id)" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      assertHasId(body, "更新客户");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "更新客户", "rxcordys accounts update '<json>' --yes");
      const res = await ctx.post(`/${MODULE}/update`, body);
      return { data: unwrap(res) };
    },
  }),

  "batch-update": defineCommand<{ data: string; dryRun: boolean; yes: boolean }>({
    name: "batch-update",
    description: "批量更新客户(ids[], fieldId, fieldValue)",
    args: {
      data: { type: "string", required: true, positional: true, desc: "批量数据 JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(args.yes, "批量更新客户", "rxcordys accounts batch-update '<json>' --yes");
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
  sub: defineCommand<{ type: string; id: string; payload: string }>({
    name: "sub",
    description: "客户 360 子资源查询(合同/商机/订单/回款/发票列表 + 对应统计)",
    args: {
      type: {
        type: "string",
        required: true,
        positional: true,
        desc: "子资源类型(contract/opportunity/order/payment-plan/payment-record/invoice/*-stat)",
      },
      id: { type: "string", required: true, positional: true, desc: "客户 ID" },
      payload: { type: "string", positional: true, desc: "分页载荷(仅分页类型需要,JSON 或关键词)" },
    },
    async run(args, ctx) {
      // GET 统计类
      if ((ACCT_SUB_GETS as readonly string[]).includes(args.type)) {
        const res = await ctx.get(
          `/${MODULE}/${statPathOf(args.type)}/${encodeURIComponent(args.id)}`,
        );
        return { data: unwrap(res) };
      }
      // POST 分页类(需把 accountId 作为 body 的 customerId 字段,Cordys 子资源按此过滤)
      if ((ACCT_SUB_PAGES as readonly string[]).includes(args.type)) {
        const body = buildPagePayload(args.payload);
        body.customerId = args.id;
        const res = await ctx.post(`/${MODULE}/${args.type}/page`, body);
        const data = unwrap<PagedData>(res);
        return { data: data.list, meta: pagedMeta(data) };
      }
      throw new errs.ValidationError({
        subtype: "invalid_argument",
        param: "<type>",
        message: `不支持的子资源类型 "${args.type}"`,
        hint: `分页:${ACCT_SUB_PAGES.join(", ")};统计:${ACCT_SUB_GETS.join(", ")}`,
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
