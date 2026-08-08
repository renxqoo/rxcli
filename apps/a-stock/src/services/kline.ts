/**
 * K 线服务 —— 统一 K 线数据访问
 *
 * 源链(多源 fallback):
 *   - 腾讯(主):字段完整,支持 day/week/month + qfq/hfq
 *   - 新浪(备):支持任意周期(scale),但只不复权
 *   - 东财 push2his(境内增强):支持所有周期 + 复权,境外不通
 *
 * 分钟级 K 线腾讯不支持,走新浪 → 东财。
 */

import { parseSymbol, type SymbolParts } from "../utils/symbol.js";
import { memoize, CacheTTL } from "../utils/cache.js";
import { trySources, type Source } from "../utils/fallback.js";
import {
  fetchTencentKline,
  TENCENT_KLINE_PERIODS,
  type TencentKlineParams,
  type TencentKlineRow,
} from "../sources/tencent.js";
import {
  fetchEastmoneyKline,
  type EastmoneyKlineRow,
  type EastmoneyKlineParams,
} from "../sources/eastmoney.js";
import { fetchSinaKline } from "../sources/sina.js";
import { fetchJqkaKline } from "../sources/10jqka.js";

export type KlinePeriod = "m1" | "m5" | "m15" | "m30" | "m60" | "day" | "week" | "month";
export type KlineAdjust = "none" | "qfq" | "hfq";

/** 统一 K 线 row(全字段,所有源都映射到这里) */
export interface Kline {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number | null;
  changePercent: number | null;
  change: number | null;
  turnoverRate: number | null;
}

export interface KlineParams {
  period: KlinePeriod;
  adjust?: KlineAdjust;
  limit?: number;
  start?: string;
  end?: string;
}

/** K线缓存 key 含全部参数(含 limit,避免 limit 不同时拿不到完整数据) */
function klineCacheKey(code: string, params: KlineParams): string {
  return [
    code,
    params.period,
    params.adjust ?? "none",
    params.limit ?? 320,
    params.start ?? "",
    params.end ?? "",
  ].join("|");
}

// 每个独立 code|params 组合一个 memoize 闭包(因 key 是组合而非单 code,这里用外层 Map 聚合)
const klineCaches = new Map<string, (code: string) => Promise<Kline[]>>();

export async function getKline(code: string, params: KlineParams): Promise<Kline[]> {
  const key = klineCacheKey(code, params);
  let cached = klineCaches.get(key);
  if (!cached) {
    cached = memoize(async (c: string) => fetchKlineInternal(c, params), CacheTTL.kline);
    klineCaches.set(key, cached);
  }
  return cached(code);
}

async function fetchKlineInternal(code: string, params: KlineParams): Promise<Kline[]> {
  const sym = parseSymbol(code);
  const tencentSupported = TENCENT_KLINE_PERIODS.includes(
    params.period as TencentKlineParams["period"],
  );

  const sources: Source<Kline[]>[] = [];

  // 腾讯(主):支持 day/week/month + 复权
  if (tencentSupported) {
    const tParams: TencentKlineParams = {
      period: params.period as TencentKlineParams["period"],
      count: params.limit,
    };
    if (params.adjust) tParams.adjust = params.adjust;
    if (params.start) tParams.start = params.start;
    if (params.end) tParams.end = params.end;
    sources.push({
      name: "tencent",
      async fetch() {
        const t = await fetchTencentKline(sym, tParams);
        return t.map(normalizeTencent);
      },
    });
  }

  // 新浪(备):支持任意周期(含分钟级),只不复权
  sources.push({
    name: "sina",
    async fetch() {
      const s = await fetchSinaKline(sym, { period: params.period, limit: params.limit });
      return s.map(normalizeSina);
    },
  });

  // 同花顺(末位兜底):只支持日/周
  if (params.period === "day" || params.period === "week") {
    sources.push({
      name: "10jqka",
      async fetch() {
        const j = await fetchJqkaKline(sym, { period: params.period, limit: params.limit });
        return j.map(normalizeJqka);
      },
    });
  }

  // 东财 push2his(境内增强):支持所有周期 + 复权,境外不通
  const eParams: EastmoneyKlineParams = {
    period: params.period as EastmoneyKlineParams["period"],
    limit: params.limit,
  };
  if (params.adjust) eParams.adjust = params.adjust;
  if (params.start) eParams.start = params.start;
  if (params.end) eParams.end = params.end;
  sources.push({
    name: "eastmoney",
    async fetch() {
      const e = await fetchEastmoneyKline(sym, eParams);
      return e.map(normalizeEastmoney);
    },
  });

  const rows = await trySources(sources, {
    isEmpty: (rows) => !Array.isArray(rows) || rows.length === 0,
    log: (lvl, msg) => process.stderr.write(`${lvl}: ${msg}\n`),
  });
  // 后处理:源缺 changePercent/change 时本地补算(close 环比)
  return enrichKline(rows);
}

/**
 * 补算缺失的 change/changePercent(基于 close 环比)。
 * 腾讯/新浪 K线不提供涨跌幅,但深度分析依赖它。本地从 OHLC 算:
 *   change = close - prevClose
 *   changePercent = (close - prevClose) / prevClose * 100
 * 第一条无前值,置 0。
 */
function enrichKline(rows: Kline[]): Kline[] {
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i]!;
    if (cur.change == null || cur.changePercent == null) {
      if (i === 0) {
        rows[i] = { ...cur, change: 0, changePercent: 0 };
      } else {
        const prevClose = rows[i - 1]!.close;
        const change = cur.close - prevClose;
        const changePercent = prevClose ? (change / prevClose) * 100 : 0;
        rows[i] = { ...cur, change, changePercent };
      }
    }
  }
  return rows;
}

function normalizeTencent(t: TencentKlineRow): Kline {
  return {
    date: t.date,
    open: t.open,
    close: t.close,
    high: t.high,
    low: t.low,
    volume: t.volume,
    amount: t.amount,
    changePercent: null,
    change: null,
    turnoverRate: null,
  };
}

/** 新浪 K线:无 amount/changePercent/change/turnoverRate */
function normalizeSina(s: {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}): Kline {
  return {
    date: s.date,
    open: s.open,
    close: s.close,
    high: s.high,
    low: s.low,
    volume: s.volume,
    amount: null,
    changePercent: null,
    change: null,
    turnoverRate: null,
  };
}

/** 同花顺 K线:日期 YYYYMMDD,有 amount,无 changePercent/change/turnoverRate */
function normalizeJqka(j: {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}): Kline {
  return {
    date: j.date,
    open: j.open,
    close: j.close,
    high: j.high,
    low: j.low,
    volume: j.volume,
    amount: j.amount,
    changePercent: null,
    change: null,
    turnoverRate: null,
  };
}

function normalizeEastmoney(e: EastmoneyKlineRow): Kline {
  return {
    date: e.date,
    open: e.open,
    close: e.close,
    high: e.high,
    low: e.low,
    volume: e.volume,
    amount: e.amount,
    changePercent: Number.isFinite(e.changePercent) ? e.changePercent : null,
    change: Number.isFinite(e.change) ? e.change : null,
    turnoverRate: Number.isFinite(e.turnoverRate) ? e.turnoverRate : null,
  };
}

// ============================================================================
// 技术指标(基于日 K 本地计算)
// ============================================================================

import { MACD, RSI, KDJ, BOLL, ATR, MA, percentile } from "../utils/indicators.js";
import { getQuote } from "./quote.js";
import { getFinancialMain } from "./financial.js";

export interface IndicatorResult {
  /** 指标类型 */
  type: string;
  /** 最新一根 K 线日期 */
  date: string;
  /** 最新价 */
  price: number;
  /** 各指标最新值 */
  values: Record<string, number | null>;
}

/**
 * 计算技术指标。默认拉 120 个交易日日K(保证 MA60/布林20 等有足够历史)。
 */
export async function getIndicators(
  code: string,
  types: string[] = ["ma", "macd", "rsi", "kdj", "boll"],
  limit = 120,
): Promise<IndicatorResult[]> {
  const klines = await getKline(code, { period: "day", limit });
  if (klines.length === 0) return [];
  const closes = klines.map((k) => k.close);
  const lastIdx = klines.length - 1;
  const results: IndicatorResult[] = [];

  for (const type of types) {
    const values: Record<string, number | null> = {};
    if (type === "ma") {
      const ma5 = MA(closes, 5);
      const ma10 = MA(closes, 10);
      const ma20 = MA(closes, 20);
      const ma60 = MA(closes, 60);
      values.ma5 = ma5[lastIdx] ?? null;
      values.ma10 = ma10[lastIdx] ?? null;
      values.ma20 = ma20[lastIdx] ?? null;
      values.ma60 = ma60[lastIdx] ?? null;
    } else if (type === "macd") {
      const r = MACD(closes);
      values.macd = r.macd[lastIdx] ?? null;
      values.signal = r.signal[lastIdx] ?? null;
      values.histogram = r.histogram[lastIdx] ?? null;
    } else if (type === "rsi") {
      const r6 = RSI(closes, 6);
      const r12 = RSI(closes, 12);
      const r24 = RSI(closes, 24);
      values.rsi6 = r6[lastIdx] ?? null;
      values.rsi12 = r12[lastIdx] ?? null;
      values.rsi24 = r24[lastIdx] ?? null;
    } else if (type === "kdj") {
      const r = KDJ(klines);
      values.k = r.k[lastIdx] ?? null;
      values.d = r.d[lastIdx] ?? null;
      values.j = r.j[lastIdx] ?? null;
    } else if (type === "boll") {
      const r = BOLL(closes);
      values.upper = r.upper[lastIdx] ?? null;
      values.mid = r.mid[lastIdx] ?? null;
      values.lower = r.lower[lastIdx] ?? null;
    } else if (type === "atr") {
      const r = ATR(klines);
      values.atr = r[lastIdx] ?? null;
    }
    results.push({
      type,
      date: klines[lastIdx]!.date,
      price: closes[lastIdx]!,
      values,
    });
  }
  return results;
}

/**
 * 估值分位:基于历史 K 线的 PE/PB 分位(需要财务 EPS/BPS)。
 * 由于 PE/PB 历史数据需财务季报,这里用 K线收盘价 + 最新 EPS 近似:
 *   pe_proxy = close / eps(当前 EPS 不变,价变 → 反映估值随价变动)
 *   分位 = 当前 pe_proxy 在过去 N 日 pe_proxy 序列的百分位
 */
export interface ValuationResult {
  code: string;
  price: number;
  eps: number;
  bps: number;
  /** PE 代理值 */
  peProxy: number;
  /** PB 代理值 */
  pbProxy: number;
  /** PE 在过去 N 日的百分位(0-100,越高越贵) */
  pePercentile: number;
  /** PB 在过去 N 日的百分位 */
  pbPercentile: number;
  /** 历史天数 */
  days: number;
}

export async function getValuation(code: string, days = 250): Promise<ValuationResult | null> {
  // 最新财务
  const fin = await getFinancialMain(code, 1);
  if (!fin[0]) return null;
  const eps = fin[0].eps;
  const bps = fin[0].bps;
  if (!Number.isFinite(eps) || eps <= 0 || !Number.isFinite(bps) || bps <= 0) return null;

  // 历史日K
  const klines = await getKline(code, { period: "day", limit: days });
  if (klines.length < 30) return null;
  const closes = klines.map((k) => k.close);
  const peHistory = closes.map((c) => c / eps);
  const pbHistory = closes.map((c) => c / bps);
  const price = closes[closes.length - 1]!;

  return {
    code,
    price,
    eps,
    bps,
    peProxy: price / eps,
    pbProxy: price / bps,
    pePercentile: percentile(price / eps, peHistory),
    pbPercentile: percentile(price / bps, pbHistory),
    days: closes.length,
  };
}
