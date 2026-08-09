/**
 * util —— 工具命令(whoami/verify/org/members/glocount/raw)。
 *
 * 端点:
 *   GET  /personal/center/info          当前用户信息(whoami/verify)
 *   GET  /department/tree               部门组织树
 *   POST /user/list                     成员列表(POST page_payload)
 *   GET  /global/search/module/count?keyword=  全局搜索模块计数
 *   — raw:通用透传(相对路径拼 baseUrl,绝对 URL 直连)—
 */

import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";

/** whoami 命令(独立导出,供 index.ts 顶层快捷引用,避免索引访问 undefined)。 */
export const whoamiCommand = defineCommand({
  name: "whoami",
  description: "查询当前用户信息(兼验证凭证是否有效)",
  args: {},
  async run(_args, ctx) {
    const res = await ctx.get(`/personal/center/info`);
    return { data: unwrap(res) };
  },
});

export const utilCommands: CommandGroup = defineCommands({
  /** whoami:当前登录用户信息(兼作凭证校验)。 */
  whoami: whoamiCommand,

  /** verify:验证凭证(同 whoami 端点,语义化命名)。 */
  verify: defineCommand({
    name: "verify",
    description: "验证当前凭证是否有效(返回用户信息)",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/personal/center/info`);
      return { data: unwrap(res) };
    },
  }),

  /** org:部门组织树。 */
  org: defineCommand({
    name: "org",
    description: "查询部门组织树",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/department/tree`);
      return { data: unwrap(res) };
    },
  }),

  /** members:成员列表(POST page_payload)。 */
  members: defineCommand<{ payload: string }>({
    name: "members",
    description: "查询成员列表(分页)",
    args: { payload: { type: "string", positional: true, desc: "分页载荷(JSON 或关键词)" } },
    async run(args, ctx) {
      const res = await ctx.post(`/user/list`, buildPagePayload(args.payload));
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** glocount:全局搜索模块计数(按关键词)。 */
  glocount: defineCommand<{ keyword: string }>({
    name: "glocount",
    description: "全局搜索模块计数(按关键词返回各模块命中数)",
    args: { keyword: { type: "string", required: true, positional: true, desc: "搜索关键词" } },
    async run(args, ctx) {
      const res = await ctx.get(`/global/search/module/count`, { keyword: args.keyword });
      return { data: unwrap(res) };
    },
  }),

  /**
   * raw:原始透传任意端点。
   *   rxcordys util raw <METHOD> <path> [body]
   *   - 相对路径:拼到 baseUrl(如 lead/page)
   *   - 绝对 URL(http*):直连(原样请求)
   *   - body 仅 POST/PUT/PATCH 有效(JSON 字符串)
   */
  raw: defineCommand<{ method: string; path: string; body: string }>({
    name: "raw",
    description: "原始透传任意端点(相对路径拼 baseUrl,绝对 URL 直连)",
    args: {
      method: {
        type: "string",
        required: true,
        positional: true,
        desc: "HTTP 方法(GET/POST/PUT/PATCH/DELETE)",
      },
      path: {
        type: "string",
        required: true,
        positional: true,
        desc: "路径(相对拼 baseUrl / 绝对 URL)",
      },
      body: { type: "string", desc: "请求体 JSON(POST/PUT/PATCH 有效)" },
    },
    async run(args, ctx) {
      const method = args.method.toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<method>",
          message: `method 只能是 GET/POST/PUT/PATCH/DELETE,收到 "${args.method}"`,
        });
      }
      const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
      const reqBody = hasBody && args.body ? parseJsonBody(args.body, "<body>") : undefined;
      const res = await ctx.request({
        method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        path: args.path,
        ...(reqBody !== undefined ? { body: reqBody } : {}),
      });
      // raw 透传不解包(返回原始信封),让调用方自行判断
      return { data: res.data };
    },
  }),
});
