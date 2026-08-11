/**
 * rxx —— manifest 签名信任链(Ed25519)
 *
 * 签名内容 = sha256(actualHosts + declaredHosts + canonicalJSON(body))。
 *   - host 绑定:api/auth 的实际 host 进 hash(改 host → 验签失败)
 *   - declaredHosts(publisher 声明)也进 hash,实际 host 必须是其子集
 *   - canonicalize 用 getOwnPropertyNames + 拒绝 __proto__(防原型链干扰签名)
 *
 * 从原 validator.ts 拆出。validator.ts 已删除,验证逻辑全在 validate.ts。
 */

import { createHash } from "node:crypto";
import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from "node:crypto";
import type { Manifest } from "./schema.js";
import { extractHosts } from "./schema.js";

/** 生成 Ed25519 密钥对(PKCS8 PEM 格式)。 */
export function generateEd25519KeyPair(): {
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyBase64: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  // base64 原始公钥字节(进 manifest.signature.publicKey)
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { publicKeyPem, privateKeyPem, publicKeyBase64 };
}

/**
 * 计算 manifest 的签名内容:sha256(actualHosts + declaredHosts + canonicalJSON(body))。
 *
 * @param manifest 待签名/验签的 manifest(签名时不含 signature 或含部分 signature)
 * @param declaredHosts publisher 声明的 host 列表(签名时显式传入;验签时从 manifest.signature.signedHosts 读)
 */
export function signingInput(manifest: Manifest, declaredHosts: string[] = []): Buffer {
  const actualHosts = extractHosts(manifest).sort();
  const sortedDeclared = declaredHosts.slice().sort();
  const body = canonicalize(stripSignature(manifest));
  return createHash("sha256")
    .update(actualHosts.join("|") + "\n" + sortedDeclared.join("|") + "\n" + body)
    .digest();
}

/**
 * Ed25519 签名。返回 base64。
 * @param manifest 待签名的 manifest(不含 signature 或仅含 publicKey 等元信息)
 * @param privateKeyPem 私钥
 * @param declaredHosts publisher 声明的 host(进签名内容)
 */
export function signManifest(
  manifest: Manifest,
  privateKeyPem: string,
  declaredHosts: string[] = [],
): string {
  const privateKey = createPrivateKey(privateKeyPem);
  const sig = sign(null, signingInput(manifest, declaredHosts), privateKey);
  return sig.toString("base64");
}

/**
 * Ed25519 验签。
 * @param manifest 含 signature.publicKey + signature.signature 的 manifest
 * @param trustedPublicKeyPem 可信公钥 PEM(pinning 的);为空则用 manifest 自带的
 * @returns true=验签通过
 */
export function verifyManifest(manifest: Manifest, trustedPublicKeyPem?: string): boolean {
  const sig = manifest.signature?.signature;
  const pubB64 = manifest.signature?.publicKey;
  if (!sig || !pubB64) return false;

  try {
    // 优先用 pinning 的公钥;没有才用 manifest 自带的
    const pubKeyPem = trustedPublicKeyPem ?? base64ToPem(pubB64);
    const publicKey = createPublicKey(pubKeyPem);
    // 验签时 declaredHosts 从 manifest.signature.signedHosts 读(此时 signature 已完整)
    const declaredHosts = (manifest.signature?.signedHosts as string[] | undefined) ?? [];
    return verify(
      null,
      signingInput(manifest, declaredHosts),
      publicKey,
      Buffer.from(sig, "base64"),
    );
  } catch {
    return false;
  }
}

/** 公钥指纹(sha256:hex,用户肉眼核对用)。 */
export function keyFingerprint(publicKeyPemOrBase64: string): string {
  // 统一转 PEM 再算 der 的 sha256
  let pem: string;
  if (publicKeyPemOrBase64.startsWith("-----BEGIN")) {
    pem = publicKeyPemOrBase64;
  } else {
    pem = base64ToPem(publicKeyPemOrBase64);
  }
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  return "sha256:" + createHash("sha256").update(der).digest("hex");
}

/**
 * base64 SPKI der → PEM。
 * 导出供 loader.ts 复用(消除重复的 PEM 包装函数)。
 */
export function base64ToPem(b64: string): string {
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

/** 去掉 signature 段(签名内容不包含签名本身)。 */
function stripSignature(m: Manifest): Omit<Manifest, "signature"> {
  const { signature: _, ...rest } = m;
  return rest;
}

/** 规范化 JSON 序列化:键排序 + 无空格。保证签名可复现。
 * 用 getOwnPropertyNames(覆盖不可枚举),拒绝 __proto__/constructor/prototype。 */
function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(",")}]`;
  // 用 getOwnPropertyNames 而非 Object.keys/Object.entries(后者跳过不可枚举,可能遗漏)
  const names = Object.getOwnPropertyNames(obj).filter(
    (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype",
  );
  names.sort();
  return `{${names.map((k) => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`).join(",")}}`;
}
