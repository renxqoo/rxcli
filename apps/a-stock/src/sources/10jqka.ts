/**
 * 同花顺(10jqka)数据源 —— d.10jqka.com.cn
 *
 * 可用性(实测):
 *   - 日K(01)/ 周K(02):可用,JSONP 格式,data 是分号分隔的 "日期,开,高,低,收,量,额"
 *   - 月K(03)/ 分钟K(05):404 不可用
 *   - 实时盘口 realhead:可用,字段是数字编码(需映射表)
 *
 * 定位:K线第三源(日/周)、行情第三源(盘口)。
 *      覆盖腾讯不支持的场景较少,主要价值是当腾讯+新浪都失败时的最后兜底。
 *
 * 格式:JSONP —— `quotebridge_v6_line_hs_600519_01_last({...})`,需去掉 callback 前缀后解析 JSON。
 *
 * 注意:d.10jqka.com.cn 历史上地域限制较强(国内外/运营商差异),稳定性次于腾讯。
 *       仅作为 fallback 链的末端,不作主源。
 */

import { httpGet } from "../utils/http.js";
import type { SymbolParts } from "../utils/symbol.js";

const KLINE_URL = (code: string, type: string) =>
  `https://d.10jqka.com.cn/v6/line/hs_${code}/${type}/last.js`;
const REALHEAD_URL = (code: string) => `https://d.10jqka.com.cn/v6/realhead/hs_${code}/last.js`;

/** 周期 → 同花顺 type 代码(01=日, 02=周;月/分钟不支持) */
const PERIOD_TYPE: Record<string, string> = {
  day: "01",
  week: "02",
};

export interface JqkaKlineRow {
  date: string; // YYYYMMDD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

/**
 * 同花顺 K线(日 / 周)
 * @returns 空数组表示该周期不支持或无数据
 */
export async function fetchJqkaKline(
  symbol: SymbolParts,
  opts: { period: string; limit?: number },
): Promise<JqkaKlineRow[]> {
  const type = PERIOD_TYPE[opts.period];
  if (!type) return []; // 只支持 day/week
  const res = await httpGet<string>(KLINE_URL(symbol.code, type), {
    responseType: "text",
    timeout: 8000,
    retries: 2,
  });
  const json = stripJsonp(res.data);
  if (!json) return [];
  const parsed = JSON.parse(json) as { data?: string; name?: string };
  if (!parsed.data) return [];
  // data 是分号分隔的行,每行逗号分隔:日期,开,高,低,收,量,额
  const rows = parsed.data
    .split(";")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split(",");
      return {
        date: parts[0] ?? "",
        open: Number(parts[1]),
        high: Number(parts[2]),
        low: Number(parts[3]),
        close: Number(parts[4]),
        volume: Number(parts[5]),
        amount: Number(parts[6]),
      };
    });
  // 同花顺返回全部历史,取最后 limit 根
  const limit = opts.limit ?? 320;
  return rows.slice(-limit);
}

/** 实时盘口(数字字段编码) */
export interface JqkaQuote {
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number; // 股
  amount: number; // 元
  limitUp: number;
  limitDown: number;
}

export async function fetchJqkaQuote(symbol: SymbolParts): Promise<JqkaQuote | null> {
  const res = await httpGet<string>(REALHEAD_URL(symbol.code), {
    responseType: "text",
    timeout: 8000,
    retries: 2,
  });
  const json = stripJsonp(res.data);
  if (!json) return null;
  const parsed = JSON.parse(json) as { items?: Record<string, string> };
  const it = parsed.items;
  if (!it) return null;
  const num = (k: string): number => {
    const v = it[k];
    return v ? Number(v) : NaN;
  };
  // 字段编码(实测):10=现价 7=昨收 8=最高 9=最低 13=总量(股) 19=成交额 69=涨停 70=跌停
  return {
    price: num("10"),
    prevClose: num("7"),
    open: num("6"),
    high: num("8"),
    low: num("9"),
    volume: num("13"),
    amount: num("19"),
    limitUp: num("69"),
    limitDown: num("70"),
  };
}

/** 去 JSONP callback 包裹,提取纯 JSON */
function stripJsonp(text: string): string | null {
  // quotebridge_v6_line_hs_600519_01_last({...})
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start + 1, end);
}
