/**
 * kb —— 知识库
 *
 * 子命令:
 *   baike          百度百科词条摘要
 *   js-question    JavaScript 面试题(随机或指定 id)
 */

import { defineCommands, defineCommand } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery } from "../envelope.js";

export const kbCommands = defineCommands({
  baike: defineCommand<{ word: string }>({
    name: "baike",
    description: "百度百科词条摘要(标题/描述/封面/链接)",
    args: { word: { type: "string", required: true, positional: true, desc: "词条关键词" } },
    async run({ word }, ctx) {
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

  "js-question": defineCommand<{ id?: number }>({
    name: "js-question",
    description: "JavaScript 面试题(含选项/答案/解析)",
    args: { id: { type: "number", desc: "指定题目 ID(省略随机)" } },
    async run({ id }, ctx) {
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
