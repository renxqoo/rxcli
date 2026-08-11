/**
 * fun —— 趣味文案 / 摸鱼日历
 *
 * 子命令:
 *   hitokoto   一言(随机或指定 id)
 *   duanzi     段子
 *   dad-joke   冷笑话(英文)
 *   fabing     发病文学(可替换名字)
 *   kfc        疯狂星期四文案
 *   answer     答案之书
 *   luck       今日运势
 *   moyu       摸鱼办·打工人日历(节假日/倒计时/进度)
 */

import * as z from "zod";
import { defineCommands, defineCommand } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery } from "../envelope.js";

export const funCommands = defineCommands({
  hitokoto: defineCommand({
    name: "hitokoto",
    description: "一言(随机短句,可指定 id)",
    args: {
      schema: z.object({
        id: z.coerce.number().describe("指定索引(越界返回 not_found)").optional(),
      }),
    },
    async run(ctx, { id }) {
      const res = await ctx.get("/hitokoto", withQuery({ id }));
      return { data: unwrap<{ index: number; hitokoto: string }>(res) };
    },
  }),

  duanzi: defineCommand({
    name: "duanzi",
    description: "段子(随机中文段子)",
    args: {
      schema: z.object({
        id: z.coerce.number().describe("指定索引(越界返回 not_found)").optional(),
      }),
    },
    async run(ctx, { id }) {
      const res = await ctx.get("/duanzi", withQuery({ id }));
      return { data: unwrap<{ index: number; duanzi: string }>(res) };
    },
  }),

  "dad-joke": defineCommand({
    name: "dad-joke",
    description: "冷笑话(英文 dad joke)",
    args: {
      schema: z.object({
        id: z.coerce.number().describe("指定索引(越界返回 not_found)").optional(),
      }),
    },
    async run(ctx, { id }) {
      const res = await ctx.get("/dad-joke", withQuery({ id }));
      return { data: unwrap<{ index: number; content: string }>(res) };
    },
  }),

  fabing: defineCommand({
    name: "fabing",
    description: "发病文学(模板替换 [name])",
    args: {
      schema: z.object({
        name: z.string().describe("替换模板里的名字(默认'主人')").optional(),
        id: z.coerce.number().describe("指定模板索引(越界返回 not_found)").optional(),
      }),
    },
    async run(ctx, { name, id }) {
      const res = await ctx.get("/fabing", withQuery({ name, id }));
      return { data: unwrap<{ index: number; saying: string }>(res) };
    },
  }),

  kfc: defineCommand({
    name: "kfc",
    description: "肯德基疯狂星期四文案",
    async run(ctx) {
      const res = await ctx.get("/kfc", withQuery());
      return { data: unwrap<{ index: number; kfc: string }>(res) };
    },
  }),

  answer: defineCommand({
    name: "answer",
    description: "答案之书(随机答案)",
    args: {
      schema: z.object({
        id: z.coerce.number().describe("指定索引(越界返回 not_found)").optional(),
      }),
    },
    async run(ctx, { id }) {
      const res = await ctx.get("/answer", withQuery({ id }));
      return { data: unwrap<{ index: number; answer: string }>(res) };
    },
  }),

  luck: defineCommand({
    name: "luck",
    description: "今日运势(运势等级 + 幸运提示)",
    args: {
      schema: z.object({
        id: z.coerce.number().describe("指定索引(越界返回 not_found)").optional(),
      }),
    },
    async run(ctx, { id }) {
      const res = await ctx.get("/luck", withQuery({ id }));
      return {
        data: unwrap<{
          luck_desc: string;
          luck_rank: number;
          luck_tip: string;
          luck_tip_index: number;
        }>(res),
      };
    },
  }),

  moyu: defineCommand({
    name: "moyu",
    description: "摸鱼办·打工人日历(节假日/倒计时/进度)",
    args: {
      schema: z.object({
        date: z.string().describe("指定日期(默认今天)").optional(),
      }),
    },
    async run(ctx, { date }) {
      const res = await ctx.get("/moyu", withQuery({ date }));
      return { data: unwrap<unknown>(res) };
    },
  }),
});
