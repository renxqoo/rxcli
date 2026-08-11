/**
 * kb —— 知识库
 *
 * 子命令:
 *   baike          百度百科词条摘要
 *   js-question    JavaScript 面试题(随机或指定 id)
 */

import * as z from "zod";
import { defineCommands, defineCommand } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery } from "../envelope.js";

export const kbCommands = defineCommands({
  baike: defineCommand({
    name: "baike",
    description: "百度百科词条摘要(标题/描述/封面/链接)",
    args: {
      schema: z.object({ word: z.string().describe("词条关键词") }),
      pos: ["word"],
    },
    async run(ctx, { word }) {
      const res = await ctx.get("/baike", withQuery({ word }));
      return {
        data: unwrap<{
          title: string;
          description: string;
          abstract: string;
          cover: string;
          link: string;
        }>(res),
      };
    },
  }),

  "js-question": defineCommand({
    name: "js-question",
    description: "JavaScript 面试题(含选项/答案/解析)",
    args: {
      schema: z.object({
        id: z.coerce.number().describe("指定题目 ID(省略随机)").optional(),
      }),
    },
    async run(ctx, { id }) {
      const res = await ctx.get("/awesome-js", withQuery({ id }));
      return {
        data: unwrap<{
          id: number;
          question: string;
          options: string[];
          answer: string;
          explanation: string;
        }>(res),
      };
    },
  }),
});
