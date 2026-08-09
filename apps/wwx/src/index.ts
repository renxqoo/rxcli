#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineCli, defineAuth } from "@renxqoo/agent-data-cli";
import { ordersCommands } from "./commands/orders.js";

// 鉴权:必须 await(defineAuth 是 async,返回 Promise<Plugin>)。
// 缺 await → plugins:[Promise] → beforeCommand 不执行 → 鉴权失效且无报错。
// 鉴权方案未定,先按 OAuth device flow 搭;后续确认 API Key 改 authStyle 即可。
const auth = await defineAuth({
  credentialNamespace: "wwx",
  baseUrl: process.env.WWX_AUTH_BASE_URL ?? "",
  scope: "orders:read",
  // 方案确认后按需改:API Key → authStyle: "x-api-key";Bearer → authStyle: "bearer"
});

const app = defineCli({
  name: "wwx",
  binName: "wwx",
  description: "查询公司订单系统数据",
  baseUrl: process.env.WWX_API ?? "https://orders.example.com",
  plugins: [auth],
  commands: ordersCommands,
  errorOnStatus: { "5xx": "server_error" }, // 404 留给 get 命令手写(语义不同)
  skillsDir: "./skills",
});

// npm 全局安装时 argv[1] 是 bin 软链,必须用 realpathSync 比对入口,否则命令不执行。
function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const argv = process.argv.slice(2);
if (isMainEntry() && argv[0] === "install") {
  const { runInstallWizard } = await import("@renxqoo/agent-data-cli");
  await runInstallWizard({ skillsSource: process.env.WWX_SKILLS_SOURCE });
  process.exit(0);
}
if (isMainEntry()) app.run(argv);
export default app;
