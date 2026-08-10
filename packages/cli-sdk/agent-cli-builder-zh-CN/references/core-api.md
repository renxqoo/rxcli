# 核心实现契约（中文）

每次使用 `agent-cli-builder` 实现 CLI 前读取本文件。内容以当前 `@renxqoo/agent-data-cli` 源码契约为准。

## 导航

1. 项目与依赖
2. 命令定义
3. CLI 装配与入口
4. 运行时上下文
5. 输出、错误与日志

## 1. 项目与依赖

优先改造用户现有项目。新项目使用 TypeScript、ESM、Node.js 20+，并复用仓库已有包管理器和测试工具。

安装框架前先检查 `package.json` 和 lockfile：

- Monorepo 内优先使用 workspace 已有版本。
- 独立项目使用用户指定版本；未指定时先查询当前稳定版本并写入 lockfile。
- 不静默全局安装依赖，不盲目复制 `@latest`。

业务包至少应包含：

```json
{
  "type": "module",
  "bin": { "my-cli": "./dist/index.js" },
  "files": ["dist", "skills"],
  "engines": { "node": ">=20" }
}
```

保留实际使用的 `build`、`typecheck`、`test` 和 `prepack` 脚本。不要为满足模板添加无法运行的脚本。

## 2. 命令定义

```ts
import { defineCommand, defineCommands, errs } from "@renxqoo/agent-data-cli";

export const todoCommands = defineCommands({
  list: defineCommand({
    name: "list",
    description: "查询待办列表",
    args: {
      limit: { type: "number", default: 20, desc: "返回数量上限，范围 1-100" },
    },
    async run(args, ctx) {
      if (args.limit < 1 || args.limit > 100) {
        throw new errs.ValidationError({
          subtype: "out_of_range",
          param: "--limit",
          message: "--limit 必须在 1-100 之间",
        });
      }
      const res = await ctx.get<{ items: Array<{ id: string; title: string }> }>("/todos", {
        limit: args.limit,
      });
      return { data: res.data.items, meta: { count: res.data.items.length } };
    },
  }),
});
```

参数规则：

| 配置               | 行为                                          |
| ------------------ | --------------------------------------------- |
| `type`             | 仅支持 `string`、`number`、`boolean`、`array` |
| `required: true`   | 必填；不能同时声明 `default`                  |
| `positional: true` | 使用 `<id>` / `[<id>]`，否则使用 flag         |
| `desc`             | 进入生成的命令文档；每个参数都应填写          |
| boolean 无 default | 未传时为 `undefined`                          |

必填 positional 不能放在可选 positional 后面。参数 schema 在装配期校验，但数值范围、枚举和跨参数关系仍由命令验证。

## 3. CLI 装配与入口

```ts
#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineCli } from "@renxqoo/agent-data-cli";
import { todoCommands } from "./commands/todos.js";

const app = defineCli({
  name: "my-cli",
  binName: "my-cli",
  description: "查询和管理待办",
  baseUrl: process.env.TODOS_API_URL ?? "https://api.example.com",
  commands: todoCommands,
  errorOnStatus: {
    404: "not_found",
    429: "rate_limited",
    "5xx": "server_error",
  },
  defaultFormat: "auto",
  skillsDir: "./skills",
});

function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainEntry()) await app.run(process.argv.slice(2));

export default app;
```

全局安装时 `argv[1]` 通常是软链接，必须用 `realpathSync` 比较真实入口。不要在被 import 时自动运行 CLI。

`defineCli` 关键选项：

| 选项            | 规则                                   |
| --------------- | -------------------------------------- |
| `name`          | 输出 `source`、管道类型和 Skill 标识   |
| `binName`       | 用户实际输入的命令名；建议显式设置     |
| `commands`      | 顶层命令；单业务域使用，必填           |
| `namespaces`    | 仅用于多个无关业务域，避免命令重名覆盖 |
| `plugins`       | 必须是已解析的 Plugin，不能传 Promise  |
| `errorOnStatus` | HTTP status 到已登记 subtype 的映射    |
| `defaultFormat` | `auto`（默认）、`json` 或 `human`      |
| `skillsDir`     | 设置后注入 `skills` 命令               |
| `skillsTargets` | 覆盖默认 Skill 同步目标                |
| `skillsScopes`  | 按 Skill 过滤生成的命令索引            |

若入口支持安装向导，传播返回码，不要固定写成功：

```ts
if (isMainEntry() && process.argv[2] === "install") {
  const { runInstallWizard } = await import("@renxqoo/agent-data-cli");
  process.exitCode = await runInstallWizard({
    skillsSource: process.env.MY_CLI_SKILLS_SOURCE,
  });
} else if (isMainEntry()) {
  await app.run(process.argv.slice(2));
}
```

## 4. 运行时上下文

`run(args, ctx)` 可使用：

- `ctx.get/post/put/patch/delete`：返回 `{ status, data, headers }`。
- `ctx.request`：需要自定义 method、query、body、header 或 timeout 时使用。
- `ctx.state`：插件之间共享的强类型状态。
- `ctx.log`：写 stderr，不污染结构化 stdout。
- `ctx.pipe`：读取上游 `PipeRecord`；仅在管道场景使用。
- `ctx.credentials`：鉴权插件初始化后的凭证 API。

请求类型必须描述真实响应。不要用 `any` 或多字段 fallback 掩盖未知 API 契约。

## 5. 输出、错误与日志

命令只能返回：

```ts
return {
  data: objectOrArrayOrNull,
  meta: {
    count: 10,
    pagination: { complete: false, nextToken: "cursor" },
    rollback: "可用 my-cli item restore <id> 撤销",
  },
};
```

- 纯副作用命令可返回 `void`；框架输出 `data: null`。
- `{}`、`{ data: undefined }` 和 string/number/boolean data 会触发 `internal/contract_violation`。
- 分页元数据不会自动生成；列表命令必须根据后端响应如实填写。Wire 字段固定为 camelCase 的 `complete` 和 `nextToken`，不要透传后端的 `next_token` 等命名。结束时 `{ complete: true }` 并省略 `nextToken`；未结束时返回 `{ complete: false, nextToken: "..." }`。
- 成功 JSON 写 stdout；错误 JSON 和日志写 stderr。
- 默认 `auto` 在 TTY 输出文本，在管道/CI 输出 JSON；agent 调用时显式加 `--json`。
- 业务命令不得直接写 stdout。`skills read` 的原文输出是框架内部例外。

业务错误使用 `errs.*`。裸 `Error` 会被归类为 `internal/unknown`，只适合真正的未预期内部故障。通用状态放 `errorOnStatus`，命令特有语义在 `run` 中抛类型化错误；两者不要重复处理。
