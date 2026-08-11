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

import * as z from "zod";
import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, unwrapPaged, buildPagePayload, pagedMeta, parseJsonBody } from "../envelope.js";

/** whoami 命令(独立导出,供 index.ts 顶层快捷引用,避免索引访问 undefined)。 */
export const whoamiCommand = defineCommand({
  name: "whoami",
  description: "查询当前用户信息(兼验证凭证是否有效)",
  async run(ctx) {
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
    async run(ctx) {
      const res = await ctx.get(`/personal/center/info`);
      return { data: unwrap(res) };
    },
  }),

  /** org:部门组织树。 */
  org: defineCommand({
    name: "org",
    description: "查询部门组织树",
    async run(ctx) {
      const res = await ctx.get(`/department/tree`);
      return { data: unwrap(res) };
    },
  }),

  /** members:成员列表(POST page_payload)。 */
  members: defineCommand({
    name: "members",
    description: "查询成员列表(分页)",
    args: {
      schema: z.object({
        payload: z.string().describe("分页载荷(JSON 或关键词)").optional(),
      }),
      pos: ["payload"],
    },
    async run(ctx, { payload }) {
      const body = buildPagePayload(payload);
      // 服务端对 null departmentIds 会抛 NPE;缺省时用当前用户所在部门兜底,
      // 解析不到则前置为清晰的 missing_required(避免误导性的 500)。
      if (body.departmentIds === undefined || body.departmentIds === null) {
        const info = unwrap(await ctx.get(`/personal/center/info`)) as {
          departmentId?: string;
        } | null;
        const deptId = info?.departmentId;
        if (!deptId) {
          throw new errs.ValidationError({
            subtype: "missing_required",
            param: "departmentIds",
            message:
              "members requires departmentIds and the current user's department could not be resolved",
            hint: `Provide the positional payload, e.g. rxcordys util members '{"departmentIds":["<deptId>"]}' (dept ids via 'rxcordys util org')`,
          });
        }
        body.departmentIds = [deptId];
      }
      const res = await ctx.post(`/user/list`, body);
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** glocount:全局搜索模块计数(按关键词)。POST,keyword 作 query 参数(Spring @RequestParam)。 */
  glocount: defineCommand({
    name: "glocount",
    description: "全局搜索模块计数(按关键词返回各模块命中数)",
    args: {
      schema: z.object({ keyword: z.string().describe("搜索关键词") }),
      pos: ["keyword"],
    },
    async run(ctx, { keyword }) {
      const res = await ctx.request({
        method: "POST",
        path: `/global/search/module/count`,
        query: { keyword },
      });
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
  raw: defineCommand({
    name: "raw",
    description: "原始透传任意端点(相对路径拼 baseUrl,绝对 URL 直连)",
    args: {
      schema: z.object({
        method: z.string().describe("HTTP 方法(GET/POST/PUT/PATCH/DELETE)"),
        path: z.string().describe("路径(相对拼 baseUrl / 绝对 URL)"),
        body: z.string().describe("请求体 JSON(POST/PUT/PATCH 有效)").optional(),
      }),
      pos: ["method", "path"],
    },
    async run(ctx, { method, path, body }) {
      const upper = method.toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(upper)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<method>",
          message: `method must be GET/POST/PUT/PATCH/DELETE, got "${method}"`,
        });
      }
      const hasBody = upper === "POST" || upper === "PUT" || upper === "PATCH";
      const reqBody = hasBody && body ? parseJsonBody(body, "<body>") : undefined;
      const res = await ctx.request({
        method: upper as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        path,
        ...(reqBody !== undefined ? { body: reqBody } : {}),
      });
      // raw 透传不解包(返回原始统一输出格式),让调用方自行判断。
      // 空 body(如 Cordys 对不存在端点返回 200+空体)→ data:null(非 undefined,避免 contract_violation)
      return { data: res.data ?? null };
    },
  }),
});
