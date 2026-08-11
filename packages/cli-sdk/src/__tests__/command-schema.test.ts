import { describe, expect, it } from "vitest";
import { compileCommandSchema } from "../command-schema.js";

describe("CompiledCommandSchema boundary", () => {
  const schema = compileCommandSchema("search", {
    query: { type: "string", positional: true, required: true, desc: "search query" },
    limit: { type: "number", default: 20 },
    tag: { type: "array" },
    verbose: { type: "boolean" },
  });

  it("uses one model for argv parsing and typed values", () => {
    expect(schema.parse(["books", "--limit", "5", "--tag=a", "--tag", "b", "--verbose"])).toEqual({
      query: "books",
      limit: 5,
      tag: ["a", "b"],
      verbose: true,
    });
  });

  it("uses the same model for help and documentation descriptors", () => {
    expect(schema.signature).toEqual({
      positionals: ["<query>"],
      options: ["[--limit <number>]", "[--tag <string>...]", "[--verbose]"],
    });
    expect(
      schema.descriptors.map(({ name, displayName, type }) => ({ name, displayName, type })),
    ).toEqual([
      { name: "query", displayName: "query", type: "string" },
      { name: "limit", displayName: "--limit", type: "number" },
      { name: "tag", displayName: "--tag", type: "array" },
      { name: "verbose", displayName: "--verbose", type: "boolean" },
    ]);
  });

  it("rejects contradictory schemas during compilation", () => {
    expect(() =>
      compileCommandSchema("bad", {
        value: { type: "string", required: true, default: "x" },
      }),
    ).toThrow("cannot declare both required and default");
  });
});
