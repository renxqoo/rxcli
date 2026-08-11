/**
 * rxx —— 安装/更新共享流程
 *
 * 抽离自 init.ts,让 init 和 update 共用同一套"拉取→确认→缓存→skill→shim"逻辑。
 * 解决:
 *   - O4:update 不再跳过信任确认(scope/写操作数展示)
 *   - C5:只拉取一次 manifest,确认信息和实际安装内容一致(无双 fetch race)
 *   - C7:公钥指纹变更时高亮提示
 *   - 事务化:任一步失败 → 补偿清理已写产物,目标位置无残留
 *   - 非 TTY 无 --auto-confirm → 抛 ConfirmationRequiredError(非 success envelope)
 */

import { errs, type CliError, type CommandResult } from "@renxqoo/agent-data-cli";
import type { FetchResult } from "./manifest/loader.js";
import { writeService, readService, removeService } from "./registry.js";
import { generateAndSyncSkill, countCommands, collectHosts, removeSkill } from "./skill-gen.js";
import { writeShim, ensureInPath, removeShim } from "./shim.js";
import { getRxBinDir } from "./config.js";
import type { Manifest } from "./manifest/schema.js";
import type { GenLang } from "@renxqoo/agent-data-cli";

export interface InstallFlowOptions {
  /** 跳过确认(非交互)。 */
  yes?: boolean;
  /** skill 文档语言(en/zh)。 */
  lang?: GenLang;
  /** 更新场景:传入已装服务的旧指纹,变更时高亮。 */
  previousKeyFingerprint?: string;
}

/** 安装流程错误(携带已执行的补偿清理结果,便于诊断)。 */
export class InstallFlowError extends Error {
  readonly cleanup?: { cleaned: string[]; failed: string[] };
  constructor(message: string, cleanup?: { cleaned: string[]; failed: string[] }) {
    super(message);
    this.name = "InstallFlowError";
    this.cleanup = cleanup;
  }
}

/**
 * 执行安装/更新:确认 → 缓存 → skill → shim → PATH。
 *
 * 事务语义(补偿动作):
 *   - 按顺序执行 writeService → generateAndSyncSkill → writeShim
 *   - 任一步抛错 → catch → 逆序清理本次已写产物(removeShim → removeSkill → removeService)
 *   - 单文件写入用 atomicWrite(已实现),保证单步原子
 *   - 失败时重新抛出原错误(包装为 InstallFlowError 附带清理报告)
 *
 * 调用方(init/update)负责拉取 manifest(含 pinning key),这里只做"装"。
 */
export async function installFlow(
  fetched: FetchResult,
  opts: InstallFlowOptions = {},
): Promise<CommandResult> {
  const { manifest, sourceUrl, signatureVerified, publicKeyPem, keyFingerprint, unsigned } =
    fetched;

  // —— 信任确认(展示 host/scope/写操作数/签名状态/指纹变更)——
  const stats = countCommands(manifest);
  const hosts = collectHosts(manifest);
  const info = buildInfoLines(
    manifest,
    sourceUrl,
    stats,
    hosts,
    unsigned,
    signatureVerified,
    keyFingerprint,
  );

  // 指纹变更检测(C7)
  let keyChanged = false;
  if (
    opts.previousKeyFingerprint &&
    keyFingerprint &&
    opts.previousKeyFingerprint !== keyFingerprint
  ) {
    keyChanged = true;
    info.push(`⚠️  KEY CHANGED: ${opts.previousKeyFingerprint} → ${keyFingerprint}`);
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      // 非 TTY 无 --auto-confirm → 抛 ConfirmationRequiredError(非 success envelope)
      // agent 可按 subtype:"high_risk_write"(exit 10)匹配,而非误读 installed:false
      throw new errs.ConfirmationRequiredError({
        subtype: "high_risk_write",
        message: `Install of "${manifest.name}" requires confirmation in non-interactive mode.`,
        hint: `Re-run with --auto-confirm to skip confirmation. Review the install details:\n${info.join("\n")}`,
      });
    }
    process.stderr.write("\n⚠️  Confirm install:\n" + info.join("\n") + "\n\nInstall? [y/N] ");
    const answer = await readLine();
    if (!/^\s*y(es)?\s*$/i.test(answer)) {
      return { data: { installed: false, manifest: manifest.name, reason: "user declined" } };
    }
  } else {
    process.stderr.write(info.join("\n") + "\n");
  }

  // —— 事务:顺序写 + 补偿清理 ——
  // 记录是否已执行各步,失败时逆序清理
  let didWriteService = false;
  let didGenSkill = false;
  let didWriteShim = false;
  try {
    writeService({
      manifest,
      sourceUrl,
      signatureVerified,
      publicKey: publicKeyPem,
      keyFingerprint,
    });
    didWriteService = true;

    const skillResult = generateAndSyncSkill(manifest, opts.lang ?? "en");
    didGenSkill = true;

    writeShim(manifest.name);
    didWriteShim = true;

    // —— PATH(独立,失败只警告,不回滚核心安装)——
    let rcWritten: string | null = null;
    try {
      rcWritten = ensureInPath();
    } catch (e) {
      process.stderr.write(`warning: failed to update PATH: ${(e as Error).message}\n`);
    }

    return {
      data: {
        installed: true,
        name: manifest.name,
        version: manifest.version,
        commands: stats.total,
        skillSynced: skillResult.sync.targets.filter((t) => t.ok).length,
        skillFailed: skillResult.sync.targets.filter((t) => !t.ok && !t.skipped).length,
        bin: `${getRxBinDir()}/${manifest.name}`,
        pathAction: rcWritten
          ? `added to ${rcWritten} (run: source ${rcWritten})`
          : "already in PATH",
        keyChanged,
      },
    };
  } catch (err) {
    // 补偿清理:逆序 remove 本次已写的产物
    const cleanup = { cleaned: [] as string[], failed: [] as string[] };
    if (didWriteShim) {
      try {
        removeShim(manifest.name);
        cleanup.cleaned.push("shim");
      } catch {
        cleanup.failed.push("shim");
      }
    }
    if (didGenSkill) {
      try {
        removeSkill(manifest.name);
        cleanup.cleaned.push("skill");
      } catch {
        cleanup.failed.push("skill");
      }
    }
    if (didWriteService) {
      try {
        removeService(manifest.name);
        cleanup.cleaned.push("registry");
      } catch {
        cleanup.failed.push("registry");
      }
    }
    process.stderr.write(
      `install aborted after failure, cleaned up: ${cleanup.cleaned.join(", ") || "none"}\n`,
    );
    throw new InstallFlowError(
      `Install of "${manifest.name}" failed: ${(err as Error).message}`,
      cleanup,
    );
  }
}

function buildInfoLines(
  manifest: Manifest,
  sourceUrl: string,
  stats: { total: number; write: number },
  hosts: { api?: string; auth?: string },
  unsigned: boolean,
  signatureVerified: boolean,
  keyFingerprint?: string,
): string[] {
  const lines: string[] = [];
  lines.push(`name:    ${manifest.name}`);
  lines.push(`version: ${manifest.version}`);
  lines.push(`source:  ${sourceUrl}`);
  if (hosts.api) lines.push(`api:     ${hosts.api}`);
  if (hosts.auth) lines.push(`auth:    ${hosts.auth}`);
  if (manifest.auth?.scope) lines.push(`scope:   ${manifest.auth.scope}`);
  lines.push(`commands: ${stats.total} (${stats.write} write)`);
  lines.push(
    `signature: ${unsigned ? "⚠️  UNSIGNED" : signatureVerified ? "✅ verified" : "❌ failed"}`,
  );
  if (keyFingerprint) lines.push(`key-fp:  ${keyFingerprint}`);
  return lines;
}

/** 从 stdin 读一行(交互确认用)。带超时和 EOF 处理,防挂死。 */
function readLine(timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("confirmation timed out"));
    }, timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      cleanup();
      resolve(String(chunk));
    };
    const onEnd = (): void => {
      cleanup();
      resolve("");
    };
    const onError = (e: Error): void => {
      cleanup();
      reject(e);
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      stdin.pause();
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
    };
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.once("data", onData);
    stdin.once("end", onEnd);
    stdin.once("error", onError);
  });
}
