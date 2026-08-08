/**
 * 个股综合诊断 —— 聚合基本面/技术面/股东/估值等多维度数据,一次性给出分析视图。
 *
 * 深度分析时,避免反复调用多个命令;diagnosis 一次拉全。
 * 各维度容错:某维度取数失败不影响其他维度(返回 null)。
 */

import { getQuote } from "./quote.js";
import { getKline, getIndicators, getValuation } from "./kline.js";
import { getFinancialMain } from "./financial.js";
import { getHolders, getHolderCount } from "./advanced.js";
import { getCompanyProfile } from "./stock.js";

export interface StockDiagnosis {
  code: string;
  /** 基本面 */
  fundamental?: {
    name: string;
    industry?: string;
    price: number;
    peRatio: number | null;
    pbRatio: number | null;
    totalMarketCap: number;
    circulateMarketCap: number;
    /** 最新财报 */
    latestFinance?: {
      reportDate: string;
      eps: number;
      roe: number;
      revenueYoY: number;
      profitYoY: number;
      grossMargin: number;
      debtRatio: number;
    };
    /** 估值分位 */
    valuation?: {
      pePercentile: number;
      pbPercentile: number;
    };
  };
  /** 技术面(最新指标) */
  technical?: {
    date: string;
    price: number;
    ma5: number | null;
    ma20: number | null;
    ma60: number | null;
    macd: number | null;
    rsi12: number | null;
    kdjJ: number | null;
    bollMid: number | null;
    bollUpper: number | null;
    bollLower: number | null;
  };
  /** 股东/筹码 */
  holders?: {
    holderCount?: number;
    holderCountChange?: number;
    topHolderRatio?: number;
  };
}

/**
 * 个股综合诊断。
 * 任一维度失败返回部分结果(对应字段为 undefined)。
 */
export async function getDiagnosis(code: string): Promise<StockDiagnosis> {
  const result: StockDiagnosis = { code };

  // 1. 基本面(行情 + 公司信息 + 财务)
  try {
    const [quote, profile, fin] = await Promise.all([
      getQuote(code),
      getCompanyProfile(code),
      getFinancialMain(code, 1),
    ]);
    if (quote) {
      result.fundamental = {
        name: quote.name,
        price: quote.price,
        peRatio: quote.peRatio,
        pbRatio: quote.pbRatio,
        totalMarketCap: quote.totalMarketCap,
        circulateMarketCap: quote.circulateMarketCap,
      };
      if (profile?.industry) result.fundamental.industry = profile.industry;
      if (fin[0]) {
        result.fundamental.latestFinance = {
          reportDate: fin[0].reportDate,
          eps: fin[0].eps,
          roe: fin[0].roe,
          revenueYoY: fin[0].revenueYoY,
          profitYoY: fin[0].profitYoY,
          grossMargin: fin[0].grossMargin,
          debtRatio: fin[0].debtRatio,
        };
      }
    }
  } catch {}

  // 2. 估值分位(并入基本面)
  try {
    const val = await getValuation(code, 250);
    if (val && result.fundamental) {
      result.fundamental.valuation = {
        pePercentile: val.pePercentile,
        pbPercentile: val.pbPercentile,
      };
    }
  } catch {}

  // 3. 技术面
  try {
    const inds = await getIndicators(code, ["ma", "macd", "rsi", "kdj", "boll"], 120);
    const ma = inds.find((i) => i.type === "ma");
    const macd = inds.find((i) => i.type === "macd");
    const rsi = inds.find((i) => i.type === "rsi");
    const kdj = inds.find((i) => i.type === "kdj");
    const boll = inds.find((i) => i.type === "boll");
    if (ma) {
      result.technical = {
        date: ma.date,
        price: ma.price,
        ma5: ma.values.ma5 ?? null,
        ma20: ma.values.ma20 ?? null,
        ma60: ma.values.ma60 ?? null,
        macd: macd?.values.macd ?? null,
        rsi12: rsi?.values.rsi12 ?? null,
        kdjJ: kdj?.values.j ?? null,
        bollMid: boll?.values.mid ?? null,
        bollUpper: boll?.values.upper ?? null,
        bollLower: boll?.values.lower ?? null,
      };
    }
  } catch {}

  // 4. 股东/筹码
  try {
    const [holderCount, holders] = await Promise.all([
      getHolderCount(code, 1),
      getHolders(code, 1),
    ]);
    if (holderCount[0] || holders[0]) {
      result.holders = {};
      if (holderCount[0]) {
        result.holders.holderCount = holderCount[0].holderTotalNum;
        result.holders.holderCountChange = holderCount[0].totalNumRatio;
      }
      if (holders[0]) {
        result.holders.topHolderRatio = holders[0].holdRatio;
      }
    }
  } catch {}

  return result;
}
