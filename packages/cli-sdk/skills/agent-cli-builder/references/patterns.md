# 模式进阶:分页 / 管道 / humanFormat

> 主 SKILL.md §5 只留了高频模式(多域 namespaces、errorOnStatus)。这里放进阶写法——**需要时才读**:
>
> - 命令返回大列表,要给 agent 续拉能力 → §1 分页
> - 下游命令消费上游命令输出(`a list | b generate`)→ §2 管道下游
> - `--no-json` 时要精致化人类可读输出 → §3 humanFormat

---

## 1. 分页(给 agent `complete + nextToken`)

列表命令如实填 `pagination`,agent 才能判断"是否续拉":

```ts
list: defineCommand({
  args: { cursor: { type: 'string', desc: '续拉游标(从上次 nextToken 取)' } },
  async run(args, ctx) {
    const res = await ctx.get('/items', { cursor: args.cursor })
    return {
      data: res.data.items,
      meta: {
        count: res.data.items.length,
        pagination: {
          complete: !res.data.hasMore,         // ★ agent 靠它判断是否续拉
          pages: 1,
          items: res.data.items.length,
          nextToken: res.data.hasMore ? res.data.nextCursor : undefined,
        },
      },
    }
  },
}),
```

**`complete` 必须如实填**——填错 agent 误判:

- `complete: true` 但其实还有更多 → agent 漏拉数据
- `complete: false` 但其实拉完了 → agent 死循环续拉

**后端分页字段未知时:先问用户,别默认全兼容。** 后端可能用 `items`/`data`/`<域名>` 三种数组键、`hasMore`/`has_more`、`nextCursor`/`next_cursor` 等不同约定。**不要在代码里猜着写 `raw.items ?? raw.data ?? raw.xxx` 的防御性归一化**——这是过度防御,掩盖了"你其实不知道后端长什么样"的问题。正确做法:列出 2-3 个候选问用户("后端列表响应是 `{items:[...]}` 还是 `{data:[...]}`?分页用 cursor 还是 page?"),拿到确定答案再写。如果暂时问不到,用**一个**最可能的形态 + `// TODO: 确认后端响应字段` 标注,不要堆兼容。

字段含义:

| 字段              | 类型    | 说明                                                                                |
| ----------------- | ------- | ----------------------------------------------------------------------------------- |
| `complete`        | boolean | **必填**。true=已拉完;false=还有更多                                                |
| `nextToken`       | string  | complete:false 时填,agent 用它作下次 `--cursor`                                     |
| `pages` / `items` | number  | 可选,信息性。**不知道总页数就省略 `pages`,别硬编码 1**(cursor 分页通常无总页数概念) |

---

## 2. 管道下游(消费上游命令的输出)

下游命令用 `ctx.pipe.isInPipe()` 分流:在管道里就读上游记录,不在就用参数。

```ts
generate: defineCommand({
  args: { orderId: { type: 'string' } },     // 既支持管道,又支持参数
  async run(args, ctx) {
    if (ctx.pipe.isInPipe()) {
      let count = 0
      for await (const rec of ctx.pipe.in()) {
        if (rec.type !== 'orders') continue   // 按 defineCli.name 分流(只处理来自 orders 的)
        await ctx.post('/invoices', { orderId: rec.id })
        count++
      }
      return { data: { generated: count } }
    }
    // 不在管道里:走参数
    if (!args.orderId) throw new errs.ValidationError({ param: 'orderId', message: '需要 orderId 或管道输入' })
    const res = await ctx.post('/invoices', { orderId: args.orderId })
    return { data: res.data }
  },
}),
```

**PipeRecord 结构**(上游 stdout 的 data 数组被框架逐条包成这个):

```ts
interface PipeRecord {
  type: string; // 来源 CLI 的 defineCli.name,下游按它分流
  id?: string; // 稳定标识
  data?: unknown; // payload(已过 beforeOutput 转换)
  meta?: Record<string, unknown>;
}
```

用法:`rx-shop orders list --status unpaid | rx-shop invoices generate`

> **管道保护是自动的**:被管道时(stdin 非 TTY),即使 `--no-json` 也强制输出 JSON,保护下游解析。

---

## 3. `humanFormat` 自定义 `--no-json` 输出

不声明 `humanFormat` 时,框架兜底渲染(对象数组→表格,单对象→key:value 详情)。想精致化用框架导出的 `printTable`(内置 CJK 宽度对齐,中文按 2 列):

```ts
import { defineCommand, printTable } from '@renxqoo/agent-data-cli'

list: defineCommand({
  humanFormat: (data) => printTable(data as any[], [
    { header: 'ID', value: (r: any) => r.id },
    { header: '总额', value: (r: any) => `¥${r.total}`, align: 'right' },
    { header: '状态', value: (r: any) => ({ paid: '已支付', shipped: '已发货' })[r.status] ?? r.status },
  ]),
  async run(args, ctx) { /* ... */ },
}),
```

- `humanFormat(data, meta?)` 返回 string,框架打到 stdout(仅 `--no-json`/TTY 模式)
- **agent 场景用不到**(agent 走 JSON 信封),这是给人看的终端输出
- 不想自定义就别声明,框架兜底够用
