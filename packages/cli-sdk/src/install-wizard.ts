/**
 * @renxqoo/agent-data-cli —— install 向导(框架层,所有业务包通用)
 *
 * 迁自 v1 rxcli/src/install-wizard.ts,改造点:
 *   - PKG/BIN 常数 → detectBizPackage() 动态探测(业务包 name/bin/version)
 *   - hasRegistered() 跑 `rxcli env` → 读 ~/.rxcli/config.json 的 clientId(v2 无 env 命令)
 *   - skills 源可配置:skillsSource 空 → 本地 skills sync;非空 → npx skills add + 回退 sync
 *   - 业务包入口拦截 argv[0]==='install' 后动态 import 本模块,调 runInstallWizard(opts)
 *
 * 4 步流程:
 * ① npm install -g <bizPkg>   全局安装/升级 CLI(探测业务包名)
 * ② skills 安装               skillsSource 配了→npx skills add;空→本地 skills sync
 * ③ rxcli auth register        用注册令牌换 client 凭据(已注册则跳过)
 * ④ rxcli auth login           device flow 浏览器登录(失败仅 warn,不阻断)
 */
import { execFile, execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileStore } from "./credentials/config-store.js";
import { detectBizPackage } from "./define.js";

// @clack/prompts 是 ESM-only,延迟加载(对齐 v1 的顶层 await import)
type Clack = typeof import("@clack/prompts");
let p: Clack;

const isWindows = process.platform === "win32";

// ---------------------------------------------------------------------------
// i18n —— 对齐 v1 的 messages.zh/en 双语表
// ---------------------------------------------------------------------------

interface Messages {
  setup: string;
  step1: string;
  step1Upgrade: string;
  step1Skip: string;
  step1Done: string;
  step1Upgraded: string;
  step1Fail: string;
  step2: string;
  step2Skip: string;
  step2Spinner: string;
  step2Done: string;
  step2FailNpx: string;
  step2FailAll: string;
  step3: string;
  step3Skip: string;
  step3Done: string;
  step3Fail: string;
  step4: string;
  step4NotFound: string;
  step4Confirm: string;
  step4Skip: string;
  step4Done: string;
  step4Fail: string;
  done: string;
  cancelled: string;
  nonTtyHint: string;
}

const messages: Record<"zh" | "en", Messages> = {
  zh: {
    setup: "正在设置 rxcli...",
    step1: "正在全局安装 %s...",
    step1Upgrade: "正在升级 %s (v%s → v%s)...",
    step1Skip: "已安装 (v%s),跳过",
    step1Done: "已全局安装",
    step1Upgraded: "已升级到 v%s",
    step1Fail: "全局安装失败。运行以下命令重试: npm install -g %s",
    step2: "安装 AI Skills",
    step2Skip: "已安装,跳过",
    step2Spinner: "正在安装 Skills...",
    step2Done: "Skills 已安装",
    step2FailNpx: "npx skills add 失败,尝试本地 skills sync 回退...",
    step2FailAll: "Skills 安装失败。可手动重试: rxcli skills sync",
    step3: "正在注册应用...",
    step3Skip: "已注册,跳过",
    step3Done: "注册完成",
    step3Fail: "注册失败。运行以下命令重试: rxcli auth register",
    step4: "授权",
    step4NotFound: "未找到 rxcli,跳过授权",
    step4Confirm: "是否允许 CLI 以你的名义访问公司应用接口?",
    step4Skip: "跳过授权。后续运行 rxcli auth login 完成授权",
    step4Done: "授权完成",
    step4Fail: "授权失败。运行以下命令重试: rxcli auth login",
    done: '安装完成!\n可以和你的 AI 工具说: "rxcli 能帮我做什么?"',
    cancelled: "安装已取消",
    nonTtyHint:
      "非交互环境,已完成 CLI 与 Skills 安装。请在终端中运行:\n  rxcli auth register\n  rxcli auth login",
  },
  en: {
    setup: "Setting up rxcli...",
    step1: "Installing %s globally...",
    step1Upgrade: "Upgrading %s (v%s → v%s)...",
    step1Skip: "Already installed (v%s). Skipped",
    step1Done: "Installed globally",
    step1Upgraded: "Upgraded to v%s",
    step1Fail: "Failed to install globally. Run manually: npm install -g %s",
    step2: "Install AI skills",
    step2Skip: "Already installed. Skipped",
    step2Spinner: "Installing skills...",
    step2Done: "Skills installed",
    step2FailNpx: "npx skills add failed, falling back to local skills sync...",
    step2FailAll: "Failed to install skills. Run manually: rxcli skills sync",
    step3: "Registering...",
    step3Skip: "Already registered. Skipped",
    step3Done: "Registered",
    step3Fail: "Failed to register. Run manually: rxcli auth register",
    step4: "Authorization",
    step4NotFound: "rxcli not found. Skipping authorization",
    step4Confirm: "Allow the CLI to access company APIs on your behalf?",
    step4Skip: "Skipped. Run rxcli auth login to authorize later",
    step4Done: "Authorization complete",
    step4Fail: "Failed to authorize. Run rxcli auth login to retry",
    done: 'All set!\nNow try asking your AI tool: "What can rxcli help me with?"',
    cancelled: "Installation cancelled",
    nonTtyHint:
      "Non-interactive: CLI and skills installed. Run in a terminal:\n  rxcli auth register\n  rxcli auth login",
  },
};

// ---------------------------------------------------------------------------
// Helpers(对齐 v1,导出供测试)
// ---------------------------------------------------------------------------

/** fmt("a %s b %s", x, y) → "a x b y"。占位符多于实参时填空串。 */
export function fmt(template: string, ...values: (string | undefined)[]): string {
  let i = 0;
  return template.replace(/%s/g, () => values[i++] ?? "");
}

/** 朴素三段整数比较(去 prerelease tag)。不用 semver 库,避免额外依赖。 */
export function semverLessThan(a: string, b: string): boolean {
  const pa = a.replace(/-.*$/, "").split(".").map(Number);
  const pb = b.replace(/-.*$/, "").split(".").map(Number);
  // 任一输入不是数字版本(如 npm 解析失败的 "unknown"/"abc")→ 无法判定为更小,返回 false。
  // 避免 Number("unknown")=NaN 经 ?? 0 后被误判(原 bug:NaN 段被跳过,后续段 0<N 误返回 true)。
  if (pa.some((n) => Number.isNaN(n)) || pb.some((n) => Number.isNaN(n))) return false;
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

/** 从 process.argv 解析 --lang / --lang=xxx,返回 "zh"/"en" 或 null。 */
export function parseLangArg(): "zh" | "en" | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lang" && args[i + 1]) {
      const val = args[i + 1]!.toLowerCase();
      if (val === "zh" || val === "en") return val;
    }
    if (args[i]!.startsWith("--lang=")) {
      const val = args[i]!.split("=")[1]!.toLowerCase();
      if (val === "zh" || val === "en") return val;
    }
  }
  return null;
}

/** 用户取消向导的哨兵(替代 process.exit,交调用方决定如何收尾)。 */
class WizardCancelled {
  constructor(readonly exitCode = 0) {}
}

function handleCancel<T>(value: T, msg: Messages): T | WizardCancelled {
  if (p.isCancel(value)) {
    p.cancel(msg.cancelled);
    return new WizardCancelled();
  }
  return value;
}

/** Windows 上把 cmd args 包成 cmd.exe /c,保证能找到 npm 装出的 .cmd shim。 */
function execCmd(cmd: string, args: string[], opts?: ExecFileSyncOptions): Buffer {
  if (isWindows) {
    return execFileSync("cmd.exe", ["/c", cmd, ...args], opts) as Buffer;
  }
  return execFileSync(cmd, args, opts) as Buffer;
}

function run(cmd: string, args: string[], opts: ExecFileSyncOptions = {}): void {
  execCmd(cmd, args, { stdio: "inherit", ...opts });
}

function runSilent(cmd: string, args: string[], opts: ExecFileSyncOptions = {}): Buffer {
  return execCmd(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
}

/** 异步版,配合 clack spinner:spinner 在转,命令在后台跑,完成后 stop。 */
function runSilentAsync(
  cmd: string,
  args: string[],
  opts: ExecFileSyncOptions = {},
): Promise<Buffer> {
  const actualCmd = isWindows ? "cmd.exe" : cmd;
  const actualArgs = isWindows ? ["/c", cmd, ...args] : args;
  return new Promise((resolve, reject) => {
    execFile(
      actualCmd,
      actualArgs,
      { stdio: ["ignore", "pipe", "pipe"], ...opts },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout as Buffer);
      },
    );
  });
}

/** 找全局 rxcli 路径(npx 跑的是临时副本,这里要找真正全局装的那份)。 */
function whichBin(binName: string): string | null {
  try {
    const prefix = execFileSync("npm", ["prefix", "-g"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    const bin = isWindows ? join(prefix, `${binName}.cmd`) : join(prefix, "bin", binName);
    if (existsSync(bin)) return bin;
  } catch {
    // fall through
  }
  try {
    const cmd = isWindows ? "where" : "which";
    return execFileSync(cmd, [binName], { stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .split("\n")[0]!
      .trim();
  } catch {
    return null;
  }
}

function getLatestVersion(pkgName: string): string | null {
  try {
    const out = runSilent("npm", ["view", pkgName, "version"], { timeout: 15000 });
    const ver = out.toString().trim();
    return /^\d+\.\d+\.\d+/.test(ver) ? ver : null;
  } catch {
    return null;
  }
}

function getGloballyInstalledVersion(pkgName: string): string | null {
  try {
    const out = runSilent("npm", ["list", "-g", pkgName], { timeout: 15000 });
    const match = out.toString().match(/@(\d+\.\d+\.\d+[^\s]*)/);
    return match ? match[1]! : "unknown";
  } catch {
    return null;
  }
}

/**
 * 检测是否已注册:读 ~/.rxcli/config.json 的 clientId(v2 register 落盘于此)。
 * v1 跑 `rxcli env` 判定;v2 无 env 命令,直接读 config.json。
 */
async function hasRegistered(): Promise<boolean> {
  try {
    const store = fileStore({ dir: join(homedir(), ".rxcli") });
    const config = (await store.loadConfig()) as { clientId?: string };
    return !!config.clientId;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepSelectLang(): Promise<"zh" | "en" | WizardCancelled> {
  const fromArg = parseLangArg();
  if (fromArg) return fromArg;

  const lang = await p.select({
    message: "请选择语言 / Select language",
    options: [
      { value: "zh" as const, label: "中文" },
      { value: "en" as const, label: "English" },
    ],
  });
  return handleCancel(lang as "zh" | "en", messages.zh);
}

async function stepInstallGlobally(msg: Messages, pkgName: string): Promise<number | void> {
  const installedVer = getGloballyInstalledVersion(pkgName);
  const latestVer = getLatestVersion(pkgName);
  const needsUpgrade =
    !!installedVer &&
    !!latestVer &&
    installedVer !== "unknown" &&
    semverLessThan(installedVer, latestVer);

  if (installedVer && !needsUpgrade) {
    p.log.info(fmt(msg.step1Skip, installedVer));
    return;
  }

  const s = p.spinner();
  if (needsUpgrade) {
    s.start(fmt(msg.step1Upgrade, pkgName, installedVer ?? "?", latestVer ?? "?"));
  } else {
    s.start(fmt(msg.step1, pkgName));
  }
  try {
    await runSilentAsync("npm", ["install", "-g", pkgName], { timeout: 120000 });
    s.stop(needsUpgrade ? fmt(msg.step1Upgraded, latestVer ?? "") : msg.step1Done);
  } catch {
    s.stop(fmt(msg.step1Fail, pkgName));
    return 1;
  }
}

/**
 * 安装 skills。skillsSource 决定路径:
 *   - 空/未设 → 本地 rxcli skills sync(用包内 skills/,不跑 npx)
 *   - 设了 → npx skills add <url> 主路径,失败回退本地 sync
 */
async function stepInstallSkills(
  msg: Messages,
  opts: { skillsSource?: string; binName: string },
): Promise<number | void> {
  const s = p.spinner();
  s.start(msg.step2Spinner);
  try {
    // skillsSource 设了:主路径 npx skills add(覆盖 30+ AI 工具发现路径)
    if (opts.skillsSource) {
      try {
        await runSilentAsync("npx", ["-y", "skills", "add", opts.skillsSource, "-y", "-g"], {
          timeout: 120000,
        });
        s.stop(msg.step2Done);
        return;
      } catch {
        s.message(msg.step2FailNpx);
      }
    }
    // 回退/默认路径:本地 rxcli skills sync(只写 ~/.agents/skills/,用包内 skills/)
    const rxcli = whichBin(opts.binName);
    if (rxcli) {
      await runSilentAsync(rxcli, ["skills", "sync"], { timeout: 60000 });
      s.stop(msg.step2Done);
      return;
    }
    throw new Error(
      `${opts.binName} not found and ${opts.skillsSource ? "npx skills add failed" : "no skillsSource"}`,
    );
  } catch {
    s.stop(msg.step2FailAll);
    return 1;
  }
}

async function stepRegister(msg: Messages, binName: string): Promise<number | void> {
  if (await hasRegistered()) {
    p.log.info(msg.step3Skip);
    return;
  }
  const s = p.spinner();
  s.start(msg.step3);
  const rxcli = whichBin(binName);
  if (!rxcli) {
    s.stop(msg.step3Fail);
    return 1;
  }
  s.stop(msg.step3);
  try {
    // register 是交互式(输令牌),必须 inherit stdio
    run(rxcli, ["auth", "register"]);
    p.log.success(msg.step3Done);
  } catch {
    p.log.error(msg.step3Fail);
    return 1;
  }
}

async function stepAuthLogin(msg: Messages, binName: string): Promise<number | void> {
  const rxcli = whichBin(binName);
  if (!rxcli) {
    p.log.warn(msg.step4NotFound);
    return;
  }

  const yes = await p.confirm({ message: msg.step4Confirm });
  if (p.isCancel(yes)) {
    p.cancel(msg.cancelled);
    return 0;
  }
  if (!yes) {
    p.log.info(msg.step4Skip);
    return;
  }

  p.log.step(msg.step4);
  try {
    // auth login 是 device flow 阻塞流程,inherit stdio
    run(rxcli, ["auth", "login"]);
    p.log.success(msg.step4Done);
  } catch {
    // 授权失败不阻断整体安装:前三步已就绪,授权可事后补
    p.log.warn(msg.step4Fail);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface InstallWizardOptions {
  /** skills 源 URL。设了 → npx skills add;空 → 本地 skills sync。 */
  skillsSource?: string;
  /** 显式指定 bin 名;不传则用 detectBizPackage 探测。 */
  binName?: string;
  /** 显式指定业务包名;不传则用 detectBizPackage 探测。 */
  pkgName?: string;
}

/**
 * 运行 install 向导。业务包入口拦截 `install` 命令后调本函数。
 *
 * 不自行 `process.exit`(对齐框架契约:交调用方决定进程退出)。
 * 返回 exit code:0 = 成功,非 0 = 某步失败/取消。
 *
 * ```ts
 * if (argv[0] === 'install') {
 *   const { runInstallWizard } = await import('@renxqoo/agent-data-cli')
 *   const code = await runInstallWizard({ skillsSource: process.env.RXCLI_SKILLS_SOURCE })
 *   process.exit(code)
 * }
 * ```
 *
 * @returns exit code(0=成功;非 0=某步失败/取消)
 */
export async function runInstallWizard(opts: InstallWizardOptions = {}): Promise<number> {
  p = await import("@clack/prompts");

  // 探测业务包信息(name/bin/version),允许 opts 覆盖
  const detected = detectBizPackage();
  const pkgName = opts.pkgName ?? detected?.name ?? "";
  const binName = opts.binName ?? detected?.bin ?? "rxcli";

  const isInteractive = !!process.stdin.isTTY;
  const lang = isInteractive ? await stepSelectLang() : (parseLangArg() ?? "en");
  if (lang instanceof WizardCancelled) return lang.exitCode;
  const msg = messages[lang];

  if (isInteractive) {
    p.intro(msg.setup);
    if (pkgName) {
      const code = await stepInstallGlobally(msg, pkgName);
      if (code !== undefined) return code;
    }
    {
      const code = await stepInstallSkills(msg, { skillsSource: opts.skillsSource, binName });
      if (code !== undefined) return code;
    }
    {
      const code = await stepRegister(msg, binName);
      if (code !== undefined) return code;
    }
    await stepAuthLogin(msg, binName);
    p.outro(msg.done);
  } else {
    console.log(msg.setup);
    if (pkgName) {
      const code = await stepInstallGlobally(msg, pkgName);
      if (code !== undefined) return code;
    }
    {
      const code = await stepInstallSkills(msg, { skillsSource: opts.skillsSource, binName });
      if (code !== undefined) return code;
    }
    console.log(msg.nonTtyHint);
  }
  return 0;
}
