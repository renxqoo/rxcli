/**
 * account —— 账号信息(经 gateway 调 /api/profile、/api/admin/users)
 *
 * 迁自 v1 commands/account.ts。
 * - account profile:查看当前登录用户资料
 * - account admin-users:管理员查全量用户(权限由服务端 403 拦截,对齐 v1)
 *   v1 是三级 `account admin users`;v2 命令名用连字符 `admin-users`(框架 namespaces 两级)
 * 美化打印用框架兜底(--no-json 自动表格/key:value 详情)。
 */

import { defineCommands, defineCommand } from '@renxqoo/agent-data-cli'

export const accountCommands = defineCommands({
  profile: defineCommand({
    name: 'profile',
    description: '查看当前登录用户的资料',
    async run(_args, ctx) {
      const res = await ctx.get('/proxy/api/profile')
      return { data: res.data }
    },
  }),

  'admin-users': defineCommand({
    name: 'admin-users',
    description: '查询全量用户列表(管理员)',
    async run(_args, ctx) {
      const res = await ctx.get('/proxy/api/admin/users')
      return { data: res.data }
    },
  }),
})
