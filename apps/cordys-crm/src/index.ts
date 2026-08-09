#!/usr/bin/env node
/**
 * rxcordys —— Cordys CRM L2C 全链路 agent 命令行工具。
 *
 * 基于 @renxqoo/agent-data-cli 框架,全量覆盖 CordysCRM 接口:
 *   - 静态双 header 鉴权(X-Access-Key / X-Secret-Key / X-Request-Source: SKILL)
 *   - 凭证:rxcordys auth login 持久化 或 CORDYS_ACCESS_KEY/CORDYS_SECRET_KEY 环境变量
 *   - 模块按 namespace 聚合:records/leads/accounts/opportunities/contacts/contracts/
 *     invoices/orders/follows/approvals/stats/util + auth(skills 自动注入)
 *   - 顶层快捷:whoami / search / raw
 *
 * 设计参考 apps/crm(多 namespace)+ apps/a-stock(顶层快捷命令)。
 */

import { defineCli } from "@renxqoo/agent-data-cli";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { API_BASE_URL, SKILLS_DIR } from "./config.js";
import { createCordysAuth, type RxCordysState } from "./auth.js";
import { recordsCommands } from "./commands/records.js";
import { leadsCommands } from "./commands/leads.js";
import { accountsCommands } from "./commands/accounts.js";
import { opportunitiesCommands } from "./commands/opportunities.js";
import { contactsCommands } from "./commands/contacts.js";
import { contractsCommands } from "./commands/contracts.js";
import { invoicesCommands } from "./commands/invoices.js";
import { ordersCommands } from "./commands/orders.js";
import { followsCommands } from "./commands/follows.js";
import { approvalsCommands } from "./commands/approvals.js";
import { statsCommands } from "./commands/stats.js";
import { utilCommands, whoamiCommand } from "./commands/util.js";

// auth plugin:静态双 header 鉴权(非 OAuth,手写 plugin)。
// provides.namespaces.auth 自动注入 login/status/logout(框架豁免自身 beforeCommand)。
const auth = createCordysAuth();

const app = defineCli<RxCordysState>({
  name: "rxcordys",
  binName: "rxcordys",
  description: "Cordys CRM L2C 全链路 agent CLI(线索/客户/商机/合同/回款/发票/订单/审批/统计)",
  plugins: [auth],
  // 顶层快捷命令(高频操作直达,免去 namespace 前缀)
  commands: {
    whoami: whoamiCommand, // rxcordys whoami(等价 rxcordys util whoami)
  },
  // 多业务域聚合:key=子命名空间 → rxcordys <ns> <cmd>
  namespaces: {
    records: recordsCommands, // 跨模块通用(view/get/page/search/contact/product/form)
    leads: leadsCommands, // 线索(+ transition/transform 转换)
    accounts: accountsCommands, // 客户(+ sub 客户360)
    opportunities: opportunitiesCommands, // 商机(+ quotation 报价单)
    contacts: contactsCommands, // 联系人
    contracts: contractsCommands, // 合同(+ payment-plan/record/business-title + stat)
    invoices: invoicesCommands, // 发票
    orders: ordersCommands, // 订单(+ stat)
    follows: followsCommands, // 跟进(plan/record)
    approvals: approvalsCommands, // 审批(todo/action/resource/flow)
    stats: statsCommands, // 统计(模块金额 + 首页看板)
    util: utilCommands, // 工具(whoami/verify/org/members/glocount/raw)
    // auth namespace 由 auth plugin 通过 provides 自动注入(login/status/logout)
  },
  baseUrl: API_BASE_URL,
  errorOnStatus: {
    401: "token_expired",
    403: "forbidden",
    404: "not_found",
    429: "rate_limited",
    "5xx": "server_error",
  },
  skillsDir: SKILLS_DIR,
  skillsSource: process.env.RXCORDYS_SKILLS_SOURCE,
  defaultFormat: "auto",
});

// bin 入口判断:用 realpath 解析软链(npm 全局安装时 argv[1] 是 bin 软链,
// import.meta.url 是真实路径),避免字符串比对在软链下失效导致命令静默不执行。
function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const argv = process.argv.slice(2);

// install 向导拦截(优先级最高):argv[0]==='install' 转给 cli-sdk 的向导,不走命令路由。
// skillsSource 空=本地 skills/;设了(如 RXCORDYS_SKILLS_SOURCE=https://skills.sh/p/xxx)=npx skills add。
if (isMainEntry() && argv[0] === "install") {
  void (async () => {
    const { runInstallWizard } = await import("@renxqoo/agent-data-cli");
    const code = await runInstallWizard({ skillsSource: process.env.RXCORDYS_SKILLS_SOURCE });
    process.exit(code);
  })();
} else if (isMainEntry()) {
  app.run(argv).catch(() => {
    /* exit code 已由 pipeline 设 */
  });
}

export default app;
