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

import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { PRIMARY_MODULES, VIEW_MODULES, WRITE_MODULES, isOneOf } from "../constants.js";
import { unwrap, buildPagePayload, pagedMeta, type PagedData } from "../envelope.js";

export const recordsCommands: CommandGroup = defineCommands({
  /** view:视图列表(/{module}/view/list),GET 带 query。 */
  view: defineCommand<{ module: string; opts: string }>({
    name: "view",
    description: "按视图查询模块列表(支持 lead/account/opportunity/contact/contract/order)",
    args: {
      module: { type: "string", required: true, positional: true, desc: "模块名" },
      opts: { type: "string", desc: "查询参数(JSON 字符串,透传为 query)" },
    },
    async run(args, ctx) {
      if (!isOneOf(args.module, VIEW_MODULES)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<module>",
          message: `view does not support module "${args.module}"`,
          hint: `Valid: ${VIEW_MODULES.join(", ")}`,
        });
      }
      let query: Record<string, unknown> = {};
      if (args.opts) query = parseQueryOpts(args.opts);
      const res = await ctx.get(`/${args.module}/view/list`, query);
      return { data: unwrap(res) };
    },
  }),

  /** get:单条详情(/{module}/{id}),GET。opportunity/quotation 特殊路径。 */
  get: defineCommand<{ module: string; id: string }>({
    name: "get",
    description: "查询单条记录详情",
    args: {
      module: {
        type: "string",
        required: true,
        positional: true,
        desc: "模块名(可含斜杠,如 contract/payment-plan)",
      },
      id: { type: "string", required: true, positional: true, desc: "记录 ID" },
    },
    async run(args, ctx) {
      const path =
        args.module === "opportunity/quotation"
          ? `/opportunity/quotation/get/${encodeURIComponent(args.id)}`
          : `/${args.module}/${encodeURIComponent(args.id)}`;
      const res = await ctx.get(path);
      return { data: unwrap(res) };
    },
  }),

  /** page:分页列表(/{module}/page),POST 带 page_payload。 */
  page: defineCommand<{ module: string; payload: string }>({
    name: "page",
    description: "分页查询模块列表(带筛选/排序/关键词,POST page_payload)",
    args: {
      module: { type: "string", required: true, positional: true, desc: "模块名" },
      payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词字符串)" },
    },
    async run(args, ctx) {
      const body = buildPagePayload(args.payload);
      const res = await ctx.post(`/${args.module}/page`, body);
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** search:全局搜索(/global/search/{module}),POST。quotation 无全局搜索,回退 page。 */
  search: defineCommand<{ module: string; payload: string }>({
    name: "search",
    description: "全局关键词搜索模块(/global/search/{module})",
    args: {
      module: { type: "string", required: true, positional: true, desc: "模块名" },
      payload: { type: "string", positional: true, desc: "搜索载荷(JSON 或关键词字符串)" },
    },
    async run(args, ctx) {
      const body = buildPagePayload(args.payload);
      // opportunity/quotation 无 /global/search 路径,回退 /opportunity/quotation/page
      if (args.module === "opportunity/quotation") {
        const res = await ctx.post(`/opportunity/quotation/page`, body);
        const data = unwrap<PagedData>(res);
        return { data: data.list, meta: pagedMeta(data) };
      }
      const res = await ctx.post(`/global/search/${args.module}`, body);
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** contact:查父记录下的联系人(/{module}/contact/list/{id}),GET。 */
  contact: defineCommand<{ module: string; id: string }>({
    name: "contact",
    description: "查询某客户/商机/线索下的联系人列表",
    args: {
      module: {
        type: "string",
        required: true,
        positional: true,
        desc: "父模块(lead/account/opportunity)",
      },
      id: { type: "string", required: true, positional: true, desc: "父记录 ID" },
    },
    async run(args, ctx) {
      if (!isOneOf(args.module, ["lead", "account", "opportunity"])) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<module>",
          message: `contact does not support module "${args.module}"`,
          hint: "Valid: lead, account, opportunity",
        });
      }
      const res = await ctx.get(`/${args.module}/contact/list/${encodeURIComponent(args.id)}`);
      return { data: unwrap(res) };
    },
  }),

  /** product:产品字段源查询(/field/source/product),POST。 */
  product: defineCommand<{ payload: string }>({
    name: "product",
    description: "产品字段源查询(用于商机/合同选产品)",
    args: {
      payload: { type: "string", positional: true, desc: "查询载荷(JSON 或关键词字符串)" },
    },
    async run(args, ctx) {
      const body = buildPagePayload(args.payload);
      const res = await ctx.post(`/field/source/product`, body);
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** form:表单定义(/{module}/module/form),GET,写入前置。 */
  form: defineCommand<{ module: string }>({
    name: "form",
    description: "查询模块表单字段定义(写入前必读,了解必填字段)",
    args: {
      module: {
        type: "string",
        required: true,
        positional: true,
        desc: "模块名(可含斜杠或 follow/plan)",
      },
    },
    async run(args, ctx) {
      const res = await ctx.get(`/${args.module}/module/form`);
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

/** 暴露模块列表(供文档/校验复用)。 */
export { PRIMARY_MODULES, WRITE_MODULES };
