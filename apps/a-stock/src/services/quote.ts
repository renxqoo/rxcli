/**
 * 行情服务 —— 统一 quote 数据访问(多源 fallback)
 *
 * 源链:
 *   - 腾讯(主):qt.gtimg.cn,无限制,字段最全(五档盘口),境内外都通
 *   - 新浪(备):hq.sinajs.cn,需 Referer,字段略少(无 PE/PB/市值),境内外都通
 *   - 东财 push2(境内增强):字段全,境外不通,仅境内补充
 *
 * 指数走腾讯/新浪(sh/sz 前缀)。
 *
 * 输出统一 Quote 形态(扁平字段 + 五档盘口),命令层只依赖本服务。
 */

import { parseSymbol, type SymbolParts } from "../utils/symbol.js";
import { memoize, CacheTTL } from "../utils/cache.js";
import { trySources, type Source } from "../utils/fallback.js";
import { fetchTencentQuote, fetchTencentQuotes, type TencentRawQuote } from "../sources/tencent.js";
import {
  fetchEastmoneyQuote,
  fetchEastmoneyQuotes,
  type EastmoneyRawQuote,
} from "../sources/eastmoney.js";
import { fetchSinaQuotes, sinaToQuote } from "../sources/sina.js";
import { fetchJqkaQuote, type JqkaQuote } from "../sources/10jqka.js";

/** 统一的标准化行情 */
export interface Quote {
  code: string;
  name: string;
  market: "sh" | "sz" | "bj";
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number; // 手
  amount: number; // 元
  turnoverRate: number; // %
  volumeRatio: number;
  amplitude: number; // %
  peRatio: number | null;
  pbRatio: number | null;
  circulateMarketCap: number; // 元
  totalMarketCap: number; // 元
  limitUp: number;
  limitDown: number;
  time: string;
  bids: { price: number; volume: number }[];
  asks: { price: number; volume: number }[];
  source: "tencent" | "eastmoney" | "sina" | "10jqka";
}

const quoteByCode = memoize(async (code: string): Promise<Quote | null> => {
  const sym = parseSymbol(code);
  return fetchQuoteInternal(sym);
}, CacheTTL.quote);

const quoteByCodeFromEM = memoize(async (code: string): Promise<Quote | null> => {
  const sym = parseSymbol(code);
  return fetchQuoteInternal(sym, "eastmoney");
}, CacheTTL.quote);

/**
 * 多源取单只行情。
 * @param preferred 优先源("tencent" 默认 / "eastmoney" 显式东财优先)
 * 失败按源链回落,全部失败返回 null(命令层抛 NotFoundError)。
 */
async function fetchQuoteInternal(
  sym: SymbolParts,
  preferred: "tencent" | "eastmoney" = "tencent",
): Promise<Quote | null> {
  const buildTencent = (): Source<Quote | null> => ({
    name: "tencent",
    async fetch() {
      const t = await fetchTencentQuote(sym);
      return t ? normalizeFromTencent(t, sym) : null;
    },
  });
  const buildSina = (): Source<Quote | null> => ({
    name: "sina",
    async fetch() {
      const s = await fetchSinaQuotes([sym]);
      return s[0] ? sinaToQuote(s[0], sym) : null;
    },
  });
  const buildEastmoney = (): Source<Quote | null> => ({
    name: "eastmoney",
    async fetch() {
      const e = await fetchEastmoneyQuote(sym);
      return e ? normalizeFromEastmoney(e, sym) : null;
    },
  });
  const buildJqka = (): Source<Quote | null> => ({
    name: "10jqka",
    async fetch() {
      const j = await fetchJqkaQuote(sym);
      return j ? normalizeFromJqka(j, sym) : null;
    },
  });

  const sources =
    preferred === "eastmoney"
      ? [buildEastmoney(), buildTencent(), buildSina(), buildJqka()]
      : [buildTencent(), buildSina(), buildJqka(), buildEastmoney()];

  try {
    return await trySources(sources, {
      isEmpty: (v) => v == null,
      log: (lvl, msg) => process.stderr.write(`${lvl}: ${msg}\n`),
    });
  } catch {
    return null;
  }
}

export async function getQuote(code: string): Promise<Quote | null> {
  return quoteByCode(code);
}

export async function getQuoteFromEastmoney(code: string): Promise<Quote | null> {
  return quoteByCodeFromEM(code);
}

/** 显式指定数据源(不再 fallback) */
export async function getQuoteFromSource(
  code: string,
  source: "tencent" | "eastmoney" | "sina",
): Promise<Quote | null> {
  const sym = parseSymbol(code);
  try {
    if (source === "tencent") {
      const t = await fetchTencentQuote(sym);
      return t ? normalizeFromTencent(t, sym) : null;
    }
    if (source === "eastmoney") {
      const e = await fetchEastmoneyQuote(sym);
      return e ? normalizeFromEastmoney(e, sym) : null;
    }
    if (source === "sina") {
      const s = await fetchSinaQuotes([sym]);
      return s[0] ? sinaToQuote(s[0], sym) : null;
    }
  } catch {
    return null;
  }
  return null;
}

const batchByCodes = memoize(async (codes: string[]): Promise<(Quote | null)[]> => {
  if (codes.length === 0) return [];
  const symbols = codes.map(parseSymbol);
  const byCode = new Map<string, Quote>();

  // 建索引:按 code 聚合,逐源补缺失(腾讯批量 → 新浪批量 → 东财逐个境内增强)
  // 1. 腾讯批量(主)
  try {
    const tList = await fetchTencentQuotes(symbols);
    const tByKey = new Map<string, TencentRawQuote>();
    for (const q of tList) {
      if (q.symbolKey) tByKey.set(q.symbolKey.toLowerCase(), q);
    }
    for (const sym of symbols) {
      const t = tByKey.get(sym.tencent.toLowerCase());
      if (t) byCode.set(sym.code, normalizeFromTencent(t, sym));
    }
  } catch (e) {
    process.stderr.write(
      `warn: [fallback] tencent 批量失败: ${e instanceof Error ? e.message : e}\n`,
    );
  }

  // 2. 新浪批量补缺失(境外可用)
  const missing1 = symbols.filter((s) => !byCode.has(s.code));
  if (missing1.length > 0) {
    try {
      const sList = await fetchSinaQuotes(missing1);
      sList.forEach((s, i) => {
        const sym = missing1[i];
        if (s && sym) byCode.set(sym.code, sinaToQuote(s, sym));
      });
    } catch (e) {
      process.stderr.write(
        `warn: [fallback] sina 批量失败: ${e instanceof Error ? e.message : e}\n`,
      );
    }
  }

  // 3. 东财逐个补缺失(境内增强,境外会失败但 try/catch 容错)
  const missing2 = symbols.filter((s) => !byCode.has(s.code));
  if (missing2.length > 0) {
    try {
      const emList = await fetchEastmoneyQuotes(missing2);
      emList.forEach((e, i) => {
        const sym = missing2[i];
        if (e && sym) byCode.set(sym.code, normalizeFromEastmoney(e, sym));
      });
    } catch {
      // 境外不通,静默跳过(已有腾讯/新浪兜底)
    }
  }

  return codes.map((c) => byCode.get(parseSymbol(c).code) ?? null);
}, CacheTTL.quote);

export async function getQuotes(codes: string[]): Promise<(Quote | null)[]> {
  return batchByCodes(codes);
}

// ============================================================================
// 标准化
// ============================================================================

function normalizeFromTencent(t: TencentRawQuote, sym: SymbolParts): Quote {
  return {
    code: sym.code,
    name: t.name,
    market: sym.market,
    price: t.price,
    prevClose: t.prevClose,
    open: t.open,
    high: t.high,
    low: t.low,
    change: t.change,
    changePercent: t.changePercent,
    volume: t.volume,
    amount: t.amount,
    turnoverRate: t.turnoverRate,
    volumeRatio: t.volumeRatio,
    amplitude: t.amplitude,
    peRatio: t.peRatio,
    pbRatio: t.pbRatio,
    circulateMarketCap: t.circulateMarketCap,
    totalMarketCap: t.totalMarketCap,
    limitUp: t.limitUp,
    limitDown: t.limitDown,
    time: t.time,
    bids: [t.bid1, t.bid2, t.bid3, t.bid4, t.bid5],
    asks: [t.ask1, t.ask2, t.ask3, t.ask4, t.ask5],
    source: "tencent",
  };
}

function normalizeFromEastmoney(e: EastmoneyRawQuote, sym: SymbolParts): Quote {
  // 东财的 f48(成交额)单位元,f47(成交量)单位手
  // 时间戳 f86 是毫秒
  const time = e.f86 ? formatTime(e.f86) : "";
  return {
    code: sym.code,
    name: e.f58 ?? "",
    market: sym.market,
    price: e.f43 ?? NaN,
    prevClose: e.f60 ?? NaN,
    open: e.f46 ?? NaN,
    high: e.f44 ?? NaN,
    low: e.f45 ?? NaN,
    change: e.f169 ?? NaN,
    changePercent: e.f170 ?? NaN,
    volume: e.f47 ?? 0,
    amount: e.f48 ?? 0,
    turnoverRate: e.f168 ?? NaN,
    volumeRatio: e.f50 ?? NaN,
    amplitude: e.f171 ?? NaN,
    peRatio: e.f162 ?? null,
    pbRatio: e.f167 ?? null,
    circulateMarketCap: e.f85 ?? NaN,
    totalMarketCap: e.f117 ?? NaN,
    limitUp: e.f51 ?? NaN,
    limitDown: e.f52 ?? NaN,
    time,
    // 东财 stock/get 单点接口没有买五卖五
    bids: [],
    asks: [],
    source: "eastmoney",
  };
}

/** 同花顺盘口 → Quote(字段较少:无 PE/PB/换手/振幅/市值/五档) */
function normalizeFromJqka(j: JqkaQuote, sym: SymbolParts): Quote {
  const change =
    Number.isFinite(j.price) && Number.isFinite(j.prevClose) ? j.price - j.prevClose : NaN;
  const changePercent = j.prevClose ? (change / j.prevClose) * 100 : NaN;
  return {
    code: sym.code,
    name: "",
    market: sym.market,
    price: j.price,
    prevClose: j.prevClose,
    open: j.open,
    high: j.high,
    low: j.low,
    change,
    changePercent,
    volume: Math.round(j.volume / 100), // 股 → 手
    amount: j.amount,
    turnoverRate: NaN,
    volumeRatio: NaN,
    amplitude: NaN,
    peRatio: null,
    pbRatio: null,
    circulateMarketCap: NaN,
    totalMarketCap: NaN,
    limitUp: j.limitUp,
    limitDown: j.limitDown,
    time: "",
    bids: [],
    asks: [],
    source: "10jqka",
  };
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${M}-${D} ${h}:${m}`;
}
