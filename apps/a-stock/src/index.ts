#!/usr/bin/env node
/**
 * rxstock —— A 股股票数据命令行工具
 *
 * 业务包入口 —— 用 cli-sdk 的 defineCli 装配:
 *   - 多业务域用 namespaces 聚合(quote/kline/stock/index/sector/financial)
 *   - 不需要鉴权(数据源公开)
 *   - skill 直接放在 skills/(随包发布)
 *
 * 数据源:
 *   - 腾讯财经 (qt.gtimg.cn) — 实时行情(主)、K 线、分时
 *   - 东方财富 (push2.eastmoney.com / datacenter-web.eastmoney.com) — 列表/板块/财务/搜索/公告/资金流(主)
 *   - 任意数据源失败时自动 fallback(见 services/*)
 *
 * 设计取舍:
 *   - 不接 ctx.get:这些是公网数据源,不走 baseUrl 相对路径;各源独立处理 UA/Referer/编码
 *   - 进程内单例内存 TTL 缓存(交易日内实时数据 + 日级数据)
 *   - HTTP 重试 2 次(指数退避)+ 真实超时(AbortSignal.timeout)
 */

import { defineCli } from "@renxqoo/agent-data-cli";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { quoteCommands } from "./commands/quote.js";
import { klineCommands } from "./commands/kline.js";
import { stockCommands } from "./commands/stock.js";
import { indexCommands } from "./commands/index.js";
import { sectorCommands } from "./commands/sector.js";
import { financialCommands } from "./commands/financial.js";

// rxstock 是公开数据 CLI,无需 state 字段
type RxStockState = Record<string, never>;

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

const app = defineCli<RxStockState>({
  name: "rxstock",
  binName: "rxstock",
  description:
    "A 股股票数据命令行工具(行情/K线/财务/板块/资金流/公告,数据源:腾讯+东方财富,完全免费)",
  plugins: [],
  // 顶层命令
  commands: {
    quote: quoteCommands.get as any, // rxstock quote <code>(快速访问)
    search: stockCommands.search as any, // rxstock search <keyword>
  },
  // 多业务域聚合
  namespaces: {
    quote: quoteCommands, // rxstock quote get / batch
    kline: klineCommands, // rxstock kline get / minute / tick
    stock: stockCommands, // rxstock stock list / search / info
    index: indexCommands, // rxstock index list / get / kline
    sector: sectorCommands, // rxstock sector list / stocks / quote
    financial: financialCommands, // rxstock financial main / forecast / fundflow / announcements
  },
  skillsDir: SKILLS_DIR,
  skillsSource: process.env.RXSTOCK_SKILLS_SOURCE,
  // 没有 baseUrl / 不接 auth:这些是公开数据源,不需要走 cli-sdk 的 request 层
  errorOnStatus: undefined,
  defaultFormat: "json",
});

// bin 入口检测:用 realpathSync 比对(避免 npm 全局安装 bin 软链失配)
function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  const argv = process.argv.slice(2);
  // install 向导
  if (argv[0] === "install") {
    void (async () => {
      const { runInstallWizard } = await import("@renxqoo/agent-data-cli");
      const code = await runInstallWizard({ skillsSource: process.env.RXSTOCK_SKILLS_SOURCE });
      process.exit(code);
    })();
  } else {
    app.run(argv).catch(() => {
      /* exit code 已设 */
    });
  }
}

export default app;
