/**
 * invoices —— 发票(经 gateway 调 /api/invoices)
 *
 * 迁自 v1 commands/invoices.ts。只返回当前登录用户的发票(按用户隔离)。
 * 美化打印用框架兜底(--no-json 自动表格)。
 */

import { defineCommands, defineCommand } from '@renxqoo/agentdatacli'

export const invoicesCommands = defineCommands({
  list: defineCommand({
    name: 'list',
    description: '查询发票列表(仅本人发票)',
    async run(_args, ctx) {
      const res = await ctx.get('/proxy/api/invoices')
      return { data: res.data }
    },
  }),
})
