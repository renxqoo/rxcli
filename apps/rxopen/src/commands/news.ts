/**
 * news —— 新闻资讯
 *
 * 子命令:
 *   - today             每日新闻速览(项目核心)
 *   - ai                AI 资讯快报
 *   - it                IT 之家实时资讯
 *   - it-rank           IT 之家排行榜
 *   - rss               RSS 订阅(近 7 天,返回 XML,CLI 解析为结构化)
 *
 * 数据源:vikiboss/60s(默认 https://60s.viki.moe),全部 /v2 前缀。
 */

import * as z from "zod";
import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

export const newsCommands = defineCommands({
  // ── 每日新闻速览 ────────────────────────────────────────────────
  today: defineCommand({
    name: "today",
    description: "每日新闻速览(新闻摘要 + 微语)",
    args: {
      schema: z.object({
        date: z.string().describe("指定日期 YYYY-MM-DD(默认今天,失败回退昨天/前天)").optional(),
        forceUpdate: z.boolean().describe("跳过缓存强制刷新").optional(),
      }),
    },
    humanFormat(data) {
      const d = data as DailyNews;
      const lines = [`# 每日新闻(${d.date} ${d.day_of_week} ${d.lunar_date})`, ""];
      d.news.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
      if (d.tip) lines.push("", `【微语】${d.tip}`);
      return lines.join("\n");
    },
    async run(ctx, { date, forceUpdate }) {
      const res = await ctx.get("/60s", withQuery({ date, "force-update": forceUpdate }));
      return { data: unwrap<DailyNews>(res) };
    },
  }),

  // ── AI 资讯快报 ─────────────────────────────────────────────────
  ai: defineCommand({
    name: "ai",
    description: "AI 资讯快报(每日 AI 行业新闻)",
    args: {
      schema: z.object({
        date: z.string().describe("指定日期 YYYY-MM-DD(默认昨天)").optional(),
        all: z.boolean().describe("返回全部日期的新闻(忽略 date)").optional(),
      }),
    },
    humanFormat(data) {
      const d = data as { date: string; news: AiNewsItem[] };
      const lines = [`# AI 资讯快报(${d.date})`, ""];
      d.news.forEach((n, i) =>
        lines.push(`${i + 1}. ${n.title}${n.source ? `(${n.source})` : ""}`),
      );
      return lines.join("\n");
    },
    async run(ctx, { date, all }) {
      const res = await ctx.get("/ai-news", withQuery({ date, all }));
      return { data: unwrap<{ date: string; news: AiNewsItem[] }>(res) };
    },
  }),

  // ── IT 之家实时资讯 ─────────────────────────────────────────────
  it: defineCommand({
    name: "it",
    description: "IT 之家实时资讯",
    args: {
      schema: z.object({
        limit: z.coerce.number().describe("返回条数上限(默认 20,上限 50)").default(20),
      }),
    },
    humanFormat(data) {
      return printTable(data as ItNewsItem[], [
        { header: "标题", value: (r: ItNewsItem) => r.title },
        { header: "发布时间", value: (r: ItNewsItem) => r.created },
      ]);
    },
    async run(ctx, { limit }) {
      const res = await ctx.get("/it-news", withQuery({ limit }));
      const list = unwrap<ItNewsItem[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),

  // ── IT 之家排行榜 ───────────────────────────────────────────────
  "it-rank": defineCommand({
    name: "it-rank",
    description: "IT 之家排行榜(日/周/月热榜)",
    args: {
      schema: z.object({
        type: z.string().describe("榜单类型:day | week | month(默认 day)").default("day"),
      }),
    },
    humanFormat(data) {
      return printTable(data as { title: string; link: string }[], [
        { header: "标题", value: (r: { title: string }) => r.title },
      ]);
    },
    async run(ctx, { type }) {
      const res = await ctx.get("/it-news/rank", withQuery({ type }));
      const list = unwrap<{ title: string; link: string }[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),

  // ── RSS 订阅(返回 XML,CLI 解析为结构化) ──────────────────────
  rss: defineCommand({
    name: "rss",
    description: "RSS 订阅(近 7 天新闻)",
    async run(ctx) {
      // RSS 返回 application/xml,不走 JSON 包装;用底层 request 拿原文后解析
      const res = await ctx.request({ method: "GET", path: "/60s/rss", query: withQuery() });
      const xml = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      return { data: parseRss(xml) };
    },
  }),
});

/** RSS XML → 结构化(轻量正则解析,不引新依赖)。 */
function parseRss(
  xml: string,
): { title: string; link: string; pubDate: string; description: string }[] {
  const items: { title: string; link: string; pubDate: string; description: string }[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1] ?? "";
    const pick = (tag: string) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
      const mm = re.exec(block);
      return mm && mm[1] ? mm[1].trim() : "";
    };
    items.push({
      title: decodeEntities(pick("title")),
      link: pick("link"),
      pubDate: pick("pubDate"),
      description: decodeEntities(pick("description")),
    });
  }
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

interface DailyNews {
  date: string;
  news: string[];
  cover: string;
  tip: string;
  image: string;
  link: string;
  created?: string;
  created_at?: number;
  updated?: string;
  updated_at?: number;
  day_of_week: string;
  lunar_date: string;
  api_updated?: string;
  api_updated_at?: number;
}

interface AiNewsItem {
  title: string;
  detail: string;
  link: string;
  source?: string;
  date?: string;
}

interface ItNewsItem {
  title: string;
  link: string;
  description: string;
  created: string;
  created_at: number;
}
