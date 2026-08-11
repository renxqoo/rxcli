/**
 * rxx —— install-flow 事务化测试
 *
 * 验证:
 *   1. 成功安装:registry/skills/bin 都落地
 *   2. 非 TTY 无 --yes → 抛 ConfirmationRequiredError(非 success envelope)
 *   3. 中间步失败 → 目标位置零变更(事务回滚,staging 清理)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errs } from "@renxqoo/agent-data-cli";
import type { FetchResult } from "../manifest/loader.js";
import type { Manifest } from "../manifest/schema.js";

const ORIG_RXX_HOME = process.env.RXX_HOME;
const ORIG_IS_TTY = process.stdin.isTTY;

function validFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  const manifest: Manifest = {
    name: "tx-test",
    description: "事务测试服务",
    version: "1.0.0",
    api: { baseUrl: "https://api.example.com" },
    commands: {
      ping: {
        description: "ping",
        http: { method: "GET", path: "/ping" },
        response: { data: "." },
      },
    },
  };
  return {
    manifest,
    sourceUrl: "https://example.com/manifest",
    signatureVerified: true,
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n",
    keyFingerprint: "sha256:abc",
    unsigned: false,
    ...overrides,
  };
}

describe("install-flow 事务化", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-tx-"));
    process.env.RXX_HOME = tmpHome;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    Object.defineProperty(process.stdin, "isTTY", { value: ORIG_IS_TTY, configurable: true });
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("成功安装:registry/skills/bin 都落地", async () => {
    const { installFlow } = await import("../install-flow.js");
    const { isInstalled, readService } = await import("../registry.js");
    const { getRxBinDir, getRxSkillsDir } = await import("../config.js");

    const result = await installFlow(validFetchResult(), { yes: true });
    expect(result.data).toMatchObject({ installed: true, name: "tx-test" });
    expect(isInstalled("tx-test")).toBe(true);
    expect(readService("tx-test")?.manifest.name).toBe("tx-test");
    expect(existsSync(join(getRxBinDir(), "tx-test"))).toBe(true);
    expect(existsSync(join(getRxSkillsDir(), "tx-test", "SKILL.md"))).toBe(true);
  });

  it("非 TTY 无 --yes → 抛 ConfirmationRequiredError(exit 10)", async () => {
    const { installFlow } = await import("../install-flow.js");
    const err = await installFlow(validFetchResult(), { yes: false }).catch((e) => e);
    // 用属性断言(避免 resetModules 导致的 instanceof 跨实例问题)
    expect(err.category).toBe("confirmation");
    expect(err.subtype).toBe("high_risk_write");
    expect(err.message).toContain("tx-test");
  });

  it("非 TTY 无 --yes → 不安装任何东西(目标位置零变更)", async () => {
    const { installFlow } = await import("../install-flow.js");
    const { isInstalled } = await import("../registry.js");
    await expect(installFlow(validFetchResult(), { yes: false })).rejects.toThrow();
    expect(isInstalled("tx-test")).toBe(false);
  });

  it("带 --yes 不交互(即使非 TTY)", async () => {
    const { installFlow } = await import("../install-flow.js");
    const result = await installFlow(validFetchResult(), { yes: true });
    expect(result.data).toMatchObject({ installed: true });
  });

  it("lang 透传给 skill 生成(zh)", async () => {
    const { installFlow } = await import("../install-flow.js");
    const result = await installFlow(validFetchResult(), { yes: true, lang: "zh" });
    expect(result.data).toMatchObject({ installed: true });
  });

  // 放最后:doMock 会污染后续同 describe 的测试,所以放末尾
  it("skill 生成失败 → 事务回滚:registry 零变更", async () => {
    // mock generateAndSyncSkill 抛错(模拟 skill 生成/sync 失败)
    vi.doMock("../skill-gen.js", () => ({
      generateAndSyncSkill: () => {
        throw new Error("skill sync boom");
      },
      countCommands: () => ({ total: 1, write: 0 }),
      collectHosts: () => ({ api: "api.example.com" }),
    }));
    const { installFlow } = await import("../install-flow.js");
    const { isInstalled } = await import("../registry.js");

    // 补偿清理后抛 InstallFlowError(包装了原始错误)
    await expect(installFlow(validFetchResult(), { yes: true })).rejects.toThrow(/skill sync boom/);
    // 事务回滚:registry 不应有 tx-test(writeService 已执行但被 removeService 清理)
    expect(isInstalled("tx-test")).toBe(false);
    // 清理 doMock,避免污染后续 describe
    vi.doUnmock("../skill-gen.js");
  });
});

describe("install-flow —— TTY 交互路径", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-tx-tty-"));
    process.env.RXX_HOME = tmpHome;
    // 模拟 TTY 环境
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    Object.defineProperty(process.stdin, "isTTY", { value: ORIG_IS_TTY, configurable: true });
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("TTY 用户输入 n → 不安装,返回 user declined", async () => {
    const { installFlow } = await import("../install-flow.js");
    // mock process.stdin.once('data', cb) 立即触发回 "n"
    const origOnce = process.stdin.once.bind(process.stdin);
    vi.spyOn(process.stdin, "once").mockImplementation(
      (event: string, cb: (chunk: string) => void) => {
        if (event === "data") setTimeout(() => cb("n\n"), 0);
        return process.stdin;
      },
    );
    vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
    // 抑制 stderr 提示
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await installFlow(validFetchResult(), { yes: false });
    expect(result.data).toMatchObject({ installed: false, reason: "user declined" });
  });

  it("TTY 用户输入 y → 安装成功", async () => {
    const { installFlow } = await import("../install-flow.js");
    const { isInstalled } = await import("../registry.js");
    vi.spyOn(process.stdin, "once").mockImplementation(
      (event: string, cb: (chunk: string) => void) => {
        if (event === "data") setTimeout(() => cb("y\n"), 0);
        return process.stdin;
      },
    );
    vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await installFlow(validFetchResult(), { yes: false });
    expect(result.data).toMatchObject({ installed: true });
    expect(isInstalled("tx-test")).toBe(true);
  });

  it("TTY readLine stdin error → 抛错(覆盖 onError 分支)", async () => {
    const { installFlow } = await import("../install-flow.js");
    // stdin 触发 error 事件(模拟 read 失败),readLine onError reject
    vi.spyOn(process.stdin, "once").mockImplementation((event: string, cb: (e: Error) => void) => {
      if (event === "error") setTimeout(() => cb(new Error("stdin broken")), 0);
      return process.stdin;
    });
    vi.spyOn(process.stdin, "setEncoding").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(installFlow(validFetchResult(), { yes: false })).rejects.toThrow(/stdin broken/);
  });
});

describe("install-flow —— writeShim 失败回滚", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-tx-shim-"));
    process.env.RXX_HOME = tmpHome;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    Object.defineProperty(process.stdin, "isTTY", { value: ORIG_IS_TTY, configurable: true });
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("writeShim 失败 → 回滚 skill + registry", async () => {
    // mock writeShim 抛错(在 skill 已写之后失败)
    vi.doMock("../shim.js", () => ({
      writeShim: () => {
        throw new Error("shim write boom");
      },
      ensureInPath: () => null,
      removeShim: () => {},
    }));
    const { installFlow } = await import("../install-flow.js");
    const { isInstalled } = await import("../registry.js");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(installFlow(validFetchResult(), { yes: true })).rejects.toThrow(/shim write boom/);
    // 回滚:registry + skill 都应清理
    expect(isInstalled("tx-test")).toBe(false);
    vi.doUnmock("../shim.js");
  });
});

describe("install-flow —— keyChanged 高亮", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-tx-key-"));
    process.env.RXX_HOME = tmpHome;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    Object.defineProperty(process.stdin, "isTTY", { value: ORIG_IS_TTY, configurable: true });
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("previousKeyFingerprint 与新不同 → keyChanged:true", async () => {
    const { installFlow } = await import("../install-flow.js");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await installFlow(validFetchResult(), {
      yes: true,
      previousKeyFingerprint: "sha256:old",
    });
    expect(result.data).toMatchObject({ keyChanged: true });
  });

  it("previousKeyFingerprint 相同 → keyChanged:false", async () => {
    const { installFlow } = await import("../install-flow.js");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await installFlow(validFetchResult(), {
      yes: true,
      previousKeyFingerprint: "sha256:abc", // 同 validFetchResult 的 keyFingerprint
    });
    expect(result.data).toMatchObject({ keyChanged: false });
  });
});
