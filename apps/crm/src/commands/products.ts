/**
 * products —— 商品目录(经 gateway 调 /api/products)
 *
 * 迁自 v1 commands/products.ts。商品目录全局共享(非按用户隔离)。
 * 美化打印用框架兜底(--no-json 自动表格)。
 */

import {
  defineCommands,
  defineCommand,
  errs,
  defineCommandFromArgs,
} from "@renxqoo/agent-data-cli";

export const productsCommands = defineCommands({
  list: defineCommandFromArgs({
    name: "list",
    description: "查询商品列表",
    args: { category: { type: "string", desc: "按分类精确过滤,如:电脑外设" } },
    async run(args, ctx) {
      const res = await ctx.get(
        "/proxy/api/products",
        args.category ? { category: args.category } : {},
      );
      return { data: res.data };
    },
  }),

  get: defineCommand<{ id: string }>({
    name: "get",
    description: "查询单个商品详情",
    args: { id: { type: "string", required: true, positional: true, desc: "商品 ID" } },
    async run({ id }, ctx) {
      const res = await ctx.get(`/proxy/api/products/${encodeURIComponent(id)}`);
      if (res.status === 404) throw new errs.NotFoundError(`Product ${id} not found`);
      return { data: res.data };
    },
  }),
});
