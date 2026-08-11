/**
 * music —— 音乐
 *
 * 子命令:
 *   rank            网易云音乐榜单列表
 *   rank-detail     网易云音乐榜单详情(按 id 查曲目)
 *   lyric           歌词搜索(QQ 音乐)
 *   changya         唱鸭随机翻唱作品
 */

import * as z from "zod";
import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

interface NcmRank {
  id: number;
  name: string;
  description: string | null;
  cover: string;
  update_frequency: string;
  updated: string;
  updated_at: number;
  link: string;
}

export const musicCommands = defineCommands({
  rank: defineCommand({
    name: "rank",
    description: "网易云音乐榜单列表",
    humanFormat(data) {
      return printTable(data as NcmRank[], [
        { header: "ID", value: (r: NcmRank) => String(r.id), align: "right" },
        { header: "榜单", value: (r: NcmRank) => r.name },
        { header: "更新频率", value: (r: NcmRank) => r.update_frequency },
      ]);
    },
    async run(ctx) {
      const res = await ctx.get("/ncm-rank/list", withQuery());
      const list = unwrap<NcmRank[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),

  "rank-detail": defineCommand({
    name: "rank-detail",
    description: "网易云音乐榜单详情(曲目列表)",
    args: {
      schema: z.object({
        id: z.string().describe("榜单 ID(如 3778678 热歌榜;用 rank 查全部)"),
        size: z.coerce.number().describe("返回曲目上限").optional(),
      }),
      pos: ["id"],
    },
    humanFormat(data) {
      return printTable(data as { rank: number; title: string; artist: unknown }[], [
        { header: "#", value: (r: { rank: number }) => String(r.rank), align: "right" },
        { header: "曲目", value: (r: { title: string }) => r.title },
        { header: "歌手", value: (r: { artist: unknown }) => artistStr(r.artist) },
      ]);
    },
    async run(ctx, { id, size }) {
      const res = await ctx.get(`/ncm-rank/${id}`, withQuery({ size }));
      const list = unwrap<unknown[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),

  lyric: defineCommand({
    name: "lyric",
    description: "歌词搜索(QQ 音乐,返回解析后的歌词)",
    args: {
      schema: z.object({
        query: z.string().describe("歌曲/歌手关键词"),
        clean: z.boolean().describe("过滤词/曲/编曲等元信息行(默认 true,设 false 保留)").optional(),
      }),
      pos: ["query"],
    },
    async run(ctx, { query, clean }) {
      const res = await ctx.get("/lyric", withQuery({ query, clean }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  changya: defineCommand({
    name: "changya",
    description: "唱鸭随机翻唱作品(含音频 URL)",
    async run(ctx) {
      const res = await ctx.get("/changya", withQuery());
      return { data: unwrap<unknown>(res) };
    },
  }),
});

function artistStr(artist: unknown): string {
  if (Array.isArray(artist)) return artist.map((a: { name?: string }) => a?.name ?? "").join("/");
  return String(artist ?? "");
}
