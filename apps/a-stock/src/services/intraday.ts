/**
 * 分时 / Tick 服务
 *
 * 分时(minute):腾讯为主源,失败抛错(不静默返回空数组,避免 agent 误判"今天无数据")。
 * 分笔(tick):东财 push2 独占(境内增强),境外不通时抛 APIError 明确提示。
 */

import { parseSymbol } from "../utils/symbol.js";
import { memoize, CacheTTL } from "../utils/cache.js";
import { fetchTencentMinute, type TencentMinute } from "../sources/tencent.js";
import { fetchTicks, type EastmoneyTickRow } from "../sources/eastmoney.js";
import { APIError } from "@renxqoo/agent-data-cli";

export interface MinutePoint {
  time: string;
  price: number;
  volume: number;
  avgPrice: number;
}

export interface TickRow {
  time: string;
  price: number;
  volume: number;
  direction: "buy" | "sell" | "auction";
  amount: number;
}

const minuteCache = memoize(async (code: string): Promise<MinutePoint[]> => {
  const sym = parseSymbol(code);
  const t = await fetchTencentMinute(sym);
  return t.map((m) => ({
    time: m.time,
    price: m.price,
    volume: m.volume,
    avgPrice: m.avgPrice,
  }));
}, CacheTTL.minute);

export async function getMinute(code: string): Promise<MinutePoint[]> {
  return minuteCache(code);
}

const tickCache = memoize(async (code: string): Promise<TickRow[]> => {
  const sym = parseSymbol(code);
  const rows = await fetchTicks(sym, { limit: 200 });
  return rows.map((r) => ({
    time: r.time,
    price: r.price,
    volume: r.volume,
    direction: r.direction === 1 ? "buy" : r.direction === 2 ? "sell" : "auction",
    amount: r.amount,
  }));
}, CacheTTL.minute);

export async function getTicks(code: string, limit = 100): Promise<TickRow[]> {
  try {
    const all = await tickCache(code);
    return all.slice(0, limit);
  } catch (e) {
    // push2 境外不通,抛明确错误(区分"无数据"和"取数失败")
    throw new APIError({
      subtype: "server_error",
      message: `Failed to fetch tick data (the tick API is unavailable in the current network environment; requires a domestic/China IP): ${e instanceof Error ? e.message : e}`,
      retryable: false,
    });
  }
}
