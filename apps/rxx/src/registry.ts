/**
 * rxx —— 本地注册表:已装动态服务的读写
 *
 * ~/.rxx/registry/<name>/ 结构:
 *   manifest.json   服务端下发的 manifest(原样缓存)
 *   pubkey.pem      publisher 公钥(pinning,首次拉取后固定)
 *   meta.json       安装元信息
 *
 * 原子写:临时文件 + rename,防并发写坏 JSON。
 */

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getRxRegistryDir } from "./config.js";
import type { Manifest } from "./manifest/schema.js";
import { assertSafeServiceName, isSafeServiceName } from "./security.js";

/**
 * 校验 service name 合法。
 *
 * SERVICE_NAME_RE(/^[a-z][a-z0-9-]{1,63}$/)已禁止所有能逃逸 registry 目录的字符
 *(`/` `\` `.` `..` 等),所以 assertSafeServiceName 是路径穿越的充分防御。
 * 历史上的 resolve+startsWith 双保险是对正则不信任的遗留,SERVICE_NAME_RE 严格
 * 到无法绕过,该双保险不可达,已删除。
 */
function assertSafeName(name: string): void {
  assertSafeServiceName(name);
}

/** 单个已装服务的元信息。 */
export interface InstalledService {
  name: string;
  version: string;
  /** 拉取来源 URL。 */
  sourceUrl: string;
  /** manifest body 的 sha256。 */
  sha256: string;
  /** 拉取时间(ISO)。 */
  fetchedAt: string;
  /** 签名是否验证通过。 */
  signatureVerified: boolean;
  /** publisher 公钥(PEM 或 base64,pinning 用)。 */
  publicKey?: string;
  /** 公钥指纹(sha256)。 */
  keyFingerprint?: string;
}

/** 已装服务的完整内容(manifest + meta)。 */
export interface InstalledServiceFull extends InstalledService {
  manifest: Manifest;
}

// ============================================================================
// 路径辅助
// ============================================================================

function serviceDir(name: string): string {
  assertSafeName(name); // 防 ../../.. 等路径穿越
  return join(getRxRegistryDir(), name);
}

function manifestPath(name: string): string {
  return join(serviceDir(name), "manifest.json");
}

function metaPath(name: string): string {
  return join(serviceDir(name), "meta.json");
}

function pubkeyPath(name: string): string {
  return join(serviceDir(name), "pubkey.pem");
}

// ============================================================================
// 原子写
// ============================================================================

/**
 * 原子写文本:先写临时文件(随机后缀防并发冲突),fsync 持久化,rename 覆盖。
 *
 * fsync 在 rename 前:确保临时文件的脏页落盘,防 crash 后 rename 指向零字节文件。
 * rename 在同 filesystem 内原子(PPOSIX 保证)。
 */
function atomicWriteText(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const rand = randomBytes(6).toString("hex");
  const tmp = `${filePath}.tmp.${process.pid}.${rand}`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, "w");
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, filePath);
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* 忽略 */
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* tmp 可能已 rename,忽略 */
    }
    throw err;
  }
}

/** 原子写 JSON(atomicWriteText 的便捷封装)。 */
function atomicWriteJson(filePath: string, data: unknown): void {
  atomicWriteText(filePath, JSON.stringify(data, null, 2));
}

// ============================================================================
// 公开 API
// ============================================================================

/** 某服务是否已装。 */
export function isInstalled(name: string): boolean {
  return existsSync(manifestPath(name));
}

/** 读已装服务的 manifest。未装返回 null。 */
export function readManifest(name: string): Manifest | null {
  const p = manifestPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

/** 读已装服务的元信息。未装返回 null。 */
export function readMeta(name: string): InstalledService | null {
  const p = metaPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as InstalledService;
  } catch {
    return null;
  }
}

/** 读已装服务的完整内容。未装返回 null。 */
export function readService(name: string): InstalledServiceFull | null {
  // 纵深防御:非法 name(如遗留的非服务子目录)直接返回 null,不抛
  // (listInstalled 已预过滤,但 readService 也独立健壮)
  if (!isSafeServiceName(name)) return null;
  const manifest = readManifest(name);
  const meta = readMeta(name);
  if (!manifest || !meta) return null;
  return { ...meta, manifest };
}

/** 读已装服务的 publisher 公钥(pinning)。 */
export function readPublicKey(name: string): string | null {
  const p = pubkeyPath(name);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * 安装/更新一个服务:写 manifest + meta + pubkey(原子写)。
 *
 * @param manifest 服务端下发的 manifest
 * @param sourceUrl 拉取来源
 * @param signatureVerified 签名是否验证通过
 * @param publicKey publisher 公钥(pinning)
 * @param keyFingerprint 公钥指纹
 */
export function writeService(args: {
  manifest: Manifest;
  sourceUrl: string;
  signatureVerified: boolean;
  publicKey?: string;
  keyFingerprint?: string;
}): InstalledService {
  const { manifest, sourceUrl, signatureVerified, publicKey, keyFingerprint } = args;
  const body = JSON.stringify(manifest);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const meta: InstalledService = {
    name: manifest.name,
    version: manifest.version,
    sourceUrl,
    sha256,
    fetchedAt: new Date().toISOString(),
    signatureVerified,
    publicKey,
    keyFingerprint,
  };
  atomicWriteJson(manifestPath(manifest.name), manifest);
  atomicWriteJson(metaPath(manifest.name), meta);
  if (publicKey) atomicWriteText(pubkeyPath(manifest.name), publicKey);
  return meta;
}

/** 移除一个已装服务(删整个目录)。未装返回 false。 */
export function removeService(name: string): boolean {
  const dir = serviceDir(name);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** 列出所有已装服务。 */
export function listInstalled(): InstalledServiceFull[] {
  const registryDir = getRxRegistryDir();
  if (!existsSync(registryDir)) return [];
  const out: InstalledServiceFull[] = [];
  for (const entry of readdirSync(registryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // 预过滤:跳过不符合服务命名规则的子目录(如 .cache/trusted-keys/备份等),
    // 避免 readService 内 assertSafeName 抛错导致 rxx list 崩溃
    if (!isSafeServiceName(entry.name)) continue;
    const svc = readService(entry.name);
    if (svc) out.push(svc);
  }
  return out;
}
