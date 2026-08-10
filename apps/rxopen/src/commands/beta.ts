/**
 * beta —— 测试接口(上游标记不稳定)
 *
 * 子命令:
 *   kuan      酷安热门话题
 *   qq        QQ 用户信息(昵称 + 头像)
 *
 * 上游 /v2/beta/ 前缀,接口可能不稳定。
 */

import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

export const betaCommands = defineCommands({
  kuan: defineCommand({
    name: "kuan",
    description: "酷安热门话题(实验性)",
    humanFormat(data) {
      const d = data as { topics: { title: string; hotness: number }[] };
      return printTable(d.topics, [
        { header: "话题", value: (r: { title: string }) => r.title },
        { header: "热度", value: (r: { hotness: number }) => String(r.hotness), align: "right" },
      ]);
    },
    async run(_args, ctx) {
      const res = await ctx.get("/beta/kuan", withQuery());
      return { data: unwrap<unknown>(res) };
    },
  }),

  qq: defineCommand<{ qq: string; size?: number }>({
    name: "qq",
    description: "QQ 用户信息(昵称 + 头像,实验性)",
    args: {
      qq: { type: "string", required: true, positional: true, desc: "QQ 号(5-11 位数字)" },
      size: { type: "number", desc: "头像尺寸:0 | 40 | 100 | 160 | 640(默认 0)" },
    },
    async run({ qq, size }, ctx) {
      const res = await ctx.get("/beta/qq/profile", withQuery({ qq, size }));
      const info = unwrap<{
        qq: string;
        nickname: string;
        avatar_url: string;
        avatar_size: number;
      }>(res);
      return { data: info, meta: countMeta([info]) };
    },
  }),
});
