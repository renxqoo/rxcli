/**
 * rx60s 统一输出格式工具:60s API 响应解包 + 分页/列表 meta 构造。
 *
 * 60s 统一响应结构(Common.buildJson):
 *   { code: 200, message, data }
 *   - code === 200 → 成功,data 为业务数据
 *   - 否则 → 业务/参数错误(message 有原因)
 *
 * 多数接口的 data 是数组(热搜榜)或对象(详情)。部分接口(60s/rss)返回 XML,
 * 由调用方单独处理,不走本解包。
 */

import { errs, type Meta, type TransportResponse } from "@renxqoo/agent-data-cli";

/** 60s 统一统一输出格式的 data 字段类型。 */
interface SixtyEnvelope {
  code?: number;
  message?: string | null;
  data?: unknown;
}

/** 60s 成功码。 */
export const SUCCESS_CODE = 200;

/**
 * 解包 60s 响应:成功返回 data,业务错误(非 200)抛 APIError。
 *
 * 60s 业务错误一般 HTTP 状态码也对应(400/404/500),已由 errorOnStatus 兜底;
 * 但个别接口可能 HTTP 200 + code≠200,这里再校验一道保证语义正确。
 */
export function unwrap<T = unknown>(res: TransportResponse): T {
  const env = res.data as SixtyEnvelope | undefined;
  // 非标准统一输出格式(无 code 字段):HTTP 非 2xx 由 errorOnStatus 兜底;2xx 原样返回
  if (!env || typeof env.code !== "number") {
    return (res.data as T) ?? (null as unknown as T);
  }
  if (env.code !== SUCCESS_CODE) {
    const message = env.message ?? `60s 接口错误 code=${env.code}`;
    throw new errs.APIError({
      subtype: mapCodeToSubtype(env.code),
      code: env.code,
      message,
    });
  }
  return env.data as T;
}

/** 60s 业务码 → cli-sdk subtype 映射(须用 SUBTYPE_REGISTRY 已登记的 subtype)。 */
function mapCodeToSubtype(code: number): string {
  if (code === 400) return "invalid_argument";
  if (code === 401 || code === 403) return "forbidden";
  if (code === 404) return "not_found";
  if (code === 429) return "rate_limited";
  if (code >= 500) return "server_error";
  return "server_error";
}

/** 默认请求 query:强制 json 编码,拿结构化数据(text/markdown 由 CLI 本地渲染)。 */
export const JSON_QUERY = { encoding: "json" } as const;

/**
 * 为数组结果构造 meta(count)。60s 多数热搜接口上游固定条数(≤50),无续拉概念。
 */
export function countMeta<T>(list: T[]): Meta {
  return { count: list.length, pagination: { complete: true, items: list.length, pages: 1 } };
}

/** 构造带额外 query 的请求参数(合并 JSON_QUERY)。 */
export function withQuery(
  extra?: Record<string, string | number | boolean | undefined | null>,
): Record<string, string | number | boolean> {
  const merged: Record<string, string | number | boolean> = { ...JSON_QUERY };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null) continue;
      merged[k] = v;
    }
  }
  return merged;
}
