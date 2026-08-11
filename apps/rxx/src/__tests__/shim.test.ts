/**
 * rxx —— shim.ts 异常路径补全
 *
 * 覆盖:writeShim/removeShim、isInPath/ensureInPath(幂等、残缺块、已完整块)、
 * realpath 解软链、atomicWriteRc(通过 ensureInPath 间接)。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
const isWindows = process.platform === "win32";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const ORIG_RXX_HOME = process.env.RXX_HOME;
const ORIG_PATH = process.env.PATH;

describe("shim.ts", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "rxx-shim-"));
    process.env.RXX_HOME = tmpHome;
    // 清 PATH 确保 isInPath 不受外部 PATH 干扰
    process.env.PATH = "";
    vi.resetModules();
  });

  afterEach(() => {
    process.env.RXX_HOME = ORIG_RXX_HOME;
    process.env.PATH = ORIG_PATH;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("writeShim / removeShim", () => {
    it("writeShim 写 POSIX + Windows shim,chmod 500", async () => {
      const { writeShim } = await import("../shim.js");
      const { getRxBinDir } = await import("../config.js");
      writeShim("svc-x");
      const shPath = join(getRxBinDir(), "svc-x");
      const cmdPath = join(getRxBinDir(), "svc-x.cmd");
      expect(existsSync(shPath)).toBe(true);
      expect(existsSync(cmdPath)).toBe(true);
      expect(readFileSync(shPath, "utf8")).toContain('exec rxx run "svc-x" "$@"');
      expect(readFileSync(cmdPath, "utf8")).toContain("rxx run svc-x %*");
    });

    it("writeShim 覆盖旧 shim(update 场景)", async () => {
      const { writeShim } = await import("../shim.js");
      const { getRxBinDir } = await import("../config.js");
      writeShim("svc-y");
      const shPath = join(getRxBinDir(), "svc-y");
      const before = readFileSync(shPath, "utf8");
      writeShim("svc-y"); // 再写一次
      expect(readFileSync(shPath, "utf8")).toBe(before);
    });

    it("writeShim 非法 name → 抛 InvalidServiceNameError", async () => {
      const { writeShim } = await import("../shim.js");
      expect(() => writeShim("BAD NAME")).toThrow(/Invalid service name/);
      expect(() => writeShim("../evil")).toThrow(/Invalid service name/);
    });

    it("removeShim 删 POSIX + Windows", async () => {
      const { writeShim, removeShim } = await import("../shim.js");
      const { getRxBinDir } = await import("../config.js");
      writeShim("svc-rm");
      removeShim("svc-rm");
      expect(existsSync(join(getRxBinDir(), "svc-rm"))).toBe(false);
      expect(existsSync(join(getRxBinDir(), "svc-rm.cmd"))).toBe(false);
    });

    it("removeShim 未存在的 shim → 不抛(幂等)", async () => {
      const { removeShim } = await import("../shim.js");
      expect(() => removeShim("never-existed")).not.toThrow();
    });

    it("removeShim 非法 name → 抛", async () => {
      const { removeShim } = await import("../shim.js");
      expect(() => removeShim("../etc")).toThrow(/Invalid service name/);
    });
  });

  describe("isInPath / ensureInPath", () => {
    it("isInPath:PATH 含 bin 目录 → true", async () => {
      const { isInPath } = await import("../shim.js");
      const { getRxBinDir } = await import("../config.js");
      process.env.PATH = getRxBinDir();
      expect(isInPath()).toBe(true);
    });

    it("isInPath:PATH 不含 bin 目录 → false", async () => {
      const { isInPath } = await import("../shim.js");
      process.env.PATH = "/usr/bin:/bin";
      expect(isInPath()).toBe(false);
    });

    it("isInPath:PATH 含 bin 目录的软链 → true(realpath 解析)", async () => {
      const { isInPath } = await import("../shim.js");
      const { getRxBinDir } = await import("../config.js");
      // 先建 binDir(让软链能 resolve)
      mkdirSync(getRxBinDir(), { recursive: true });
      // 创建一个指向 binDir 的软链,把软链放进 PATH
      const linkDir = join(tmpHome, "binlink");
      symlinkSync(getRxBinDir(), linkDir);
      process.env.PATH = linkDir;
      expect(isInPath()).toBe(true);
    });

    it.skipIf(isWindows)("ensureInPath:不在 PATH → 写 rc 文件,返回 rc 路径", async () => {
      // 用 HOME 指向 tmp,避免污染真实 rc
      const ORIG_HOME = process.env.HOME;
      const ORIG_SHELL = process.env.SHELL;
      process.env.HOME = tmpHome;
      process.env.SHELL = "/bin/zsh";
      mkdirSync(join(tmpHome, ".zshrc-exists"), { recursive: false }); // 确保无干扰
      try {
        const { ensureInPath } = await import("../shim.js");
        const rc = ensureInPath();
        expect(rc).toBeTruthy();
        expect(rc).toBe(join(tmpHome, ".zshrc"));
        const content = readFileSync(rc!, "utf8");
        expect(content).toContain("# >>> rxx bin >>>");
        expect(content).toContain("# <<< rxx bin <<<");
        expect(content).toContain("$HOME/.rxx/bin:$PATH");
      } finally {
        process.env.HOME = ORIG_HOME;
        process.env.SHELL = ORIG_SHELL;
      }
    });

    it.skipIf(isWindows)("ensureInPath:已有完整标记块 → 幂等,不再写(null)", async () => {
      const ORIG_HOME = process.env.HOME;
      const ORIG_SHELL = process.env.SHELL;
      process.env.HOME = tmpHome;
      process.env.SHELL = "/bin/zsh";
      // 预写一个完整块
      writeFileSync(
        join(tmpHome, ".zshrc"),
        [
          "# existing content",
          "# >>> rxx bin >>>",
          'export PATH="$HOME/.rxx/bin:$PATH"',
          "# <<< rxx bin <<<",
          "",
        ].join("\n"),
      );
      try {
        const { ensureInPath } = await import("../shim.js");
        expect(ensureInPath()).toBeNull(); // 已有,不重复写
      } finally {
        process.env.HOME = ORIG_HOME;
        process.env.SHELL = ORIG_SHELL;
      }
    });

    it.skipIf(isWindows)("ensureInPath:残缺块(只有 start 无 end)→ 清理后重写完整块", async () => {
      const ORIG_HOME = process.env.HOME;
      const ORIG_SHELL = process.env.SHELL;
      process.env.HOME = tmpHome;
      process.env.SHELL = "/bin/zsh";
      // 预写残缺块(只有 start)
      writeFileSync(
        join(tmpHome, ".zshrc"),
        [
          "# existing",
          "# >>> rxx bin >>>",
          'export PATH="$HOME/.rxx/bin:$PATH"',
          "# 但没有 end 标记",
        ].join("\n"),
      );
      try {
        const { ensureInPath } = await import("../shim.js");
        const rc = ensureInPath();
        expect(rc).toBeTruthy();
        const content = readFileSync(rc!, "utf8");
        // 应有完整 start + end
        const startCount = (content.match(/# >>> rxx bin >>>/g) || []).length;
        const endCount = (content.match(/# <<< rxx bin <<</g) || []).length;
        expect(startCount).toBe(1);
        expect(endCount).toBe(1);
      } finally {
        process.env.HOME = ORIG_HOME;
        process.env.SHELL = ORIG_SHELL;
      }
    });
  });
});
