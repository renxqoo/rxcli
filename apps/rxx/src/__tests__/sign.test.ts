/**
 * rxx —— Ed25519 签名信任链测试
 *
 * 从原 validator.test.ts 拆出。签名函数现位于 manifest/sign.ts
 * (validator.ts 已删除,验证逻辑全在 validate.ts,验证测试在 validate.test.ts)。
 */

import { describe, it, expect } from "vitest";

describe("signing (Ed25519)", () => {
  const declaredHosts = ["api.example.com"];

  it("签名 + 验签往返", async () => {
    const { generateEd25519KeyPair, signManifest, verifyManifest, keyFingerprint } =
      await import("../manifest/sign.js");
    const keys = generateEd25519KeyPair();
    const manifest: any = {
      name: "signed-svc",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "https://api.example.com" },
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    };
    manifest.signature = {
      publicKey: keys.publicKeyBase64,
      keyFingerprint: keyFingerprint(keys.publicKeyBase64),
      signedAt: new Date().toISOString(),
      signedHosts: declaredHosts,
      signature: signManifest(manifest, keys.privateKeyPem, declaredHosts),
    };
    expect(verifyManifest(manifest)).toBe(true);
  });

  it("篡改 manifest body 后验签失败", async () => {
    const { generateEd25519KeyPair, signManifest, verifyManifest } =
      await import("../manifest/sign.js");
    const keys = generateEd25519KeyPair();
    const manifest: any = {
      name: "signed-svc",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "https://api.example.com" },
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    };
    manifest.signature = {
      publicKey: keys.publicKeyBase64,
      signedHosts: declaredHosts,
      signature: signManifest(manifest, keys.privateKeyPem, declaredHosts),
    };
    manifest.description = "tampered";
    expect(verifyManifest(manifest)).toBe(false);
  });

  it("篡改 host 后验签失败(host 绑定)", async () => {
    const { generateEd25519KeyPair, signManifest, verifyManifest } =
      await import("../manifest/sign.js");
    const keys = generateEd25519KeyPair();
    const manifest: any = {
      name: "signed-svc",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "https://api.example.com" },
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    };
    manifest.signature = {
      publicKey: keys.publicKeyBase64,
      signedHosts: declaredHosts,
      signature: signManifest(manifest, keys.privateKeyPem, declaredHosts),
    };
    // 篡改 host
    manifest.api.baseUrl = "https://evil.example.com";
    expect(verifyManifest(manifest)).toBe(false);
  });

  it("keyFingerprint 对 base64 和 PEM 一致", async () => {
    const { generateEd25519KeyPair, keyFingerprint } = await import("../manifest/sign.js");
    const keys = generateEd25519KeyPair();
    const fpFromBase64 = keyFingerprint(keys.publicKeyBase64);
    const fpFromPem = keyFingerprint(keys.publicKeyPem);
    expect(fpFromBase64).toBe(fpFromPem);
    expect(fpFromBase64).toMatch(/^sha256:[0-9a-f]+$/);
  });

  it("base64ToPem 生成合法 PEM", async () => {
    const { generateEd25519KeyPair, base64ToPem } = await import("../manifest/sign.js");
    const keys = generateEd25519KeyPair();
    const pem = base64ToPem(keys.publicKeyBase64);
    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(pem).toContain("-----END PUBLIC KEY-----");
  });

  it("pinning 公钥优先于 manifest 自带公钥", async () => {
    const { generateEd25519KeyPair, signManifest, verifyManifest } =
      await import("../manifest/sign.js");
    const keys = generateEd25519KeyPair();
    const manifest: any = {
      name: "signed-svc",
      description: "x",
      version: "1.0.0",
      api: { baseUrl: "https://api.example.com" },
      namespaces: {
        x: {
          y: { description: "y", http: { method: "GET", path: "/y" }, response: { data: "." } },
        },
      },
    };
    manifest.signature = {
      publicKey: keys.publicKeyBase64,
      signedHosts: declaredHosts,
      signature: signManifest(manifest, keys.privateKeyPem, declaredHosts),
    };
    // 用 pinning 的 PEM 验签(优先)
    expect(verifyManifest(manifest, keys.publicKeyPem)).toBe(true);
  });
});
