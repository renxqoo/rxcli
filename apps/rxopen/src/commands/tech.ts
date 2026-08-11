/**
 * tech —— 科技社区
 *
 * 子命令:
 *   hackernews            Hacker News 文章(默认 top)
 *
 * 路由 /hacker-news/{top|best|new};⚠️ 上游 bug:/new 实际连到 handle('top'),
 * 与 /top 结果相同。CLI 文档已标注,这里如实封装。
 */

import * as z from "zod";
import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

interface HNItem {
  id: number;
  title: string;
  score: number;
  link: string;
  author: string;
  created: string;
  created_at: number;
}

export const techCommands = defineCommands({
  hackernews: defineCommand({
    name: "hackernews",
    description: "Hacker News 文章(top / best)",
    args: {
      schema: z.object({
        type: z
          .string()
          .describe("文章类型:top(热门) | best(精选)| new(⚠️上游 bug,等同 top)")
          .default("top"),
        limit: z.coerce.number().describe("返回数量(默认 10,上限 35)").default(10),
        forceUpdate: z.boolean().describe("跳过缓存强制刷新(缓存 10 分钟)").optional(),
      }),
    },
    humanFormat(data) {
      return printTable(data as HNItem[], [
        { header: "标题", value: (r: HNItem) => r.title },
        { header: "得分", value: (r: HNItem) => String(r.score), align: "right" },
        { header: "作者", value: (r: HNItem) => r.author },
      ]);
    },
    async run(ctx, { type, limit, forceUpdate }) {
      const res = await ctx.get(
        `/hacker-news/${type}`,
        withQuery({ limit, "force-update": forceUpdate }),
      );
      const list = unwrap<HNItem[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),
});
