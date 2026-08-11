/**
 * kline —— K 线 / 分钟线查询
 *
 * 子命令:
 *   - get <code>    K 线(默认日线)
 *   - minute <code> 当日分时图
 *   - tick <code>   当日分笔成交
 */

import * as z from "zod";
import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";
import { getKline, getIndicators, type KlineAdjust, type KlinePeriod } from "../services/kline.js";
import { getMinute, getTicks } from "../services/intraday.js";

const VALID_PERIODS: KlinePeriod[] = ["m1", "m5", "m15", "m30", "m60", "day", "week", "month"];
const VALID_ADJUST: KlineAdjust[] = ["none", "qfq", "hfq"];

export const klineCommands = defineCommands({
  get: defineCommand({
    name: "get",
    description: "查询 K 线(支持日/周/月/分钟级 + 前/后复权)",
    args: {
      schema: z.object({
        code: z.string().describe("股票/指数代码"),
        period: z.string().describe("周期:day|week|month|m1|m5|m15|m30|m60 (默认 day)").optional(),
        adjust: z.string().describe("复权:none|qfq|hfq (默认 none)").optional(),
        limit: z.coerce.number().describe("返回根数(默认 320,最大 ~800)").optional(),
        start: z.string().describe("起始日期 YYYY-MM-DD").optional(),
        end: z.string().describe("结束日期 YYYY-MM-DD").optional(),
      }),
      pos: ["code"],
    },
    async run(_ctx, { code, period, adjust, limit, start, end }) {
      const p = (period ?? "day") as KlinePeriod;
      if (!VALID_PERIODS.includes(p)) {
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "period",
          message: `Unsupported period: ${period} (valid: ${VALID_PERIODS.join(",")})`,
        });
      }
      const a = (adjust ?? "none") as KlineAdjust;
      if (!VALID_ADJUST.includes(a)) {
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "adjust",
          message: `Unsupported adjust: ${adjust} (valid: ${VALID_ADJUST.join(",")})`,
        });
      }
      const data = await getKline(code, {
        period: p,
        adjust: a,
        limit: limit ?? 320,
        start,
        end,
      });
      return {
        data,
        meta: {
          count: data.length,
          period: p,
          adjust: a,
        },
      };
    },
  }),

  minute: defineCommand({
    name: "minute",
    description: "当日分时走势(分钟级,含均价)",
    args: {
      schema: z.object({ code: z.string().describe("股票/指数代码") }),
      pos: ["code"],
    },
    async run(_ctx, { code }) {
      const data = await getMinute(code);
      return {
        data,
        meta: {
          count: data.length,
          type: "minute",
        },
      };
    },
  }),

  tick: defineCommand({
    name: "tick",
    description: "当日分笔成交(tick 级,数据量大)",
    args: {
      schema: z.object({
        code: z.string().describe("股票/指数代码"),
        limit: z.coerce.number().describe("返回条数(默认 100,最大 ~5000)").optional(),
      }),
      pos: ["code"],
    },
    async run(_ctx, { code, limit }) {
      const data = await getTicks(code, limit ?? 100);
      return {
        data,
        meta: {
          count: data.length,
          type: "tick",
        },
      };
    },
  }),

  indicator: defineCommand({
    name: "indicator",
    description: "技术指标计算(MA均线/MACD/RSI/KDJ/布林带/ATR,本地基于日K计算)",
    args: {
      schema: z.object({
        code: z.string().describe("股票代码"),
        types: z
          .string()
          .describe("指标类型,逗号分隔:ma,macd,rsi,kdj,boll,atr (默认全部)")
          .optional(),
        limit: z.coerce.number().describe("基于的历史日K根数(默认 120,越大越准但越慢)").optional(),
      }),
      pos: ["code"],
    },
    async run(_ctx, { code, types, limit }) {
      const typeList = (types ?? "ma,macd,rsi,kdj,boll,atr")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const data = await getIndicators(code, typeList, limit ?? 120);
      return {
        data,
        meta: {
          count: data.length,
          types: typeList,
          hint: "MA for trend; MACD golden/death cross; RSI>70 overbought <30 oversold; KDJ J>90 overbought <10 oversold; Bollinger Bands touching upper/lower rail",
        },
      };
    },
  }),
});
