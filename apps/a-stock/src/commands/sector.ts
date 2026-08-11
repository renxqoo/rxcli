/**
 * sector —— 板块 / 行业查询
 *
 * 子命令:
 *   - list                    板块列表(行业 / 概念 / 地域)
 *   - stocks <code>           板块成分股
 *   - quote <code>            板块实时行情
 *   - top                     涨幅 / 跌幅 / 成交额 TOP 板块
 */

import * as z from "zod";
import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";
import { getSectorList, getSectorStocks } from "../services/stock.js";

const VALID_KINDS = ["industry", "concept", "area"] as const;
type SectorKind = (typeof VALID_KINDS)[number];

export const sectorCommands = defineCommands({
  list: defineCommand({
    name: "list",
    description: "查询板块列表(行业 / 概念 / 地域)",
    args: {
      schema: z.object({
        kind: z.string().describe("板块类型:industry|concept|area (默认 industry)").optional(),
        page: z.coerce.number().describe("页码(默认 1)").optional(),
        size: z.coerce.number().describe("单页条数(默认 100)").optional(),
      }),
    },
    async run(_ctx, { kind, page, size }) {
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

  stocks: defineCommand({
    name: "stocks",
    description: "查询板块成分股",
    args: {
      schema: z.object({
        code: z.string().describe("板块代码(如 BK1600)"),
        page: z.coerce.number().describe("页码(默认 1)").optional(),
        size: z.coerce.number().describe("单页条数(默认 100)").optional(),
      }),
      pos: ["code"],
    },
    async run(_ctx, { code, page, size }) {
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

  quote: defineCommand({
    name: "quote",
    description: "查询板块实时行情",
    args: {
      schema: z.object({
        code: z.string().describe("板块代码(如 BK1600)"),
      }),
      pos: ["code"],
    },
    async run(_ctx, { code }) {
      // 板块代码是 BK 前缀,东财 secid 是 BK + 数字
      // 板块报价走东财,腾讯不直接支持 BK
      const data = await getSectorList({ kind: "industry", size: 5000 });
      const item = data.items.find((s) => s.code === code);
      if (!item) throw new errs.NotFoundError(`Sector not found: ${code}`);
      return { data: item };
    },
  }),
});
