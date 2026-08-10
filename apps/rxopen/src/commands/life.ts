/**
 * life —— 生活服务
 *
 * 子命令:
 *   weather            实时天气
 *   forecast           天气预报(逐小时 + 多日)
 *   fuel-price         今日油价(+ 调价预测)
 *   gold-price         贵金属/金价(实时行情 + 金店/银行/回收)
 *   exchange-rate      汇率查询
 *   lunar              老黄历/万年历(干支/宜忌/节气/运势)
 *   today-in-history   历史上的今天
 *   olympics           奥运奖牌榜
 *   olympics-events    历届奥运赛事列表
 */

import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

export const lifeCommands = defineCommands({
  weather: defineCommand<{ query?: string; city?: string; province?: string }>({
    name: "weather",
    description: "实时天气(含空气质量/日出日落/预警)",
    args: {
      query: { type: "string", positional: true, desc: "城市搜索词(默认北京,如 上海/广州天河)" },
      city: { type: "string", desc: "精确匹配城市名" },
      province: { type: "string", desc: "精确匹配省份名" },
    },
    async run({ query, city, province }, ctx) {
      const res = await ctx.get("/weather/realtime", withQuery({ query, city, province }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  forecast: defineCommand<{ query?: string; days?: number; city?: string; province?: string }>({
    name: "forecast",
    description: "天气预报(逐小时 + 多日 + 日出日落)",
    args: {
      query: { type: "string", positional: true, desc: "城市搜索词(默认北京)" },
      days: { type: "number", default: 7, desc: "预报天数(日预报上限 8,日出日落上限 15)" },
      city: { type: "string", desc: "精确匹配城市名" },
      province: { type: "string", desc: "精确匹配省份名" },
    },
    async run({ query, days, city, province }, ctx) {
      const res = await ctx.get("/weather/forecast", withQuery({ query, days, city, province }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  "fuel-price": defineCommand<{ region?: string; forceUpdate?: boolean }>({
    name: "fuel-price",
    description: "今日油价(各省汽柴油价格 + 调价预测)",
    args: {
      region: { type: "string", desc: "区域名(后缀匹配,如 北京/广东,默认北京)" },
      forceUpdate: { type: "boolean", desc: "跳过缓存强制刷新(缓存 60 分钟)" },
    },
    async run({ region, forceUpdate }, ctx) {
      const res = await ctx.get("/fuel-price", withQuery({ region, "force-update": forceUpdate }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  "gold-price": defineCommand({
    name: "gold-price",
    description: "贵金属金价(实时行情 + 金店/银行/回收价)",
    async run(_args, ctx) {
      const res = await ctx.get("/gold-price", withQuery());
      return { data: unwrap<unknown>(res) };
    },
  }),

  "exchange-rate": defineCommand<{ currency?: string }>({
    name: "exchange-rate",
    description: "汇率查询(基准货币对其它货币)",
    args: { currency: { type: "string", desc: "基准货币代码 ISO 4217(如 USD,默认 CNY)" } },
    async run({ currency }, ctx) {
      const res = await ctx.get("/exchange-rate", withQuery({ currency }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  lunar: defineCommand<{ date?: string }>({
    name: "lunar",
    description: "老黄历/万年历(公历农历/干支/宜忌/节气/运势)",
    args: { date: { type: "string", desc: "日期(支持 10/13 位时间戳或日期字符串,默认今天)" } },
    async run({ date }, ctx) {
      const res = await ctx.get("/lunar", withQuery({ date }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  "today-in-history": defineCommand<{ date?: string }>({
    name: "today-in-history",
    description: "历史上的今天(出生/逝世/事件)",
    args: { date: { type: "string", desc: "日期 ISO(默认今天)" } },
    humanFormat(data) {
      const d = data as {
        date: string;
        items: { title: string; year: number; event_type: string }[];
      };
      const lines = [`# 历史上的今天(${d.date})`, ""];
      d.items.forEach((it) => lines.push(`${it.year} 年 [${it.event_type}] ${it.title}`));
      return lines.join("\n");
    },
    async run({ date }, ctx) {
      const res = await ctx.get("/today-in-history", withQuery({ date }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  olympics: defineCommand<{ id?: string }>({
    name: "olympics",
    description: "奥运奖牌榜",
    args: { id: { type: "string", desc: "赛事 slug(省略取进行中的赛事)" } },
    humanFormat(data) {
      const d = data as {
        event_name: string;
        list: {
          rank: number;
          country: string;
          gold: number;
          silver: number;
          bronze: number;
          total: number;
        }[];
      };
      return printTable(d.list, [
        { header: "#", value: (r) => String(r.rank), align: "right" },
        { header: "国家/地区", value: (r) => r.country },
        { header: "金", value: (r) => String(r.gold), align: "right" },
        { header: "银", value: (r) => String(r.silver), align: "right" },
        { header: "铜", value: (r) => String(r.bronze), align: "right" },
        { header: "总计", value: (r) => String(r.total), align: "right" },
      ]);
    },
    async run({ id }, ctx) {
      const res = await ctx.get("/olympics", withQuery({ id }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  "olympics-events": defineCommand({
    name: "olympics-events",
    description: "历届奥运赛事列表",
    humanFormat(data) {
      return printTable(data as { year: string; name: string; season: string }[], [
        { header: "届次", value: (r) => r.year, align: "right" },
        { header: "名称", value: (r) => r.name },
        { header: "季", value: (r) => r.season },
      ]);
    },
    async run(_args, ctx) {
      const res = await ctx.get("/olympics/events", withQuery());
      const list = unwrap<unknown[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),
});
