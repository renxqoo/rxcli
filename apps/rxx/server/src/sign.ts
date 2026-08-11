/**
 * rxx-server —— Ed25519 签名工具
 *
 * 服务器启动时(首次)生成 Ed25519 密钥对,持久化到 keys/ 目录。
 * 每次返回 manifest 时,用私钥现场签名。
 *
 * 签名机制与 rxx 客户端验证器对齐:
 *   - 算法:Ed25519
 *   - 签名内容:sha256(sortedHosts.join("|") + "\n" + canonicalJSON(stripSignature(manifest)))
 *   - host 绑定:api.baseUrl + auth.baseUrl 的 host 进签名内容
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = join(__dirname, "..", "keys");

const PRIVATE_KEY_PATH = join(KEYS_DIR, "ed25519-private.pem");
const PUBLIC_KEY_PATH = join(KEYS_DIR, "ed25519-public.pem");
const PUBLIC_KEY_B64_PATH = join(KEYS_DIR, "ed25519-public.b64");

export interface KeyMaterial {
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyBase64: string;
  fingerprint: string;
}

/** 加载或生成 Ed25519 密钥对(首次启动时生成并持久化)。 */
export function loadOrCreateKeys(): KeyMaterial {
  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
    const privateKeyPem = readFileSync(PRIVATE_KEY_PATH, "utf8");
    const publicKeyPem = readFileSync(PUBLIC_KEY_PATH, "utf8");
    const publicKeyBase64 = readFileSync(PUBLIC_KEY_B64_PATH, "utf8").trim();
    return { privateKeyPem, publicKeyPem, publicKeyBase64, fingerprint: fp(publicKeyPem) };
  }

  mkdirSync(KEYS_DIR, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  writeFileSync(PRIVATE_KEY_PATH, privateKeyPem, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_PATH, publicKeyPem);
  writeFileSync(PUBLIC_KEY_B64_PATH, publicKeyBase64);

  return { privateKeyPem, publicKeyPem, publicKeyBase64, fingerprint: fp(publicKeyPem) };
}

/** Ed25519 签名,返回 base64。declaredHosts 显式传入(与客户端对齐)。 */
export function signManifest(
  manifest: Record<string, unknown>,
  privateKeyPem: string,
  declaredHosts: string[] = [],
): string {
  const privateKey = createPrivateKey(privateKeyPem);
  return sign(null, signingInput(manifest, declaredHosts), privateKey).toString("base64");
}

/** 计算 manifest 的签名内容(与客户端 validator.signingInput 对齐)。
 * C10/C11 同步:actualHosts + declaredHosts + canonicalize(用 getOwnPropertyNames) */
function signingInput(manifest: Record<string, unknown>, declaredHosts: string[] = []): Buffer {
  const actualHosts = extractHosts(manifest).sort();
  const sortedDeclared = declaredHosts.slice().sort();
  const body = canonicalize(stripSignature(manifest));
  return createHash("sha256")
    .update(actualHosts.join("|") + "\n" + sortedDeclared.join("|") + "\n" + body)
    .digest();
}

/** 提取 manifest 的 host 列表(api + auth)。 */
function extractHosts(m: Record<string, unknown>): string[] {
  const hosts: string[] = [];
  const api = m.api as { baseUrl?: string } | undefined;
  const auth = m.auth as { baseUrl?: string } | undefined;
  if (api?.baseUrl) {
    const h = hostOf(api.baseUrl);
    if (h) hosts.push(h);
  }
  if (auth?.baseUrl) {
    const h = hostOf(auth.baseUrl);
    if (h) hosts.push(h);
  }
  return [...new Set(hosts)];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** 去掉 signature 段。 */
function stripSignature(m: Record<string, unknown>): Record<string, unknown> {
  const { signature: _, ...rest } = m;
  return rest;
}

/** 规范化 JSON 序列化(键排序)。C11 同步:getOwnPropertyNames + 拒绝 __proto__。 */
function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(",")}]`;
  const names = Object.getOwnPropertyNames(obj).filter(
    (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype",
  );
  names.sort();
  return `{${names.map((k) => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`).join(",")}}`;
}

/** 公钥指纹(sha256:hex)。 */
function fp(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return "sha256:" + createHash("sha256").update(der).digest("hex");
}
