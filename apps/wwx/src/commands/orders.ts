import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";

/**
 * 订单实体(按后端字段;占位字段待确认真实响应后调整)。
 * 列表响应:{ data: Order[], total: number, page: number }(分页方案 B)
 */
interface Order {
  id: string;
  // TODO: 确认订单详情字段(金额/状态/时间等),补到 Order 接口
  [key: string]: unknown;
}

/** 分页方案 B 的列表响应结构。 */
interface OrderListResponse {
  data: Order[];
  total: number;
  page: number;
}

export const ordersCommands = defineCommands({
  /** 查询订单列表(支持分页续拉)。 */
  list: defineCommand({
    name: "list",
    description: "查询订单列表",
    args: {
      page: { type: "number", default: 1, desc: "页码(从 1 开始)" },
      size: { type: "number", default: 20, desc: "每页数量" },
    },
    async run(args, ctx) {
      const res = await ctx.get<OrderListResponse>("/orders", {
        page: args.page,
        size: args.size,
      });
      const items = res.data.data;
      const total = res.data.total;
      const page = res.data.page;
      // 方案 B:current * size >= total 表示已拉完。
      // complete 必须如实填——false 但其实拉完 → agent 死循环续拉;true 但还有 → 漏拉。
      const isLast = page * args.size >= total;
      return {
        data: items,
        meta: {
          count: items.length,
          pagination: {
            complete: isLast,
            pages: Math.ceil(total / args.size),
            items: total,
            // B 方案无 cursor,续拉用下一页码;agent 据此传 --page <页码>
            nextToken: isLast ? undefined : String(page + 1),
          },
        },
      };
    },
  }),

  /** 查询单个订单详情。 */
  get: defineCommand<{ id: string }>({
    name: "get",
    description: "查询订单详情",
    args: {
      id: { type: "string", required: true, positional: true, desc: "订单 ID" },
    },
    async run({ id }, ctx) {
      // 404 未配进 errorOnStatus → 在此手写 if 才可达。
      const res = await ctx.get<Order>(`/orders/${id}`);
      if (res.status === 404) throw new errs.NotFoundError(`订单 ${id} 不存在`);
      return { data: res.data };
    },
  }),
});
