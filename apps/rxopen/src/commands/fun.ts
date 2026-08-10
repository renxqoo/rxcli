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

import { defineCommands, defineCommand } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery } from "../envelope.js";

export const funCommands = defineCommands({
  hitokoto: defineCommand<{ id?: number }>({
    name: "hitokoto",
    description: "一言(随机短句,可指定 id)",
    args: { id: { type: "number", desc: "指定索引(越界返回 not_found)" } },
    async run({ id }, ctx) {
      const res = await ctx.get("/hitokoto", withQuery({ id }));
      return { data: unwrap<{ index: number; hitokoto: string }>(res) };
    },
  }),

  duanzi: defineCommand<{ id?: number }>({
    name: "duanzi",
    description: "段子(随机中文段子)",
    args: { id: { type: "number", desc: "指定索引(越界返回 not_found)" } },
    async run({ id }, ctx) {
      const res = await ctx.get("/duanzi", withQuery({ id }));
      return { data: unwrap<{ index: number; duanzi: string }>(res) };
    },
  }),

  "dad-joke": defineCommand<{ id?: number }>({
    name: "dad-joke",
    description: "冷笑话(英文 dad joke)",
    args: { id: { type: "number", desc: "指定索引(越界返回 not_found)" } },
    async run({ id }, ctx) {
      const res = await ctx.get("/dad-joke", withQuery({ id }));
      return { data: unwrap<{ index: number; content: string }>(res) };
    },
  }),

  fabing: defineCommand<{ name?: string; id?: number }>({
    name: "fabing",
    description: "发病文学(模板替换 [name])",
    args: {
      name: { type: "string", desc: "替换模板里的名字(默认'主人')" },
      id: { type: "number", desc: "指定模板索引(越界返回 not_found)" },
    },
    async run({ name, id }, ctx) {
      const res = await ctx.get("/fabing", withQuery({ name, id }));
      return { data: unwrap<{ index: number; saying: string }>(res) };
    },
  }),

  kfc: defineCommand({
    name: "kfc",
    description: "肯德基疯狂星期四文案",
    async run(_args, ctx) {
      const res = await ctx.get("/kfc", withQuery());
      return { data: unwrap<{ index: number; kfc: string }>(res) };
    },
  }),

  answer: defineCommand<{ id?: number }>({
    name: "answer",
    description: "答案之书(随机答案)",
    args: { id: { type: "number", desc: "指定索引(越界返回 not_found)" } },
    async run({ id }, ctx) {
      const res = await ctx.get("/answer", withQuery({ id }));
      return { data: unwrap<{ index: number; answer: string }>(res) };
    },
  }),

  luck: defineCommand<{ id?: number }>({
    name: "luck",
    description: "今日运势(运势等级 + 幸运提示)",
    args: { id: { type: "number", desc: "指定索引(越界返回 not_found)" } },
    async run({ id }, ctx) {
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

  moyu: defineCommand<{ date?: string }>({
    name: "moyu",
    description: "摸鱼办·打工人日历(节假日/倒计时/进度)",
    args: { date: { type: "string", desc: "指定日期(默认今天)" } },
    async run({ date }, ctx) {
      const res = await ctx.get("/moyu", withQuery({ date }));
      return { data: unwrap<unknown>(res) };
    },
  }),
});
