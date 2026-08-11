/**
 * records —— 跨模块通用命令(view/get/page/search/contact/product/form)。
 *
 * Cordys 核心设计是「模块作为路径段」,这些命令对一级模块通用:
 *   rxcordys records view <module> [opts]
 *   rxcordys records get <module> <id>
 *   rxcordys records page <module> [keyword|JSON]
 *   rxcordys records search <module> [keyword|JSON]
 *   rxcordys records contact <module> <id>
 *   rxcordys records product [keyword|JSON]
 *   rxcordys records form <module>
 */

import * as z from "zod";
import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { VIEW_MODULES, isOneOf } from "../constants.js";
import { unwrap, detailPath, unwrapPaged, buildPagePayload, pagedMeta } from "../envelope.js";

export const recordsCommands: CommandGroup = defineCommands({
  /** view:视图列表(/{module}/view/list),GET 带 query。 */
  view: defineCommand({
    name: "view",
    description: "按视图查询模块列表(支持 lead/account/opportunity/contact/contract/order)",
    args: {
      schema: z.object({
        module: z.string().describe("模块名"),
        opts: z.string().describe("查询参数(JSON 字符串,透传为 query)").optional(),
      }),
      pos: ["module"],
    },
    async run(ctx, { module, opts }) {
      if (!isOneOf(module, VIEW_MODULES)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<module>",
          message: `view does not support module "${module}"`,
          hint: `Valid: ${VIEW_MODULES.join(", ")}`,
        });
      }
      const query = opts ? parseQueryOpts(opts) : {};
      const res = await ctx.get(`/${module}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  /** get:单条详情(/{module}/{id}),GET。opportunity/quotation 特殊路径。 */
  get: defineCommand({
    name: "get",
    description: "查询单条记录详情",
    args: {
      schema: z.object({
        module: z.string().describe("模块名(可含斜杠,如 contract/payment-plan)"),
        id: z.string().describe("记录 ID"),
      }),
      pos: ["module", "id"],
    },
    async run(ctx, { module, id }) {
      // Cordys 详情统一为 GET /{module}/get/{id}(含 opportunity/quotation)。
      const res = await ctx.get(detailPath(module, id));
      return { data: unwrap(res) };
    },
  }),

  /** page:分页列表(/{module}/page),POST 带 page_payload。 */
  page: defineCommand({
    name: "page",
    description: "分页查询模块列表(带筛选/排序/关键词,POST page_payload)",
    args: {
      schema: z.object({
        module: z.string().describe("模块名"),
        payload: z.string().describe("分页载荷(JSON 或关键词字符串)").optional(),
      }),
      pos: ["module"],
    },
    async run(ctx, { module, payload }) {
      const body = buildPagePayload(payload);
      const res = await ctx.post(`/${module}/page`, body);
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** search:全局搜索(/global/search/{module}),POST。quotation 无全局搜索,回退 page。 */
  search: defineCommand({
    name: "search",
    description: "全局关键词搜索模块(/global/search/{module})",
    args: {
      schema: z.object({
        module: z.string().describe("模块名"),
        payload: z.string().describe("搜索载荷(JSON 或关键词字符串)").optional(),
      }),
      pos: ["module"],
    },
    async run(ctx, { module, payload }) {
      const body = buildPagePayload(payload);
      // opportunity/quotation 无 /global/search 路径,回退 /opportunity/quotation/page
      if (module === "opportunity/quotation") {
        const res = await ctx.post(`/opportunity/quotation/page`, body);
        const data = unwrapPaged(res);
        return { data: data.list, meta: pagedMeta(data) };
      }
      const res = await ctx.post(`/global/search/${module}`, body);
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** contact:查父记录下的联系人(/{module}/contact/list/{id}),GET。 */
  contact: defineCommand({
    name: "contact",
    description: "查询某客户/商机/线索下的联系人列表",
    args: {
      schema: z.object({
        module: z.string().describe("父模块(lead/account/opportunity)"),
        id: z.string().describe("父记录 ID"),
      }),
      pos: ["module", "id"],
    },
    async run(ctx, { module, id }) {
      if (!isOneOf(module, ["lead", "account", "opportunity"])) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<module>",
          message: `contact does not support module "${module}"`,
          hint: "Valid: lead, account, opportunity",
        });
      }
      const res = await ctx.get(`/${module}/contact/list/${encodeURIComponent(id)}`);
      return { data: unwrap(res) };
    },
  }),

  /** product:产品字段源查询(/field/source/product),POST。 */
  product: defineCommand({
    name: "product",
    description: "产品字段源查询(用于商机/合同选产品)",
    args: {
      schema: z.object({
        payload: z.string().describe("查询载荷(JSON 或关键词字符串)").optional(),
      }),
      pos: ["payload"],
    },
    async run(ctx, { payload }) {
      const body = buildPagePayload(payload);
      const res = await ctx.post(`/field/source/product`, body);
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** form:表单定义(/{module}/module/form),GET,写入前置。 */
  form: defineCommand({
    name: "form",
    description: "查询模块表单字段定义(写入前必读,了解必填字段)",
    args: {
      schema: z.object({
        module: z.string().describe("模块名(可含斜杠或 follow/plan)"),
      }),
      pos: ["module"],
    },
    async run(ctx, { module }) {
      const res = await ctx.get(`/${module}/module/form`);
      return { data: unwrap(res) };
    },
  }),
});

/** 把 opts(JSON 字符串)解析成 query 对象。 */
function parseQueryOpts(opts: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(opts);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fallthrough */
  }
  throw new errs.ValidationError({
    subtype: "invalid_argument",
    param: "--opts",
    message: `opts is not a valid JSON object: ${opts}`,
    hint: "Provide a JSON object, e.g. '{\"pageSize\":10}'",
  });
}
