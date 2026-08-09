/**
 * tech —— 科技社区
 *
 * 子命令:
 *   hackernews            Hacker News 文章(默认 top)
 *
 * 路由 /hacker-news/{top|best|new};⚠️ 上游 bug:/new 实际连到 handle('top'),
 * 与 /top 结果相同。CLI 文档已标注,这里如实封装。
 */

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
  hackernews: defineCommand<{ type?: string; limit?: number; forceUpdate?: boolean }>({
    name: "hackernews",
    description: "Hacker News 文章(top / best)",
    args: {
      type: {
        type: "string",
        default: "top",
        desc: "文章类型:top(热门) | best(精选)| new(⚠️上游 bug,等同 top)",
      },
      limit: { type: "number", default: 10, desc: "返回数量(默认 10,上限 35)" },
      forceUpdate: { type: "boolean", desc: "跳过缓存强制刷新(缓存 10 分钟)" },
    },
    humanFormat(data) {
      return printTable(data as HNItem[], [
        { header: "标题", value: (r: HNItem) => r.title },
        { header: "得分", value: (r: HNItem) => String(r.score), align: "right" },
        { header: "作者", value: (r: HNItem) => r.author },
      ]);
    },
    async run({ type, limit, forceUpdate }, ctx) {
      const res = await ctx.get(
        `/hacker-news/${type}`,
        withQuery({ limit, "force-update": forceUpdate }),
      );
      const list = unwrap<HNItem[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),
});
