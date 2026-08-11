/**
 * rxx —— `rxx init <url>`:拉取 manifest + 验签 + 安装
 *
 * 流程:
 *   1. 若已装有同名服务,先读 pinning 公钥(C5:前置,避免双 fetch)
 *   2. fetchManifest(用 pinning key 验签,或首次 TOFU)
 *   3. installFlow(确认 → 缓存 → skill → shim → PATH)
 *
 * 安装/确认逻辑在 install-flow.ts,与 update 共用(O4)。
 */

import { defineCommand, errs } from "@renxqoo/agent-data-cli";
import { fetchManifest, type FetchOptions, LoaderError } from "../manifest/loader.js";
import { isInstalled, readPublicKey, readService } from "../registry.js";
import { installFlow } from "../install-flow.js";
import { rxxError } from "../errors.js";

export interface InitArgs {
  url: string;
  insecure?: boolean;
  "private-endpoints"?: boolean;
  unsigned?: boolean;
  yes?: boolean;
  lang?: "en" | "zh";
}

export const initCommand = defineCommand<InitArgs>({
  name: "init",
  description:
    "Install a dynamic service from a manifest URL (manifest → CLI + skill + distribution)",
  args: {
    url: { type: "string", required: true, positional: true, desc: "manifest URL (https://...)" },
    insecure: { type: "boolean", desc: "allow HTTP (local dev)" },
    "private-endpoints": { type: "boolean", desc: "allow internal endpoints (local dev)" },
    unsigned: { type: "boolean", desc: "allow unsigned manifest (WARNING: untrusted)" },
    yes: { type: "boolean", desc: "skip confirmation (non-interactive)" },
    lang: { type: "string", desc: "skill document language (en/zh)", default: "en" },
  },
  internal: true,
  async run(args) {
    try {
      // C5 修复:前置读 pinning key,只 fetch 一次
      const existingName = guessNameFromUrl(args.url);
      const existing = existingName ? readService(existingName) : undefined;
      const pinnedKey = existing ? existing.publicKey : undefined;
      const previousFp = existing?.keyFingerprint;

      const opts: FetchOptions = {
        allowInsecure: args.insecure,
        allowPrivateEndpoints: args["private-endpoints"],
        allowUnsigned: args.unsigned,
        trustedPublicKeyPem: pinnedKey, // 有 pinning 就用(更新场景)
      };

      let fetched: Awaited<ReturnType<typeof fetchManifest>>;
      try {
        fetched = await fetchManifest(args.url, opts);
      } catch (err) {
        // TOFU fallback:pinned key 验签失败时,URL 末段碰撞可能是无关服务,
        // 降级到 manifest 自带公钥(首次信任),加警告提示 key 变更。
        if (err instanceof LoaderError && err.subtype === "signature_failed" && pinnedKey) {
          process.stderr.write(
            `⚠️  Pinned key verification failed for "${existingName}". ` +
              `Falling back to manifest's built-in public key (TOFU). ` +
              `Verify the new key fingerprint before trusting.\n`,
          );
          fetched = await fetchManifest(args.url, { ...opts, trustedPublicKeyPem: undefined });
        } else {
          throw err;
        }
      }

      // installFlow 复用(O4):确认 → 缓存 → skill → shim
      return await installFlow(fetched, {
        yes: args.yes,
        lang: args.lang === "zh" ? "zh" : "en",
        previousKeyFingerprint: previousFp,
      });
    } catch (err) {
      throw rxxError(err);
    }
  },
});

/**
 * 从 manifest URL 猜测服务名(URL 末段)。
 * 用于判断"是否已装→读 pinning key"。猜不中无妨(返回 undefined 走首次 TOFU)。
 *
 * 规则:
 *   - strip 常见 manifest 后缀(.json/.yaml/.json5)
 *   - 末段为通用名(如 "manifest")不猜(避免碰撞阻断无关服务)
 *   - 猜测名不符合服务命名规则(大写/特殊字符)不猜
 */
export function guessNameFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (!seg) return undefined;
    // strip 常见 manifest 文件后缀
    const name = seg.replace(/\.(json|ya?ml|json5)$/i, "");
    // 通用名不猜(碰撞风险高)
    if (name === "manifest" || name === "index" || name === "latest") return undefined;
    // 不符合服务命名规则的也不猜(SERVICE_NAME_RE 在 security.ts)
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(name)) return undefined;
    return name;
  } catch {
    return undefined;
  }
}
