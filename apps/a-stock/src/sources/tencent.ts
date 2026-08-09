/**
 * 腾讯财经数据源 —— https://qt.gtimg.cn + https://web.ifzq.gtimg.cn
 *
 * 优势:
 *   - 无 Referer 限制(对比新浪),全球可达
 *   - 单接口支持批量:qt.gtimg.cn?q=sh600519,sz000001(逗号分隔)
 *   - qt 字段定义清晰(36+ 字段)
 *   - K 线接口参数灵活:周期 / 复权 / 起始结束日
 *
 * qt.gtimg.cn 数据格式:
 *   v_sh600519="1~贵州茅台~600519~1309.22~1308.55~...";
 *   分隔符:~ ;字段位置固定(见 parseQtStock)
 *
 * 数据源约定:
 *   - 实时行情:gtimg.cn/q=  (快照)
 *   - K 线(不复权):appstock/app/fqkline/get?param=code,period,,,count  (返回 day/week/month/... 数组)
 *   - K 线(前复权):param=code,period,,,count,qfq  (额外 qfqday / qfqweek / qfqmonth / qfq*min*)
 *   - 分时:appstock/app/minute/query?code=sh600519
 */

import { httpGet } from "../utils/http.js";
import { APIError } from "@renxqoo/agent-data-cli";
import type { SymbolParts } from "../utils/symbol.js";

const QT_URL = "https://qt.gtimg.cn/q=";
const KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const MINUTE_URL = "https://web.ifzq.gtimg.cn/appstock/app/minute/query";

/**
 * 实时行情快照(批量)
 * 输入 SymbolParts[] 返回规范化 Quote[]
 */
export async function fetchTencentQuotes(symbols: SymbolParts[]): Promise<TencentRawQuote[]> {
  if (symbols.length === 0) return [];
  const q = symbols.map((s) => s.tencent).join(",");
  const res = await httpGet<string>(`${QT_URL}${q}`, {
    responseType: "gbk",
    timeout: 5000,
    retries: 2,
  });
  return parseQtResponse(res.data);
}

/** 单只实时行情 */
export async function fetchTencentQuote(symbol: SymbolParts): Promise<TencentRawQuote | null> {
  const list = await fetchTencentQuotes([symbol]);
  return list[0] ?? null;
}

/**
 * K 线数据
 *
 * 腾讯只支持 day / week / month / year 四个周期,分钟级不支持。
 * 复权支持 qfq(前)/ hfq(后)。
 *
 * @param symbol 标准化代码
 * @param period 腾讯支持:'day' | 'week' | 'month' | 'year'
 *               注:分钟级 K 线腾讯不支持,需要走东财(push2his.eastmoney.com)
 * @param adjust 'none' | 'qfq' | 'hfq'
 * @param count  返回根数(默认 320)
 * @param start/end YYYY-MM-DD 区间(可选)
 */
export interface TencentKlineParams {
  period: "day" | "week" | "month" | "year";
  adjust?: "none" | "qfq" | "hfq";
  count?: number;
  start?: string;
  end?: string;
}

/** 腾讯支持哪些周期 */
export const TENCENT_KLINE_PERIODS: TencentKlineParams["period"][] = [
  "day",
  "week",
  "month",
  "year",
];

export async function fetchTencentKline(
  symbol: SymbolParts,
  params: TencentKlineParams,
): Promise<TencentKlineRow[]> {
  if (!TENCENT_KLINE_PERIODS.includes(params.period)) {
    throw new APIError({
      subtype: "server_error",
      message: `Tencent does not support period ${params.period}`,
      retryable: false,
    });
  }
  const { period, adjust = "none", count = 320, start, end } = params;
  // 腾讯 fqkline 接口不复权(adjustTag 空)会返回 code:1 "bad params",
  // 必须显式传 qfq 或 hfq。不复权时默认用 qfqday(前复权)——这是分析标准做法,
  // 且除权除息会扭曲涨跌幅计算。真不复权需调用方接受腾讯接口限制。
  const adjustTag = adjust === "hfq" ? "hfq" : "qfq";
  const effectiveAdjust = adjust === "hfq" ? "hfq" : "qfq";
  const paramValue = [
    symbol.tencent,
    period,
    start ?? "",
    end ?? "",
    String(count),
    adjustTag,
  ].join(",");
  const res = await httpGet<{
    code: number;
    msg: string;
    data: Record<string, TencentKlineData>;
  }>(KLINE_URL, { query: { param: paramValue }, timeout: 8000 });

  if (res.data.code !== 0) {
    throw new APIError({
      subtype: "server_error",
      message: `Tencent kline error: ${res.data.msg}`,
      retryable: true,
    });
  }
  const d = res.data.data[symbol.tencent];
  if (!d) return [];
  const key = pickKlineKey(d, period, effectiveAdjust);
  if (!key) return [];
  const rows = d[key] as unknown[][] | undefined;
  if (!rows) return [];
  return rows.map((arr) => ({
    date: String(arr[0]),
    open: toNumber(arr[1]),
    close: toNumber(arr[2]),
    high: toNumber(arr[3]),
    low: toNumber(arr[4]),
    volume: toNumber(arr[5]),
    amount: arr.length > 6 ? toNumber(arr[6]) : null,
  }));
}

function pickKlineKey(
  d: TencentKlineData,
  period: TencentKlineParams["period"],
  adjust: TencentKlineParams["adjust"],
): keyof TencentKlineData | null {
  const candidates: string[] =
    adjust === "qfq"
      ? [`qfq${period}`]
      : adjust === "hfq"
        ? [`hfq${period}`]
        : [period, `qfq${period}`, `hfq${period}`]; // 不复权优先用不复权 key
  for (const k of candidates) {
    if (d[k as keyof TencentKlineData] !== undefined) return k as keyof TencentKlineData;
  }
  return null;
}

/** 分时图(分钟走势,当日) */
export interface TencentMinute {
  time: string; // HH:mm
  price: number;
  volume: number; // 累计成交量(手)
  avgPrice: number; // 均价
}

export async function fetchTencentMinute(symbol: SymbolParts): Promise<TencentMinute[]> {
  const res = await httpGet<{
    code: number;
    msg: string;
    data: Record<string, { data?: { data?: string[]; date?: string } }>;
  }>(MINUTE_URL, { query: { code: symbol.tencent }, timeout: 8000 });
  if (res.data.code !== 0) {
    throw new APIError({
      subtype: "server_error",
      message: `Tencent minute error: ${res.data.msg}`,
      retryable: true,
    });
  }
  // 响应结构:data.sh600519.data.data = string[] (分钟数组)
  const sd = res.data.data[symbol.tencent];
  const rows = sd?.data?.data;
  if (!rows || rows.length === 0) return [];
  // 行格式:"HHmm price volume amount"  按空格分割
  // 含义:time=0930, price=当前价, volume=累计成交量(手), amount=累计成交额(元)
  // 均价 = 累计成交额 / 累计成交量
  return rows.map((row) => {
    const [timeRaw, priceRaw, volRaw, amountRaw] = row.split(/\s+/);
    const t = timeRaw ?? "";
    const time = t.length === 4 ? `${t.slice(0, 2)}:${t.slice(2)}` : t;
    const volume = toNumber(volRaw); // 手
    const amount = toNumber(amountRaw); // 元
    // avgPrice(元/手) = amount / volume(把元换算到 每股 × 100)
    // 正确均价(元/股) = amount / (volume * 100)
    const avgPrice = volume > 0 ? amount / (volume * 100) : NaN;
    return {
      time,
      price: toNumber(priceRaw),
      volume,
      avgPrice,
    };
  });
}

// —— 解析 qt.gtimg.cn 响应 ——

/**
 * 原始 36 字段腾讯实时行情:
 *  [0]  1  (未知)
 *  [1]  名称(中文)
 *  [2]  代码
 *  [3]  当前价
 *  [4]  昨收
 *  [5]  今开
 *  [6]  成交量(手)
 *  [7]  外盘
 *  [8]  内盘
 *  [9]  买一价
 *  [10] 买一量
 *  [11] 买二价
 *  [12] 买二量
 *  ... (买五 / 卖五共 10 档,这里简化)
 *  [29] 时间
 *  [30] 涨跌额
 *  [31] 涨跌幅(%)
 *  [32] 最高
 *  [33] 最低
 *  [34] 价格/成交量/成交额 (字符串)
 *  [35] 成交量(手)
 *  [36] 成交额(元)
 *  [37] 换手率(%)
 *  [38] 市盈率(动)
 *  [39] 最高(?)
 *  [40] 最低(?)
 *  [41] 振幅(%)
 *  [42] 流通市值
 *  [43] 总市值
 *  [44] 市净率
 *  [45] 涨停价
 *  [46] 跌停价
 *  [47] 委比(%)
 *  [48] 量比
 *  ...
 *  [60+] 扩展字段(行业 / 板块等)
 */
export interface TencentRawQuote {
  name: string;
  code: string;
  /** 内部用:腾讯原始 symbol key (sh600519),用于和 SymbolParts.tencent 匹配校验 */
  symbolKey?: string;
  price: number;
  prevClose: number;
  open: number;
  volume: number; // 手
  outerVolume: number;
  innerVolume: number;
  bid1: { price: number; volume: number };
  bid2: { price: number; volume: number };
  bid3: { price: number; volume: number };
  bid4: { price: number; volume: number };
  bid5: { price: number; volume: number };
  ask1: { price: number; volume: number };
  ask2: { price: number; volume: number };
  ask3: { price: number; volume: number };
  ask4: { price: number; volume: number };
  ask5: { price: number; volume: number };
  time: string;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  amount: number; // 元
  turnoverRate: number; // 换手率 %
  peRatio: number | null; // 市盈率(动)
  amplitude: number; // 振幅 %
  circulateMarketCap: number; // 流通市值
  totalMarketCap: number; // 总市值
  pbRatio: number | null; // 市净率
  limitUp: number;
  limitDown: number;
  committeeRatio: number; // 委比 %
  volumeRatio: number; // 量比
}

function parseQtResponse(text: string): TencentRawQuote[] {
  const results: TencentRawQuote[] = [];
  // 每行: v_sh600519="...";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = /v_([a-z]{2}\d{6})="([^"]*)"/i.exec(line);
    if (!m) continue;
    const symbolKey = m[1]!.toUpperCase();
    const fields = m[2]!.split("~");
    if (fields.length < 40) continue;
    try {
      results.push({
        name: fields[1]!,
        code: fields[2]!,
        symbolKey: symbolKey,
        price: toNumber(fields[3]),
        prevClose: toNumber(fields[4]),
        open: toNumber(fields[5]),
        volume: toNumber(fields[6]),
        outerVolume: toNumber(fields[7]),
        innerVolume: toNumber(fields[8]),
        bid1: { price: toNumber(fields[9]), volume: toNumber(fields[10]) },
        bid2: { price: toNumber(fields[11]), volume: toNumber(fields[12]) },
        bid3: { price: toNumber(fields[13]), volume: toNumber(fields[14]) },
        bid4: { price: toNumber(fields[15]), volume: toNumber(fields[16]) },
        bid5: { price: toNumber(fields[17]), volume: toNumber(fields[18]) },
        ask1: { price: toNumber(fields[19]), volume: toNumber(fields[20]) },
        ask2: { price: toNumber(fields[21]), volume: toNumber(fields[22]) },
        ask3: { price: toNumber(fields[23]), volume: toNumber(fields[24]) },
        ask4: { price: toNumber(fields[25]), volume: toNumber(fields[26]) },
        ask5: { price: toNumber(fields[27]), volume: toNumber(fields[28]) },
        time: fields[30]!,
        change: toNumber(fields[31]),
        changePercent: toNumber(fields[32]),
        high: toNumber(fields[33]),
        low: toNumber(fields[34]),
        // [35] = "price/vol/amount" 文本;  [37] 是 amount(万元),需 ×10000 → 元
        amount: toNumber(fields[37]) * 10000,
        turnoverRate: toNumber(fields[38]),
        peRatio: toNumberOrNull(fields[39]),
        amplitude: toNumber(fields[43]),
        circulateMarketCap: toNumber(fields[44]),
        totalMarketCap: toNumber(fields[45]),
        pbRatio: toNumberOrNull(fields[46]),
        limitUp: toNumber(fields[47]),
        limitDown: toNumber(fields[48]),
        committeeRatio: toNumber(fields[49]),
        volumeRatio: toNumber(fields[50]),
      });
    } catch {
      // skip malformed
    }
  }
  return results;
}

// —— 类型 ——
interface TencentKlineData {
  day?: unknown[][];
  week?: unknown[][];
  month?: unknown[][];
  season?: unknown[][];
  year?: unknown[][];
  m1?: unknown[][];
  m5?: unknown[][];
  m15?: unknown[][];
  m30?: unknown[][];
  m60?: unknown[][];
  qfqday?: unknown[][];
  qfqweek?: unknown[][];
  qfqmonth?: unknown[][];
  qfqseason?: unknown[][];
  qfqyear?: unknown[][];
  qfqm1?: unknown[][];
  qfqm5?: unknown[][];
  qfqm15?: unknown[][];
  qfqm30?: unknown[][];
  qfqm60?: unknown[][];
  hfqday?: unknown[][];
  hfqweek?: unknown[][];
  hfqmonth?: unknown[][];
  hfqseason?: unknown[][];
  hfqyear?: unknown[][];
  hfqm1?: unknown[][];
  hfqm5?: unknown[][];
  hfqm15?: unknown[][];
  hfqm30?: unknown[][];
  hfqm60?: unknown[][];
  qt?: unknown[][];
}

export interface TencentKlineRow {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number | null;
}

type TencentMinuteRaw = [string, string | number, string | number, string | number];

// —— 数字清洗 ——
function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  // 去掉千分位逗号
  const s = v.replace(/,/g, "").trim();
  if (!s || s === "-") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function toNumberOrNull(v: unknown): number | null {
  const n = toNumber(v);
  return Number.isFinite(n) ? n : null;
}
