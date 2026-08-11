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

import * as z from "zod";
import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

export const lifeCommands = defineCommands({
  weather: defineCommand({
    name: "weather",
    description: "实时天气(含空气质量/日出日落/预警)",
    args: {
      schema: z.object({
        query: z.string().describe("城市搜索词(默认北京,如 上海/广州天河)").optional(),
        city: z.string().describe("精确匹配城市名").optional(),
        province: z.string().describe("精确匹配省份名").optional(),
      }),
      pos: ["query"],
    },
    async run(ctx, { query, city, province }) {
      const res = await ctx.get("/weather/realtime", withQuery({ query, city, province }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  forecast: defineCommand({
    name: "forecast",
    description: "天气预报(逐小时 + 多日 + 日出日落)",
    args: {
      schema: z.object({
        query: z.string().describe("城市搜索词(默认北京)").optional(),
        days: z.coerce.number().describe("预报天数(日预报上限 8,日出日落上限 15)").default(7),
        city: z.string().describe("精确匹配城市名").optional(),
        province: z.string().describe("精确匹配省份名").optional(),
      }),
      pos: ["query"],
    },
    async run(ctx, { query, days, city, province }) {
      const res = await ctx.get("/weather/forecast", withQuery({ query, days, city, province }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  "fuel-price": defineCommand({
    name: "fuel-price",
    description: "今日油价(各省汽柴油价格 + 调价预测)",
    args: {
      schema: z.object({
        region: z.string().describe("区域名(后缀匹配,如 北京/广东,默认北京)").optional(),
        forceUpdate: z.boolean().describe("跳过缓存强制刷新(缓存 60 分钟)").optional(),
      }),
    },
    async run(ctx, { region, forceUpdate }) {
      const res = await ctx.get("/fuel-price", withQuery({ region, "force-update": forceUpdate }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  "gold-price": defineCommand({
    name: "gold-price",
    description: "贵金属金价(实时行情 + 金店/银行/回收价)",
    async run(ctx) {
      const res = await ctx.get("/gold-price", withQuery());
      return { data: unwrap<unknown>(res) };
    },
  }),

  "exchange-rate": defineCommand({
    name: "exchange-rate",
    description: "汇率查询(基准货币对其它货币)",
    args: {
      schema: z.object({
        currency: z.string().describe("基准货币代码 ISO 4217(如 USD,默认 CNY)").optional(),
      }),
    },
    async run(ctx, { currency }) {
      const res = await ctx.get("/exchange-rate", withQuery({ currency }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  lunar: defineCommand({
    name: "lunar",
    description: "老黄历/万年历(公历农历/干支/宜忌/节气/运势)",
    args: {
      schema: z.object({
        date: z.string().describe("日期(支持 10/13 位时间戳或日期字符串,默认今天)").optional(),
      }),
    },
    async run(ctx, { date }) {
      const res = await ctx.get("/lunar", withQuery({ date }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  "today-in-history": defineCommand({
    name: "today-in-history",
    description: "历史上的今天(出生/逝世/事件)",
    args: {
      schema: z.object({
        date: z.string().describe("日期 ISO(默认今天)").optional(),
      }),
    },
    humanFormat(data) {
      const d = data as {
        date: string;
        items: { title: string; year: number; event_type: string }[];
      };
      const lines = [`# 历史上的今天(${d.date})`, ""];
      d.items.forEach((it) => lines.push(`${it.year} 年 [${it.event_type}] ${it.title}`));
      return lines.join("\n");
    },
    async run(ctx, { date }) {
      const res = await ctx.get("/today-in-history", withQuery({ date }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  olympics: defineCommand({
    name: "olympics",
    description: "奥运奖牌榜",
    args: {
      schema: z.object({
        id: z.string().describe("赛事 slug(省略取进行中的赛事)").optional(),
      }),
    },
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
    async run(ctx, { id }) {
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
    async run(ctx) {
      const res = await ctx.get("/olympics/events", withQuery());
      const list = unwrap<unknown[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),
});
