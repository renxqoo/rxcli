/**
 * rxx —— 占位符替换(安全关键模块)
 *
 * manifest 的 http.path/query/body/headers 含 `{argName}` 占位符,
 * 运行时用 args 值替换。
 *
 * 安全核心:path 占位符用 security.ts 的 isSafePathSegment 防 path traversal,
 * 覆盖 `..`/`.`/`/`/`\`/预编码 `%2e` 等绕过。
 *
 * 占位符语法刻意最小化:只有 `{argName}`,不支持表达式/条件/循环。
 * 这是边界,不是缺陷——避免滑向"JSON 里的编程语言"。
 */

import { isSafePathSegment } from "../security.js";

/**
 * 占位符正则:`{name}`,name = 字母/数字/下划线/连字符。
 *
 * 连字符支持 `{my-arg}` 形态的参数名(validate.ts 不限制 arg 名 charset,
 * kebab-case 是常见命名)。连字符在字符类末尾,是字面量(非范围)。
 */
const PLACEHOLDER = /\{([\w-]+)\}/g;

/**
 * 替换 path 模板的占位符。安全关键。
 *
 * 规则:
 *   1. 参数缺失 → 抛错(必填 path 参数不能缺)
 *   2. 用 isSafePathSegment 检查原值(拒绝 `..`/`.`/`/`/`\`/预编码)
 *   3. encodeURIComponent 编码后返回
 *
 * @example
 *   fillPath("/orders/{id}", { id: "ord_123" }) → "/orders/ord_123"
 *   fillPath("/orders/{id}", { id: ".." }) → 抛错(path traversal)
 *   fillPath("/orders/{id}", { id: "a/b" }) → 抛错(path traversal)
 *   fillPath("/orders/{id}", {}) → 抛错(缺 id)
 */
export function fillPath(template: string, args: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const val = args[key];
    if (val === undefined || val === null) {
      throw new PlaceholderError(`Missing required path parameter: ${key}`, key);
    }
    const str = String(val);
    // 区分错误类型给精确提示(AI 常见错误:空值/空格/引号包裹/路径穿越)
    if (str === "") {
      throw new PlaceholderError(`Path parameter ${key} is empty (provide a non-empty value)`, key);
    }
    if (str.trim() === "") {
      throw new PlaceholderError(
        `Path parameter ${key} is all whitespace: "${str}" (provide a non-empty value)`,
        key,
      );
    }
    if (str !== str.trim()) {
      throw new PlaceholderError(
        `Path parameter ${key} has leading/trailing whitespace: "${str}" (trim it first)`,
        key,
      );
    }
    // AI 常把引号当字面传(复制粘贴)——裸引号包裹几乎都是错误
    if (/^['"].*['"]$/.test(str)) {
      throw new PlaceholderError(
        `Path parameter ${key} is wrapped in quotes: ${str} (remove the surrounding quotes)`,
        key,
      );
    }
    // path traversal 防护:用统一的安全原语(拒绝 ..、.、/、\、预编码)
    if (!isSafePathSegment(str)) {
      throw new PlaceholderError(
        `Path parameter ${key} is not a safe path segment (path traversal blocked): ${str}`,
        key,
      );
    }
    return encodeURIComponent(str);
  });
}

/**
 * 替换 query/body/headers 模板的占位符。
 *
 * 规则:
 *   1. 占位符值转字符串;undefined/null → 空字符串
 *   2. 整个值替换后若为空字符串 → 该键省略(不发)
 *   3. 非 string 值直接保留(数字/布尔/对象——body 允许结构化值)
 *
 * @example
 *   fillMap({ limit: "{limit}", cursor: "{cursor}" }, { limit: 10 }) → { limit: "10" }
 *   (cursor 缺失 → 空字符串 → 省略)
 */
export function fillMap(
  template: Record<string, string>,
  args: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(template)) {
    if (typeof v !== "string") {
      out[k] = String(v);
      continue;
    }
    const filled = v.replace(PLACEHOLDER, (_match, key: string) => {
      const val = args[key];
      return val === undefined || val === null ? "" : String(val);
    });
    if (filled === "") continue; // 空值省略(不发)
    out[k] = filled;
  }
  return out;
}

/**
 * 替换 body 模板。递归处理嵌套对象/数组。
 *
 * 语义(每个值按类型处理):
 *   - string 含占位符:所有占位符都有值 → 替换;任一缺失 → 该键/元素省略
 *   - string 不含占位符:原样保留
 *   - 对象:递归(省略后只剩有效键;空对象保留为 {})
 *   - 数组:递归每个元素(占位符缺失的元素从数组移除)
 *   - 其他(数字/布尔/null 等):原样保留
 *
 * 不修改输入 template(深拷贝语义)。
 *
 * @example
 *   fillBody({ name: "{name}", price: "{price}" }, { name: "Widget", price: 990 })
 *     → { name: "Widget", price: "990" }
 *   fillBody({ a: "{x}" }, {}) → {} (x 缺失,省略)
 *   fillBody({ outer: { inner: "{x}" } }, { x: "v" }) → { outer: { inner: "v" } }
 *   fillBody({ outer: { inner: "{x}" } }, {}) → { outer: {} } (inner 省略,outer 保留)
 *   fillBody({ tags: ["{a}", "fixed"] }, { a: "x" }) → { tags: ["x", "fixed"] }
 */
export function fillBody(
  template: Record<string, unknown>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return fillValue(template, args) as Record<string, unknown>;
}

/**
 * 递归核心:对任意值做占位符替换。
 *
 * @returns
 *   - string 含占位符且全有值 → 替换后的 string
 *   - string 含占位符且有缺失 → SENTINEL_SKIP(调用方据此省略键/元素)
 *   - 其他 string/number/boolean/null → 原样
 *   - 对象 → 递归后的新对象(可能空)
 *   - 数组 → 递归后的新数组(占位符缺失的元素被移除)
 */
const SENTINEL_SKIP: unique symbol = Symbol("skip");

function fillValue(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    if (!value.includes("{")) return value;
    const placeholders = [...value.matchAll(PLACEHOLDER)].map((m) => m[1]!);
    const allPresent = placeholders.every((p) => args[p] !== undefined && args[p] !== null);
    if (!allPresent) return SENTINEL_SKIP;
    return value.replace(PLACEHOLDER, (_match, key: string) => String(args[key]));
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const el of value) {
      const filled = fillValue(el, args);
      if (filled !== SENTINEL_SKIP) out.push(filled);
    }
    return out;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const filled = fillValue(v, args);
      if (filled !== SENTINEL_SKIP) out[k] = filled;
    }
    return out;
  }
  return value;
}

/** 占位符替换错误。 */
export class PlaceholderError extends Error {
  constructor(
    message: string,
    readonly param: string,
  ) {
    super(message);
    this.name = "PlaceholderError";
  }
}
