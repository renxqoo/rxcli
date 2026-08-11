/**
 * BUG-9 红测:`--no-<typo>` 不应吞下一个 token 作为值。
 * 现状:`--no-verbos`(拼错的 boolean)→ 不命中 no- 分支也不命中 boolean 分支
 *      → 落到值解析 → 吞下一个非 `-` token 作值,静默且丢失 positional。
 * 最优解:`--no-` 前缀对未知 key 抛 unknown_flag(提示可能是拼写错误),而非当值 flag 处理。
 */
import { describe, it, expect } from "vitest";
import { parseCommandFlags } from "../cli-argv.js";
import { ValidationError } from "../errs/index.js";

describe("BUG-9: --no-<typo> 不吞下一个 token 作为值", () => {
  it("--no-verbos(拼错的 boolean)→ 抛 unknown_flag,提示可能拼写错误", () => {
    const argsSpec = { verbose: { type: "boolean" } };
    expect(() => parseCommandFlags(["--no-verbos", "foo"], argsSpec)).toThrow(ValidationError);
    expect(() => parseCommandFlags(["--no-verbos", "foo"], argsSpec)).toThrow(
      /--no-verbos|unknown/i,
    );
  });

  it("--no-verbose(正确的 boolean)仍正常解析为 false", () => {
    const argsSpec = { verbose: { type: "boolean" } };
    const { options } = parseCommandFlags(["--no-verbose", "foo"], argsSpec);
    expect(options.verbose).toBe(false);
  });

  it("--no-verbos 不吞 'foo':foo 应保留为 positional(或抛错后整体不解析)", () => {
    const argsSpec = { verbose: { type: "boolean" }, name: { type: "string", positional: true } };
    // 抛错即证明 foo 没被悄悄吃掉
    expect(() => parseCommandFlags(["--no-verbos", "foo"], argsSpec)).toThrow();
  });

  it("--no-未知(无对应 boolean)也应抛 unknown_flag", () => {
    expect(() => parseCommandFlags(["--no-unknown"], {})).toThrow(ValidationError);
  });
});
