import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineCli, defineCommand } from "@renxqoo/agent-data-cli";

/**
 * 第 2 层端到端测试:验证统一输出格式 + source(不挂鉴权,单独装配一个同名 app)。
 * 重点验证输出契约,不验证命令逻辑(那是第 1 层的事)。
 */
describe("统一输出格式 + source", () => {
  let stdoutBuf = "";
  let stderrBuf = "";
  beforeEach(() => {
    stdoutBuf = "";
    stderrBuf = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdoutBuf += typeof chunk === "string" ? chunk : (chunk as Uint8Array).toString();
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrBuf += typeof chunk === "string" ? chunk : (chunk as Uint8Array).toString();
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("成功输出含 source: defineCli.name", async () => {
    const app = defineCli({
      name: "wwx",
      description: "test",
      commands: {
        list: defineCommand({
          name: "list",
          description: "x",
          async run() {
            return { data: [{ id: "o_1" }] };
          },
        }),
      },
    });

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ data: [], total: 0, page: 1 })),
      headers: new Headers(),
    }) as unknown as typeof globalThis.fetch;

    await app.run(["list"]);
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(stdoutBuf)).toEqual({
      ok: true,
      source: "wwx",
      data: [{ id: "o_1" }],
    });
  });

  it("未知命令 → exit 2 + stderr 错误输出", async () => {
    const app = defineCli({
      name: "wwx",
      description: "test",
      commands: {
        list: defineCommand({
          name: "list",
          description: "x",
          async run() {
            return { data: 1 };
          },
        }),
      },
    });
    await app.run(["bogus"]);
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(stderrBuf.trim()).error.subtype).toBe("invalid_argument");
  });
});
