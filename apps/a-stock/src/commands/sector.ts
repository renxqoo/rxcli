/**
 * sector —— 板块 / 行业查询
 *
 * 子命令:
 *   - list                    板块列表(行业 / 概念 / 地域)
 *   - stocks <code>           板块成分股
 *   - quote <code>            板块实时行情
 *   - top                     涨幅 / 跌幅 / 成交额 TOP 板块
 */

import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";
import { getSectorList, getSectorStocks } from "../services/stock.js";
import { getQuote } from "../services/quote.js";

const VALID_KINDS = ["industry", "concept", "area"] as const;
type SectorKind = (typeof VALID_KINDS)[number];

export const sectorCommands = defineCommands({
  list: defineCommand<
    {
      kind?: string;
      page?: number;
      size?: number;
    },
    unknown[]
  >({
    name: "list",
    description: "查询板块列表(行业 / 概念 / 地域)",
    args: {
      kind: {
        type: "string",
        desc: "板块类型:industry|concept|area (默认 industry)",
      },
      page: {
        type: "number",
        desc: "页码(默认 1)",
      },
      size: {
        type: "number",
        desc: "单页条数(默认 100)",
      },
    },
    async run({ kind, page, size }) {
      const k = (kind ?? "industry") as SectorKind;
      if (!VALID_KINDS.includes(k)) {
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "kind",
          message: `Unsupported type: ${kind} (valid: ${VALID_KINDS.join(",")})`,
        });
      }
      const data = await getSectorList({
        kind: k,
        page: page ?? 1,
        size: size ?? 100,
      });
      return {
        data: data.items,
        meta: {
          total: data.total,
          kind: k,
        },
      };
    },
  }),

  stocks: defineCommand<{ code: string; page?: number; size?: number }, unknown[]>({
    name: "stocks",
    description: "查询板块成分股",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "板块代码(如 BK1600)",
      },
      page: {
        type: "number",
        desc: "页码(默认 1)",
      },
      size: {
        type: "number",
        desc: "单页条数(默认 100)",
      },
    },
    async run({ code, page, size }) {
      const data = await getSectorStocks(code, {
        page: page ?? 1,
        size: size ?? 100,
      });
      return {
        data: data.items,
        meta: {
          total: data.total,
          sector: code,
        },
      };
    },
  }),

  quote: defineCommand<{ code: string }, unknown>({
    name: "quote",
    description: "查询板块实时行情",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "板块代码(如 BK1600)",
      },
    },
    async run({ code }) {
      // 板块代码是 BK 前缀,东财 secid 是 BK + 数字
      // 板块报价走东财,腾讯不直接支持 BK
      const data = await getSectorList({ kind: "industry", size: 5000 });
      const item = data.items.find((s) => s.code === code);
      if (!item) throw new errs.NotFoundError(`Sector not found: ${code}`);
      return { data: item };
    },
  }),
});
