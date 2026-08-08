/**
 * stock —— 股票信息(列表 / 搜索 / 公司基本信息)
 *
 * 子命令:
 *   - search <keyword>        按代码 / 名称 / 拼音搜索股票
 *   - list                    全市场股票列表(支持分页 + 排序 + 筛选)
 *   - info <code>             公司基本信息
 */

import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";
import { searchStocks, getStockList, getCompanyProfile } from "../services/stock.js";
import { getValuation } from "../services/kline.js";
import { getDiagnosis } from "../services/diagnosis.js";
import type { ListMarket, ListSort } from "../sources/eastmoney.js";

const VALID_MARKETS: ListMarket[] = ["sh", "sz", "bj", "all"];
const VALID_SORTS: ListSort[] = ["changePercent", "change", "amount", "volume", "code", "name"];

export const stockCommands = defineCommands({
  search: defineCommand<{ keyword: string; limit?: number }, unknown[]>({
    name: "search",
    description: "搜索股票(支持代码 / 中文名称 / 拼音首字母)",
    args: {
      keyword: {
        type: "string",
        required: true,
        positional: true,
        desc: "搜索关键字(代码如 600519 / 名称如 茅台 / 拼音如 gzmt)",
      },
      limit: {
        type: "number",
        desc: "返回条数(默认 20)",
      },
    },
    async run({ keyword, limit }) {
      const data = await searchStocks(keyword);
      const capped = limit ? data.slice(0, limit) : data.slice(0, 20);
      return {
        data: capped,
        meta: {
          total: data.length,
          keyword,
          hint: "使用 `rxstock stock info <code>` 或 `rxstock quote get <code>` 查详情",
        },
      };
    },
  }),

  list: defineCommand<
    {
      market?: string;
      page?: number;
      size?: number;
      sort?: string;
      desc?: boolean;
    },
    unknown[]
  >({
    name: "list",
    description: "查询股票列表(全市场 / 按市场过滤 / 排序 / 分页)",
    args: {
      market: {
        type: "string",
        desc: "市场:sh|sz|bj|all (默认 all)",
      },
      page: {
        type: "number",
        desc: "页码(默认 1)",
      },
      size: {
        type: "number",
        desc: "单页条数(默认 100,最大 1000)",
      },
      sort: {
        type: "string",
        desc: "排序字段:changePercent|change|amount|volume|code|name (默认 changePercent)",
      },
      desc: {
        type: "boolean",
        desc: "是否降序(默认 true)",
      },
    },
    async run({ market, page, size, sort, desc }) {
      const m = (market ?? "all") as ListMarket;
      if (!VALID_MARKETS.includes(m)) {
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "market",
          message: `不支持的市场:${market}(可选:${VALID_MARKETS.join(",")})`,
        });
      }
      const s = (sort ?? "changePercent") as ListSort;
      if (!VALID_SORTS.includes(s)) {
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "sort",
          message: `不支持的排序字段:${sort}(可选:${VALID_SORTS.join(",")})`,
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

  info: defineCommand<{ code: string }, unknown>({
    name: "info",
    description: "查询公司基本信息(总股本 / 流通股本 / 上市日期 等)",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "股票代码",
      },
    },
    humanFormat: formatProfileHuman,
    async run({ code }) {
      const data = await getCompanyProfile(code);
      if (!data) throw new errs.NotFoundError(`未找到 ${code} 的公司信息`);
      return { data };
    },
  }),

  valuation: defineCommand<{ code: string; days?: number }, unknown>({
    name: "valuation",
    description: "估值分位(PE/PB 在历史区间的百分位,判断当前贵不贵)",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "股票代码",
      },
      days: {
        type: "number",
        desc: "历史回溯天数(默认 250,约一年)",
      },
    },
    async run({ code, days }) {
      const data = await getValuation(code, days ?? 250);
      if (!data)
        throw new errs.NotFoundError(`无法计算 ${code} 的估值(可能缺 EPS/BPS 或历史数据不足)`);
      return {
        data,
        meta: {
          hint: "百分位 0-100:>80 偏贵(高估),<20 偏便宜(低估),50 为中位。基于价/EPS 代理,反映估值随价变动趋势",
        },
      };
    },
  }),

  diagnosis: defineCommand<{ code: string }, unknown>({
    name: "diagnosis",
    description: "个股综合诊断(一次性聚合基本面+技术面+股东+估值,深度分析用)",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "股票代码",
      },
    },
    async run({ code }) {
      const data = await getDiagnosis(code);
      return {
        data,
        meta: {
          dimensions: ["fundamental", "technical", "holders"],
          hint: "基本面看 PE/PB/ROE/成长性;技术面看均线排列/MACD/RSI/KDJ;股东看筹码集中度趋势",
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
