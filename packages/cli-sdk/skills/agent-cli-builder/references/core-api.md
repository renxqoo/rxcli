# Core Implementation Contract

Read this file before implementing any CLI with `agent-cli-builder`. It reflects the current `@renxqoo/agent-data-cli` source contract.

## Contents

1. Project and dependency setup
2. Command definitions
3. CLI assembly and entry point
4. Runtime context
5. Output, errors, and logs

## 1. Project and dependency setup

Prefer modifying the user's existing project. For a new project, use TypeScript, ESM, Node.js 20+, and the repository's package manager and test stack.

Before installing the framework, inspect `package.json` and the lockfile:

- In a monorepo, reuse its existing workspace version.
- In a standalone project, use the requested version; otherwise verify the current stable version and commit the lockfile.
- Do not silently install global dependencies or copy `@latest` blindly.

A publishable business package normally includes:

```json
{
  "type": "module",
  "bin": { "my-cli": "./dist/index.js" },
  "files": ["dist", "skills"],
  "engines": { "node": ">=20" }
}
```

Keep only scripts that actually run, typically `build`, `typecheck`, `test`, and `prepack`.

## 2. Command definitions

```ts
import { defineCommandFromArgs, defineCommands, errs } from "@renxqoo/agent-data-cli";

export const todoCommands = defineCommands({
  list: defineCommandFromArgs({
    name: "list",
    description: "List todos",
    args: {
      limit: { type: "number", default: 20, desc: "Maximum items, from 1 to 100" },
    },
    async run(args, ctx) {
      if (args.limit < 1 || args.limit > 100) {
        throw new errs.ValidationError({
          subtype: "out_of_range",
          param: "--limit",
          message: "--limit must be between 1 and 100",
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

Argument rules:

| Setting                 | Behavior                                                              |
| ----------------------- | --------------------------------------------------------------------- |
| `type`                  | `string`, `number`, `boolean`, or `array`                             |
| `required: true`        | Required and incompatible with `default`                              |
| `positional: true`      | Uses `<id>` or `[id]`; otherwise uses a flag                          |
| `desc`                  | Enters generated command documentation; provide it for every argument |
| boolean without default | Resolves to `undefined` when omitted                                  |

A required positional cannot follow an optional positional. Assembly validates schema shape; the command still validates ranges, enums, and cross-argument rules.

Use `defineCommandFromArgs` when the schema is the source of truth: required/default fields are inferred as present and all others as optional. Use `defineCommand<ExactArgs, Result, State>` when values need narrower unions or the command reads `ctx.state`. Componentized stateful groups should use `defineCommands<State>({...})`; incompatible groups are rejected by `defineCli<State>`. `json`, `api-key`, `help`, and `version` are framework-reserved names and cannot be redeclared by a business command. Framework flags may appear before or after the command route.

## 3. CLI assembly and entry point

```ts
#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineCli } from "@renxqoo/agent-data-cli";
import { todoCommands } from "./commands/todos.js";

const app = defineCli({
  name: "my-cli",
  binName: "my-cli",
  description: "Query and manage todos",
  baseUrl: process.env.TODOS_API_URL ?? "https://api.example.com",
  commands: todoCommands,
  errorOnStatus: { 404: "not_found", 429: "rate_limited", "5xx": "server_error" },
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

Global installation makes `argv[1]` a symlink, so compare real paths. Never run the CLI when the module is imported.

Key `defineCli` options:

| Option          | Rule                                            |
| --------------- | ----------------------------------------------- |
| `name`          | Output `source`, pipe type, and Skill identity  |
| `binName`       | The actual shell command; set it explicitly     |
| `commands`      | Required top-level commands; use for one domain |
| `namespaces`    | Use only for multiple unrelated domains         |
| `plugins`       | Must contain resolved Plugins, never Promises   |
| `errorOnStatus` | HTTP status to registered subtype mapping       |
| `defaultFormat` | `auto` by default, or `json` / `human`          |
| `skillsDir`     | Enables built-in `skills` commands              |
| `skillsTargets` | Overrides default synchronization targets       |
| `skillsScopes`  | Filters generated command indexes per Skill     |

When exposing the install wizard, propagate its return code:

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

## 4. Runtime context

`run(args, ctx)` can use:

- `ctx.get/post/put/patch/delete`, returning `{ status, data, headers }`.
- `ctx.request` for custom methods, query, body, headers, or timeout.
- `ctx.state` for typed state shared by plugins.
- `ctx.log` for stderr-only logs.
- `ctx.pipe` for upstream `PipeRecord` input.
- `ctx.credentials` after auth initialization.

Type requests from the verified API. Do not use `any` or multi-field fallbacks to conceal an unknown contract.

## 5. Output, errors, and logs

```ts
return {
  data: objectOrArrayOrNull,
  meta: {
    count: 10,
    pagination: { complete: false, nextToken: "cursor" },
    rollback: "Run my-cli item restore <id> to undo",
  },
};
```

- A pure side effect may return `void`; the framework emits `data: null`.
- `{}`, `{ data: undefined }`, and scalar data cause `internal/contract_violation`.
- Pagination metadata is never automatic. Map it explicitly to `complete` and `nextToken`; omit `nextToken` when complete.
- Successful JSON goes to stdout. Errors and logs go to stderr.
- `auto` renders text on a TTY and JSON in pipes or CI; agents should still pass `--json` explicitly.
- Business commands must not write to stdout. Raw `skills read` output is an internal exception.

Throw `errs.*` for business failures. A bare `Error` becomes `internal/unknown` and is appropriate only for a genuinely unexpected internal failure. Put shared HTTP semantics in `errorOnStatus`; throw command-specific errors in `run`, never both for the same status.
