/**
 * rxx —— manifest 校验工具的完整测试(TDD:先写测试定标准)
 *
 * 校验工具是纯函数,零 IO,返回结构化结果(收集所有错误,不是遇到第一个就停)。
 * 这些测试是"真理的唯一标准"——每个字段的每个坏值都有用例。
 *
 * 真实 manifest 模板(基准 valid),每个测试只改一个字段验证一条规则。
 */

import { describe, it, expect } from "vitest";
import { validate, type ManifestIssue } from "../manifest/validate.js";

// ============================================================================
// 基准:完全合法的 manifest(每个测试深拷贝后改一个字段)
// ============================================================================

function validManifest(): any {
  return {
    name: "demo-svc",
    description: "演示服务",
    version: "1.0.0",
    api: { baseUrl: "https://api.example.com" },
    errorOnStatus: { "404": "not_found" },
    namespaces: {
      orders: {
        list: {
          description: "查询订单列表",
          args: {
            limit: { type: "number", desc: "数量" },
            cursor: { type: "string", desc: "游标" },
          },
          http: {
            method: "GET",
            path: "/api/orders",
            query: { limit: "{limit}", cursor: "{cursor}" },
          },
          response: {
            data: "orders",
            pagination: {
              complete: { field: "hasMore", invert: true },
              nextToken: { field: "nextCursor" },
            },
          },
        },
        get: {
          description: "查询单个订单",
          args: { id: { type: "string", required: true, positional: true, desc: "ID" } },
          http: { method: "GET", path: "/api/orders/{id}" },
          response: { data: "." },
        },
        create: {
          description: "创建订单",
          args: {
            amount: { type: "number", required: true, desc: "金额" },
            customer: { type: "string", required: true, desc: "客户" },
          },
          http: { method: "POST", path: "/api/orders", body: { amount: "{amount}" } },
          response: { data: "." },
        },
      },
    },
  };
}

// ============================================================================
// 校验结果形态
// ============================================================================

describe("validate 返回结构化结果(不抛异常)", () => {
  it("合法 manifest 返回空 issues", () => {
    const result = validate(validManifest());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("收集多个错误(不是遇到第一个就停)", () => {
    const m = validManifest();
    m.name = "Bad Name";
    m.version = "";
    m.api = null;
    const result = validate(m);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });

  it("每个 issue 有 level/field/message", () => {
    const m = validManifest();
    m.name = "x";
    const result = validate(m);
    expect(result.ok).toBe(false);
    const issue = result.issues[0]!;
    expect(issue).toHaveProperty("level");
    expect(issue).toHaveProperty("field");
    expect(issue).toHaveProperty("message");
  });
});

// ============================================================================
// name 字段
// ============================================================================

describe("name", () => {
  it("缺失 → error", () => {
    const m = validManifest();
    delete m.name;
    const result = validate(m);
    expect(result.issues).toContainFieldError("name");
  });
  it("非字符串 → error", () => {
    const m = validManifest();
    m.name = 123;
    expect(validate(m).issues).toContainFieldError("name");
  });
  it("含大写 → error", () => {
    const m = validManifest();
    m.name = "MySvc";
    expect(validate(m).issues).toContainFieldError("name");
  });
  it("含空格 → error", () => {
    const m = validManifest();
    m.name = "my svc";
    expect(validate(m).issues).toContainFieldError("name");
  });
  it("含下划线 → error", () => {
    const m = validManifest();
    m.name = "my_svc";
    expect(validate(m).issues).toContainFieldError("name");
  });
  it("单个字符(太短)→ error", () => {
    const m = validManifest();
    m.name = "x";
    expect(validate(m).issues).toContainFieldError("name");
  });
  it("65 字符(太长)→ error", () => {
    const m = validManifest();
    m.name = "a".repeat(65);
    expect(validate(m).issues).toContainFieldError("name");
  });
  it("数字开头 → error", () => {
    const m = validManifest();
    m.name = "1svc";
    expect(validate(m).issues).toContainFieldError("name");
  });
  it("合法:字母+数字+连字符 → ok", () => {
    const m = validManifest();
    m.name = "demo-svc-2";
    expect(validate(m).ok).toBe(true);
  });
  it("合法:正好 64 字符 → ok", () => {
    const m = validManifest();
    m.name = "a".repeat(64);
    expect(validate(m).ok).toBe(true);
  });
});

// ============================================================================
// description 字段
// ============================================================================

describe("description", () => {
  it("缺失 → error", () => {
    const m = validManifest();
    delete m.description;
    expect(validate(m).issues).toContainFieldError("description");
  });
  it("非字符串 → error", () => {
    const m = validManifest();
    m.description = 123;
    expect(validate(m).issues).toContainFieldError("description");
  });
  it("空字符串 → error(agent 无法语义匹配)", () => {
    const m = validManifest();
    m.description = "";
    expect(validate(m).issues).toContainFieldError("description");
  });
  it("纯空格 → error", () => {
    const m = validManifest();
    m.description = "   ";
    expect(validate(m).issues).toContainFieldError("description");
  });
});

// ============================================================================
// version 字段
// ============================================================================

describe("version", () => {
  it("缺失 → error", () => {
    const m = validManifest();
    delete m.version;
    expect(validate(m).issues).toContainFieldError("version");
  });
  it("非字符串 → error", () => {
    const m = validManifest();
    m.version = 1;
    expect(validate(m).issues).toContainFieldError("version");
  });
  it("非 semver → error", () => {
    const m = validManifest();
    m.version = "v1";
    expect(validate(m).issues).toContainFieldError("version");
  });
  it("合法 semver → ok", () => {
    const m = validManifest();
    m.version = "2.3.4";
    expect(validate(m).ok).toBe(true);
  });
  it("合法带预发布 → ok", () => {
    const m = validManifest();
    m.version = "1.0.0-beta.1";
    expect(validate(m).ok).toBe(true);
  });
});

// ============================================================================
// api.baseUrl 字段
// ============================================================================

describe("api.baseUrl", () => {
  it("api 缺失 → error", () => {
    const m = validManifest();
    delete m.api;
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("baseUrl 缺失 → error", () => {
    const m = validManifest();
    m.api = {};
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("非 URL → error", () => {
    const m = validManifest();
    m.api.baseUrl = "not a url";
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("ftp 协议 → error", () => {
    const m = validManifest();
    m.api.baseUrl = "ftp://example.com";
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("HTTP → error(默认要求 HTTPS)", () => {
    const m = validManifest();
    m.api.baseUrl = "http://api.example.com";
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("HTTP + allowInsecure → warning(非 error)", () => {
    const m = validManifest();
    m.api.baseUrl = "http://api.example.com";
    const result = validate(m, { allowInsecure: true });
    expect(result.issues.some((i) => i.field === "api.baseUrl" && i.level === "error")).toBe(false);
  });
  it("内网地址 → error(SSRF)", () => {
    const m = validManifest();
    m.api.baseUrl = "https://127.0.0.1";
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("10.x → error(SSRF)", () => {
    const m = validManifest();
    m.api.baseUrl = "https://10.0.0.1";
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("192.168.x → error(SSRF)", () => {
    const m = validManifest();
    m.api.baseUrl = "https://192.168.1.1";
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("localhost → error(SSRF)", () => {
    const m = validManifest();
    m.api.baseUrl = "https://localhost";
    expect(validate(m).issues).toContainFieldError("api.baseUrl");
  });
  it("内网 + allowPrivateEndpoints → ok", () => {
    const m = validManifest();
    m.api.baseUrl = "http://127.0.0.1:9966";
    expect(validate(m, { allowInsecure: true, allowPrivateEndpoints: true }).ok).toBe(true);
  });
});

// ============================================================================
// auth 字段
// ============================================================================

describe("auth", () => {
  it("type 非 oauth2 → error", () => {
    const m = validManifest();
    m.auth = { type: "basic", baseUrl: "https://auth.example.com", credentialNamespace: "x" };
    expect(validate(m).issues).toContainFieldError("auth.type");
  });
  it("缺 baseUrl → error", () => {
    const m = validManifest();
    m.auth = { type: "oauth2", credentialNamespace: "x" };
    expect(validate(m).issues).toContainFieldError("auth.baseUrl");
  });
  it("缺 credentialNamespace → error", () => {
    const m = validManifest();
    m.auth = { type: "oauth2", baseUrl: "https://auth.example.com" };
    expect(validate(m).issues).toContainFieldError("auth.credentialNamespace");
  });
  it("auth.baseUrl 内网 → error", () => {
    const m = validManifest();
    m.auth = { type: "oauth2", baseUrl: "https://127.0.0.1", credentialNamespace: "x" };
    expect(validate(m).issues).toContainFieldError("auth.baseUrl");
  });
  it("合法 oauth2 → ok", () => {
    const m = validManifest();
    m.auth = {
      type: "oauth2",
      baseUrl: "https://auth.example.com",
      credentialNamespace: "crm",
      scope: "read",
      flow: "device",
    };
    expect(validate(m).ok).toBe(true);
  });
  it("flow 非法 → error", () => {
    const m = validManifest();
    m.auth = {
      type: "oauth2",
      baseUrl: "https://auth.example.com",
      credentialNamespace: "x",
      flow: "magic",
    };
    expect(validate(m).issues).toContainFieldError("auth.flow");
  });
});

// ============================================================================
// 命令存在性
// ============================================================================

describe("命令存在性", () => {
  it("commands + namespaces 都空 → error", () => {
    const m = validManifest();
    m.namespaces = {};
    expect(validate(m).issues.some((i) => i.field === "commands")).toBe(true);
  });
  it("只有顶层 commands → ok", () => {
    const m: any = {
      name: "demo",
      description: "x",
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
    expect(validate(m).ok).toBe(true);
  });
});

// ============================================================================
// 单个命令字段
// ============================================================================

describe("命令字段", () => {
  it("缺 description → error", () => {
    const m = validManifest();
    delete m.namespaces.orders.list.description;
    expect(validate(m).issues.some((i) => i.field.endsWith(".description"))).toBe(true);
  });
  it("缺 http → error", () => {
    const m = validManifest();
    delete m.namespaces.orders.list.http;
    expect(validate(m).issues.some((i) => i.field.endsWith(".http"))).toBe(true);
  });
  it("缺 response.data → error", () => {
    const m = validManifest();
    delete m.namespaces.orders.list.response.data;
    expect(validate(m).issues.some((i) => i.field.endsWith(".response.data"))).toBe(true);
  });

  // http.method
  it("method 非法 → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.http.method = "FETCH";
    expect(validate(m).issues.some((i) => i.field.includes("http.method"))).toBe(true);
  });
  it("method 小写 → error(必须大写)", () => {
    const m = validManifest();
    m.namespaces.orders.list.http.method = "get";
    expect(validate(m).issues.some((i) => i.field.includes("http.method"))).toBe(true);
  });

  // http.path
  it("path 不以 / 开头 → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.http.path = "api/orders";
    expect(validate(m).issues.some((i) => i.field.includes("http.path"))).toBe(true);
  });
  it("path 是绝对 URL → ok", () => {
    const m = validManifest();
    m.namespaces.orders.list.http.path = "https://other.example.com/x";
    expect(validate(m).ok).toBe(true);
  });

  // body 只在写方法
  it("GET 带 body → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.http.body = { x: 1 };
    expect(validate(m).issues.some((i) => i.field.includes("http.body"))).toBe(true);
  });
  it("POST 带 body → ok", () => {
    const m = validManifest();
    expect(validate(m).ok).toBe(true); // create 命令本身就有 body
  });
});

// ============================================================================
// args 字段
// ============================================================================

describe("args 字段", () => {
  it("type 非法 → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.args.limit.type = "integer";
    expect(validate(m).issues.some((i) => i.field.includes(".type"))).toBe(true);
  });
  it("type 拼错(如 strin)→ error", () => {
    const m = validManifest();
    m.namespaces.orders.list.args.limit.type = "strin";
    expect(validate(m).issues.some((i) => i.field.includes(".type"))).toBe(true);
  });
  it("required + default 同时声明 → error", () => {
    const m = validManifest();
    m.namespaces.orders.get.args.id.required = true;
    m.namespaces.orders.get.args.id.default = "x";
    expect(validate(m).issues.some((i) => i.field.includes(".id"))).toBe(true);
  });
  it("合法的 4 种 type → ok", () => {
    const m = validManifest();
    m.namespaces.orders.list.args = {
      a: { type: "string" },
      b: { type: "number" },
      c: { type: "boolean" },
      d: { type: "array" },
    };
    expect(validate(m).ok).toBe(true);
  });
  it("保留参数名 json → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.args = { json: { type: "string" } };
    expect(
      validate(m).issues.some((i) => i.level === "error" && i.message.includes("reserved")),
    ).toBe(true);
  });
});

// ============================================================================
// response 字段
// ============================================================================

describe("response 字段", () => {
  it("pagination.complete 缺 field → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.response.pagination = { complete: { invert: true } };
    expect(validate(m).issues.some((i) => i.field.includes("pagination.complete"))).toBe(true);
  });
  it("pagination.nextToken 缺 field → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.response.pagination = { nextToken: {} };
    expect(validate(m).issues.some((i) => i.field.includes("pagination.nextToken"))).toBe(true);
  });
});

// ============================================================================
// errorOnStatus
// ============================================================================

describe("errorOnStatus", () => {
  it("status key 非法(非数字非 Nxx)→ error", () => {
    const m = validManifest();
    m.errorOnStatus = { abc: "not_found" };
    expect(validate(m).issues.some((i) => i.field.includes("errorOnStatus"))).toBe(true);
  });
  it("status key 合法(数字)→ ok", () => {
    const m = validManifest();
    m.errorOnStatus = { "404": "not_found", "500": "server_error" };
    expect(validate(m).ok).toBe(true);
  });
  it("status key 合法(Nxx)→ ok", () => {
    const m = validManifest();
    m.errorOnStatus = { "5xx": "server_error" };
    expect(validate(m).ok).toBe(true);
  });
  // —— TDD 新增:value 必须是合法 subtype 字符串 ——
  it("value 非法(任意字符串)→ error", () => {
    const m = validManifest();
    m.errorOnStatus = { "404": "banana" };
    expect(validate(m).issues.some((i) => i.field.includes("errorOnStatus"))).toBe(true);
  });
  it("value 非字符串(数字)→ error", () => {
    const m = validManifest();
    m.errorOnStatus = { "404": 123 };
    expect(validate(m).issues.some((i) => i.field.includes("errorOnStatus"))).toBe(true);
  });
});

// ============================================================================
// 命令名 charset(新:破坏 argv 解析的字符要拦)
// ============================================================================

describe("命令名 charset", () => {
  it("命令名含空格 → error(破坏 argv 解析)", () => {
    const m = validManifest();
    m.namespaces.orders["bad name"] = m.namespaces.orders.list;
    expect(validate(m).issues.some((i) => i.field.includes("bad name"))).toBe(true);
  });
  it("命令名含 / → error", () => {
    const m = validManifest();
    m.namespaces.orders["a/b"] = m.namespaces.orders.list;
    expect(validate(m).issues.some((i) => i.field.includes("a/b"))).toBe(true);
  });
  it("namespace 名含空格 → error", () => {
    const m = validManifest();
    m.namespaces["bad ns"] = m.namespaces.orders;
    expect(validate(m).issues.some((i) => i.field.includes("bad ns"))).toBe(true);
  });
});

// ============================================================================
// pagination.invert 类型(新:非 boolean 要拦)
// ============================================================================

describe("pagination.invert 类型", () => {
  it("invert 为字符串 'yes' → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.response.pagination.complete.invert = "yes" as any;
    expect(validate(m).issues.some((i) => i.field.includes("invert"))).toBe(true);
  });
  it("invert 为数字 1 → error", () => {
    const m = validManifest();
    m.namespaces.orders.list.response.pagination.complete.invert = 1 as any;
    expect(validate(m).issues.some((i) => i.field.includes("invert"))).toBe(true);
  });
  it("invert 为 boolean false → ok", () => {
    const m = validManifest();
    m.namespaces.orders.list.response.pagination.complete.invert = false;
    expect(validate(m).ok).toBe(true);
  });
});

// ============================================================================
// 性能(高性能要求)
// ============================================================================

describe("性能", () => {
  // 阈值留足 CI 慢机余量(本机 ~1ms,CI 慢机可达 6ms+);
  // 真实意图是"性能没退化 10x+",不是绝对毫秒数。
  it("1000 次校验 < 500ms", () => {
    const m = validManifest();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) validate(m);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
  it("大 manifest(100 命令)< 50ms", () => {
    const m = validManifest();
    m.namespaces = {};
    for (let i = 0; i < 100; i++) {
      m.namespaces[`ns${i}`] = {
        cmd: {
          description: `cmd ${i}`,
          http: { method: "GET", path: `/api/${i}` },
          response: { data: "." },
        },
      };
    }
    const start = performance.now();
    validate(m);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

// ============================================================================
// 测试辅助扩展
// ============================================================================

// 给 expect(issues).toContainFieldError 用的自定义 matcher
expect.extend({
  toContainFieldError(received: ManifestIssue[], field: string) {
    const ok = received.some((i) => i.field === field && i.level === "error");
    return {
      pass: ok,
      message: () =>
        `expected issues to contain error for field "${field}", got: ${JSON.stringify(received.map((i) => ({ field: i.field, level: i.level })))}`,
    };
  },
});

interface CustomMatchers<R = unknown> {
  toContainFieldError(field: string): R;
}
declare module "vitest" {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
