/**
 * 新浪财经数据源 —— 实时行情 / K线 / 列表 / 分时
 *
 * 三个域名:
 *   - hq.sinajs.cn              实时行情(批量,GBK)
 *   - money.finance.sina.com.cn K线(分钟/日,JSON,UTF-8)
 *   - vip.stock.finance.sina.com.cn 全市场列表 + 板块列表(JSON,UTF-8)
 *
 * 关键约束:
 *   - 部分接口需要特定的来源标识(Referer),以符合数据源的访问约定
 *   - 行情接口 GBK 编码,K线/列表 UTF-8
 *
 * 主要用于:
 *   - 腾讯行情失败的实时报价 fallback
 *   - 腾讯 K线失败时的备源(支持任意周期 scale 参数)
 *   - 东财 push2 列表不可用时的全市场/板块列表主源
 *
 * 数据格式(实时行情):
 *   var hq_str_sh600519="贵州茅台,1308.660,1308.550,1309.220,1315.280,1301.000,1309.220,1309.230,2497581,3266919421.000,...";
 *   字段:0=名称, 1=今开, 2=昨收, 3=当前价, 4=最高, 5=最低,
 *        6=买一价, 7=卖一价, 8=成交量(股), 9=成交额(元),
 *        30=日期, 31=时间
 */

import { httpGet } from "../utils/http.js";
import type { SymbolParts } from "../utils/symbol.js";

const SINA_URL = "https://hq.sinajs.cn/list=";
const SINA_KLINE_URL =
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
const SINA_LIST_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";

/** 部分接口访问所需的来源标识(符合数据源的访问约定) */
const SINA_HEADERS = { Referer: "https://finance.sina.com.cn" };

export interface SinaRawQuote {
  name: string;
  code: string;
  open: number;
  prevClose: number;
  price: number;
  high: number;
  low: number;
  bid1: number;
  ask1: number;
  /** 成交量(股) */
  volume: number;
  /** 成交额(元) */
  amount: number;
  date: string;
  time: string;
}

export async function fetchSinaQuotes(symbols: SymbolParts[]): Promise<SinaRawQuote[]> {
  if (symbols.length === 0) return [];
  const list = symbols.map((s) => s.tencent).join(",");
  const res = await httpGet<string>(`${SINA_URL}${list}`, {
    responseType: "gbk",
    timeout: 5000,
    retries: 2,
    headers: SINA_HEADERS, // 来源标识(数据源访问约定)
  });
  return parseSinaResponse(res.data);
}

function parseSinaResponse(text: string): SinaRawQuote[] {
  const results: SinaRawQuote[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = /hq_str_([a-z]{2}\d{6})="([^"]*)"/i.exec(line);
    if (!m) continue;
    const symbolKey = m[1]!.toLowerCase();
    const fields = m[2]!.split(",");
    if (fields.length < 32) continue;
    try {
      results.push({
        name: fields[0]!,
        code: symbolKey,
        open: toNumber(fields[1]),
        prevClose: toNumber(fields[2]),
        price: toNumber(fields[3]),
        high: toNumber(fields[4]),
        low: toNumber(fields[5]),
        bid1: toNumber(fields[6]),
        ask1: toNumber(fields[7]),
        volume: toNumber(fields[8]),
        amount: toNumber(fields[9]),
        date: fields[30]!,
        time: fields[31]!,
      });
    } catch {
      // skip
    }
  }
  return results;
}

function toNumber(v: string | undefined): number {
  if (!v) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// ============================================================================
// K线(日/周/月 + 分钟级)
// ============================================================================

/**
 * 新浪 K线 —— 支持任意周期(scale 参数)
 * scale 单位:分钟。日 K 用 240(一个交易日 4 小时),周 K 用 1200,月 K 用 7200。
 * 实测返回 JSON 数组,字段:day/open/high/low/close/volume + 均线(ma_price5 等)
 *
 * 注:新浪 K线只支持不复权,复权需走腾讯。
 */
export interface SinaKlineRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 周期 → 新浪 scale 分钟数 */
const PERIOD_SCALE: Record<string, number> = {
  m5: 5,
  m15: 15,
  m30: 30,
  m60: 60,
  day: 240,
  week: 1200,
  month: 7200,
};

export async function fetchSinaKline(
  symbol: SymbolParts,
  opts: { period: string; limit?: number },
): Promise<SinaKlineRow[]> {
  const scale = PERIOD_SCALE[opts.period];
  if (!scale) return []; // 不支持的周期
  const res = await httpGet<SinaKlineRaw[]>(SINA_KLINE_URL, {
    query: { symbol: symbol.tencent, scale, datalen: opts.limit ?? 320 },
    timeout: 8000,
    retries: 2,
    headers: SINA_HEADERS,
  });
  if (!Array.isArray(res.data)) return [];
  return res.data.map((r) => ({
    date: r.day,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }));
}

interface SinaKlineRaw {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// ============================================================================
// 全市场 / 板块列表
// ============================================================================

/**
 * 新浪全市场股票列表 —— 替代东财 push2/clist(境外不通)
 * node 取值:hs_a=沪深A, sh_a=沪A, sz_a=深A, bj=北交所(详见 getHQNodes)
 *
 * 返回字段(symbol=sz301707, trade=现价, changepercent, volume=股, amount=元,
 *          per=PE, pb=PB, mktcap=总市值(万元), nmc=流通市值(万元), turnoverratio=换手率)
 */
export interface SinaListItem {
  symbol: string; // sz301707
  code: string; // 301707
  name: string;
  trade: number; // 现价
  open: number;
  high: number;
  low: number;
  settlement: number; // 昨收
  pricechange: number; // 涨跌额
  changepercent: number; // 涨跌幅 %
  volume: number; // 股
  amount: number; // 元
  per: number; // PE
  pb: number; // PB
  mktcap: number; // 总市值(万元)
  nmc: number; // 流通市值(万元)
  turnoverratio: number; // 换手率 %
}

/** 新浪 node → 本工具 market 映射 */
const MARKET_NODES: Record<"all" | "sh" | "sz" | "bj", string> = {
  all: "hs_a",
  sh: "sh_a",
  sz: "sz_a",
  bj: "bj_a",
};

export async function fetchSinaStockList(opts: {
  market?: "all" | "sh" | "sz" | "bj";
  page?: number;
  size?: number;
  sort?: string;
  desc?: boolean;
}): Promise<{ total: number; items: SinaListItem[] }> {
  const node = MARKET_NODES[opts.market ?? "all"] ?? "hs_a";
  // 新浪排序字段名与东财不同:symbol/code/name/changepercent/amount/volume/turnoverratio/per/pb
  const sortFieldMap: Record<string, string> = {
    changePercent: "changepercent",
    change: "pricechange",
    amount: "amount",
    volume: "volume",
    code: "symbol",
    name: "name",
    turnoverRate: "turnoverratio",
  };
  const res = await httpGet<SinaListItem[]>(SINA_LIST_URL, {
    query: {
      page: opts.page ?? 1,
      num: Math.min(opts.size ?? 100, 80), // 新浪单页上限约 80
      sort: sortFieldMap[opts.sort ?? "changepercent"] ?? "changepercent",
      asc: opts.desc === false ? 1 : 0,
      node,
      _s_r_a: "sort",
    },
    timeout: 10000,
    retries: 2,
    headers: SINA_HEADERS,
  });
  const items = Array.isArray(res.data) ? res.data : [];
  // 新浪列表接口不直接返回 total,需另查 count;这里用 0 占位,调用方按需补查
  return { total: items.length === 0 ? 0 : -1, items };
}

/**
 * 新浪板块列表 —— 从节点树动态取板块清单(行业/概念/地域)
 *
 * 新浪的"板块列表"不是单一接口返回的排行表,而是节点树里的分类清单:
 *   - 行业:new_blhy(玻璃)/ new_cmyl(传媒)...
 *   - 概念:gn_hwqc / gn_BCdc ...
 *   - 地域:diyu_650000 ...
 * 本函数返回板块名 + node code(作为板块标识),行情字段置空(需另查成分股聚合)。
 *
 * 注:返回的 items 是简化结构(symbol/code/name 有值,行情字段 NaN)。
 *      node code 作为板块标识传给 sector stocks 查成分股。
 */
export interface SinaSectorNode {
  /** 板块名称,如"玻璃行业" */
  name: string;
  /** 新浪 node code,如 new_blhy(作为板块标识) */
  node: string;
}

export async function fetchSinaSectorList(opts: {
  kind?: "industry" | "concept" | "area";
}): Promise<{ total: number; items: SinaSectorNode[] }> {
  const categoryName =
    opts.kind === "concept" ? "概念板块" : opts.kind === "area" ? "地域板块" : "新浪行业";
  const res = await httpGet<unknown>(
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodes",
    { timeout: 10000, retries: 2, headers: SINA_HEADERS },
  );
  const items = extractSectorNodes(res.data, categoryName);
  return { total: items.length, items };
}

/**
 * 递归从节点树中提取指定分类下的板块清单。
 * 节点树格式:[name, children?] 或 [name, children?, code?]
 * code 存在的是叶子板块节点(有数据),缺失的是分类容器。
 */
function extractSectorNodes(tree: unknown, categoryName: string): SinaSectorNode[] {
  const category = findNodeByName(tree, categoryName);
  if (!category || !Array.isArray(category)) return [];
  // category 是子节点数组:[[name, children?, code?], ...]
  const nodes: SinaSectorNode[] = [];
  for (const item of category) {
    if (
      Array.isArray(item) &&
      typeof item[0] === "string" &&
      typeof item[2] === "string" &&
      item[2]
    ) {
      nodes.push({ name: item[0], node: item[2] });
    }
  }
  return nodes;
}

/** 在节点树里按名找节点,返回其 children(子数组) */
function findNodeByName(node: unknown, name: string): unknown[] | null {
  if (Array.isArray(node) && node.length >= 1 && node[0] === name) {
    // 找到了,返回 children(第二个元素,应是数组)
    if (Array.isArray(node[1])) return node[1];
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const r = findNodeByName(child, name);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Sina 通用函数:把 TencentQuote-style 标准化字段从 Sina 数据补齐
 * 用于当腾讯失败时的兜底
 */
export function sinaToQuote(s: SinaRawQuote, sym: SymbolParts) {
  // Sina 没有涨跌额/涨跌幅,要算
  const change = s.price - s.prevClose;
  const changePercent = s.prevClose ? (change / s.prevClose) * 100 : NaN;
  return {
    code: sym.code,
    name: s.name,
    market: sym.market,
    price: s.price,
    prevClose: s.prevClose,
    open: s.open,
    high: s.high,
    low: s.low,
    change,
    changePercent,
    volume: Math.round(s.volume / 100), // 股 → 手
    amount: s.amount,
    turnoverRate: NaN,
    volumeRatio: NaN,
    amplitude: NaN,
    peRatio: null,
    pbRatio: null,
    circulateMarketCap: NaN,
    totalMarketCap: NaN,
    limitUp: NaN,
    limitDown: NaN,
    time: `${s.date} ${s.time}`,
    bids: [],
    asks: [],
    source: "sina" as const,
  };
}
