/**
 * stats —— 统计模块(模块金额统计 + 首页看板统计)。
 *
 * 端点:
 *   — 模块金额统计(POST,返回 {amount, averageAmount})—
 *   POST /contract/statistic                  合同统计
 *   POST /contract/payment-record/statistic   回款统计
 *   POST /opportunity/statistic               商机统计
 *   POST /order/statistic                     订单统计
 *   — 首页看板统计(POST,HomeStatisticBaseSearchRequest)—
 *   POST /home/statistic/lead                 线索首页统计(今日/本周/本月/本年 + 环比)
 *   POST /home/statistic/opportunity          商机首页统计
 *   POST /home/statistic/opportunity/success  成功商机统计
 *   POST /home/statistic/opportunity/underway 进行中商机统计
 *   GET  /home/statistic/department/tree      部门权限树
 *
 * HomeStatisticBaseSearchRequest:{ searchType: ALL|SELF|DEPARTMENT, deptIds[], timeField, userField, priorPeriodEnable }
 */

import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, parseJsonBody } from "../envelope.js";

/** 模块金额统计支持的模块。 */
const STAT_MODULES = ["contract", "payment-record", "opportunity", "order"] as const;

export const statsCommands: CommandGroup = defineCommands({
  /** 模块金额统计(contract/payment-record/opportunity/order)。 */
  stat: defineCommand<{ module: string; payload: string }>({
    name: "stat",
    description: "模块金额统计(返回 {amount, averageAmount})",
    args: {
      module: {
        type: "string",
        required: true,
        positional: true,
        desc: "模块(contract/payment-record/opportunity/order)",
      },
      payload: { type: "string", desc: "统计载荷 JSON(含筛选条件)" },
    },
    async run(args, ctx) {
      if (!(STAT_MODULES as readonly string[]).includes(args.module)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<module>",
          message: `stat does not support module "${args.module}"`,
          hint: `Valid: ${STAT_MODULES.join(", ")}`,
        });
      }
      const body = args.payload ? parseJsonBody(args.payload, "<payload>") : {};
      // payment-record 是 contract 的子资源,路径特殊
      const path =
        args.module === "payment-record"
          ? `/contract/payment-record/statistic`
          : `/${args.module}/statistic`;
      const res = await ctx.post(path, body);
      return { data: unwrap(res) };
    },
  }),

  /** 首页线索统计。 */
  "home-lead": defineCommand<{ payload: string }>({
    name: "home-lead",
    description: "首页线索统计(今日/本周/本月/本年 + 环比)",
    args: { payload: { type: "string", desc: "HomeStatisticBaseSearchRequest JSON" } },
    async run(args, ctx) {
      const body = args.payload ? parseJsonBody(args.payload, "<payload>") : {};
      const res = await ctx.post(`/home/statistic/lead`, body);
      return { data: unwrap(res) };
    },
  }),

  /** 首页商机统计(all/success/underway)。 */
  "home-opportunity": defineCommand<{ type: string; payload: string }>({
    name: "home-opportunity",
    description: "首页商机统计(type ∈ all/success/underway)",
    args: {
      type: { type: "string", desc: "商机统计类型(all/success/underway)", default: "all" },
      payload: { type: "string", desc: "HomeStatisticBaseSearchRequest JSON" },
    },
    async run(args, ctx) {
      const type = args.type || "all";
      if (!["all", "success", "underway"].includes(type)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "--type",
          message: `home-opportunity type must be all/success/underway, got "${type}"`,
        });
      }
      const body = args.payload ? parseJsonBody(args.payload, "<payload>") : {};
      const path =
        type === "all" ? `/home/statistic/opportunity` : `/home/statistic/opportunity/${type}`;
      const res = await ctx.post(path, body);
      return { data: unwrap(res) };
    },
  }),

  /** 部门权限树(首页统计用)。 */
  "dept-tree": defineCommand({
    name: "dept-tree",
    description: "查询当前用户可见的部门权限树",
    args: {},
    async run(_args, ctx) {
      const res = await ctx.get(`/home/statistic/department/tree`);
      return { data: unwrap(res) };
    },
  }),
});
