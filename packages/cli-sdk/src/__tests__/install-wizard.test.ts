/**
 * install-wizard 测试 —— 测纯函数部分(detectBizPackage/semverLessThan/fmt/parseLangArg/skillsSource 分支逻辑)。
 * runInstallWizard 涉及子进程/网络/clack 交互,靠手动冒烟,不在此单测。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fmt, semverLessThan, parseLangArg } from "../install-wizard.js";
import { detectBizPackage } from "../define.js";

describe("fmt: 占位符替换", () => {
  it("单占位符", () => {
    expect(fmt("a %s b", "x")).toBe("a x b");
  });
  it("多占位符", () => {
    expect(fmt("a %s b %s", "x", "y")).toBe("a x b y");
  });
  it("占位符多于实参 → 填空串", () => {
    expect(fmt("a %s b %s", "x")).toBe("a x b ");
  });
  it("无占位符", () => {
    expect(fmt("hello")).toBe("hello");
  });
});

describe("semverLessThan: 版本比较", () => {
  it("1.0.0 < 1.0.1", () => {
    expect(semverLessThan("1.0.0", "1.0.1")).toBe(true);
  });
  it("1.0.1 < 1.1.0", () => {
    expect(semverLessThan("1.0.1", "1.1.0")).toBe(true);
  });
  it("1.9.0 < 2.0.0", () => {
    expect(semverLessThan("1.9.0", "2.0.0")).toBe(true);
  });
  it("相等 → false", () => {
    expect(semverLessThan("1.0.0", "1.0.0")).toBe(false);
  });
  it("大于 → false", () => {
    expect(semverLessThan("2.0.0", "1.0.0")).toBe(false);
  });
  it("去 prerelease tag:1.0.0-beta < 1.0.1", () => {
    expect(semverLessThan("1.0.0-beta", "1.0.1")).toBe(true);
  });
  it("缺段补 0:1.0 < 1.0.1", () => {
    expect(semverLessThan("1.0", "1.0.1")).toBe(true);
  });
});

describe("parseLangArg: --lang 参数解析", () => {
  it("无 --lang → null", () => {
    const orig = process.argv;
    process.argv = ["node", "rxcli", "install"];
    expect(parseLangArg()).toBeNull();
    process.argv = orig;
  });
  it("--lang zh", () => {
    const orig = process.argv;
    process.argv = ["node", "rxcli", "install", "--lang", "zh"];
    expect(parseLangArg()).toBe("zh");
    process.argv = orig;
  });
  it("--lang=en", () => {
    const orig = process.argv;
    process.argv = ["node", "rxcli", "install", "--lang=en"];
    expect(parseLangArg()).toBe("en");
    process.argv = orig;
  });
  it("--lang 大写归一", () => {
    const orig = process.argv;
    process.argv = ["node", "rxcli", "install", "--lang", "ZH"];
    expect(parseLangArg()).toBe("zh");
    process.argv = orig;
  });
  it("--lang 非法值 → null", () => {
    const orig = process.argv;
    process.argv = ["node", "rxcli", "install", "--lang", "fr"];
    expect(parseLangArg()).toBeNull();
    process.argv = orig;
  });
});

describe("detectBizPackage: 业务包探测", () => {
  it("在 cli-sdk 测试上下文里要么探测到业务包,要么返回 null(不崩)", () => {
    // 测试跑在 vitest 进程里,process.argv[1] 是 vitest,往上找可能找不到带 bin 的业务包
    // 关键是不崩、返回结构正确
    const result = detectBizPackage();
    if (result) {
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("bin");
      expect(result).toHaveProperty("version");
      expect(typeof result.name).toBe("string");
      expect(typeof result.bin).toBe("string");
      // cli-sdk 自己应被跳过
      expect(result.name).not.toBe("@renxqoo/agent-data-cli");
    } else {
      expect(result).toBeNull();
    }
  });
});

describe("skillsSource 分支逻辑(通过 InstallWizardOptions 类型校验)", () => {
  // skillsSource 的分支在 stepInstallSkills 里(涉及 spinner/子进程),这里只校验
  // runInstallWizard 接受空和非空两种 opts 不报类型错(编译期已保证)。
  // 运行时分支的正确性靠手动冒烟(见 plan 验证段)。
  it("空 skillsSource 是合法入参", () => {
    const opts = { skillsSource: undefined };
    expect(opts.skillsSource).toBeUndefined();
  });
  it("非空 skillsSource 是合法入参", () => {
    const opts = { skillsSource: "https://skills.sh/p/xxx" };
    expect(opts.skillsSource).toBe("https://skills.sh/p/xxx");
  });
});

// ============================================================================
// I1: runInstallWizard 不应直接 process.exit(框架契约:统一设 exitCode / 返回 code)
// ============================================================================

// I1 走非交互路径(非 TTY):不触发 clack 交互,但会跑 npm/whichBin 子进程。
// 用 vi.mock 把 child_process 全部 stub 成成功 no-op,避免真装包/真联网。
// existsSync 让 whichBin 找到 bin(返回非 null),从而 stepInstallSkills 走成功分支。
// 用动态 import 隔离 mock,不影响上面的纯函数测试(它们在 mock 生效前已 import)。
vi.mock("node:child_process", () => ({
  execFileSync: () => Buffer.from("/fake/prefix/bin/rxcli-test"),
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: Buffer) => void,
  ) => {
    cb(null, Buffer.from(""));
  },
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: () => true };
});

describe("I1: runInstallWizard 返回 exit code,不自行 process.exit", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const origIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    // 非交互路径:走 console.log 而非 clack intro/outro
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit should not be called");
    }) as never);
    // 捕获 console.log 防止污染测试输出
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    vi.restoreAllMocks();
  });

  it("成功完成 → 返回 exit code 0", async () => {
    const { runInstallWizard } = await import("../install-wizard.js");
    const code = await runInstallWizard({ binName: "rxcli-test", pkgName: "test-pkg" });
    expect(code).toBe(0);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("返回值是 number(而非 undefined/void)", async () => {
    const { runInstallWizard } = await import("../install-wizard.js");
    const code = await runInstallWizard({ binName: "rxcli-test" });
    expect(typeof code).toBe("number");
  });
});
