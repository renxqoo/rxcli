#!/usr/bin/env node
/**
 * rx60s —— 每天 60 秒读懂世界 · 开放 API 命令行工具
 *
 * 业务包入口 —— 用 @renxqoo/agent-data-cli 的 defineCliApp 装配:
 *   - 多业务域用 namespaces 聚合(news/hot/tech/fun/music/movie/life/tool/kb/health/beta)
 *   - 不需要鉴权(60s 全公开接口):installer 以 auth:false 装配
 *   - 顶层快捷命令:60s / bing / weibo / zhihu / toutiao / hitokoto / moyu
 *
 * 数据源:vikiboss/60s 开源项目(默认 https://60s.viki.moe),全部接口在 /v2 前缀下,
 * 统一响应 { code, message, data }。响应解包见 src/envelope.ts。
 *
 * 设计取舍:
 *   - 走 ctx.get + baseUrl(标准 REST,非 a-stock 的多源自定义)
 *   - 强制 ?encoding=json 拿结构化数据;text/markdown 由 humanFormat 本地渲染
 *   - 二进制/重定向输出(qrcode/bing image)只暴露 URL/base64 字段
 */

import {
  createUpdateNotifier,
  defineCliApp,
  defineCommand,
  defineInstaller,
  detectBizPackage,
} from "@renxqoo/agent-data-cli";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

import { newsCommands } from "./commands/news.js";
import { hotCommands } from "./commands/hot.js";
import { techCommands } from "./commands/tech.js";
import { funCommands } from "./commands/fun.js";
import { musicCommands } from "./commands/music.js";
import { movieCommands } from "./commands/movie.js";
import { lifeCommands } from "./commands/life.js";
import { toolCommands } from "./commands/tool.js";
import { kbCommands } from "./commands/kb.js";
import { healthCommands } from "./commands/health.js";
import { betaCommands } from "./commands/beta.js";
import { unwrap, withQuery } from "./envelope.js";

// rx60s 是公开数据 CLI,无需 state 字段
type Rx60sState = Record<string, never>;

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
// 60s API 所有数据接口在 /v2 前缀下(router.ts 用 prefix:'/v2')。baseUrl 含 /v2,
// 命令内路径用相对路径(如 /hitokoto)即拼成 https://60s.viki.moe/v2/hitokoto。
const DEFAULT_BASE_URL = "https://60s.viki.moe/v2";
// 本地状态根(update-notifier 缓存),开放数据 CLI 无凭证/config
const STATE_DIR = join(homedir(), ".rx60s");

// update awareness:仅当入口可探测到业务包名/合法版本时启用(库引用场景跳过)
const biz = detectBizPackage();
const updateNotifier =
  biz && /^\d+\.\d+\.\d+/.test(biz.version)
    ? [createUpdateNotifier<Rx60sState>({ packageName: biz.name, currentVersion: biz.version })]
    : [];

// ── 必应每日壁纸(独立接口,顶层快捷) ──────────────────────────────
const bingCommand = defineCommand({
  name: "bing",
  description: "必应每日壁纸(标题 + 1080P/4K 封面)",
  async run(ctx) {
    const res = await ctx.get("/bing", withQuery());
    return {
      data: unwrap<{ title: string; cover: string; cover_4k: string; copyright: string }>(res),
    };
  },
});

const app = await defineCliApp<Rx60sState>({
  name: "rx60s",
  dir: STATE_DIR,
  binName: "rx60s",
  description:
    "每天 60 秒读懂世界 · 开放 API 命令行工具(新闻/热搜/天气/油价/金价/汇率/老黄历/翻译/二维码/密码/健康评估等 60+ 接口,数据源 vikiboss/60s,全免费)",
  plugins: [
    // 无鉴权场景:install 只做装包 + skills 同步,跳过 register/login
    defineInstaller<Rx60sState>({ skillsSource: process.env.RX60S_SKILLS_SOURCE, auth: false }),
    ...updateNotifier,
  ],
  // 顶层快捷命令(高频接口直达,免去 namespace 前缀)
  commands: {
    "60s": { ...newsCommands.today!, name: "60s" }, // rx60s 60s → 每天 60 秒(顶层快捷,等同 news today)
    bing: bingCommand, // rx60s bing → 必应每日壁纸
    weibo: hotCommands.weibo!,
    zhihu: hotCommands.zhihu!,
    toutiao: hotCommands.toutiao!,
    hitokoto: funCommands.hitokoto!,
    moyu: funCommands.moyu!,
  },
  // 多业务域聚合 → rx60s <ns> <cmd>
  namespaces: {
    news: newsCommands, // rx60s news today/ai/it/it-rank/rss
    hot: hotCommands, // rx60s hot weibo/zhihu/toutiao/...
    tech: techCommands, // rx60s tech hackernews
    fun: funCommands, // rx60s fun hitokoto/duanzi/kfc/...
    music: musicCommands, // rx60s music rank/lyric/changya
    movie: movieCommands, // rx60s movie maoyan-*/douban/epic
    life: lifeCommands, // rx60s life weather/fuel-price/lunar/...
    tool: toolCommands, // rx60s tool hash/qrcode/og/whois/password/...
    kb: kbCommands, // rx60s kb baike/js-question
    health: healthCommands, // rx60s health assess
    beta: betaCommands, // rx60s beta kuan/qq(实验性)
  },
  baseUrl: process.env.RX60S_BASE_URL ?? DEFAULT_BASE_URL,
  skillsDir: SKILLS_DIR,
  skillsSource: process.env.RX60S_SKILLS_SOURCE,
  // 60s 业务错误:400/404/429 走 errorOnStatus 自动 throw;
  // 5xx 不在此配,统一交给 unwrap 处理(上游 500 时 message 常含自身解析失败信息,需美化)
  errorOnStatus: {
    400: "invalid_argument",
    404: "not_found",
    429: "rate_limited",
  },
  defaultFormat: "auto",
});

// bin 入口检测:用 realpathSync 比对(避免 npm 全局安装 bin 软链失配)
function isMainEntry(): boolean {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

// bin 入口:install 是 installer 插件提供的普通命令(无鉴权场景),无需拦截。
if (isMainEntry()) {
  app.run(process.argv.slice(2)).catch(() => {
    /* exit code 已由框架按错误 category 设置 */
  });
}

export default app;
