/**
 * 股票 / 搜索 / 板块 / 指数 服务
 *
 * 涉及:搜索 / 列表 / 板块成分股 / 公司基本信息
 */

import { memoize, CacheTTL } from "../utils/cache.js";
import { trySources, type Source } from "../utils/fallback.js";
import {
  searchEastmoney,
  fetchEastmoneyStockList,
  fetchEastmoneySectorList,
  fetchSectorConstituents,
  fetchCompanyProfile,
  type EastmoneySearchItem,
  type EastmoneyStockListItem,
  type EastmoneyProfile,
  type SectorKind,
} from "../sources/eastmoney.js";
import type { ListMarket, ListSort } from "../sources/eastmoney.js";
import {
  fetchSinaStockList,
  fetchSinaSectorList,
  type SinaListItem,
  type SinaSectorNode,
} from "../sources/sina.js";

// ============================================================================
// 搜索
// ============================================================================

export interface SearchResult {
  code: string;
  name: string;
  pinyin?: string;
  market: "sh" | "sz" | "bj" | string;
  classify: string;
  /** 东财 secid 形态 1.600519 */
  quoteId: string;
}

const searchCache = memoize(async (keyword: string): Promise<SearchResult[]> => {
  const raw = await searchEastmoney(keyword);
  return raw.map(normalizeSearch);
}, CacheTTL.search);

export async function searchStocks(keyword: string): Promise<SearchResult[]> {
  if (!keyword.trim()) return [];
  return searchCache(keyword);
}

function normalizeSearch(r: EastmoneySearchItem): SearchResult {
  let market: "sh" | "sz" | "bj" | string = "";
  if (r.SecurityTypeName?.includes("沪")) market = "sh";
  else if (r.SecurityTypeName?.includes("深")) market = "sz";
  else if (r.SecurityTypeName?.includes("京")) market = "bj";
  return {
    code: r.Code,
    name: r.Name,
    pinyin: r.PinYin,
    market,
    classify: r.Classify,
    quoteId: r.QuoteID,
  };
}

// ============================================================================
// 股票列表(全市场 / 单市场)
// ============================================================================

export interface StockListItem {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  change: number;
  volume: number;
  amount: number;
  amplitude: number;
  turnoverRate: number;
  peRatio: number | null;
  pbRatio: number | null;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  circulateMarketCap: number;
  totalMarketCap: number;
  speedRate: number; // 涨速
  change5Min: number;
  change60Day: number;
  changeYTD: number;
}

export interface StockListResult {
  total: number;
  items: StockListItem[];
}

function normalizeListItem(r: EastmoneyStockListItem): StockListItem {
  return {
    code: r.f12,
    name: r.f14 ?? "",
    price: r.f2 ?? NaN,
    changePercent: r.f3 ?? NaN,
    change: r.f4 ?? NaN,
    volume: r.f5 ?? 0,
    amount: r.f6 ?? 0,
    amplitude: r.f7 ?? NaN,
    turnoverRate: r.f8 ?? NaN,
    peRatio: Number.isFinite(r.f9) ? (r.f9 ?? null) : null,
    pbRatio: Number.isFinite(r.f22) ? (r.f22 ?? null) : null,
    high: r.f15 ?? NaN,
    low: r.f16 ?? NaN,
    open: r.f17 ?? NaN,
    prevClose: r.f18 ?? NaN,
    circulateMarketCap: r.f20 ?? NaN,
    totalMarketCap: r.f21 ?? NaN,
    speedRate: r.f23 ?? NaN,
    change5Min: r.f24 ?? NaN,
    change60Day: r.f25 ?? NaN,
    changeYTD: r.f100 ?? NaN,
  };
}

/**
 * 新浪列表项标准化 —— 字段映射到统一的 StockListItem。
 * 单位换算:新浪 mktcap/nmc=万元(→×1e4=元),volume=股(→÷100=手),amount=元
 * 新浪返回的数值字段可能是字符串,需统一 toNum 转换。
 * 新浪无 amplitude/speedRate/change5Min/change60Day/changeYTD,置 NaN。
 */
function normalizeSinaListItem(r: SinaListItem): StockListItem {
  return {
    code: r.code,
    name: r.name,
    price: toNum(r.trade),
    changePercent: toNum(r.changepercent),
    change: toNum(r.pricechange),
    volume: Math.round(toNum(r.volume) / 100), // 股 → 手
    amount: toNum(r.amount),
    amplitude: NaN, // 新浪列表无振幅
    turnoverRate: toNum(r.turnoverratio),
    peRatio: toNumOrNull(r.per),
    pbRatio: toNumOrNull(r.pb),
    high: toNum(r.high),
    low: toNum(r.low),
    open: toNum(r.open),
    prevClose: toNum(r.settlement),
    circulateMarketCap: toNum(r.nmc) * 1e4, // 万元 → 元
    totalMarketCap: toNum(r.mktcap) * 1e4,
    speedRate: NaN,
    change5Min: NaN,
    change60Day: NaN,
    changeYTD: NaN,
  };
}

/** 新浪数值字段可能是字符串或数字,统一转 number(失败→NaN) */
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function toNumOrNull(v: unknown): number | null {
  const n = toNum(v);
  return Number.isFinite(n) ? n : null;
}

export async function getStockList(
  opts: {
    market?: ListMarket;
    page?: number;
    size?: number;
    sort?: ListSort;
    desc?: boolean;
  } = {},
): Promise<StockListResult> {
  // 源链:新浪(境外可用,主源)→ 东财 push2(境内增强,字段更全)
  const sources: Source<{ total: number; items: StockListItem[] }>[] = [
    {
      name: "sina",
      async fetch() {
        const raw = await fetchSinaStockList({
          market: (opts.market ?? "all") as "all" | "sh" | "sz" | "bj",
          page: opts.page ?? 1,
          size: opts.size ?? 100,
          sort: opts.sort,
          desc: opts.desc,
        });
        return { total: raw.total, items: raw.items.map(normalizeSinaListItem) };
      },
    },
    {
      name: "eastmoney",
      async fetch() {
        const raw = await fetchEastmoneyStockList(opts);
        return { total: raw.total, items: raw.items.map(normalizeListItem) };
      },
    },
  ];
  return trySources(sources, {
    isEmpty: (r) => r.items.length === 0,
    log: (lvl, msg) => process.stderr.write(`${lvl}: ${msg}\n`),
  });
}

// ============================================================================
// 板块列表 / 板块成分股
// ============================================================================

export interface SectorListItem {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  change: number;
  amount: number;
  volume: number;
  industry?: string;
}

export async function getSectorList(
  opts: {
    kind?: SectorKind;
    page?: number;
    size?: number;
    sort?: ListSort;
    desc?: boolean;
  } = {},
): Promise<{ total: number; items: SectorListItem[] }> {
  // 源链:东财 push2(境内,带完整行情,主源)→ 新浪节点树(境外,仅板块清单)
  const sources: Source<{ total: number; items: SectorListItem[] }>[] = [
    {
      name: "eastmoney",
      async fetch() {
        const raw = await fetchEastmoneySectorList(opts);
        return {
          total: raw.total,
          items: raw.items.map((r) => ({
            code: r.f12,
            name: r.f14 ?? "",
            price: r.f2 ?? NaN,
            changePercent: r.f3 ?? NaN,
            change: r.f4 ?? NaN,
            amount: r.f6 ?? 0,
            volume: r.f5 ?? 0,
            industry: r.f104,
          })),
        };
      },
    },
    {
      name: "sina",
      async fetch() {
        const raw = await fetchSinaSectorList({ kind: opts.kind });
        // 新浪只给板块清单(名+node),无聚合行情;分页截断
        const start = ((opts.page ?? 1) - 1) * (opts.size ?? 100);
        const paged = raw.items.slice(start, start + (opts.size ?? 100));
        return {
          total: raw.total,
          items: paged.map((s) => normalizeSinaSectorNode(s, opts.kind)),
        };
      },
    },
  ];
  return trySources(sources, {
    isEmpty: (r) => r.items.length === 0,
    log: (lvl, msg) => process.stderr.write(`${lvl}: ${msg}\n`),
  });
}

/** 新浪板块清单节点 → SectorListItem(行情字段置 NaN,仅提供板块清单) */
function normalizeSinaSectorNode(s: SinaSectorNode, kind: SectorKind | undefined): SectorListItem {
  return {
    code: s.node, // 用新浪 node 作为板块标识
    name: s.name,
    price: NaN,
    changePercent: NaN,
    change: NaN,
    amount: 0,
    volume: 0,
    industry: kind,
  };
}

export async function getSectorStocks(
  sectorCode: string,
  opts: { page?: number; size?: number } = {},
): Promise<StockListResult> {
  const raw = await fetchSectorConstituents(sectorCode, opts);
  return { total: raw.total, items: raw.items.map(normalizeListItem) };
}

// ============================================================================
// 公司基本信息
// ============================================================================

export interface CompanyProfile extends EastmoneyProfile {}

export async function getCompanyProfile(code: string): Promise<CompanyProfile | null> {
  return fetchCompanyProfile(code);
}

// ============================================================================
// 常用指数
// ============================================================================

/** 常用指数代码清单(腾讯 secid) */
export const MAJOR_INDICES = [
  { code: "sh000001", name: "上证指数" },
  { code: "sz399001", name: "深证成指" },
  { code: "sz399006", name: "创业板指" },
  { code: "sh000300", name: "沪深 300" },
  { code: "sh000016", name: "上证 50" },
  { code: "sh000905", name: "中证 500" },
  { code: "sh000688", name: "科创 50" },
  { code: "sz399905", name: "中证 500(深)" },
  { code: "sh000852", name: "中证 1000" },
] as const;
