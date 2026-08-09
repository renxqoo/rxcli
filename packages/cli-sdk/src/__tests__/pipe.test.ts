import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { createPipeReader } from "../pipe.js";
import type { PipeRecord } from "../types.js";

/** 把字符串包成 Readable stream(模拟 stdin)。 */
function makeStdin(data: string): NodeJS.ReadableStream {
  const s = new Readable({ read() {} });
  s.push(data);
  s.push(null);
  return s as unknown as NodeJS.ReadableStream & { isTTY?: boolean };
}

async function collect(iter: AsyncIterable<PipeRecord>): Promise<PipeRecord[]> {
  const out: PipeRecord[] = [];
  for await (const rec of iter) out.push(rec);
  return out;
}

describe("pipe: 信封整包 parse → 逐条 yield PipeRecord", () => {
  it("data 是数组 → 逐条 yield,每条包成 PipeRecord", async () => {
    const stdin = makeStdin(
      JSON.stringify({
        ok: true,
        data: [
          { id: "o1", total: 100 },
          { id: "o2", total: 200 },
        ],
        meta: { pagination: { complete: true } },
      }),
    );
    const reader = createPipeReader(stdin as NodeJS.ReadableStream & { isTTY?: boolean }, "orders");
    const records = await collect(reader.in());
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ type: "orders", id: "o1", data: { id: "o1", total: 100 } });
    expect(records[1]).toEqual({ type: "orders", id: "o2", data: { id: "o2", total: 200 } });
  });

  it("data 是单对象 → yield 一条", async () => {
    const stdin = makeStdin(JSON.stringify({ ok: true, data: { id: "o1", status: "paid" } }));
    const reader = createPipeReader(stdin as NodeJS.ReadableStream & { isTTY?: boolean }, "orders");
    const records = await collect(reader.in());
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("o1");
  });

  it("data 是 scalar 时也 yield 一条,不静默丢失", async () => {
    const reader = createPipeReader(
      makeStdin(JSON.stringify({ ok: true, data: 42 })) as NodeJS.ReadableStream & {
        isTTY?: boolean;
      },
      "numbers",
    );
    expect(await collect(reader.in())).toEqual([{ type: "numbers", data: 42 }]);
  });

  it("uses the upstream envelope source instead of the downstream fallback namespace", async () => {
    const reader = createPipeReader(
      makeStdin(
        JSON.stringify({ ok: true, source: "orders", data: [{ id: "o1" }] }),
      ) as NodeJS.ReadableStream & {
        isTTY?: boolean;
      },
      "customers",
    );
    expect(await collect(reader.in())).toEqual([{ type: "orders", id: "o1", data: { id: "o1" } }]);
  });

  it("data 是单个显式 PipeRecord 时不重复包装", async () => {
    const record = { type: "customers", id: "c1", data: { name: "alice" } };
    const stdin = makeStdin(JSON.stringify({ ok: true, data: record }));
    const reader = createPipeReader(stdin as NodeJS.ReadableStream & { isTTY?: boolean }, "orders");
    expect(await collect(reader.in())).toEqual([record]);
  });

  it("data 项已带 type(多级管道)→ 保留上游 type", async () => {
    const stdin = makeStdin(
      JSON.stringify({
        ok: true,
        data: [{ type: "customers", id: "c1", data: { name: "alice" } }],
      }),
    );
    const reader = createPipeReader(stdin as NodeJS.ReadableStream & { isTTY?: boolean }, "orders");
    const records = await collect(reader.in());
    expect(records[0].type).toBe("customers"); // 保留上游 type,不被 fallback 覆盖
  });

  it("普通业务对象即使有 type 字段,没有 PipeRecord.data 时仍应被包装", async () => {
    const item = { type: "physical", id: "p1", title: "Book" };
    const stdin = makeStdin(JSON.stringify({ ok: true, data: [item] }));
    const reader = createPipeReader(
      stdin as NodeJS.ReadableStream & { isTTY?: boolean },
      "products",
    );
    const records = await collect(reader.in());
    expect(records[0]).toEqual({ type: "products", id: "p1", data: item });
  });

  it("拒绝把失败信封静默当成空管道", async () => {
    const stdin = makeStdin(
      JSON.stringify({ ok: false, error: { type: "api", subtype: "server_error" } }),
    );
    const reader = createPipeReader(stdin as NodeJS.ReadableStream & { isTTY?: boolean }, "orders");
    await expect(collect(reader.in())).rejects.toThrow(/失败信封|pipe/i);
  });

  it("空 stdin → 无记录", async () => {
    const stdin = makeStdin("");
    const reader = createPipeReader(stdin as NodeJS.ReadableStream & { isTTY?: boolean }, "orders");
    const records = await collect(reader.in());
    expect(records).toHaveLength(0);
  });

  it("非法 JSON → 抛 InternalError(decode_failure)", async () => {
    const stdin = makeStdin("not json {{{");
    const reader = createPipeReader(stdin as NodeJS.ReadableStream & { isTTY?: boolean }, "orders");
    await expect(collect(reader.in())).rejects.toThrow(/不是合法 JSON|管道输入/);
    await expect(collect(reader.in())).rejects.toThrow(/不是合法 JSON|管道输入/);
  });

  it("缺少 ok/data 的普通对象不是合法成功信封", async () => {
    const reader = createPipeReader(
      makeStdin(JSON.stringify({ hello: "world" })) as NodeJS.ReadableStream & { isTTY?: boolean },
      "orders",
    );
    await expect(collect(reader.in())).rejects.toThrow(/成功信封/);
  });
});
