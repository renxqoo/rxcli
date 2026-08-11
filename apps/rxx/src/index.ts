#!/usr/bin/env node
/**
 * rxx —— 动态 agent-native CLI 运行时入口
 *
 * 双层命令:
 *   - rxx 自身静态命令(写死):init / list / update / remove / run
 *   - 动态服务命令(运行时):rxx run <service> <...> → 现场 build App
 *
 * 分流逻辑:
 *   argv[0] === 'run' → 调度(剥掉 run + service,build App,转发剩余 argv)
 *   否则 → rxx 自己的 defineCli App(init/list/update/remove/--help/--version)
 *
 * 设计依据:DESIGN.md 第 2 章架构 + 第 4.5 节调度入口。
 */

import { defineCli, serializeError, exitCodeOf } from "@renxqoo/agent-data-cli";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initCommand } from "./commands/init.js";
import { listCommand, updateCommand, removeCommand } from "./commands/manage.js";
import { runService } from "./commands/run.js";
import { rxxError } from "./errors.js";

// rxx 自身的静态命令(都 internal,不走 auth)
const rxxCommands = {
  init: initCommand,
  list: listCommand,
  update: updateCommand,
  remove: removeCommand,
};

const rxxApp = defineCli({
  name: "rxx",
  createState: () => ({}),
  description:
    "Dynamic agent-native CLI runtime: manifest → executable Agent Skill + multi-agent distribution",
  commands: rxxCommands,
  // 不设 baseUrl / errorOnStatus:rxx 自身命令不发业务请求
});

// ============================================================================
// bin 入口判断 + 分流
// ============================================================================

function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const argv = process.argv.slice(2);

if (isMainEntry()) {
  // —— 调度分流:argv[0]==='run' → 动态服务 ——
  if (argv[0] === "run") {
    const serviceName = argv[1];
    if (!serviceName || serviceName.startsWith("-")) {
      process.stderr.write(
        `Usage: rxx run <service> <command> [options]\n\nInstalled services: run \`rxx list\`\n`,
      );
      process.exitCode = 2;
    } else {
      const serviceArgs = argv.slice(2);
      void runService(serviceName, serviceArgs).then(
        () => {
          /* exit code 已由动态 App 的 pipeline 设 */
        },
        (err) => {
          // rxx 内部错误(LoaderError/事务失败等)→ rxxError 转 CliError → envelope 输出。
          // 不吐裸 error: 文本(违反 envelope 契约);rxxError 保证总返回 CliError。
          const cliErr = rxxError(err);
          process.stderr.write(serializeError(cliErr) + "\n");
          process.exitCode = exitCodeOf(cliErr.category);
        },
      );
    }
  } else {
    // rxx 自身命令(init/list/update/remove)+ --help/--version。
    // --version 由 cli-sdk 的 leadingVersion 检查处理(在 app.run 内)。
    // app.run() 内部有全包 try/catch:命令抛的任何错误都被捕获 →
    // toCliError → serializeError(envelope) → 设 exitCode。永不 reject。
    void rxxApp.run(argv);
  }
}

export default rxxApp;
