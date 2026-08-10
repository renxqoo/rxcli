/**
 * movie —— 影视 / 游戏
 *
 * 子命令:
 *   maoyan-all              全球电影票房总榜
 *   maoyan-realtime         今日实时票房/收视/网播(--type movie|tv|web)
 *   douban                  豆瓣一周口碑榜(--cat movie|tv_chinese|tv_global|show_chinese|show_global)
 *   epic                    Epic Games 免费游戏
 */

import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

interface RankItem {
  rank?: number;
  title?: string;
  movie_name?: string;
  programme_name?: string;
  series_name?: string;
  rating?: number;
  box_office_desc?: string;
  [k: string]: unknown;
}

export const movieCommands = defineCommands({
  "maoyan-all": defineCommand({
    name: "maoyan-all",
    description: "猫眼全球电影票房总榜",
    humanFormat(data) {
      const d = data as { list: RankItem[] };
      return printTable(d.list, [
        { header: "#", value: (r: RankItem) => String(r.rank ?? ""), align: "right" },
        { header: "影片", value: (r: RankItem) => r.movie_name ?? "" },
        { header: "票房", value: (r: RankItem) => r.box_office_desc ?? "", align: "right" },
      ]);
    },
    async run(_args, ctx) {
      const res = await ctx.get("/maoyan/all/movie", withQuery());
      return { data: unwrap<unknown>(res) };
    },
  }),

  "maoyan-realtime": defineCommand<{ type?: string; date?: string }>({
    name: "maoyan-realtime",
    description: "猫眼今日实时票房/收视/网播榜",
    args: {
      type: {
        type: "string",
        default: "movie",
        desc: "类型:movie(实时票房) | tv(电视收视) | web(网播热度)",
      },
      date: { type: "string", desc: "日期 YYYYMMDD(默认今天)" },
    },
    humanFormat(data) {
      const d = data as { list: RankItem[] };
      return printTable(d.list, [
        {
          header: "名称",
          value: (r: RankItem) => r.movie_name ?? r.programme_name ?? r.series_name ?? "",
        },
      ]);
    },
    async run({ type, date }, ctx) {
      const res = await ctx.get(`/maoyan/realtime/${type}`, withQuery({ date }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  douban: defineCommand<{ cat?: string }>({
    name: "douban",
    description: "豆瓣一周口碑榜",
    args: {
      cat: {
        type: "string",
        default: "movie",
        desc: "分类:movie(电影) | tv_chinese(国内剧) | tv_global(全球剧) | show_chinese(国内综艺) | show_global(全球综艺)",
      },
    },
    humanFormat(data) {
      return printTable(data as RankItem[], [
        { header: "#", value: (r: RankItem) => String(r.rank ?? ""), align: "right" },
        { header: "名称", value: (r: RankItem) => r.title ?? "" },
        {
          header: "评分",
          value: (r: RankItem) => (r.rating ? String(r.rating) : ""),
          align: "right",
        },
      ]);
    },
    async run({ cat }, ctx) {
      const res = await ctx.get(`/douban/weekly/${cat}`, withQuery());
      const list = unwrap<RankItem[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),

  epic: defineCommand({
    name: "epic",
    description: "Epic Games 免费游戏(当前 + 即将)",
    humanFormat(data) {
      return printTable(data as { title: string; original_price_desc?: string }[], [
        { header: "游戏", value: (r: { title: string }) => r.title },
        {
          header: "原价",
          value: (r: { original_price_desc?: string }) => r.original_price_desc ?? "免费",
          align: "right",
        },
      ]);
    },
    async run(_args, ctx) {
      const res = await ctx.get("/epic", withQuery());
      const list = unwrap<unknown[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),
});
