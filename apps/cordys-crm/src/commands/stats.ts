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

import * as z from "zod";
import { defineCommands, defineCommand, errs, type CommandGroup } from "@renxqoo/agent-data-cli";
import { unwrap, parseJsonBody } from "../envelope.js";

/** 模块金额统计支持的模块。 */
const STAT_MODULES = ["contract", "payment-record", "opportunity", "order"] as const;

export const statsCommands: CommandGroup = defineCommands({
  /** 模块金额统计(contract/payment-record/opportunity/order)。 */
  stat: defineCommand({
    name: "stat",
    description: "模块金额统计(返回 {amount, averageAmount})",
    args: {
      schema: z.object({
        module: z.string().describe("模块(contract/payment-record/opportunity/order)"),
        payload: z.string().describe("统计载荷 JSON(含筛选条件)").optional(),
      }),
      pos: ["module"],
    },
    async run(ctx, { module, payload }) {
      if (!(STAT_MODULES as readonly string[]).includes(module)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<module>",
          message: `stat does not support module "${module}"`,
          hint: `Valid: ${STAT_MODULES.join(", ")}`,
        });
      }
      const body = payload ? parseJsonBody(payload, "<payload>") : {};
      // payment-record 是 contract 的子资源,路径特殊
      const path =
        module === "payment-record" ? `/contract/payment-record/statistic` : `/${module}/statistic`;
      const res = await ctx.post(path, body);
      return { data: unwrap(res) };
    },
  }),

  /** 首页线索统计。 */
  "home-lead": defineCommand({
    name: "home-lead",
    description: "首页线索统计(今日/本周/本月/本年 + 环比)",
    args: {
      schema: z.object({
        payload: z.string().describe("HomeStatisticBaseSearchRequest JSON").optional(),
      }),
    },
    async run(ctx, { payload }) {
      const body = payload ? parseJsonBody(payload, "<payload>") : {};
      const res = await ctx.post(`/home/statistic/lead`, body);
      return { data: unwrap(res) };
    },
  }),

  /** 首页商机统计(all/success/underway)。 */
  "home-opportunity": defineCommand({
    name: "home-opportunity",
    description: "首页商机统计(type ∈ all/success/underway)",
    args: {
      schema: z.object({
        type: z.string().describe("商机统计类型(all/success/underway)").default("all"),
        payload: z.string().describe("HomeStatisticBaseSearchRequest JSON").optional(),
      }),
    },
    async run(ctx, { type, payload }) {
      const t = type || "all";
      if (!["all", "success", "underway"].includes(t)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "--type",
          message: `home-opportunity type must be all/success/underway, got "${t}"`,
        });
      }
      const body = payload ? parseJsonBody(payload, "<payload>") : {};
      const path = t === "all" ? `/home/statistic/opportunity` : `/home/statistic/opportunity/${t}`;
      const res = await ctx.post(path, body);
      return { data: unwrap(res) };
    },
  }),

  /** 部门权限树(首页统计用)。 */
  "dept-tree": defineCommand({
    name: "dept-tree",
    description: "查询当前用户可见的部门权限树",
    async run(ctx) {
      const res = await ctx.get(`/home/statistic/department/tree`);
      return { data: unwrap(res) };
    },
  }),
});
