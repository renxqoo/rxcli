import { describe, it, expect } from "vitest";
import { createTestCtx } from "@renxqoo/agent-data-cli";
import { newsCommands } from "../commands/news.js";
import { hotCommands } from "../commands/hot.js";
import { toolCommands } from "../commands/tool.js";
import { healthCommands } from "../commands/health.js";

/** 构造 60s 标准包装响应 { code:200, message, data }。 */
function ok<T>(data: T) {
  return { status: 200, data: { code: 200, message: "ok", data }, headers: {} };
}

describe("news.today", () => {
  it("GET /60s 并解包 data", async () => {
    const ctx = createTestCtx({
      request: async (opts) => {
        expect(opts.path).toBe("/60s");
        expect(opts.query).toMatchObject({ encoding: "json" });
        return ok({
          date: "2026-08-09",
          news: ["测试新闻", "第二条新闻"],
          tip: "微语",
          day_of_week: "星期六",
          lunar_date: "六月十六",
        });
      },
    });
    const result = await newsCommands.today.run({ date: undefined, forceUpdate: undefined }, ctx);
    expect(result.data).toMatchObject({ date: "2026-08-09" });
    expect((result.data as { news: string[] }).news[0]).toBe("测试新闻");
  });

  it("forceUpdate 透传为 force-update query", async () => {
    const ctx = createTestCtx({
      request: async (opts) => {
        expect(opts.query).toMatchObject({ "force-update": true });
        return ok({ date: "2026-08-09", news: [] });
      },
    });
    await newsCommands.today.run({ forceUpdate: true }, ctx);
  });

  it("humanFormat 渲染 string[] 新闻为序号列表(不出现 undefined)", () => {
    // 真实 API 的 news 是 string[];旧 bug 把 string 当 {title} 解引用 → 全部 "undefined"
    const data = {
      date: "2026-08-09",
      news: ["台风白海豚预计登陆", "新疆调整景区收费"],
      tip: "走自己的路",
      day_of_week: "星期日",
      lunar_date: "丙午年六月廿八",
    };
    const out = newsCommands.today.humanFormat!(data);
    expect(out).toContain("1. 台风白海豚预计登陆");
    expect(out).toContain("2. 新疆调整景区收费");
    expect(out).not.toContain("undefined");
  });
});

describe("hot.weibo", () => {
  it("GET /weibo 返回数组 + countMeta", async () => {
    const ctx = createTestCtx({
      request: async (opts) => {
        expect(opts.path).toBe("/weibo");
        return ok([
          { title: "热搜1", hot_value: 100, link: "https://weibo.com" },
          { title: "热搜2", hot_value: 90, link: "https://weibo.com" },
        ]);
      },
    });
    const result = await hotCommands.weibo.run({}, ctx);
    expect(result.data).toHaveLength(2);
    expect(result.meta?.count).toBe(2);
    expect(result.meta?.pagination?.complete).toBe(true);
  });
});

describe("tool.fanyi", () => {
  it("GET /fanyi 透传 text/from/to", async () => {
    const ctx = createTestCtx({
      request: async (opts) => {
        expect(opts.path).toBe("/fanyi");
        expect(opts.query).toMatchObject({ text: "hello", to: "zh-CHS" });
        return ok({
          source: { text: "hello", type: "en", type_desc: "英语", pronounce: "" },
          target: { text: "你好", type: "zh-CHS", type_desc: "中文", pronounce: "" },
        });
      },
    });
    const result = await toolCommands.fanyi.run({ text: "hello", to: "zh-CHS" }, ctx);
    expect((result.data as { target: { text: string } }).target.text).toBe("你好");
  });
});

describe("health.assess", () => {
  it("GET /health 透传四个必填参数", async () => {
    const ctx = createTestCtx({
      request: async (opts) => {
        expect(opts.path).toBe("/health");
        expect(opts.query).toMatchObject({ height: 175, weight: 70, gender: "male", age: 30 });
        return ok({ bmi: { value: 22.9, category: "正常" } });
      },
    });
    const result = await healthCommands.assess.run(
      { height: 175, weight: 70, gender: "male", age: 30 },
      ctx,
    );
    expect((result.data as { bmi: { value: number } }).bmi.value).toBe(22.9);
  });
});

describe("news.rss(XML 解析)", () => {
  it("把 RSS XML 解析为结构化 items", async () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title>每天 60s 第 1 条</title>
          <link>https://example.com/1</link>
          <pubDate>Sat, 09 Aug 2026 10:00:00 +0800</pubDate>
          <description><![CDATA[<p>新闻内容</p>]]></description>
        </item>
        <item>
          <title>第 2 条</title>
          <link>https://example.com/2</link>
          <pubDate>Sat, 09 Aug 2026 10:00:00 +0800</pubDate>
          <description>描述 &amp; 更多</description>
        </item>
      </channel></rss>`;
    const ctx = createTestCtx({
      request: async () => ({
        status: 200,
        data: xml,
        headers: { "content-type": "application/xml" },
      }),
    });
    const result = await newsCommands.rss.run({}, ctx);
    const items = result.data as { title: string; link: string; description: string }[];
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("每天 60s 第 1 条");
    expect(items[0].description).toBe("<p>新闻内容</p>");
    expect(items[1].description).toBe("描述 & 更多");
  });
});
