/**
 * 东方财富数据源
 *
 * 域名分两类,可用性差异极大(实测):
 *
 *   🟢 datacenter-web.eastmoney.com —— 境内外都通,JSON,最稳定
 *      财务/龙虎榜/分红/两融/解禁/大宗/北向/股东/公告 全在这。这是东财的主价值。
 *      约定:必须带 columns=ALL,filter 里的引号需 URL 编码。
 *
 *   🟢 searchapi.eastmoney.com —— 搜索,境内外都通(需固定 token)
 *
 *   🟡 push2.eastmoney.com / push2his.eastmoney.com / 82.push2 —— **境外/受限网络不通**(HTTP 000)
 *      实时行情快照/列表/板块/资金流/分笔/K线 在这。
 *      这些接口只在境内 IP 可用。本工具把它们作为"境内增强源"保留,
 *      优先级最低(境外自动 fallback 到腾讯/新浪;境内可作为数据更全的补充源)。
 *      调用方需 try/catch 容错,不能作为唯一源依赖。
 *
 * 主要 API:
 *   - 财务(主要):  datacenter-web/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA
 *   - 业绩预告:    datacenter-web/api/data/v1/get?reportName=RPT_LICO_FN_CPD
 *   - 公告:        np-anotice-stock.eastmoney.com/api/security/ann?stock_list=600519&page_size=20
 *   - 搜索:        searchapi/api/suggest/get?input=&type=14
 *   - 实时快照[🟡]:  push2/api/qt/stock/get?secid=1.600519&fields=f43,...
 *   - K 线[🟡]:      push2his/api/qt/stock/kline/get?...&klt=101&fqt=1
 *   - 列表/板块[🟡]: push2/api/qt/clist/get?...&fs=m:0+t:6,m:0+t:80&pn=1&pz=20&fid=f3
 *   - 资金流[🟡]:    push2/api/qt/stock/fflow/daykline/get?secid=1.600519
 *   - 分笔[🟡]:      push2/api/qt/stock/details/get?secid=...
 *
 * 字段编号(f*)含义由全市场共用,文档不公开但社区已稳定。常用:
 *   f43=当前价, f44=最高, f45=最低, f46=今开, f47=成交量(手),
 *   f48=成交额, f50=量比, f57=代码, f58=名称, f60=昨收,
 *   f162=市盈率ttm, f167=市净率, f168=换手率, f169=涨跌额,
 *   f170=涨跌幅%, f171=振幅%, f117=总市值, f85=流通市值,
 *   f191=成交量(手,精确), f192=板块代码(板块相关时),
 *   f173=ROE, f183=市净率(板块), f184=涨速
 */

import { httpGet } from "../utils/http.js";
import { eastmoneyFs, type SymbolParts } from "../utils/symbol.js";

// ============================================================================
// 实时行情
// ============================================================================

/**
 * 实时行情快照(单只)[🟡 境内增强源]
 *
 * 走 push2 域 —— 境外/受限网络会 HTTP 000 超时。
 * 行情主源是腾讯(services/quote.ts),本函数仅作为境内增强 fallback;
 * 调用方必须 try/catch,境外会失败并自动回落到下一个源。
 *
 * 注意:批量时 secid 用逗号分隔,返回 data 结构变为 diff 数组(非对象)。
 */
export async function fetchEastmoneyQuote(symbol: SymbolParts): Promise<EastmoneyRawQuote | null> {
  const fields =
    "f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f162,f163,f167,f168,f169,f170,f171,f117,f85,f86,f292,f173,f183,f184,f185,f192,f107,f191,f161,f162,f59,f55,f49,f84,f292";
  const res = await httpGet<{ rc: number; data: EastmoneyRawQuote }>(
    "https://push2.eastmoney.com/api/qt/stock/get",
    {
      query: { secid: symbol.secid, fields, invt: 2, fltt: 2 },
      timeout: 5000,
      retries: 2,
    },
  );
  if (res.data.rc !== 0 || !res.data.data || Object.keys(res.data.data).length === 0) return null;
  return res.data.data;
}

/**
 * 批量实时行情(单次最多约 100 只)
 */
export async function fetchEastmoneyQuotes(
  symbols: SymbolParts[],
): Promise<(EastmoneyRawQuote | null)[]> {
  if (symbols.length === 0) return [];
  // 单只循环(简单可靠;批量接口语义复杂,数据源偶发问题)
  return Promise.all(symbols.map((s) => fetchEastmoneyQuote(s).catch(() => null)));
}

// ============================================================================
// K 线
// ============================================================================

/**
 * K 线参数 [🟡 境内增强源]
 * 走 push2his 域 —— 境外/受限网络会 HTTP 000 超时。
 * K线主源是腾讯(services/kline.ts),本函数仅作为境内增强 fallback。
 *
 * klt: 1=1分, 5=5分, 15=15分, 30=30分, 60=60分, 101=日, 102=周, 103=月
 * fqt: 0=不复权, 1=前复权, 2=后复权
 */
export interface EastmoneyKlineParams {
  period: "m1" | "m5" | "m15" | "m30" | "m60" | "day" | "week" | "month";
  adjust?: "none" | "qfq" | "hfq";
  limit?: number;
  start?: string; // YYYYMMDD
  end?: string;
}

const PERIOD_KLT: Record<EastmoneyKlineParams["period"], number> = {
  m1: 1,
  m5: 5,
  m15: 15,
  m30: 30,
  m60: 60,
  day: 101,
  week: 102,
  month: 103,
};

export interface EastmoneyKlineRow {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  amplitude: number; // 振幅 %
  changePercent: number; // 涨跌幅 %
  change: number; // 涨跌额
  turnoverRate: number; // 换手率 %
}

export async function fetchEastmoneyKline(
  symbol: SymbolParts,
  params: EastmoneyKlineParams,
): Promise<EastmoneyKlineRow[]> {
  const klt = PERIOD_KLT[params.period];
  const fqt = params.adjust === "qfq" ? 1 : params.adjust === "hfq" ? 2 : 0;
  const fields1 = "f1,f2,f3,f4,f5,f6";
  const fields2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";

  const res = await httpGet<{
    rc: number;
    data: { klines: string[]; name?: string; code?: string; decimal?: number };
  }>("https://push2his.eastmoney.com/api/qt/stock/kline/get", {
    query: {
      secid: symbol.secid,
      fields1,
      fields2,
      klt,
      fqt,
      beg: params.start ?? 0,
      end: params.end ?? 20500101,
      lmt: params.limit ?? 320,
      ...(params.period === "day" ? {} : {}),
    },
    timeout: 8000,
    retries: 2,
  });

  if (res.data.rc !== 0 || !res.data.data) return [];
  const klines = res.data.data.klines ?? [];
  return klines.map(parseKlineLine);
}

function parseKlineLine(line: string): EastmoneyKlineRow {
  const parts = line.split(",");
  return {
    date: parts[0] ?? "",
    open: num(parts[1]),
    close: num(parts[2]),
    high: num(parts[3]),
    low: num(parts[4]),
    volume: num(parts[5]),
    amount: num(parts[6]),
    amplitude: num(parts[7]),
    changePercent: num(parts[8]),
    change: num(parts[9]),
    turnoverRate: num(parts[10]),
  };
}

// ============================================================================
// 股票列表 / 板块列表
// ============================================================================

export type ListMarket = "sh" | "sz" | "bj" | "all";
export type ListSort = "changePercent" | "change" | "amount" | "volume" | "code" | "name";

/**
 * 股票列表(全市场 / 单市场 / 板块)[🟡 境内增强源]
 *
 * 走 push2/clist 域 —— 境外/受限网络会 HTTP 000 超时。
 * 列表主源是新浪(fetchSinaStockList),本函数仅作为境内增强 fallback
 * (东财列表字段更全:f100 年初至今涨跌幅 / f23 涨速 等,新浪没有)。
 *
 * @param market  'sh' | 'sz' | 'bj' | 'all'
 * @param page    1-based 页码
 * @param size    单页条数(默认 100,东财单次最大约 1000)
 * @param sort    排序字段
 * @param desc    是否降序(默认 true)
 */
export async function fetchEastmoneyStockList(
  opts: {
    market?: ListMarket;
    page?: number;
    size?: number;
    sort?: ListSort;
    desc?: boolean;
  } = {},
): Promise<{ total: number; items: EastmoneyStockListItem[] }> {
  const { market = "all", page = 1, size = 100, sort = "changePercent", desc = true } = opts;
  const fs =
    market === "all"
      ? "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81" // 全 A 股
      : eastmoneyFs(market);

  const fidMap: Record<ListSort, string> = {
    changePercent: "f3", // 涨跌幅
    change: "f169",
    amount: "f6",
    volume: "f5",
    code: "f12",
    name: "f14",
  };

  const res = await httpGet<{
    rc: number;
    data: { total: number; diff: EastmoneyStockListItem[] };
  }>("https://push2.eastmoney.com/api/qt/clist/get", {
    query: {
      pn: page,
      pz: size,
      po: desc ? 1 : 0,
      np: 1,
      fltt: 2,
      invt: 2,
      fid: fidMap[sort],
      fs,
      fields:
        "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f22,f23,f24,f25,f100",
    },
    timeout: 8000,
    retries: 2,
  });

  if (res.data.rc !== 0 || !res.data.data) return { total: 0, items: [] };
  return { total: res.data.data.total, items: res.data.data.diff ?? [] };
}

/** 板块列表(行业 / 概念 / 地域)[🟡 境内增强源] */
export type SectorKind = "industry" | "concept" | "area";

export async function fetchEastmoneySectorList(
  opts: {
    kind?: SectorKind;
    page?: number;
    size?: number;
    sort?: ListSort;
    desc?: boolean;
  } = {},
): Promise<{ total: number; items: EastmoneyStockListItem[] }> {
  const { kind = "industry", page = 1, size = 100, sort = "changePercent", desc = true } = opts;
  // m:90+t:2 = 行业板块;m:90+t:3 = 概念板块;m:90+t:1 = 地域
  const fs = kind === "industry" ? "m:90+t:2" : kind === "concept" ? "m:90+t:3" : "m:90+t:1";

  const fidMap: Record<ListSort, string> = {
    changePercent: "f3",
    change: "f169",
    amount: "f6",
    volume: "f5",
    code: "f12",
    name: "f14",
  };

  const res = await httpGet<{
    rc: number;
    data: { total: number; diff: EastmoneyStockListItem[] };
  }>("https://push2.eastmoney.com/api/qt/clist/get", {
    query: {
      pn: page,
      pz: size,
      po: desc ? 1 : 0,
      np: 1,
      fltt: 2,
      invt: 2,
      fid: fidMap[sort],
      fs,
      fields: "f1,f2,f3,f4,f5,f6,f7,f12,f13,f14,f104",
    },
    timeout: 8000,
    retries: 2,
  });
  if (res.data.rc !== 0 || !res.data.data) return { total: 0, items: [] };
  return { total: res.data.data.total, items: res.data.data.diff ?? [] };
}

/** 板块内成分股(传入板块代码 BKxxxx)[🟡 境内增强源] */
export async function fetchSectorConstituents(
  sectorCode: string,
  opts: { page?: number; size?: number } = {},
): Promise<{ total: number; items: EastmoneyStockListItem[] }> {
  const { page = 1, size = 100 } = opts;
  const res = await httpGet<{
    rc: number;
    data: { total: number; diff: EastmoneyStockListItem[] };
  }>("https://push2.eastmoney.com/api/qt/clist/get", {
    query: {
      pn: page,
      pz: size,
      po: 1,
      np: 1,
      fltt: 2,
      invt: 2,
      fid: "f3",
      fs: `b:${sectorCode}+f:!50`,
      fields: "f1,f2,f3,f4,f5,f6,f12,f14",
    },
    timeout: 8000,
    retries: 2,
  });
  if (res.data.rc !== 0 || !res.data.data) return { total: 0, items: [] };
  return { total: res.data.data.total, items: res.data.data.diff ?? [] };
}

// ============================================================================
// 搜索
// ============================================================================

export interface EastmoneySearchItem {
  /** 6 位代码(沪A / 深A / 京A 等) */
  Code: string;
  Name: string;
  PinYin?: string;
  /** 'AStock' = A 股 / 'HKStock' / 'USStock' 等 */
  Classify: string;
  /** '沪A' / '深A' / '京A' 等 */
  SecurityTypeName: string;
  /** '1.600519' 这种东财 secid 形态 */
  QuoteID: string;
  /** 内部代码 */
  InnerCode?: string;
}

export async function searchEastmoney(keyword: string): Promise<EastmoneySearchItem[]> {
  const res = await httpGet<{
    QuotationCodeTable: {
      Data: EastmoneySearchItem[];
      TotalCount: number;
      Status: number;
    };
  }>("https://searchapi.eastmoney.com/api/suggest/get", {
    query: {
      input: keyword,
      type: 14, // A 股代码 + 名称 + 拼音
      // token 来自环境变量(可自行获取),未设置时使用公开默认值
      token: process.env.RXSTOCK_SEARCH_TOKEN ?? "D43BF722C8E33BDC906FB84D85E326E7",
      markettype: "",
      mktNum: "",
      jys: "",
      classify: "",
      securitytype: "",
      status: "",
      count: 30,
    },
    timeout: 5000,
    retries: 2,
    headers: {
      Referer: "https://www.eastmoney.com/", // 来源标识(数据源访问约定)
      Accept: "application/json",
    },
  });
  if (res.data.QuotationCodeTable.Status !== 0) return [];
  return res.data.QuotationCodeTable.Data ?? [];
}

// ============================================================================
// 财务数据
// ============================================================================

export interface EastmoneyFinancialRow {
  /** 报告期 YYYY-MM-DD */
  reportDate: string;
  /** 报告类型:一季报 / 半年报 / 三季报 / 年报 */
  reportType: string;
  /** 营业总收入(元) */
  totalRevenue: number;
  /** 归属母公司净利润(元) */
  netProfit: number;
  /** 基本每股收益 */
  eps: number;
  /** 净资产收益率(%) */
  roe: number;
  /** 营收同比(%) */
  revenueYoY: number;
  /** 净利润同比(%) */
  profitYoY: number;
  /** 销售毛利率(%) */
  grossMargin: number;
  /** 每股净资产 */
  bps: number;
  /** 资产负债率(%) */
  debtRatio: number;
}

/**
 * 主要财务指标(连续季度 / 年度)
 * reportName: RPT_F10_FINANCE_MAINFINADATA
 */
export async function fetchFinancialMain(
  code: string,
  limit = 20,
): Promise<EastmoneyFinancialRow[]> {
  const secCode = toSecucode(code);
  if (!secCode) return [];
  const res = await httpGet<{
    success: boolean;
    result: { data: Record<string, unknown>[]; pages: number };
  }>("https://datacenter-web.eastmoney.com/api/data/v1/get", {
    query: {
      reportName: "RPT_F10_FINANCE_MAINFINADATA",
      columns: "ALL",
      filter: `(SECUCODE="${secCode}")`,
      pageNumber: 1,
      pageSize: limit,
      sortTypes: -1,
      sortColumns: "REPORT_DATE",
      source: "HSF10",
      client: "PC",
    },
    timeout: 10000,
    retries: 2,
  });
  if (!res.data.success) return [];
  return (res.data.result?.data ?? []).map((r) => ({
    reportDate: str(r.REPORT_DATE),
    reportType: str(r.REPORT_DATE_NAME ?? r.DATATYPE),
    totalRevenue: num(r.TOTALOPERATEREVE),
    netProfit: num(r.PARENTNETPROFIT),
    eps: num(r.EPSJB),
    roe: num(r.ROEJQ ?? r.WEIGHTAVG_ROE),
    revenueYoY: num(r.TOTALOPERATEREVETZ),
    profitYoY: num(r.PARENTNETPROFITTZ),
    grossMargin: num(r.XSMLL),
    bps: num(r.BPS),
    debtRatio: num(r.ZCFZL),
  }));
}

/**
 * 业绩预告
 */
export async function fetchFinancialForecast(
  code: string,
  limit = 30,
): Promise<EastmoneyFinancialRow[]> {
  const secCode = toSecucode(code);
  if (!secCode) return [];
  const res = await httpGet<{
    success: boolean;
    result: { data: Record<string, unknown>[]; pages: number };
  }>("https://datacenter-web.eastmoney.com/api/data/v1/get", {
    query: {
      reportName: "RPT_LICO_FN_CPD",
      columns: "ALL",
      filter: `(SECUCODE="${secCode}")`,
      pageNumber: 1,
      pageSize: limit,
      sortTypes: -1,
      sortColumns: "NOTICE_DATE",
    },
    timeout: 10000,
    retries: 2,
  });
  if (!res.data.success) return [];
  return (res.data.result?.data ?? []).map((r) => ({
    reportDate: str(r.REPORTDATE),
    reportType: str(r.DATATYPE),
    totalRevenue: num(r.TOTAL_OPERATE_INCOME),
    netProfit: num(r.PARENT_NETPROFIT),
    eps: num(r.BASIC_EPS),
    roe: num(r.WEIGHTAVG_ROE),
    revenueYoY: num(r.YSTZ),
    profitYoY: num(r.SJLTZ),
    grossMargin: num(r.XSMLL),
    bps: num(r.BPS),
    debtRatio: 0,
  }));
}

// ============================================================================
// 资金流
// ============================================================================

export interface EastmoneyFundFlowRow {
  date: string;
  /**主力净流入(元)*/
  mainNet: number;
  /**小单净流入(元)*/
  smallNet: number;
  /**中单净流入(元)*/
  mediumNet: number;
  /**大单净流入(元)*/
  bigNet: number;
  /**超大单净流入(元)*/
  superNet: number;
  /**主力净流入占比(%)*/
  mainNetRatio: number;
}

/**
 * 个股资金流(主力/大单/中单/小单)[🟡 push2 独占,境内增强源]
 *
 * 实测:东财 datacenter 无资金流 reportName(全部"报表配置不存在"),
 * 资金流数据只在 push2 体系里。境外/受限网络下此接口 HTTP 000 超时,
 * 调用方需 try/catch —— 失败时 services/financial.ts 会返回明确错误,
 * 不静默返回空数组(避免 agent 误判"今天无数据")。
 */
export async function fetchFundFlow(
  symbol: SymbolParts,
  opts: { limit?: number } = {},
): Promise<EastmoneyFundFlowRow[]> {
  const limit = opts.limit ?? 30;
  const res = await httpGet<{
    rc: number;
    data: { klines: string[] };
  }>("https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get", {
    query: {
      secid: symbol.secid,
      fields1: "f1,f2,f3,f4",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58",
      lmt: limit,
      klt: 1,
      fqt: 1,
      beg: 0,
      end: 20500000,
    },
    timeout: 8000,
    retries: 2,
  });
  if (res.data.rc !== 0 || !res.data.data) return [];
  return (res.data.data.klines ?? []).map((line) => {
    const parts = line.split(",");
    return {
      date: parts[0] ?? "",
      mainNet: num(parts[1]),
      smallNet: num(parts[2]),
      mediumNet: num(parts[3]),
      bigNet: num(parts[4]),
      superNet: num(parts[5]),
      mainNetRatio: num(parts[6]),
    };
  });
}

// ============================================================================
// 分笔成交(tick)
// ============================================================================

export interface EastmoneyTickRow {
  time: string; // HH:mm:ss
  price: number;
  volume: number; // 成交手数
  /** 方向: 1 = 买入 / 2 = 卖出 / 4 = 竞价 */
  direction: 1 | 2 | 4;
  amount: number;
}

/** 分笔成交(tick)[🟡 境内增强源] —— 走 push2 域,境外不通。调用方 try/catch 容错。 */
export async function fetchTicks(
  symbol: SymbolParts,
  opts: { limit?: number } = {},
): Promise<EastmoneyTickRow[]> {
  const limit = opts.limit ?? 100;
  const res = await httpGet<{
    rc: number;
    data: { details: string[]; prePrice?: number };
  }>("https://push2.eastmoney.com/api/qt/stock/details/get", {
    query: {
      secid: symbol.secid,
      fields1: "f1,f2,f3,f4",
      fields2: "f51,f52,f53,f54,f55",
      lmt: limit,
      pos: -0, // 从最新开始
    },
    timeout: 8000,
    retries: 2,
  });
  if (res.data.rc !== 0 || !res.data.data) return [];
  return (res.data.data.details ?? []).map((line) => {
    const [time, price, volume, direction, amount] = line.split(",");
    return {
      time: time ?? "",
      price: num(price),
      volume: num(volume),
      direction: Number(direction) as 1 | 2 | 4,
      amount: num(amount),
    };
  });
}

// ============================================================================
// 公告 / 新闻
// ============================================================================

export interface EastmoneyAnnouncementItem {
  artCode: string;
  title: string;
  noticeDate: string;
  columns: { code: string; name: string }[];
  sourceType: string;
}

export async function fetchAnnouncements(
  code: string,
  opts: { page?: number; size?: number; type?: string } = {},
): Promise<EastmoneyAnnouncementItem[]> {
  const { page = 1, size = 20, type = "A" } = opts;
  const res = await httpGet<{
    data: { list: Record<string, unknown>[] };
  }>("https://np-anotice-stock.eastmoney.com/api/security/ann", {
    query: {
      sr: -1,
      page_size: size,
      page_index: page,
      ann_type: type,
      client_source: "web",
      stock_list: code,
      f_node: 0,
      s_node: 0,
    },
    timeout: 8000,
    retries: 2,
  });
  return (res.data?.data?.list ?? []).map((r) => ({
    artCode: str(r.art_code),
    title: str(r.title),
    noticeDate: str(r.notice_date),
    columns: ((r.columns as Record<string, unknown>[]) ?? []).map((c) => ({
      code: str(c.column_code),
      name: str(c.column_name),
    })),
    sourceType: str(r.source_type),
  }));
}

// ============================================================================
// 公司基本信息(从 stock/get 的部分字段获取,东财没有单独的"profile"接口)
// ============================================================================

export interface EastmoneyProfile {
  code: string;
  name: string;
  /** 行业 */
  industry?: string;
  /** 总股本(股) */
  totalShares?: number;
  /** 流通股本(股) */
  circulateShares?: number;
  /** 总市值(元) */
  totalMarketCap?: number;
  /** 流通市值(元) */
  circulateMarketCap?: number;
  /** 上市日期 YYYY-MM-DD */
  listDate?: string;
  /** 每股净资产 */
  bps?: number;
  /** 实际控制人 */
  controller?: string;
  /** 注册资本 */
  registeredCapital?: number;
}

/**
 * 公司基本信息(从 F10 财报主接口取)
 *
 * 注:东财没有"单一 profile 接口",这里复用 RPT_F10_FINANCE_MAINFINADATA 的部分字段。
 * 后续可扩展专门的 F10 接口。
 */
export async function fetchCompanyProfile(code: string): Promise<EastmoneyProfile | null> {
  const secCode = toSecucode(code);
  if (!secCode) return null;
  const res = await httpGet<{
    success: boolean;
    result: { data: Record<string, unknown>[] };
  }>("https://datacenter-web.eastmoney.com/api/data/v1/get", {
    query: {
      reportName: "RPT_F10_FINANCE_MAINFINADATA",
      columns: "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,TOTAL_SHARE,A_FREE_SHARE",
      filter: `(SECUCODE="${secCode}")`,
      pageNumber: 1,
      pageSize: 1,
      sortTypes: -1,
      sortColumns: "REPORT_DATE",
      source: "HSF10",
      client: "PC",
    },
    timeout: 10000,
    retries: 2,
  });
  if (!res.data.success || !res.data.result?.data?.[0]) return null;
  const r = res.data.result.data[0];
  return {
    code: str(r.SECURITY_CODE),
    name: str(r.SECURITY_NAME_ABBR),
    totalShares: num(r.TOTAL_SHARE), // 单位:股
    circulateShares: num(r.A_FREE_SHARE),
  };
}

// ============================================================================
// 类型定义
// ============================================================================

export interface EastmoneyRawQuote {
  /** f43 */
  f43?: number;
  /** f44 最高 */
  f44?: number;
  /** f45 最低 */
  f45?: number;
  /** f46 今开 */
  f46?: number;
  /** f47 成交量(手) */
  f47?: number;
  /** f48 成交额 */
  f48?: number;
  /** f49 委比 */
  f49?: number;
  /** f50 量比 */
  f50?: number;
  /** f51 涨停价 */
  f51?: number;
  /** f52 跌停价 */
  f52?: number;
  /** f55 涨速 */
  f55?: number;
  /** f57 代码 */
  f57: string;
  /** f58 名称 */
  f58: string;
  /** f60 昨收 */
  f60?: number;
  /** f62 主力净额 */
  f62?: number;
  /** f71 中单净额 */
  f71?: number;
  /** f72 大单净额 */
  f72?: number;
  /** f73 小单净额 */
  f73?: number;
  /** f84 总股本 */
  f84?: number;
  /** f85 流通市值 */
  f85?: number;
  /** f86 时间戳 */
  f86?: number;
  /** f107 市场类型 */
  f107?: number;
  /** f117 总市值 */
  f117?: number;
  /** f161 内盘 */
  f161?: number;
  /** f162 动市盈率 */
  f162?: number;
  /** f167 市净率 */
  f167?: number;
  /** f168 换手率(%) */
  f168?: number;
  /** f169 涨跌额 */
  f169?: number;
  /** f170 涨跌幅(%) */
  f170?: number;
  /** f171 振幅(%) */
  f171?: number;
  /** f173 ROE(%) */
  f173?: number;
  /** f183 市净率 */
  f183?: number;
  /** f191 成交量(手,精确) */
  f191?: number;
  /** f192 板块代码 */
  f192?: string;
  /** f292 */
  f292?: number;
}

export interface EastmoneyStockListItem {
  /** 类型 f1 */
  f1?: number;
  /** 当前价 f2 */
  f2?: number;
  /** 涨跌幅 f3 */
  f3?: number;
  /** 涨跌额 f4 */
  f4?: number;
  /** 成交量 f5 */
  f5?: number;
  /** 成交额 f6 */
  f6?: number;
  /** 振幅 f7 */
  f7?: number;
  /** 换手率 f8 */
  f8?: number;
  /** 市盈率 f9 */
  f9?: number;
  /** 量比 f10 */
  f10?: number;
  /** 代码 f12 */
  f12: string;
  /** 板块代码 f13 */
  f13?: number;
  /** 名称 f14 */
  f14: string;
  /** 最高 f15 */
  f15?: number;
  /** 最低 f16 */
  f16?: number;
  /** 今开 f17 */
  f17?: number;
  /** 昨收 f18 */
  f18?: number;
  /** 流通市值 f20 */
  f20?: number;
  /** 总市值 f21 */
  f21?: number;
  /** 市净率 f22 */
  f22?: number;
  /** 涨速 f23 */
  f23?: number;
  /** 5分钟涨跌 f24 */
  f24?: number;
  /** 60日涨跌幅 f25 */
  f25?: number;
  /** 年初至今涨跌幅 f100 */
  f100?: number;
  /** 行业 f104(板块列表才有) */
  f104?: string;
}

// ============================================================================
// 辅助
// ============================================================================

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const s = v.replace(/,/g, "").trim();
  if (!s || s === "-") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

/** 把 600519 转成 SECUCODE 形态 600519.SH */
function toSecucode(code: string): string | null {
  const clean = code.trim().toUpperCase().replace(/[.\s]/g, "");
  let pure = clean;
  let mkt: string | undefined;
  const suffixMatch = /^(.+?)(SH|SZ|BJ)$/.exec(clean);
  if (suffixMatch) {
    pure = suffixMatch[1]!;
    mkt = suffixMatch[2]!;
  }
  if (/^(SH|SZ|BJ)\d{6}$/.test(pure)) {
    mkt = pure.slice(0, 2);
    pure = pure.slice(2);
  }
  if (!/^\d{6}$/.test(pure)) return null;
  if (!mkt) {
    if (pure.startsWith("6") || pure.startsWith("9") || pure.startsWith("5")) mkt = "SH";
    else if (pure.startsWith("0") || pure.startsWith("3")) mkt = "SZ";
    else if (pure.startsWith("4") || pure.startsWith("8")) mkt = "BJ";
  }
  return `${pure}.${mkt}`;
}

// ============================================================================
// datacenter 通用查询(财务/龙虎榜/北向/分红/股东/三表/两融 等高级数据)
// 统一走 datacenter-web.eastmoney.com(境内外都通),必带 columns=ALL
// ============================================================================

const DATACENTER_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";

/**
 * datacenter 通用查询。返回原始行数组(Record<string,unknown>[])。
 * 调用方负责字段映射。
 */
async function datacenterQuery(
  reportName: string,
  opts: {
    filter?: string;
    pageSize?: number;
    sortColumns?: string;
    sortTypes?: number;
  } = {},
): Promise<Record<string, unknown>[]> {
  const res = await httpGet<{
    success: boolean;
    result?: { data?: Record<string, unknown>[]; pages?: number };
  }>(DATACENTER_URL, {
    query: {
      reportName,
      columns: "ALL",
      filter: opts.filter,
      pageNumber: 1,
      pageSize: opts.pageSize ?? 20,
      sortColumns: opts.sortColumns,
      sortTypes: opts.sortTypes,
      source: "WEB",
      client: "WEB",
    },
    timeout: 10000,
    retries: 2,
  });
  if (!res.data.success) return [];
  return res.data.result?.data ?? [];
}

// —— 龙虎榜 ——
export interface EastmoneyDragonTigerRow {
  /** 交易日期 YYYY-MM-DD */
  tradeDate: string;
  code: string;
  name: string;
  /** 收盘价 */
  closePrice: number;
  /** 涨跌幅 % */
  changeRate: number;
  /** 换手率 % */
  turnoverRate: number;
  /** 上榜原因 */
  explain: string;
  /** 龙虎榜买入额(元) */
  buyAmt: number;
  /** 龙虎榜卖出额(元) */
  sellAmt: number;
  /** 龙虎榜净额(元) */
  netAmt: number;
  /** 买入席位数 */
  buySeatCount: number;
  /** 卖出席位数 */
  sellSeatCount: number;
}

export async function fetchDragonTiger(
  opts: { date?: string; code?: string; pageSize?: number } = {},
): Promise<EastmoneyDragonTigerRow[]> {
  const filterParts: string[] = [];
  if (opts.date) filterParts.push(`(TRADE_DATE='${opts.date}')`);
  if (opts.code) filterParts.push(`(SECURITY_CODE='${opts.code}')`);
  const filter = filterParts.length ? filterParts.join(" AND ") : undefined;
  const rows = await datacenterQuery("RPT_DAILYBILLBOARD_DETAILS", {
    filter,
    pageSize: opts.pageSize ?? 30,
    sortColumns: "TRADE_DATE",
    sortTypes: -1,
  });
  return rows.map((r) => ({
    tradeDate: str(r.TRADE_DATE).slice(0, 10),
    code: str(r.SECURITY_CODE),
    name: str(r.SECURITY_NAME_ABBR),
    closePrice: num(r.CLOSE_PRICE),
    changeRate: num(r.CHANGE_RATE),
    turnoverRate: num(r.TURNOVERRATE),
    explain: str(r.EXPLAIN),
    buyAmt: num(r.BILLBOARD_BUY_AMT),
    sellAmt: num(r.BILLBOARD_SELL_AMT),
    netAmt: num(r.BILLBOARD_NET_AMT),
    buySeatCount: num(r.BUY_SEAT),
    sellSeatCount: num(r.SELL_SEAT),
  }));
}

// —— 北向资金(沪深股通) ——
export interface EastmoneyNorthboundRow {
  /** MUTUAL_TYPE: 001=沪股通 / 003=深股通 / 002=港股通 */
  mutualType: string;
  tradeDate: string;
  /** 成交额(元) */
  dealAmt: number;
  /** 净买入额(元;东财部分返回 null) */
  netDealAmt: number | null;
  /** 持股总市值(元) */
  holdMarketCap: number;
  /** 领涨股代码 */
  leadStockCode: string;
  leadStockName: string;
  /** 领涨股涨跌幅 % */
  leadStockChange: number;
}

export async function fetchNorthbound(
  opts: { type?: "001" | "003" | "all"; pageSize?: number } = {},
): Promise<EastmoneyNorthboundRow[]> {
  const type = opts.type ?? "all";
  const filter = type !== "all" ? `(MUTUAL_TYPE="${type}")` : undefined;
  const rows = await datacenterQuery("RPT_MUTUAL_DEAL_HISTORY", {
    filter,
    pageSize: opts.pageSize ?? 30,
    sortColumns: "TRADE_DATE",
    sortTypes: -1,
  });
  return rows.map((r) => ({
    mutualType: str(r.MUTUAL_TYPE),
    tradeDate: str(r.TRADE_DATE).slice(0, 10),
    dealAmt: num(r.DEAL_AMT),
    netDealAmt: r.NET_DEAL_AMT == null ? null : num(r.NET_DEAL_AMT),
    holdMarketCap: num(r.HOLD_MARKET_CAP),
    leadStockCode: str(r.LEAD_STOCKS_CODE),
    leadStockName: str(r.LEAD_STOCKS_NAME),
    leadStockChange: num(r.LS_CHANGE_RATE),
  }));
}

// —— 分红送配 ——
export interface EastmoneyDividendRow {
  /** 公告日期 YYYY-MM-DD */
  noticeDate: string;
  /** 报告期 YYYY-MM-DD */
  reportDate: string;
  /** 实施方案,如"10转1.00派6.00元" */
  implPlan: string;
  /** 送股(每 10 股) */
  bonusRatio: number;
  /** 转增(每 10 股) */
  transferRatio: number;
  /** 派息税前(每 10 股,元) */
  pretaxDividend: number;
  /** 除权除息日 */
  exDividendDate: string;
  /** 股权登记日 */
  equityRecordDate: string;
  /** 进度 */
  progress: string;
}

export async function fetchDividend(code: string, pageSize = 30): Promise<EastmoneyDividendRow[]> {
  const secCode = toSecucode(code);
  if (!secCode) return [];
  const rows = await datacenterQuery("RPT_SHAREBONUS_DET", {
    filter: `(SECURITY_CODE="${code}")`,
    pageSize,
    sortColumns: "REPORT_DATE",
    sortTypes: -1,
  });
  return rows.map((r) => ({
    noticeDate: str(r.NOTICE_DATE).slice(0, 10),
    reportDate: str(r.REPORT_DATE).slice(0, 10),
    implPlan: str(r.IMPL_PLAN_PROFILE),
    bonusRatio: num(r.BONUS_RATIO),
    transferRatio: num(r.IT_RATIO),
    pretaxDividend: num(r.PRETAX_BONUS_RMB),
    exDividendDate: str(r.EX_DIVIDEND_DATE).slice(0, 10),
    equityRecordDate: str(r.EQUITY_RECORD_DATE).slice(0, 10),
    progress: str(r.ASSIGN_PROGRESS),
  }));
}

// —— 十大股东 ——
export interface EastmoneyHolderRow {
  /** 截止日期 YYYY-MM-DD */
  endDate: string;
  /** 股东名称 */
  holderName: string;
  /** 持股数(股) */
  holdNum: number;
  /** 持股比例 % */
  holdRatio: number;
  /** 持股变动(股) */
  holdChange: number;
  /** 变动比例 % */
  changeRatio: number;
  /** 是否机构 */
  isOrg: boolean;
  /** 排名 */
  rank: number;
}

export async function fetchHolders(code: string, pageSize = 10): Promise<EastmoneyHolderRow[]> {
  const secCode = toSecucode(code);
  if (!secCode) return [];
  const rows = await datacenterQuery("RPT_F10_EH_HOLDERS", {
    filter: `(SECUCODE="${secCode}")`,
    pageSize,
    sortColumns: "END_DATE,HOLDER_RANK",
    sortTypes: -1, // 注:datacenter 对多 sortColumns 只接受单个 sortTypes,这里退回单字段排序
  });
  // 若多字段排序报错,退回按 END_DATE 单字段
  if (rows.length === 0) {
    const fallbackRows = await datacenterQuery("RPT_F10_EH_HOLDERS", {
      filter: `(SECUCODE="${secCode}")`,
      pageSize,
      sortColumns: "END_DATE",
      sortTypes: -1,
    });
    return fallbackRows.map(mapHolder);
  }
  return rows.map(mapHolder);
}

function mapHolder(r: Record<string, unknown>): EastmoneyHolderRow {
  // HOLD_NUM_CHANGE 可能是中文("不变"/"新增")而非数字,需兼容
  const rawChange = r.HOLD_NUM_CHANGE;
  let holdChange = num(rawChange);
  if (!Number.isFinite(holdChange)) {
    holdChange = typeof rawChange === "string" && rawChange.includes("不变") ? 0 : NaN;
  }
  // CHANGE_RATIO null 时尝试 NEW_CHANGE_RATIO
  const changeRatio = num(r.CHANGE_RATIO);
  const fallbackRatio = num(r.NEW_CHANGE_RATIO);
  return {
    endDate: str(r.END_DATE).slice(0, 10),
    holderName: str(r.HOLDER_NAME),
    holdNum: num(r.HOLD_NUM),
    holdRatio: num(r.HOLD_NUM_RATIO),
    holdChange,
    changeRatio: Number.isFinite(changeRatio)
      ? changeRatio
      : Number.isFinite(fallbackRatio)
        ? fallbackRatio
        : NaN,
    isOrg: Boolean(r.IS_HOLDORG),
    rank: num(r.HOLDER_RANK),
  };
}

// —— 股东人数 ——
export interface EastmoneyHolderCountRow {
  /** 截止日期 YYYY-MM-DD */
  endDate: string;
  /** 股东总数 */
  holderTotalNum: number;
  /** 较上期变化 % */
  totalNumRatio: number;
  /** 户均流通股 */
  avgFreeShares: number;
  /** 户均持股金额(元) */
  avgHoldAmt: number;
  /** 筹码集中度 */
  holdFocus: string;
}

export async function fetchHolderCount(
  code: string,
  pageSize = 10,
): Promise<EastmoneyHolderCountRow[]> {
  const secCode = toSecucode(code);
  if (!secCode) return [];
  const rows = await datacenterQuery("RPT_F10_EH_HOLDERNUM", {
    filter: `(SECUCODE="${secCode}")`,
    pageSize,
    sortColumns: "END_DATE",
    sortTypes: -1,
  });
  return rows.map((r) => ({
    endDate: str(r.END_DATE).slice(0, 10),
    holderTotalNum: num(r.HOLDER_TOTAL_NUM),
    totalNumRatio: num(r.TOTAL_NUM_RATIO),
    avgFreeShares: num(r.AVG_FREE_SHARES),
    avgHoldAmt: num(r.AVG_HOLD_AMT),
    holdFocus: str(r.HOLD_FOCUS),
  }));
}

// —— 融资融券 ——
export interface EastmoneyMarginRow {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 融资余额(元) */
  rzye: number;
  /** 融券余额(元) */
  rqye: number;
  /** 融资融券余额(元) */
  rzrqye: number;
  /** 融资买入额(元) */
  rzmre: number;
  /** 融资偿还额(元) */
  rzjme: number;
  /** 融券卖出量(股) */
  rqmcl: number;
  /** 收盘价 */
  closePrice: number;
  /** 涨跌幅 % */
  changeRate: number;
}

export async function fetchMargin(code: string, pageSize = 30): Promise<EastmoneyMarginRow[]> {
  const rows = await datacenterQuery("RPTA_WEB_RZRQ_GGMX", {
    filter: `(SCODE="${code}")`,
    pageSize,
    sortColumns: "DATE",
    sortTypes: -1,
  });
  return rows.map((r) => ({
    date: str(r.DATE).slice(0, 10),
    rzye: num(r.RZYE),
    rqye: num(r.RQYE),
    rzrqye: num(r.RZRQYE),
    rzmre: num(r.RZMRE),
    rzjme: num(r.RZJME),
    rqmcl: num(r.RQMCL),
    closePrice: num(r.SPJ),
    changeRate: num(r.ZDF),
  }));
}

// —— 财报三表 ——
export interface EastmoneyBalanceSheetRow {
  /** 报告期 YYYY-MM-DD */
  reportDate: string;
  /** 货币资金 */
  monetaryFunds: number;
  /** 应收账款 */
  accountsReceivable: number;
  /** 存货 */
  inventory: number;
  /** 流动资产合计 */
  totalCurrentAssets: number;
  /** 非流动资产合计 */
  totalNonCurrentAssets: number;
  /** 资产总计 */
  totalAssets: number;
  /** 流动负债合计 */
  totalCurrentLiabilities: number;
  /** 非流动负债合计 */
  totalNonCurrentLiabilities: number;
  /** 负债合计 */
  totalLiabilities: number;
  /** 股东权益合计 */
  totalShareholdersEquity: number;
}

export async function fetchBalanceSheet(
  code: string,
  pageSize = 8,
): Promise<EastmoneyBalanceSheetRow[]> {
  const secCode = toSecucode(code);
  if (!secCode) return [];
  const rows = await datacenterQuery("RPT_F10_FINANCE_GBALANCE", {
    filter: `(SECUCODE="${secCode}")`,
    pageSize,
    sortColumns: "REPORT_DATE",
    sortTypes: -1,
  });
  return rows.map((r) => ({
    reportDate: str(r.REPORT_DATE).slice(0, 10),
    monetaryFunds: num(r.MONETARYFUNDS),
    accountsReceivable: num(r.ACCOUNTS_RECE),
    inventory: num(r.INVENTORY),
    totalCurrentAssets: num(r.TOTAL_CURRENT_ASSETS),
    totalNonCurrentAssets: num(r.TOTAL_NONCURRENT_ASSETS),
    totalAssets: num(r.TOTAL_ASSETS),
    totalCurrentLiabilities: num(r.TOTAL_CURRENT_LIAB),
    totalNonCurrentLiabilities: num(r.TOTAL_NONCURRENT_LIAB),
    totalLiabilities: num(r.TOTAL_LIABILITIES),
    totalShareholdersEquity: num(r.TOTAL_EQUITY),
  }));
}

export interface EastmoneyIncomeRow {
  reportDate: string;
  /** 营业总收入 */
  totalRevenue: number;
  /** 营业收入 */
  operatingRevenue: number;
  /** 营业成本 */
  operatingCost: number;
  /** 销售费用 */
  sellingExpense: number;
  /** 管理费用 */
  managingExpense: number;
  /** 财务费用 */
  financialExpense: number;
  /** 营业利润 */
  operatingProfit: number;
  /** 利润总额 */
  totalProfit: number;
  /** 净利润 */
  netProfit: number;
  /** 归母净利润 */
  parentNetProfit: number;
}

export async function fetchIncome(code: string, pageSize = 8): Promise<EastmoneyIncomeRow[]> {
  const secCode = toSecucode(code);
  if (!secCode) return [];
  const rows = await datacenterQuery("RPT_DMSK_FN_INCOME", {
    filter: `(SECUCODE="${secCode}")`,
    pageSize,
    sortColumns: "REPORT_DATE",
    sortTypes: -1,
  });
  return rows.map((r) => ({
    reportDate: str(r.REPORT_DATE).slice(0, 10),
    totalRevenue: num(r.TOTAL_OPERATE_INCOME),
    // OPERATE_INCOME 在此报表常为 null,用 TOTAL_OPERATE_INCOME 兜底
    operatingRevenue: num(r.OPERATE_INCOME) || num(r.TOTAL_OPERATE_INCOME),
    operatingCost: num(r.OPERATE_COST) || num(r.TOTAL_OPERATE_COST),
    sellingExpense: num(r.SALE_EXPENSE),
    managingExpense: num(r.MANAGE_EXPENSE),
    financialExpense: num(r.FINANCE_EXPENSE),
    operatingProfit: num(r.OPERATE_PROFIT),
    totalProfit: num(r.TOTAL_PROFIT),
    netProfit: num(r.PARENT_NETPROFIT),
    parentNetProfit: num(r.PARENT_NETPROFIT),
  }));
}

export interface EastmoneyCashFlowRow {
  reportDate: string;
  /** 经营活动现金流净额 */
  operatingCashFlow: number;
  /** 投资活动现金流净额 */
  investingCashFlow: number;
  /** 筹资活动现金流净额 */
  financingCashFlow: number;
  /** 现金及等价物净增加额 */
  netCashIncrease: number;
  /** 期末现金及等价物余额 */
  cashBalance: number;
}

export async function fetchCashFlow(code: string, pageSize = 8): Promise<EastmoneyCashFlowRow[]> {
  const secCode = toSecucode(code);
  if (!secCode) return [];
  const rows = await datacenterQuery("RPT_F10_FINANCE_GCASHFLOW", {
    filter: `(SECUCODE="${secCode}")`,
    pageSize,
    sortColumns: "REPORT_DATE",
    sortTypes: -1,
  });
  return rows.map((r) => ({
    reportDate: str(r.REPORT_DATE).slice(0, 10),
    operatingCashFlow: num(r.NETCASH_OPERATE),
    investingCashFlow: num(r.NETCASH_INVEST),
    financingCashFlow: num(r.NETCASH_FINANCE),
    netCashIncrease: num(r.CCE_ADD),
    cashBalance: num(r.END_CCE),
  }));
}
