/**
 * rxx —— manifest 加载器:拉取 / 缓存读取 / 验签
 *
 * 两个入口:
 *   - loadManifest(name):读本地缓存(~/.rxx/registry/<name>/manifest.json),供 rx run 用
 *   - fetchManifest(url, opts):从远程拉取,校验+验签,供 rx init/update 用
 *
 * 安全:
 *   - HTTPS 强制(--allow-insecure 例外)
 *   - Ed25519 验签(TOFU:首次拉公钥 + 指纹展示 + pinning)
 *   - SSRF 防护(validate.ts → security.ts isPrivateHost)
 *   - host 绑定签名(改 host 验签失败)
 */

import type { Manifest } from "./schema.js";
import { verifyManifest, keyFingerprint, base64ToPem } from "./sign.js";
import { validate, type ManifestIssue } from "./validate.js";
import { readManifest } from "../registry.js";
import { RXX_VERSION } from "../config.js";
import { isPrivateHost, assertSafeHost, type SafeHostOptions } from "../security.js";

// ============================================================================
// 读缓存(rx run 用)
// ============================================================================

/**
 * 从本地缓存加载已装服务的 manifest。
 * 未装抛错(让上层给"未安装,先 rx init"提示)。
 */
export function loadManifest(name: string): Manifest {
  const m = readManifest(name);
  if (!m) {
    throw new LoaderError(
      `Service "${name}" is not installed. Run \`rxx init <url>\` first.`,
      "not_installed",
    );
  }
  return m;
}

// ============================================================================
// 远程拉取(rx init/update 用)
// ============================================================================

export interface FetchOptions {
  /** 允许 HTTP(本地开发,默认 false 强制 HTTPS)。 */
  allowInsecure?: boolean;
  /** 允许内网 endpoint(本地开发)。 */
  allowPrivateEndpoints?: boolean;
  /** 跳过签名验证(未签名也允许,默认 false)。 */
  allowUnsigned?: boolean;
  /** 已 pinning 的公钥 PEM(更新时用本地缓存的)。 */
  trustedPublicKeyPem?: string;
  /** fetch 实现(测试注入;默认用全局 fetch)。 */
  fetchImpl?: typeof fetch;
  /** DNS lookup 注入(测试 DNS rebinding 场景)。 */
  lookup?: SafeHostOptions["lookup"];
  /** fetch 超时(ms,默认 30000)。 */
  fetchTimeoutMs?: number;
  /** 最大 body 字节数(默认 1MB)。 */
  maxBodyBytes?: number;
}

export interface FetchResult {
  manifest: Manifest;
  sourceUrl: string;
  signatureVerified: boolean;
  /** 用的公钥 PEM(pinning 缓存)。 */
  publicKeyPem?: string;
  /** 公钥指纹。 */
  keyFingerprint?: string;
  /** 是否无签名。 */
  unsigned: boolean;
}

/**
 * 从 URL 拉取 manifest,校验 + 验签。
 * 失败抛 LoaderError。返回 FetchResult 供上层展示 + 缓存。
 */
export async function fetchManifest(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const url = rawUrl.trim();
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? 30_000;
  const maxBodyBytes = opts.maxBodyBytes ?? 1_048_576; // 1MB

  // —— HTTPS + SSRF + DNS rebinding 校验(早校验,不拉取)——
  await preCheckUrl(url, opts);

  const fetchFn = opts.fetchImpl ?? fetch;
  // 手动处理重定向:每跳都校验 SSRF + DNS + HTTPS(C6 防御)
  let currentUrl = url;
  let res: Response;
  const MAX_REDIRECTS = 5;
  for (let hop = 0; ; hop++) {
    // 每跳 fetch 超时(AbortController,防恶意服务器挂连接 DoS)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      res = await fetchFn(currentUrl, {
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new LoaderError(
          `Manifest fetch from ${currentUrl} timed out after ${fetchTimeoutMs}ms`,
          "fetch_timeout",
        );
      }
      throw new LoaderError(
        `Failed to fetch manifest from ${currentUrl}: ${(err as Error).message}`,
        "network",
      );
    } finally {
      clearTimeout(timer);
    }
    // 3xx 重定向:手动跟随,每跳校验
    if (res.status >= 300 && res.status < 400) {
      if (hop >= MAX_REDIRECTS) {
        throw new LoaderError(`Manifest URL exceeded ${MAX_REDIRECTS} redirects`, "network");
      }
      const location = res.headers.get("location");
      if (!location) {
        throw new LoaderError(
          `Redirect ${res.status} without Location header`,
          "http_error",
          undefined,
          res.status,
        );
      }
      const nextUrl = new URL(location, currentUrl).href;
      // 每跳都要校验 SSRF + DNS + HTTPS(防重定向到内网/降级/rebinding)
      await preCheckUrl(nextUrl, opts);
      currentUrl = nextUrl;
      continue;
    }
    break;
  }
  if (!res.ok) {
    throw new LoaderError(
      `Manifest endpoint returned ${res.status}: ${res.statusText}`,
      "http_error",
      undefined,
      res.status,
    );
  }
  // —— 读 body,累计字节数防恶意服务器流 GB 数据 DoS ——
  const text = await readBodyWithLimit(res, maxBodyBytes, currentUrl);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(text) as Manifest;
  } catch {
    throw new LoaderError(`Manifest at ${currentUrl} is not valid JSON`, "parse_error");
  }

  // —— 合法性校验(高性能 validate,收集所有错误)——
  const result = validate(manifest, {
    allowPrivateEndpoints: opts.allowPrivateEndpoints,
    allowInsecure: opts.allowInsecure,
  });
  if (!result.ok) {
    // 把所有 error 级 issue 汇总成一条消息(让用户一次看到全部问题)
    const errs = result.issues.filter((i) => i.level === "error");
    const lines = errs.map((i, n) => `  ${n + 1}. [${i.field}] ${i.message}`);
    throw new LoaderError(
      `Manifest validation failed with ${errs.length} error(s):\n${lines.join("\n")}`,
      "validation_failed",
      errs,
    );
  }
  // warning 级 issue:stderr 提示但不阻止
  const warnings = result.issues.filter((i) => i.level === "warning");
  for (const w of warnings) {
    process.stderr.write(`warning: [${w.field}] ${w.message}\n`);
  }

  // —— minCliVersion 校验(manifest 要求的最低 rxx 版本)——
  if (manifest.minCliVersion) {
    if (!satisfiesMinVersion(RXX_VERSION, manifest.minCliVersion)) {
      throw new LoaderError(
        `Manifest requires rxx >= ${manifest.minCliVersion}, but current is ${RXX_VERSION}. Please upgrade rxx.`,
        "version_mismatch",
      );
    }
  }

  // —— 验签 ——
  const sig = manifest.signature;
  const unsigned = !sig?.signature || !sig?.publicKey;
  if (unsigned) {
    if (!opts.allowUnsigned) {
      throw new LoaderError(
        `Manifest from ${url} is unsigned. Use --allow-unsigned to accept (WARNING: untrusted).`,
        "unsigned",
      );
    }
    return { manifest, sourceUrl: url, signatureVerified: false, unsigned: true };
  }

  // 验签:优先用 pinning 的公钥,否则用 manifest 自带的
  const pubB64 = sig!.publicKey!;
  const trustedPem = opts.trustedPublicKeyPem ?? base64ToPem(pubB64);
  const ok = verifyManifest(manifest, trustedPem);
  if (!ok) {
    throw new LoaderError(
      `Manifest signature verification FAILED for ${url}. The manifest may have been tampered with, or the signing key changed.`,
      "signature_failed",
    );
  }

  // pinning 的公钥已提供时直接复用,否则从 manifest 的 base64 公钥转 PEM
  const publicKeyPem = opts.trustedPublicKeyPem ?? base64ToPem(pubB64);
  const fp = keyFingerprint(pubB64);

  return {
    manifest,
    sourceUrl: url,
    signatureVerified: true,
    publicKeyPem,
    keyFingerprint: fp,
    unsigned: false,
  };
}

/**
 * URL 预检查:HTTPS 强制 + SSRF(isPrivateHost)+ DNS rebinding(assertSafeHost)。
 *
 * 这是 fetch 前的完整安全校验,三重防御:
 *   1. 协议(HTTPS 强制,--allow-insecure 例外)
 *   2. host 字面量私有检查(isPrivateHost,覆盖 IPv4 各编码 + IPv6 + mapped)
 *   3. DNS 运行时解析校验(assertSafeHost,防 evil.com 解析到 169.254.169.254)
 *
 * async 因为 assertSafeHost 要做 dns.lookup。
 */
async function preCheckUrl(url: string, opts: FetchOptions): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LoaderError(`"${url}" is not a valid URL`, "invalid_url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new LoaderError(`Manifest URL must be http(s): ${url}`, "invalid_url");
  }
  if (parsed.protocol === "http:" && !opts.allowInsecure) {
    throw new LoaderError(
      `Manifest URL must be HTTPS (use --allow-insecure for local dev): ${url}`,
      "insecure",
    );
  }
  // SSRF:host 字面量私有检查(fetch URL 本身,不只是 manifest 内容的 api.baseUrl)
  if (!opts.allowPrivateEndpoints && isPrivateHost(parsed.hostname)) {
    throw new LoaderError(
      `Manifest URL "${url}" points to private/loopback address (SSRF blocked). Use --private-endpoints for local dev.`,
      "insecure",
    );
  }
  // DNS rebinding:解析 hostname,校验解析到的 IP 不私有
  await assertSafeHost(parsed.hostname, {
    allowPrivateEndpoints: opts.allowPrivateEndpoints,
    lookup: opts.lookup,
  });
}

/**
 * 读 response body,累计字节数防恶意服务器流 GB 数据 DoS。
 * 超过 maxBytes 抛 response_too_large。
 */
async function readBodyWithLimit(res: Response, maxBytes: number, url: string): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    // 无 body stream(罕见),退化到 text()
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new LoaderError(`Manifest at ${url} exceeded ${maxBytes} bytes`, "response_too_large");
    }
    return text;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* 忽略 */
        }
        throw new LoaderError(
          `Manifest at ${url} exceeded ${maxBytes} bytes`,
          "response_too_large",
        );
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ============================================================================
// 错误
// ============================================================================

export type LoaderErrorSubtype =
  | "not_installed"
  | "invalid_url"
  | "insecure"
  | "network"
  | "http_error"
  | "parse_error"
  | "unsigned"
  | "signature_failed"
  | "validation_failed"
  | "version_mismatch"
  | "response_too_large"
  | "fetch_timeout";

/**
 * 简化的 semver 比较:current >= required?
 * 只比较 major.minor.patch(忽略预发布)。
 */
function satisfiesMinVersion(current: string, required: string): boolean {
  const parseVer = (v: string): [number, number, number] => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return [0, 0, 0];
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const [ca, cb, cc] = parseVer(current);
  const [ra, rb, rc] = parseVer(required);
  if (ca !== ra) return ca > ra;
  if (cb !== rb) return cb > rb;
  return cc >= rc;
}

export class LoaderError extends Error {
  /** validation_failed 时附带的 issue 列表(供上层提取首个 field 当 param)。 */
  readonly issues?: ManifestIssue[];
  /** http_error 时附带的 HTTP status(供 errors.ts 按 status 映射 subtype)。 */
  readonly status?: number;
  constructor(
    message: string,
    readonly subtype: LoaderErrorSubtype,
    issues?: ManifestIssue[],
    status?: number,
  ) {
    super(message);
    this.name = "LoaderError";
    this.issues = issues;
    this.status = status;
  }
}
