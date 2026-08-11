/**
 * health —— 健康评估
 *
 * 子命令:
 *   assess    基于 身高/体重/性别/年龄 计算 BMI / 理想体重 / 基础代谢 / 体脂率 / 健康建议
 *
 * 注:根级 /health 是健康检查(返回 ok),与此 /v2/health 不同。
 */

import * as z from "zod";
import { defineCommands, defineCommand } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery } from "../envelope.js";

export const healthCommands = defineCommands({
  assess: defineCommand({
    name: "assess",
    description: "健康评估报告(BMI/理想体重/基础代谢/体脂率/建议)",
    args: {
      schema: z.object({
        height: z.coerce.number().describe("身高 cm(50-300)"),
        weight: z.coerce.number().describe("体重 kg(10-300)"),
        gender: z.string().describe("性别:male | female"),
        age: z.coerce.number().describe("年龄(1-150)"),
      }),
    },
    async run(ctx, { height, weight, gender, age }) {
      const res = await ctx.get("/health", withQuery({ height, weight, gender, age }));
      return { data: unwrap<unknown>(res) };
    },
  }),
});
