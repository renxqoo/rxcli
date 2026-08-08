/**
 * financial —— 财务数据
 *
 * 子命令:
 *   - main <code>        主要财务指标(连续季度/年度)
 *   - forecast <code>    业绩预告
 *   - fundflow <code>    资金流(境内增强)
 *   - dividend <code>    分红送配
 *   - holders <code>     十大股东
 *   - holdercount <code> 股东人数
 *   - margin <code>      融资融券
 *   - balancesheet <code> 资产负债表
 *   - income <code>      利润表
 *   - cashflow <code>    现金流量表
 *   - announcements <code> 公告
 */

import { defineCommands, defineCommand } from "@renxqoo/agent-data-cli";
import {
  getFinancialMain,
  getFinancialForecast,
  getFundFlow,
  getAnnouncements,
} from "../services/financial.js";
import {
  getDividend,
  getHolders,
  getHolderCount,
  getMargin,
  getBalanceSheet,
  getIncome,
  getCashFlow,
  getDragonTiger,
} from "../services/advanced.js";

export const financialCommands = defineCommands({
  main: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "main",
    description: "查询主要财务指标(连续多期,默认 20 期)",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "股票代码",
      },
      limit: {
        type: "number",
        desc: "返回条数(默认 20,最大 ~50)",
      },
    },
    humanFormat: formatFinancialHuman,
    async run({ code, limit }) {
      const data = await getFinancialMain(code, limit ?? 20);
      return { data, meta: { count: data.length, type: "main" } };
    },
  }),

  forecast: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "forecast",
    description: "查询业绩预告(净利润预增/预减 区间)",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "股票代码",
      },
      limit: {
        type: "number",
        desc: "返回条数(默认 20)",
      },
    },
    async run({ code, limit }) {
      const data = await getFinancialForecast(code, limit ?? 20);
      return { data, meta: { count: data.length, type: "forecast" } };
    },
  }),

  fundflow: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "fundflow",
    description: "查询资金流向(主力 / 大单 / 中单 / 小单 净流入)",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "股票代码",
      },
      limit: {
        type: "number",
        desc: "返回天数(默认 30)",
      },
    },
    humanFormat: formatFundFlowHuman,
    async run({ code, limit }) {
      const data = await getFundFlow(code, limit ?? 30);
      return { data, meta: { count: data.length, type: "fundflow" } };
    },
  }),

  announcements: defineCommand<{ code: string; page?: number; size?: number }, unknown[]>({
    name: "announcements",
    description: "查询个股公告",
    args: {
      code: {
        type: "string",
        required: true,
        positional: true,
        desc: "股票代码",
      },
      page: {
        type: "number",
        desc: "页码(默认 1)",
      },
      size: {
        type: "number",
        desc: "单页条数(默认 20,最大 50)",
      },
    },
    async run({ code, page, size }) {
      const data = await getAnnouncements(code, {
        page: page ?? 1,
        size: Math.min(size ?? 20, 50),
      });
      return { data, meta: { count: data.length, type: "announcements" } };
    },
  }),

  dividend: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "dividend",
    description: "查询分红送配历史(送股/转增/派息)",
    args: {
      code: { type: "string", required: true, positional: true, desc: "股票代码" },
      limit: { type: "number", desc: "返回条数(默认 20)" },
    },
    async run({ code, limit }) {
      const data = await getDividend(code, limit ?? 20);
      return { data, meta: { count: data.length, type: "dividend" } };
    },
  }),

  holders: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "holders",
    description: "查询十大股东(最新一期,持股数/比例/变动)",
    args: {
      code: { type: "string", required: true, positional: true, desc: "股票代码" },
      limit: { type: "number", desc: "返回条数(默认 10,即十大股东)" },
    },
    async run({ code, limit }) {
      const data = await getHolders(code, limit ?? 10);
      return { data, meta: { count: data.length, type: "holders" } };
    },
  }),

  holdercount: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "holdercount",
    description: "查询股东人数变化(筹码集中度趋势)",
    args: {
      code: { type: "string", required: true, positional: true, desc: "股票代码" },
      limit: { type: "number", desc: "返回期数(默认 10)" },
    },
    async run({ code, limit }) {
      const data = await getHolderCount(code, limit ?? 10);
      return { data, meta: { count: data.length, type: "holdercount" } };
    },
  }),

  margin: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "margin",
    description: "查询融资融券明细(融资余额/融券余额/买入额)",
    args: {
      code: { type: "string", required: true, positional: true, desc: "股票代码" },
      limit: { type: "number", desc: "返回天数(默认 30)" },
    },
    async run({ code, limit }) {
      const data = await getMargin(code, limit ?? 30);
      return { data, meta: { count: data.length, type: "margin" } };
    },
  }),

  balancesheet: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "balancesheet",
    description: "查询资产负债表(资产/负债/股东权益明细)",
    args: {
      code: { type: "string", required: true, positional: true, desc: "股票代码" },
      limit: { type: "number", desc: "返回期数(默认 8)" },
    },
    async run({ code, limit }) {
      const data = await getBalanceSheet(code, limit ?? 8);
      return { data, meta: { count: data.length, type: "balancesheet" } };
    },
  }),

  income: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "income",
    description: "查询利润表(营收/成本/费用/利润明细)",
    args: {
      code: { type: "string", required: true, positional: true, desc: "股票代码" },
      limit: { type: "number", desc: "返回期数(默认 8)" },
    },
    async run({ code, limit }) {
      const data = await getIncome(code, limit ?? 8);
      return { data, meta: { count: data.length, type: "income" } };
    },
  }),

  cashflow: defineCommand<{ code: string; limit?: number }, unknown[]>({
    name: "cashflow",
    description: "查询现金流量表(经营/投资/筹资活动现金流)",
    args: {
      code: { type: "string", required: true, positional: true, desc: "股票代码" },
      limit: { type: "number", desc: "返回期数(默认 8)" },
    },
    async run({ code, limit }) {
      const data = await getCashFlow(code, limit ?? 8);
      return { data, meta: { count: data.length, type: "cashflow" } };
    },
  }),

  lhb: defineCommand<{ date?: string; code?: string; pageSize?: number }, unknown[]>({
    name: "lhb",
    description: "查询龙虎榜(当日/历史个股上榜,买入卖出净额)",
    args: {
      date: { type: "string", desc: "交易日期 YYYY-MM-DD(默认最新)" },
      code: { type: "string", desc: "指定个股代码(查该股上榜历史)" },
      pageSize: { type: "number", desc: "返回条数(默认 30)" },
    },
    async run({ date, code, pageSize }) {
      const data = await getDragonTiger({ date, code, pageSize: pageSize ?? 30 });
      return {
        data,
        meta: { count: data.length, type: "lhb", date: date ?? "latest" },
      };
    },
  }),
});

// ============================================================================
// 人类可读格式化
// ============================================================================

function formatFinancialHuman(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) return "（无数据）";
  const lines: string[] = [];
  lines.push("报告期            类型       营收(亿)     净利(亿)   EPS    同比%    ROE%");
  lines.push("-".repeat(70));
  for (const r of data.slice(0, 10) as Array<Record<string, unknown>>) {
    const date = String(r.reportDate ?? "").slice(0, 10);
    const type = String(r.reportType ?? "");
    const rev = Number(r.totalRevenue) / 1e8;
    const np = Number(r.netProfit) / 1e8;
    const eps = Number(r.eps);
    const yoy = Number(r.profitYoY);
    const roe = Number(r.roe);
    lines.push(
      `${date.padEnd(14)} ${type.padEnd(10)} ${rev.toFixed(2).padStart(10)}  ${np.toFixed(2).padStart(8)}  ${eps.toFixed(2).padStart(5)}  ${yoy.toFixed(2).padStart(6)}  ${roe.toFixed(2).padStart(5)}`,
    );
  }
  return lines.join("\n");
}

function formatFundFlowHuman(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) return "（无数据）";
  const lines: string[] = [];
  lines.push("日期        主力净流入(万)  大单(万)   中单(万)    小单(万)    主力占比%");
  lines.push("-".repeat(72));
  for (const r of data as Array<Record<string, unknown>>) {
    lines.push(
      `${String(r.date ?? "").padEnd(12)} ${(Number(r.mainNet) / 1e4).toFixed(0).padStart(12)}  ${(Number(r.bigNet) / 1e4).toFixed(0).padStart(8)}  ${(Number(r.mediumNet) / 1e4).toFixed(0).padStart(8)}  ${(Number(r.smallNet) / 1e4).toFixed(0).padStart(8)}    ${Number(r.mainNetRatio).toFixed(2)}`,
    );
  }
  return lines.join("\n");
}
