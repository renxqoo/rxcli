/**
 * index —— 大盘指数 / 主要指数查询
 *
 * 子命令:
 *   - list        常用指数清单(上证/深证/沪深 300/创业板 等)
 *   - get <code>  单个指数实时行情
 *   - kline <code> 指数 K 线
 */

import * as z from "zod";
import { defineCommands, defineCommand } from "@renxqoo/agent-data-cli";
import { MAJOR_INDICES, getStockList } from "../services/stock.js";
import { getQuote } from "../services/quote.js";
import { getKline } from "../services/kline.js";
import { getNorthbound } from "../services/advanced.js";

export const indexCommands = defineCommands({
  list: defineCommand({
    name: "list",
    description: "常用指数清单(预置 9 个主要指数)",
    async run(_ctx) {
      // 指数代码(sh000001 / sz399001 等)直接传 quote 服务拉行情
      const codes = MAJOR_INDICES.map((i) => i.code);
      const quotes = await Promise.all(codes.map((c) => getQuote(c).catch(() => null)));
      const items = MAJOR_INDICES.map((i, idx) => {
        const q = quotes[idx];
        return {
          code: i.code,
          name: i.name,
          price: q?.price ?? null,
          change: q?.change ?? null,
          changePercent: q?.changePercent ?? null,
          open: q?.open ?? null,
          high: q?.high ?? null,
          low: q?.low ?? null,
          prevClose: q?.prevClose ?? null,
          volume: q?.volume ?? null,
          amount: q?.amount ?? null,
          time: q?.time ?? "",
        };
      });
      return { data: items, meta: { count: items.length } };
    },
  }),

  get: defineCommand({
    name: "get",
    description: "查询单个指数实时行情",
    args: {
      schema: z.object({
        code: z.string().describe("指数代码(如 sh000001 上证、sz399001 深证、sh000300 沪深 300)"),
      }),
      pos: ["code"],
    },
    humanFormat: (d) => {
      const q = d as Record<string, unknown>;
      const sign = Number(q.change) >= 0 ? "+" : "";
      return (
        `${q.name} (${q.code})\n` +
        `当前 ${q.price}  ${sign}${q.change} (${sign}${q.changePercent}%)\n` +
        `开 ${q.open}  高 ${q.high}  低 ${q.low}  昨收 ${q.prevClose}\n` +
        `成交额 ${q.amount}  ${q.time}`
      );
    },
    async run(_ctx, { code }) {
      const data = await getQuote(code);
      return { data };
    },
  }),

  kline: defineCommand({
    name: "kline",
    description: "查询指数 K 线",
    args: {
      schema: z.object({
        code: z.string().describe("指数代码"),
        period: z.string().describe("周期:day|week|month|m5|m15|m30|m60 (默认 day)").optional(),
        limit: z.coerce.number().describe("返回根数(默认 320)").optional(),
      }),
      pos: ["code"],
    },
    async run(_ctx, { code, period, limit }) {
      const data = await getKline(code, {
        period: (period as any) ?? "day",
        limit: limit ?? 320,
      });
      return { data, meta: { count: data.length } };
    },
  }),

  northbound: defineCommand({
    name: "northbound",
    description: "查询北向资金(沪深股通成交额/持股市值/领涨股)",
    args: {
      schema: z.object({
        type: z.string().describe("通道:001=沪股通 / 003=深股通 / all=全部(默认 all)").optional(),
        pageSize: z.coerce.number().describe("返回天数(默认 30)").optional(),
      }),
    },
    async run(_ctx, { type, pageSize }) {
      const t = (type ?? "all") as "001" | "003" | "all";
      const data = await getNorthbound({ type: t, pageSize: pageSize ?? 30 });
      return {
        data,
        meta: { count: data.length, type: t },
      };
    },
  }),
});
