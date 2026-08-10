/**
 * orders —— 订单管理(经 gateway 调 /api/orders)
 *
 * 迁自 v1 commands/orders.ts,改用 cli-sdk v2 的 defineCommand。
 * v1 的 printGatewayJson 固定 GET → v2 用 ctx.get;美化打印用框架兜底(--no-json 自动表格)。
 */

import {
  defineCommands,
  defineCommand,
  errs,
  defineCommandFromArgs,
} from "@renxqoo/agent-data-cli";

export const ordersCommands = defineCommands({
  list: defineCommandFromArgs({
    name: "list",
    description: "查询订单列表(仅本人订单)",
    args: { limit: { type: "number", desc: "返回数量上限" } },
    async run(args, ctx) {
      const res = await ctx.get("/proxy/api/orders", args.limit ? { limit: args.limit } : {});
      return { data: res.data };
    },
  }),

  get: defineCommand<{ id: string }>({
    name: "get",
    description: "查询单个订单详情(仅本人订单可见)",
    args: { id: { type: "string", required: true, positional: true, desc: "订单 ID" } },
    async run({ id }, ctx) {
      const res = await ctx.get(`/proxy/api/orders/${encodeURIComponent(id)}`);
      if (res.status === 404) throw new errs.NotFoundError(`Order ${id} not found`);
      return { data: res.data };
    },
  }),
});
