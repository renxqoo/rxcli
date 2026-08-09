import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanSubPath, listPath } from "../skills/reader.js";
import { syncSkills } from "../skills/sync.js";
import {
  signatureLine,
  generateAutogenBlock,
  refreshAutogen,
  generateSkillSkeleton,
  AUTOGEN_START,
  AUTOGEN_END,
} from "../skills/gen.js";
import { defineCommand, defineCommands } from "../index.js";
import { NotFoundError } from "../errs/index.js";
import type { DefineCliOptions } from "../types.js";

describe("cleanSubPath: 路径穿越校验(安全边界)", () => {
  it("合法相对路径通过", () => {
    expect(cleanSubPath("references/orders.md")).toBe("references/orders.md");
    expect(cleanSubPath("a/b/c.md")).toBe("a/b/c.md");
  });

  it("拒绝绝对路径(POSIX)", () => {
    expect(() => cleanSubPath("/etc/passwd")).toThrow();
  });

  it("拒绝 Windows 绝对路径", () => {
    expect(() => cleanSubPath("C:\\windows\\system32")).toThrow();
  });

  it("拒绝 .. 穿越", () => {
    expect(() => cleanSubPath("../../../etc/passwd")).toThrow();
    expect(() => cleanSubPath("..")).toThrow();
    expect(() => cleanSubPath("../secret")).toThrow();
  });

  it("拒绝空路径", () => {
    expect(() => cleanSubPath("")).toThrow();
  });
});

describe("gen: 命令签名生成", () => {
  it("required positional → <id>", () => {
    const cmd = {
      path: "get",
      spec: defineCommand({
        name: "get",
        description: "查详情",
        args: { id: { type: "string", required: true, positional: true } },
        async run() {},
      }),
    };
    expect(signatureLine("rxcli-orders", cmd)).toBe("rxcli-orders get <id>");
  });

  it("optional flag → [--limit <number>]", () => {
    const cmd = {
      path: "list",
      spec: defineCommand({
        name: "list",
        description: "列表",
        args: { limit: { type: "number", default: 30 }, status: { type: "string" } },
        async run() {},
      }),
    };
    const sig = signatureLine("rxcli-orders", cmd);
    expect(sig).toContain("[--limit <number>]");
    expect(sig).toContain("[--status <string>]");
    expect(sig).toContain("rxcli-orders list");
  });

  it("boolean flag → [--flag]", () => {
    const cmd = {
      path: "force",
      spec: defineCommand({
        name: "force",
        description: "强制",
        args: { yes: { type: "boolean" } },
        async run() {},
      }),
    };
    expect(signatureLine("rxcli", cmd)).toBe("rxcli force [--yes]");
  });

  it("array flag 的元素类型签名是 string", () => {
    const cmd = {
      path: "search",
      spec: defineCommand({
        name: "search",
        description: "search",
        args: { tag: { type: "array" } },
        async run() {},
      }),
    };
    expect(signatureLine("rxcli", cmd)).toBe("rxcli search [--tag <string>...]");
  });
});

describe("gen: AUTO-GEN 块生成", () => {
  const cliOptions: Pick<DefineCliOptions<any>, "commands" | "namespaces"> = {
    commands: defineCommands({
      list: defineCommand({
        name: "list",
        description: "查询订单列表",
        args: { limit: { type: "number", default: 30, desc: "返回数量上限" } },
        async run() {},
      }),
      get: defineCommand({
        name: "get",
        description: "查询订单详情",
        args: { id: { type: "string", required: true, positional: true } },
        async run() {},
      }),
    }),
  };

  it("generateAutogenBlock 只生成命令索引表(不含参数说明)", () => {
    const block = generateAutogenBlock("rxcli-orders", cliOptions);
    expect(block).toContain("## 命令");
    expect(block).toContain("| 操作 | 命令 |");
    expect(block).toContain("查询订单列表");
    expect(block).toContain("rxcli-orders list");
    // 参数细节不进 AUTO-GEN 块(交给 references 按需加载)
    expect(block).not.toContain("### 参数说明");
    expect(block).not.toContain("| 参数 | 类型 |");
    expect(block).not.toContain("返回数量上限");
  });

  it("generateAutogenBlock 含无参命令时只列命令索引", () => {
    const opts: Pick<DefineCliOptions<any>, "commands" | "namespaces"> = {
      commands: defineCommands({
        ping: defineCommand({ name: "ping", description: "无参命令", async run() {} }),
        list: defineCommand({
          name: "list",
          description: "有参命令",
          args: { limit: { type: "number", default: 10, desc: "上限" } },
          async run() {},
        }),
      }),
    };
    const block = generateAutogenBlock("demo", opts);
    expect(block).toContain("demo ping");
    expect(block).toContain("demo list");
    expect(block).not.toContain("### 参数说明");
    expect(block).not.toContain("无参数");
  });

  it("refreshAutogen 替换已有块,块外语义内容保留", () => {
    const existing = `# orders

这是人写的语义内容,gen 不该动。

${AUTOGEN_START}
旧的块内容,该被替换
${AUTOGEN_END}

## 何时用
人写的,保留。
`;
    const updated = refreshAutogen(existing, "rxcli-orders", cliOptions);
    // 块外语义内容保留
    expect(updated).toContain("这是人写的语义内容,gen 不该动。");
    expect(updated).toContain("## 何时用");
    expect(updated).toContain("人写的,保留。");
    // 块内容被替换
    expect(updated).not.toContain("旧的块内容,该被替换");
    expect(updated).toContain("rxcli-orders list");
  });

  it("refreshAutogen 无块时接在末尾", () => {
    const existing = "# orders\n\n手写简介";
    const updated = refreshAutogen(existing, "rxcli-orders", cliOptions);
    expect(updated).toContain("手写简介");
    expect(updated).toContain(AUTOGEN_START);
    expect(updated).toContain("rxcli-orders list");
  });
});

describe("gen: 骨架生成(--init)", () => {
  it("generateSkillSkeleton 含 frontmatter + AUTO-GEN 块 + {{FILL}} 占位", () => {
    const cliOptions: Pick<DefineCliOptions<any>, "commands" | "namespaces"> = {
      commands: defineCommands({
        list: defineCommand({ name: "list", description: "列表", async run() {} }),
      }),
    };
    const skel = generateSkillSkeleton("orders", "查询订单", "rxcli-orders", cliOptions);
    expect(skel).toContain("---");
    expect(skel).toContain("name: orders");
    expect(skel).toContain("description: 查询订单");
    expect(skel).toContain("{{FILL"); // 占位
    expect(skel).toContain(AUTOGEN_START);
    expect(skel).toContain("rxcli-orders list");
    expect(skel).toContain("## 何时用");
    expect(skel).toContain("## 错误处理");
  });
});

// ============================================================================
// 测试辅助:创建临时 skill 目录
// ============================================================================
let tmpRoot: string;
let tmpDest: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "rxcli-src-"));
  tmpDest = mkdtempSync(join(tmpdir(), "rxcli-dest-"));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(tmpDest, { recursive: true, force: true });
});

function makeSkill(root: string, name: string, desc = "x") {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(
    join(root, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\nbody`,
  );
}

// ============================================================================
// M4: syncSkills 应清理源端已删除的 skill(全量同步语义)
// ============================================================================
describe("M4: syncSkills 全量同步(清理源端已删除的 skill)", () => {
  it("源端删除的 skill 应从 destDir 移除", () => {
    // 初始:src 有 alpha + beta
    makeSkill(tmpRoot, "alpha");
    makeSkill(tmpRoot, "beta");
    syncSkills(tmpRoot, tmpDest);
    expect(existsSync(join(tmpDest, "alpha"))).toBe(true);
    expect(existsSync(join(tmpDest, "beta"))).toBe(true);

    // 第二次:src 删掉 beta,只留 alpha
    rmSync(join(tmpRoot, "beta"), { recursive: true, force: true });
    syncSkills(tmpRoot, tmpDest);

    // 期望:destDir 的 beta 也被清理(全量同步语义),alpha 仍在
    expect(existsSync(join(tmpDest, "alpha"))).toBe(true);
    expect(existsSync(join(tmpDest, "beta"))).toBe(false); // 当前 bug:仍存在(残留)
  });

  it("新增的 skill 被同步过来", () => {
    makeSkill(tmpRoot, "alpha");
    syncSkills(tmpRoot, tmpDest);
    makeSkill(tmpRoot, "gamma");
    syncSkills(tmpRoot, tmpDest);
    expect(existsSync(join(tmpDest, "alpha"))).toBe(true);
    expect(existsSync(join(tmpDest, "gamma"))).toBe(true);
  });

  it("返回同步数量", () => {
    makeSkill(tmpRoot, "a");
    makeSkill(tmpRoot, "b");
    const { count } = syncSkills(tmpRoot, tmpDest);
    expect(count).toBe(2);
  });

  it("不误删 destDir 中其他来源的无关目录(仅清理已知 skill 名)", () => {
    // destDir 里有个非 skill 的目录(其他工具放的),sync 不该删它
    mkdirSync(join(tmpDest, "other-tool-data"), { recursive: true });
    makeSkill(tmpRoot, "alpha");
    syncSkills(tmpRoot, tmpDest);
    expect(existsSync(join(tmpDest, "other-tool-data"))).toBe(true);
  });

  it("不删除另一个业务包同步到同一 destDir 的 skill", () => {
    const otherRoot = mkdtempSync(join(tmpdir(), "rxcli-other-src-"));
    try {
      makeSkill(tmpRoot, "orders");
      makeSkill(otherRoot, "products");
      syncSkills(tmpRoot, tmpDest);
      syncSkills(otherRoot, tmpDest);
      expect(existsSync(join(tmpDest, "orders", "SKILL.md"))).toBe(true);
      expect(existsSync(join(tmpDest, "products", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("同名 skill 的一个 owner 删除后恢复另一 owner 的副本", () => {
    const otherRoot = mkdtempSync(join(tmpdir(), "rxcli-other-src-"));
    try {
      makeSkill(tmpRoot, "shared", "from-a");
      makeSkill(otherRoot, "shared", "from-b");
      syncSkills(otherRoot, tmpDest);
      syncSkills(tmpRoot, tmpDest);
      rmSync(join(tmpRoot, "shared"), { recursive: true, force: true });
      syncSkills(tmpRoot, tmpDest);
      expect(readFileSync(join(tmpDest, "shared", "SKILL.md"), "utf8")).toContain("from-b");
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// M7: listPath 不存在的子路径应抛 NotFoundError(而非裸 statSync ENOENT)
// ============================================================================
describe("M7: listPath 错误处理", () => {
  it("skill 存在但子路径不存在 → NotFoundError(不抛裸 statSync 错误)", () => {
    makeSkill(tmpRoot, "orders");
    // 子路径 references 不存在:当前 statSync 抛裸 ENOENT → 被 pipeline 兜底成 internal/unknown
    expect(() => listPath(tmpRoot, "orders/nonexistent-sub")).toThrow(NotFoundError);
  });

  it("不存在的 skill → NotFoundError", () => {
    expect(() => listPath(tmpRoot, "ghost")).toThrow(NotFoundError);
  });

  it("子路径是文件不是目录 → InternalError(contract_violation)", () => {
    makeSkill(tmpRoot, "orders");
    mkdirSync(join(tmpRoot, "orders", "refs"), { recursive: true });
    writeFileSync(join(tmpRoot, "orders", "refs", "a.md"), "x");
    // listPath 指向文件应给 contract_violation 提示,而非裸错误
    expect(() => listPath(tmpRoot, "orders/refs/a.md")).toThrow(/file, not a directory|不是目录/);
  });
});
