#!/usr/bin/env node
/**
 * rxcli(crm)—— 多业务域聚合业务包入口
 *
 * 迁自 v1 rxcli 单体 CLI,改用 cli-sdk v2:
 *   - 多业务域用 namespaces 聚合(orders/products/invoices/account)
 *   - auth 用 cli-sdk 的 defineAuth 工厂(钩子 + login/status/logout/register 自动注入)
 *   - skill 直接复用 v1(已搬到 skills/)
 */

import { defineCli, defineAuth } from "@renxqoo/agent-data-cli";
import { AUTH_BASE_URL, API_BASE_URL, CRM_SCOPES, SKILLS_DIR } from "./config.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ordersCommands } from "./commands/orders.js";
import { productsCommands } from "./commands/products.js";
import { invoicesCommands } from "./commands/invoices.js";
import { accountCommands } from "./commands/account.js";

type CrmState = {
  user: { userId: string; name?: string } | null;
};

// auth plugin(钩子 + auth 命令一捆):defineCli 自动注入 login/status/logout/register
// scope 业务自定(crm 走中间层 company.api + offline_access 拿 refresh_token)
// bearerToken + envBearerProvider:多环境自适应
//   - 本地:无 CRM_BEARER_TOKEN → device flow 登录,token 存文件
//   - sandbox:有 CRM_BEARER_TOKEN → 直接用 admin 预签发的 JWT
const auth = await defineAuth<CrmState>({
  credentialNamespace: "crm",
  baseUrl: AUTH_BASE_URL,
  scope: CRM_SCOPES.join(" "),
  clientMetadata: {
    client_name: "crm",
    grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    scope: CRM_SCOPES.join(" "),
    token_endpoint_auth_method: "client_secret_basic",
  },
  bearerToken: process.env.CRM_BEARER_TOKEN,
});

const app = defineCli<CrmState>({
  name: "crm",
  createState: () => ({ user: null }),
  description: "通过鉴权中间层访问公司应用(订单/商品/发票/账号)",
  plugins: [auth],
  // 顶层命令:无(全部走 namespace)
  commands: {},
  // 多业务域聚合:key=子命名空间 → rxcli <ns> <cmd>
  // auth namespace 由 auth plugin 通过 provides 自动注入(login/status/logout/register)
  namespaces: {
    orders: ordersCommands, // → rxcli orders list / rxcli orders get <id>
    products: productsCommands, // → rxcli products list / rxcli products get <id>
    invoices: invoicesCommands, // → rxcli invoices list
    account: accountCommands, // → rxcli account profile / rxcli account admin-users
  },
  baseUrl: API_BASE_URL,
  errorOnStatus: {
    401: "token_expired",
    403: "forbidden",
    404: "not_found",
    "5xx": "server_error",
  },
  skillsDir: SKILLS_DIR,
  // skills 源 URL:设了 → install 向导优先 npx skills add;空 → 用包内本地 skills(走 skills sync)
  skillsSource: process.env.RXCLI_SKILLS_SOURCE,
});

// bin 入口判断:用 realpath 解析软链(npm 全局安装时 argv[1] 是 bin 软链,
// import.meta.url 是真实路径),避免字符串比对在软链下失效导致命令静默不执行
function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const argv = process.argv.slice(2);

// install 向导拦截(优先级最高):argv[0]==='install' 转给 cli-sdk 的向导,不走命令路由。
// skillsSource 空=本地 skills/;设了(如 RXCLI_SKILLS_SOURCE=https://skills.sh/p/xxx)=npx skills add。
if (isMainEntry() && argv[0] === "install") {
  const { runInstallWizard } = await import("@renxqoo/agent-data-cli");
  const code = await runInstallWizard({ skillsSource: process.env.RXCLI_SKILLS_SOURCE });
  process.exit(code);
}

// bin 入口:被直接执行时自动 run
if (isMainEntry()) {
  app.run(argv).then(() => {
    /* exit code 已由 pipeline 设 */
  });
}

export default app;
