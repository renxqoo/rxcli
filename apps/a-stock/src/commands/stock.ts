/**
 * stock —— 股票信息(列表 / 搜索 / 公司基本信息)
 *
 * 子命令:
 *   - search <keyword>        按代码 / 名称 / 拼音搜索股票
 *   - list                    全市场股票列表(支持分页 + 排序 + 筛选)
 *   - info <code>             公司基本信息
 */

import * as z from "zod";
import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";
import { searchStocks, getStockList, getCompanyProfile } from "../services/stock.js";
import { getValuation } from "../services/kline.js";
import { getDiagnosis } from "../services/diagnosis.js";
import type { ListMarket, ListSort } from "../sources/eastmoney.js";

const VALID_MARKETS: ListMarket[] = ["sh", "sz", "bj", "all"];
const VALID_SORTS: ListSort[] = ["changePercent", "change", "amount", "volume", "code", "name"];

export const stockCommands = defineCommands({
  search: defineCommand({
    name: "search",
    description: "搜索股票(支持代码 / 中文名称 / 拼音首字母)",
    args: {
      schema: z.object({
        keyword: z.string().describe("搜索关键字(代码如 600519 / 名称如 茅台 / 拼音如 gzmt)"),
        limit: z.coerce.number().describe("返回条数(默认 20)").optional(),
      }),
      pos: ["keyword"],
    },
    async run(_ctx, { keyword, limit }) {
      const data = await searchStocks(keyword);
      const capped = limit ? data.slice(0, limit) : data.slice(0, 20);
      return {
        data: capped,
        meta: {
          total: data.length,
          keyword,
          hint: "Use `rxstock stock info <code>` or `rxstock quote get <code>` for details",
        },
      };
    },
  }),

  list: defineCommand({
    name: "list",
    description: "查询股票列表(全市场 / 按市场过滤 / 排序 / 分页)",
    args: {
      schema: z.object({
        market: z.string().describe("市场:sh|sz|bj|all (默认 all)").optional(),
        page: z.coerce.number().describe("页码(默认 1)").optional(),
        size: z.coerce.number().describe("单页条数(默认 100,最大 1000)").optional(),
        sort: z
          .string()
          .describe("排序字段:changePercent|change|amount|volume|code|name (默认 changePercent)")
          .optional(),
        desc: z.boolean().describe("是否降序(默认 true)").optional(),
      }),
    },
    async run(_ctx, { market, page, size, sort, desc }) {
      const m = (market ?? "all") as ListMarket;
      if (!VALID_MARKETS.includes(m)) {
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "market",
          message: `Unsupported market: ${market} (valid: ${VALID_MARKETS.join(",")})`,
        });
      }
      const s = (sort ?? "changePercent") as ListSort;
      if (!VALID_SORTS.includes(s)) {
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "sort",
          message: `Unsupported sort field: ${sort} (valid: ${VALID_SORTS.join(",")})`,
        });
      }
      const data = await getStockList({
        market: m,
        page: page ?? 1,
        size: Math.min(size ?? 100, 1000),
        sort: s,
        desc: desc ?? true,
      });
      return {
        data: data.items,
        meta: {
          total: data.total,
          page: page ?? 1,
          size: size ?? 100,
          pagination: {
            complete: (page ?? 1) * (size ?? 100) >= data.total,
            nextToken:
              (page ?? 1) * (size ?? 100) < data.total ? String((page ?? 1) + 1) : undefined,
          },
        },
      };
    },
  }),

  info: defineCommand({
    name: "info",
    description: "查询公司基本信息(总股本 / 流通股本 / 上市日期 等)",
    args: {
      schema: z.object({ code: z.string().describe("股票代码") }),
      pos: ["code"],
    },
    humanFormat: formatProfileHuman,
    async run(_ctx, { code }) {
      const data = await getCompanyProfile(code);
      if (!data) throw new errs.NotFoundError(`Company info not found for ${code}`);
      return { data };
    },
  }),

  valuation: defineCommand({
    name: "valuation",
    description: "估值分位(PE/PB 在历史区间的百分位,判断当前贵不贵)",
    args: {
      schema: z.object({
        code: z.string().describe("股票代码"),
        days: z.coerce.number().describe("历史回溯天数(默认 250,约一年)").optional(),
      }),
      pos: ["code"],
    },
    async run(_ctx, { code, days }) {
      const data = await getValuation(code, days ?? 250);
      if (!data)
        throw new errs.NotFoundError(
          `Cannot calculate valuation for ${code} (missing EPS/BPS or insufficient historical data)`,
        );
      return {
        data,
        meta: {
          hint: "Percentile 0-100: >80 expensive (overvalued), <20 cheap (undervalued), 50 median. Based on price/EPS proxy, reflects valuation trend with price changes",
        },
      };
    },
  }),

  diagnosis: defineCommand({
    name: "diagnosis",
    description: "个股综合诊断(一次性聚合基本面+技术面+股东+估值,深度分析用)",
    args: {
      schema: z.object({ code: z.string().describe("股票代码") }),
      pos: ["code"],
    },
    async run(_ctx, { code }) {
      const data = await getDiagnosis(code);
      return {
        data,
        meta: {
          dimensions: ["fundamental", "technical", "holders"],
          hint: "Fundamentals: PE/PB/ROE/growth; Technicals: MA alignment/MACD/RSI/KDJ; Shareholders: concentration trend",
        },
      };
    },
  }),
});

function formatProfileHuman(data: unknown): string {
  const p = data as Record<string, unknown>;
  if (!p || typeof p !== "object") return "（无数据）";
  const lines: string[] = [];
  lines.push(`${p.name} (${p.code})`);
  if (p.totalShares) lines.push(`总股本: ${(Number(p.totalShares) / 1e8).toFixed(2)} 亿股`);
  if (p.circulateShares)
    lines.push(`流通股本: ${(Number(p.circulateShares) / 1e8).toFixed(2)} 亿股`);
  if (p.totalMarketCap) lines.push(`总市值: ${(Number(p.totalMarketCap) / 1e8).toFixed(2)} 亿元`);
  if (p.circulateMarketCap)
    lines.push(`流通市值: ${(Number(p.circulateMarketCap) / 1e8).toFixed(2)} 亿元`);
  if (p.industry) lines.push(`所属行业: ${p.industry}`);
  if (p.listDate) lines.push(`上市日期: ${p.listDate}`);
  if (p.controller) lines.push(`实际控制人: ${p.controller}`);
  return lines.join("\n");
}
