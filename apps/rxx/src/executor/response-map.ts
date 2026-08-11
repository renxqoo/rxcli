/**
 * rxx —— 响应字段映射
 *
 * 把 SaaS 异构响应结构归一成 cli-sdk envelope 契约:
 *   - response.data:从 res.data 提取业务数据(支持 "." / "orders" / "a.b" 路径)
 *   - response.pagination:业务字段 → Pagination 契约(complete/nextToken)
 *
 * 这是"agent 高效准确获取数据"的关键——不管调哪个 SaaS,
 * agent 永远面对同一种 {data, meta} 输出结构。
 */

import type { FieldPath, PaginationFieldMap, ResponseMapping } from "../manifest/schema.js";
import { safeGetField } from "../security.js";

/**
 * 从 res.data 按 path 提取业务数据。
 *
 * 用 safeGetField(不走原型链,拒绝 __proto__/constructor),
 * 防止 HTTP 响应里的危险键污染原型链。
 *
 * @param resData HTTP 响应 body
 * @param path 字段路径:
 *   - `"."` = 整个 res.data
 *   - `"orders"` = res.data.orders
 *   - `"data.items"` = res.data.data.items(点号嵌套逐层下钻)
 *   - 任一层为 null/undefined 或非对象 → 返回 null
 *
 * @example
 *   extractData({ orders: [...] }, "orders") → [...]
 *   extractData({ a: { b: 1 } }, "a.b") → 1
 *   extractData({ x: 1 }, ".") → { x: 1 }
 */
export function extractData(resData: unknown, path: FieldPath): unknown {
  return safeGetField(resData, path);
}

/**
 * 把 SaaS 的分页字段映射成 cli-sdk Pagination 契约。
 *
 * field 支持点号嵌套(如 "paging.next" → resData.paging.next)。
 *
 * @example
 *   // SaaS 返回 { hasMore: true, nextCursor: "abc" }
 *   mapPagination(resData, {
 *     complete: { field: "hasMore", invert: true },  // hasMore=true → complete=false
 *     nextToken: { field: "nextCursor" }
 *   })
 *   → { complete: false, nextToken: "abc" }
 */
export function mapPagination(
  resData: unknown,
  spec: PaginationFieldMap,
): { complete: boolean; pages?: number; items?: number; nextToken?: string } {
  let complete = true;
  if (spec.complete) {
    const raw = readField(resData, spec.complete.field);
    complete = spec.complete.invert ? !raw : !!raw;
  }

  let nextToken: string | undefined;
  if (spec.nextToken) {
    const raw = readField(resData, spec.nextToken.field);
    nextToken = raw === undefined || raw === null ? undefined : String(raw);
  }

  let items: number | undefined;
  if (spec.items) {
    const raw = readField(resData, spec.items.field);
    if (Array.isArray(raw)) items = raw.length;
    else if (typeof raw === "number") items = raw;
  }

  const result: { complete: boolean; pages?: number; items?: number; nextToken?: string } = {
    complete,
  };
  if (nextToken !== undefined) result.nextToken = nextToken;
  if (items !== undefined) result.items = items;
  return result;
}

/** 按 "a.b.c" 点号路径读嵌套字段(用 safeGetField,不走原型链)。 */
function readField(obj: unknown, path: string): unknown {
  const v = safeGetField(obj, path);
  return v === null ? undefined : v;
}

/**
 * 提取额外 meta 字段(从 res.data 按 path 取值,塞进 meta)。
 *
 * @example
 *   mapMeta({ total: 100 }, { totalCount: "total" }) → { totalCount: 100 }
 */
export function mapMeta(
  resData: unknown,
  spec: Record<string, FieldPath> | undefined,
): Record<string, unknown> | undefined {
  if (!spec) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(spec)) {
    out[key] = extractData(resData, path);
  }
  return out;
}

/**
 * 把完整 ResponseMapping 应用到 resData,产出 cli-sdk CommandResult 的 {data, meta}。
 *
 * 这是通用执行器调用的核心:HTTP 响应 → 归一化 → 符合 envelope 契约。
 */
export function mapResponse(
  resData: unknown,
  response: ResponseMapping,
): { data: unknown; meta?: Record<string, unknown> } {
  const data = extractData(resData, response.data);
  const meta: Record<string, unknown> = {};

  if (response.pagination) {
    const p = mapPagination(resData, response.pagination);
    // pagination spec 没声明 items 但 data 是数组 → 从数组长度补 items。
    // 构造新对象而非 mutate mapPagination 返回(防御性,避免重构时引入耦合)。
    const pagination =
      p.items === undefined && Array.isArray(data) ? { ...p, items: data.length } : p;
    meta.pagination = pagination;
    if (pagination.items !== undefined) meta.count = pagination.items;
  } else if (Array.isArray(data)) {
    meta.count = data.length;
  }

  const extra = mapMeta(resData, response.meta);
  if (extra) Object.assign(meta, extra);

  return { data, meta: Object.keys(meta).length > 0 ? meta : undefined };
}
