/**
 * 技术指标计算 —— 纯本地计算,基于 K线数据(OHLCV)。
 *
 * 不依赖任何数据源,所有指标从传入的 Kline[] 计算。
 * 用于深度技术分析:趋势(MACD/均线)、超买超卖(RSI/KDJ)、波动(布林)。
 */

import type { Kline } from "../services/kline.js";

// —— 均线(MA) ——
export function MA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

// —— 指数移动平均(EMA) ——
export function EMA(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  let ema = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[0]! : values[i]! * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// —— MACD(12,26,9) ——
export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function MACD(closes: number[]): MACDResult {
  const fast = EMA(closes, 12);
  const slow = EMA(closes, 26);
  const dif = closes.map((_, i) => fast[i]! - slow[i]!);
  const dea = EMA(dif, 9);
  return {
    macd: dif,
    signal: dea,
    histogram: dif.map((d, i) => (d - dea[i]!) * 2),
  };
}

// —— RSI(默认 14) ——
export function RSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [null];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
      } else {
        result.push(null);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

// —— KDJ(9,3,3) ——
export interface KDJResult {
  k: (number | null)[];
  d: (number | null)[];
  j: (number | null)[];
}

export function KDJ(klines: Kline[], period = 9): KDJResult {
  const k: (number | null)[] = [];
  const d: (number | null)[] = [];
  const j: (number | null)[] = [];
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) {
      k.push(null);
      d.push(null);
      j.push(null);
      continue;
    }
    const slice = klines.slice(i - period + 1, i + 1);
    const high = Math.max(...slice.map((x) => x.high));
    const low = Math.min(...slice.map((x) => x.low));
    const close = klines[i]!.close;
    const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100;
    const kv = (prevK * 2 + rsv) / 3;
    const dv = (prevD * 2 + kv) / 3;
    const jv = 3 * kv - 2 * dv;
    k.push(kv);
    d.push(dv);
    j.push(jv);
    prevK = kv;
    prevD = dv;
  }
  return { k, d, j };
}

// —— 布林带(20,2) ——
export interface BollResult {
  upper: (number | null)[];
  mid: (number | null)[];
  lower: (number | null)[];
}

export function BOLL(closes: number[], period = 20, mult = 2): BollResult {
  const mid = MA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      const m = mid[i]!;
      const variance = slice.reduce((acc, v) => acc + (v - m) ** 2, 0) / period;
      const std = Math.sqrt(variance);
      upper.push(m + mult * std);
      lower.push(m - mult * std);
    }
  }
  return { upper, mid, lower };
}

// —— ATR(平均真实波幅,14) ——
export function ATR(klines: Kline[], period = 14): (number | null)[] {
  const trs: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) {
      trs.push(klines[i]!.high - klines[i]!.low);
    } else {
      const k = klines[i]!;
      const prevClose = klines[i - 1]!.close;
      trs.push(Math.max(k.high - k.low, Math.abs(k.high - prevClose), Math.abs(k.low - prevClose)));
    }
  }
  const result: (number | null)[] = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      result.push(trs.slice(0, period).reduce((a, b) => a + b, 0) / period);
    } else {
      const prev = result[i - 1]!;
      result.push((prev * (period - 1) + trs[i]!) / period);
    }
  }
  return result;
}

/**
 * 计算某值在历史序列中的百分位(估值分位核心)。
 * @param value 当前值
 * @param history 历史值序列
 * @returns 0-100,表示当前值高于历史 x% 的数据
 */
export function percentile(value: number, history: number[]): number {
  const valid = history.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return NaN;
  const below = valid.filter((v) => v < value).length;
  return (below / valid.length) * 100;
}
