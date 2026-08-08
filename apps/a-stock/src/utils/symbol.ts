/**
 * 股票代码工具 —— 不同数据源需要不同的代码格式
 *
 * 各数据源代码约定:
 *   - 腾讯:    sh600519 / sz000001 / sz399001(深沪前缀 + 6 位代码,或 sz+指数代码)
 *   - 新浪:    sh600519 / sz000001 / sh000001(同腾讯但指数不同前缀)
 *   - 东财:    secid=1.600519(沪 1.+代码,深 0.+代码)/ 0. / 1. / 116.
 *
 * 输入统一接收:6 位纯代码 + 可选市场标识(沪/深/京)。
 *   - "600519" → 默认沪市
 *   - "000001" → 默认深市
 *   - "300750" → 默认深市(创业板)
 *   - "688981" → 默认沪市(科创板)
 *   - "8xxxxx" → 默认北交所
 *   - "BJ836473" / "836473" → 北交所
 *   - "sh600519" / "sz000001" → 显式带前缀,直接透传
 *   - "1.600519" / "0.000001" → 东财 secid 形态
 *   - "600519.SH" / "000001.SZ" → 行业标准后缀
 *
 * 简单规则:
 *   - 6xxxxx, 9xxxxx → 沪市(sh)
 *   - 0xxxxx, 3xxxxx → 深市(sz)
 *   - 4xxxxx, 8xxxxx → 北交所(bj)
 *   - 5xxxxx → 沪基金 / ETF(沪)
 */

import { ValidationError } from "@renxqoo/agent-data-cli";

export type Market = "sh" | "sz" | "bj";

export interface SymbolParts {
  /** 6 位纯代码,如 '600519' */
  code: string;
  /** 市场 */
  market: Market;
  /** 腾讯/新浪前缀形态:sh600519 / sz000001 */
  tencent: string;
  /** 东财 secid 形态:1.600519 / 0.000001 / 0.836473 */
  secid: string;
}

/**
 * 解析用户输入的代码 → 标准化 SymbolParts
 * 抛 InvalidSymbolError 当格式无法识别时。
 */
export function parseSymbol(input: string): SymbolParts {
  const lower = input.trim().toLowerCase().replace(/\s/g, "");

  // 形如 1.600519 / 0.000001(东财 secid,先判避免被去除 . 后误判)
  if (/^[01]\.\d{6}$/.test(lower)) {
    const [m, c] = lower.split(".");
    return buildParts(c!, m === "1" ? "sh" : "sz");
  }

  // 去掉所有 .(用于后续 .SH / .SZ 后缀识别)
  const noDot = lower.replace(/\./g, "");

  // 形如 600519.SH / 000001.SZ(后缀 .SH / .SZ,大小写不敏感)
  let code = noDot;
  let marketHint: Market | undefined;
  const suffixMatch = /^(.+?)(sh|sz|bj)$/.exec(noDot);
  if (suffixMatch) {
    code = suffixMatch[1]!;
    marketHint = suffixMatch[2]! as Market;
  }

  // 形如 sh600519 / sz000001 / bj836473(前缀)
  if (/^(sh|sz|bj)\d{6}$/.test(code)) {
    marketHint = code.slice(0, 2) as Market;
    code = code.slice(2);
  }

  // 形如纯 6 位数字
  if (/^\d{6}$/.test(code)) {
    if (marketHint) return buildParts(code, marketHint);
    return buildParts(code, detectMarket(code));
  }

  throw new InvalidSymbolError(`无法识别股票代码: ${input}`);
}

function detectMarket(code: string): Market {
  // 6xxxxx(沪市主板/科创/基金 ETF)、9xxxxx(沪市 B 股)→ 沪
  if (code.startsWith("6") || code.startsWith("9") || code.startsWith("5")) return "sh";
  // 0xxxxx(深主板/中小板)、3xxxxx(创业板)→ 深
  if (code.startsWith("0") || code.startsWith("3")) return "sz";
  // 4xxxxx(原老三板)、8xxxxx(北交所)→ 北交所
  if (code.startsWith("4") || code.startsWith("8")) return "bj";
  return "sz";
}

function buildParts(code: string, market: Market): SymbolParts {
  const tencent = `${market}${code}`;
  // 北交所 (bj) 在东财里其实是 market=0(代码段 8/4 开头)
  const marketDigit = market === "sh" ? "1" : "0";
  const secid = `${marketDigit}.${code}`;
  return { code, market, tencent, secid };
}

/** 把多个代码拼成东财 clist 用的 fs 参数(全市场股票列表) */
export function eastmoneyFs(market: Market): string {
  if (market === "sh") return "m:1+t:2,m:1+t:23,m:1+t:5"; // 沪 A / 沪基金 / 沪 B
  if (market === "sz") return "m:0+t:6,m:0+t:80,m:0+t:5"; // 深 A / 深创业板 / 深 B
  return "m:0+t:81"; // 京 A(北交所)
}

/**
 * 股票代码格式错误。
 *
 * 继承 ValidationError(框架的 errs 体系),category=validation / exit code=2。
 * 保留具名类是为了向后兼容(test 里 toThrow(InvalidSymbolError))+ 语义清晰。
 */
export class InvalidSymbolError extends ValidationError {
  constructor(message: string) {
    super({
      subtype: "invalid_argument",
      param: "code",
      message,
      hint: "支持 600519 / sh600519 / 600519.SH / 1.600519 等格式",
    });
    this.name = "InvalidSymbolError";
  }
}
