/**
 * 财务数据 / 资金流 / 公告 服务
 */

import { memoize, CacheTTL } from "../utils/cache.js";
import { APIError } from "@renxqoo/agent-data-cli";
import {
  fetchFinancialMain,
  fetchFinancialForecast,
  fetchFundFlow,
  fetchAnnouncements,
  type EastmoneyFinancialRow,
  type EastmoneyFundFlowRow,
  type EastmoneyAnnouncementItem,
} from "../sources/eastmoney.js";
import { parseSymbol } from "../utils/symbol.js";

export interface FinancialRow extends EastmoneyFinancialRow {}

// 缓存拉满 50 期(上限),limit 在调用方 slice,避免 limit 不同时拿不到完整数据
const financialCache = memoize(async (code: string): Promise<FinancialRow[]> => {
  return fetchFinancialMain(code, 50);
}, CacheTTL.financial);

export async function getFinancialMain(code: string, limit = 20): Promise<FinancialRow[]> {
  const all = await financialCache(code);
  return all.slice(0, limit);
}

export interface ForecastRow extends FinancialRow {}

const forecastCache = memoize(async (code: string): Promise<ForecastRow[]> => {
  return fetchFinancialForecast(code, 50);
}, CacheTTL.financial);

export async function getFinancialForecast(code: string, limit = 30): Promise<ForecastRow[]> {
  const all = await forecastCache(code);
  return all.slice(0, limit);
}

// ============================================================================
// 资金流
// ============================================================================

export interface FundFlowRow extends EastmoneyFundFlowRow {}

export async function getFundFlow(code: string, limit = 30): Promise<FundFlowRow[]> {
  const sym = parseSymbol(code);
  try {
    const rows = await fetchFundFlow(sym, { limit });
    return rows;
  } catch (e) {
    // 资金流是 push2 独占(东财 datacenter 无此 reportName),境外不通时明确报错
    throw new APIError({
      subtype: "server_error",
      message: `Failed to fetch fund flow data (the fund flow API is unavailable in the current network environment; requires a domestic/China IP): ${e instanceof Error ? e.message : e}`,
      retryable: false,
    });
  }
}

// ============================================================================
// 公告
// ============================================================================

export interface AnnouncementItem extends EastmoneyAnnouncementItem {}

export async function getAnnouncements(
  code: string,
  opts: { page?: number; size?: number; type?: string } = {},
): Promise<AnnouncementItem[]> {
  return fetchAnnouncements(code, opts);
}
