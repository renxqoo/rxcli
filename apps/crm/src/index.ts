#!/usr/bin/env node
/**
 * rxcli(crm)—— 多业务域聚合业务包入口
 *
 * 迁自 v1 rxcli 单体 CLI,改用 cli-sdk v2:
 *   - 多业务域用 namespaces 聚合(orders/products/invoices/account)
 *   - auth 用 cli-sdk 的 defineAuth 工厂(同步工厂,装配器自动 apply)
 *   - installer 是插件(顶层 install 命令),入口不再拦截
 *   - update awareness 用 createUpdateNotifier(每次运行一次,仅 stderr)
 *   - skill 直接复用 v1(已搬到 skills/)
 */

import {
  createUpdateNotifier,
  defineAuth,
  defineCliApp,
  defineInstaller,
  detectBizPackage,
} from "@renxqoo/agent-data-cli";
import { AUTH_BASE_URL, API_BASE_URL, CRM_SCOPES, SKILLS_DIR, RXCLI_DIR } from "./config.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ordersCommands } from "./commands/orders.js";
import { productsCommands } from "./commands/products.js";
import { invoicesCommands } from "./commands/invoices.js";
import { accountCommands } from "./commands/account.js";

type CrmState = {
  user: { userId: string; name?: string } | null;
};

// update awareness:仅当入口可探测到业务包名/合法版本时启用(库引用场景跳过)
const biz = detectBizPackage();
const updateNotifier =
  biz && /^\d+\.\d+\.\d+/.test(biz.version)
    ? [createUpdateNotifier<CrmState>({ packageName: biz.name, currentVersion: biz.version })]
    : [];

// defineCliApp:唯一目录决策(dir),auth/installer/notifier 经 apply(services) 拿本地状态
// auth plugin(钩子 + auth 命令一捆):defineCliApp 自动注入 login/status/logout/register
// scope 业务自定(crm 走中间层 company.api + offline_access 拿 refresh_token)
// bearerToken + envBearerProvider:多环境自适应
//   - 本地:无 CRM_BEARER_TOKEN → device flow 登录,token 存文件
//   - sandbox:有 CRM_BEARER_TOKEN → 直接用 admin 预签发的 JWT
const app = await defineCliApp<CrmState>({
  name: "crm",
  dir: RXCLI_DIR,
  createState: () => ({ user: null }),
  description: "通过鉴权中间层访问公司应用(订单/商品/发票/账号)",
  plugins: [
    defineAuth<CrmState>({
      credentialNamespace: "crm",
      baseUrl: AUTH_BASE_URL,
      // 一份 scope:登录授权与注册声明共用;注册 metadata 其余字段由 SDK 派生
      // (client_name ← crm、grant_types ← device flow、token_endpoint_auth_method ← client_secret_basic)
      scope: CRM_SCOPES.join(" "),
      bearerToken: process.env.CRM_BEARER_TOKEN,
    }),
    defineInstaller<CrmState>({ skillsSource: process.env.RXCLI_SKILLS_SOURCE }),
    ...updateNotifier,
  ],
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

// bin 入口:被直接执行时自动 run。install 是 installer 插件提供的普通命令,无需拦截。
if (isMainEntry()) {
  app.run(process.argv.slice(2)).then(() => {
    /* exit code 已由 pipeline 设 */
  });
}

export default app;
