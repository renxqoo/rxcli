/**
 * orders —— 订单管理(经 gateway 调 /api/orders)
 *
 * 迁自 v1 commands/orders.ts,改用 cli-sdk v2 的 defineCommand。
 * v1 的 printGatewayJson 固定 GET → v2 用 ctx.get;美化打印用框架兜底(--no-json 自动表格)。
 */

import * as z from "zod";
import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";

export const ordersCommands = defineCommands({
  list: defineCommand({
    name: "list",
    description: "查询订单列表(仅本人订单)",
    args: {
      schema: z.object({
        limit: z.coerce.number().describe("返回数量上限").optional(),
        cursor: z.string().describe("续拉游标（使用上次 meta.pagination.next_token）").optional(),
      }),
    },
    async run(ctx, { limit, cursor }) {
      const query = {
        ...(limit ? { limit } : {}),
        ...(cursor ? { cursor } : {}),
      };
      const res = await ctx.get<{
        orders: unknown[];
        hasMore: boolean;
        nextCursor: string | null;
      }>("/proxy/api/orders", query);
      return {
        data: res.data,
        meta: {
          count: res.data.orders.length,
          pagination: {
            complete: !res.data.hasMore,
            items: res.data.orders.length,
            nextToken: res.data.nextCursor ?? undefined,
          },
        },
      };
    },
  }),

  get: defineCommand({
    name: "get",
    description: "查询单个订单详情(仅本人订单可见)",
    args: {
      schema: z.object({ id: z.string().describe("订单 ID") }),
      pos: ["id"],
    },
    async run(ctx, { id }) {
      const res = await ctx.get(`/proxy/api/orders/${encodeURIComponent(id)}`);
      if (res.status === 404) throw new errs.NotFoundError(`Order ${id} not found`);
      return { data: res.data };
    },
  }),
});
