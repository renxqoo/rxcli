/**
 * 高级数据服务 —— 龙虎榜/北向/分红/股东/三表/两融
 *
 * 数据源均为东财 datacenter(境内外都通,单源)。
 * 单源数据不加 fallback,加重试 + 缓存兜底(datacenter 本身很稳定)。
 */

import { memoize, CacheTTL } from "../utils/cache.js";
import {
  fetchDragonTiger,
  fetchNorthbound,
  fetchDividend,
  fetchHolders,
  fetchHolderCount,
  fetchMargin,
  fetchBalanceSheet,
  fetchIncome,
  fetchCashFlow,
  type EastmoneyDragonTigerRow,
  type EastmoneyNorthboundRow,
  type EastmoneyDividendRow,
  type EastmoneyHolderRow,
  type EastmoneyHolderCountRow,
  type EastmoneyMarginRow,
  type EastmoneyBalanceSheetRow,
  type EastmoneyIncomeRow,
  type EastmoneyCashFlowRow,
} from "../sources/eastmoney.js";

// —— 龙虎榜 ——
export interface DragonTigerRow extends EastmoneyDragonTigerRow {}

export async function getDragonTiger(
  opts: { date?: string; code?: string; pageSize?: number } = {},
): Promise<DragonTigerRow[]> {
  return fetchDragonTiger(opts);
}

// —— 北向资金 ——
export interface NorthboundRow extends EastmoneyNorthboundRow {}

const northboundCache = memoize(
  async (type: string): Promise<NorthboundRow[]> =>
    fetchNorthbound({ type: type as "001" | "003" | "all", pageSize: 30 }),
  CacheTTL.fundflow,
);

export async function getNorthbound(
  opts: { type?: "001" | "003" | "all"; pageSize?: number } = {},
): Promise<NorthboundRow[]> {
  const type = opts.type ?? "all";
  const all = await northboundCache(type);
  const pageSize = opts.pageSize ?? all.length;
  return all.slice(0, pageSize);
}

// —— 分红送配 ——
export interface DividendRow extends EastmoneyDividendRow {}

const dividendCache = memoize(async (code: string): Promise<DividendRow[]> => {
  return fetchDividend(code, 50);
}, CacheTTL.financial);

export async function getDividend(code: string, limit = 30): Promise<DividendRow[]> {
  const all = await dividendCache(code);
  return all.slice(0, limit);
}

// —— 十大股东 ——
export interface HolderRow extends EastmoneyHolderRow {}

const holdersCache = memoize(async (code: string): Promise<HolderRow[]> => {
  return fetchHolders(code, 100);
}, CacheTTL.financial);

export async function getHolders(code: string, limit = 10): Promise<HolderRow[]> {
  const all = await holdersCache(code);
  return all.slice(0, limit);
}

// —— 股东人数 ——
export interface HolderCountRow extends EastmoneyHolderCountRow {}

const holderCountCache = memoize(async (code: string): Promise<HolderCountRow[]> => {
  return fetchHolderCount(code, 30);
}, CacheTTL.financial);

export async function getHolderCount(code: string, limit = 10): Promise<HolderCountRow[]> {
  const all = await holderCountCache(code);
  return all.slice(0, limit);
}

// —— 融资融券 ——
export interface MarginRow extends EastmoneyMarginRow {}

export async function getMargin(code: string, pageSize = 30): Promise<MarginRow[]> {
  return fetchMargin(code, pageSize);
}

// —— 财报三表 ——
export interface BalanceSheetRow extends EastmoneyBalanceSheetRow {}
export interface IncomeRow extends EastmoneyIncomeRow {}
export interface CashFlowRow extends EastmoneyCashFlowRow {}

const balanceSheetCache = memoize(async (code: string): Promise<BalanceSheetRow[]> => {
  return fetchBalanceSheet(code, 20);
}, CacheTTL.financial);

export async function getBalanceSheet(code: string, limit = 8): Promise<BalanceSheetRow[]> {
  const all = await balanceSheetCache(code);
  return all.slice(0, limit);
}

const incomeCache = memoize(async (code: string): Promise<IncomeRow[]> => {
  return fetchIncome(code, 20);
}, CacheTTL.financial);

export async function getIncome(code: string, limit = 8): Promise<IncomeRow[]> {
  const all = await incomeCache(code);
  return all.slice(0, limit);
}

const cashFlowCache = memoize(async (code: string): Promise<CashFlowRow[]> => {
  return fetchCashFlow(code, 20);
}, CacheTTL.financial);

export async function getCashFlow(code: string, limit = 8): Promise<CashFlowRow[]> {
  const all = await cashFlowCache(code);
  return all.slice(0, limit);
}
