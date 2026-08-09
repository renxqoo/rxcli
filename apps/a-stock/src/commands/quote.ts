/**
 * quote —— 实时行情查询
 *
 * 子命令:
 *   - get <code>             单只实时行情(全字段 + 五档盘口)
 *   - batch <code1,code2...> 批量(逗号分隔,最多 100 只)
 *
 * 数据:优先腾讯,失败回落东财(见 services/quote.ts)
 */

import { defineCommands, defineCommand, errs } from "@renxqoo/agent-data-cli";
import { getQuote, getQuotes } from "../services/quote.js";

export const quoteCommands = defineCommands({
  get: defineCommand<{ code: string; source?: string }, unknown>({
    name: "get",
    description: "查询单只股票/指数实时行情",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "代码(支持 600519 / sh600519 / 600519.SH 等多种格式)",
      },
      source: { type: "string", desc: "指定数据源:tencent | eastmoney(默认自动 fallback)" },
    },
    humanFormat: formatQuoteHuman,
    async run({ code, source }) {
      let data: unknown;
      if (source === "tencent" || source === "eastmoney" || source === "sina") {
        const { getQuoteFromSource } = await import("../services/quote.js");
        data = await getQuoteFromSource(code, source);
      } else {
        data = await getQuote(code);
      }
      if (!data) {
        throw new errs.NotFoundError(
          `Quote not found for ${code} (the code may not exist or the stock may be suspended)`,
        );
      }
      return { data };
    },
  }),

  batch: defineCommand<{ codes: string; size?: number }, unknown[]>({
    name: "batch",
    description: "批量查询多只股票实时行情(逗号分隔,最多 100 只)",
    args: {
      codes: {
        type: "string",
        required: true,
        positional: true,
        desc: "代码列表,用逗号分隔,如 600519,000001,300750",
      },
    },
    async run({ codes }) {
      const list = codes
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (list.length === 0)
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "codes",
          message: "codes must not be empty",
        });
      if (list.length > 100)
        throw new errs.ValidationError({
          subtype: "invalid_param",
          param: "codes",
          message: `Batch supports up to 100 codes, got ${list.length}`,
        });
      const quotes = await getQuotes(list);
      return {
        data: quotes,
        meta: {
          count: quotes.filter(Boolean).length,
          total: list.length,
        },
      };
    },
  }),
});

// ============================================================================
// 人类可读格式化(--no-json 模式)
// ============================================================================

function formatQuoteHuman(data: unknown): string {
  const q = data as Record<string, unknown>;
  if (!q || typeof q !== "object") return "（无数据）";
  const lines: string[] = [];
  const sign = Number(q.change) >= 0 ? "+" : "";
  lines.push(
    `${q.name} (${q.code})  ${formatNum(q.price)} ${sign}${formatNum(q.change)} (${sign}${formatNum(q.changePercent)}%)`,
  );
  lines.push(
    `开 ${formatNum(q.open)}  高 ${formatNum(q.high)}  低 ${formatNum(q.low)}  昨收 ${formatNum(q.prevClose)}`,
  );
  lines.push(
    `量 ${formatLargeNum(q.volume)} 手  额 ${formatLargeNum(q.amount)} 换手 ${formatNum(q.turnoverRate)}% 量比 ${formatNum(q.volumeRatio)}`,
  );
  if (q.peRatio != null) lines.push(`PE ${formatNum(q.peRatio)}  PB ${formatNum(q.pbRatio)}`);
  lines.push(
    `总市值 ${formatLargeNum(q.totalMarketCap)}  流通市值 ${formatLargeNum(q.circulateMarketCap)}`,
  );
  lines.push(`涨跌停 [${formatNum(q.limitUp)} / ${formatNum(q.limitDown)}]  ${q.time}`);
  // 五档盘口
  const bids = q.bids as Array<{ price: number; volume: number }> | undefined;
  const asks = q.asks as Array<{ price: number; volume: number }> | undefined;
  if (bids?.length && asks?.length) {
    lines.push("");
    lines.push("五档盘口:");
    lines.push("  卖五  " + formatLevel(asks[4]));
    lines.push("  卖四  " + formatLevel(asks[3]));
    lines.push("  卖三  " + formatLevel(asks[2]));
    lines.push("  卖二  " + formatLevel(asks[1]));
    lines.push("  卖一  " + formatLevel(asks[0]));
    lines.push("  ---");
    lines.push("  买一  " + formatLevel(bids[0]));
    lines.push("  买二  " + formatLevel(bids[1]));
    lines.push("  买三  " + formatLevel(bids[2]));
    lines.push("  买四  " + formatLevel(bids[3]));
    lines.push("  买五  " + formatLevel(bids[4]));
  }
  lines.push(`数据源:${q.source}`);
  return lines.join("\n");
}

function formatLevel(l: { price: number; volume: number } | undefined): string {
  if (!l) return "  -";
  return `${formatNum(l.price).padStart(10)}  ${String(l.volume).padStart(8)} 手`;
}

function formatNum(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  return n.toFixed(2);
}

function formatLargeNum(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + "亿";
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + "万";
  return n.toFixed(2);
}
