/**
 * rxopen 统一输出格式工具:上游 API 响应解包 + 分页/列表 meta 构造。
 *
 * 上游统一响应结构(Common.buildJson):
 *   { code: 200, message, data }
 *   - code === 200 → 成功,data 为业务数据
 *   - 否则 → 业务/参数错误(message 有原因)
 *
 * 多数接口的 data 是数组(热搜榜)或对象(详情)。部分接口(60s/rss)返回 XML,
 * 由调用方单独处理,不走本解包。
 *
 * 错误处理:400/404/429 由 errorOnStatus 自动 throw;5xx 统一在此处理
 * (上游 500 时 message 常含自身解析失败信息,如 "Unexpected token '<'",
 * 需美化成对用户/agent 友好的提示)。
 */

import { errs, type Meta, type TransportResponse } from "@renxqoo/agent-data-cli";

/** 上游 API 响应的 data 字段类型。 */
interface SixtyEnvelope {
  code?: number;
  message?: string | null;
  data?: unknown;
}

/** 上游成功码。 */
export const SUCCESS_CODE = 200;

/**
 * 解包上游响应:成功返回 data,业务错误(非 200)或 HTTP 5xx 抛 APIError。
 *
 * 400/404/429 已由 errorOnStatus 在请求层 throw;5xx 不配 errorOnStatus,
 * 统一走到这里处理(message 美化)。
 */
export function unwrap<T = unknown>(res: TransportResponse): T {
  // HTTP 5xx:上游服务异常(可能返回 HTML 错误页或含解析失败信息的 JSON)
  if (res.status >= 500) {
    throw new errs.APIError({
      subtype: "server_error",
      code: res.status,
      message: friendlyServerError(res),
      retryable: true,
    });
  }

  const env = res.data as SixtyEnvelope | undefined;
  // 非标准统一输出格式(无 code 字段):HTTP 非 2xx 由 errorOnStatus 兜底;2xx 原样返回
  if (!env || typeof env.code !== "number") {
    return (res.data as T) ?? (null as unknown as T);
  }
  if (env.code !== SUCCESS_CODE) {
    throw new errs.APIError({
      subtype: mapCodeToSubtype(env.code),
      code: env.code,
      message: friendlyMessage(env.code, env.message),
      retryable: env.code >= 500,
    });
  }
  return env.data as T;
}

/**
 * 美化上游 5xx 错误消息。
 * 上游 500 时 message 常含自身数据源解析失败信息(如 "Unexpected token '<'"、
 * "is not valid JSON"),对用户/agent 无意义,替换成友好提示。
 */
function friendlyServerError(res: TransportResponse): string {
  const env = res.data as SixtyEnvelope | undefined;
  const raw = env?.message;
  if (raw && isUpstreamParseFailure(raw)) {
    return "Upstream service temporarily unavailable (data source error), please retry later";
  }
  return raw ?? `Upstream service error (HTTP ${res.status})`;
}

/** 美化业务错误消息(200 + code≠200 场景)。5xx 的 parse failure 统一替换。 */
function friendlyMessage(code: number, message: string | null | undefined): string {
  const base = message ?? `upstream API error code=${code}`;
  if (code >= 500 && isUpstreamParseFailure(base)) {
    return "Upstream service temporarily unavailable (data source error), please retry later";
  }
  return base;
}

/** 检测 message 是否是上游数据源解析失败的典型特征(JSON parse 错误)。 */
function isUpstreamParseFailure(msg: string): boolean {
  return (
    msg.includes("Unexpected token") ||
    msg.includes("is not valid JSON") ||
    msg.includes("<!DOCTYPE") ||
    msg.includes("<html")
  );
}

/** 上游业务码 → cli-sdk subtype 映射(须用 SUBTYPE_REGISTRY 已登记的 subtype)。 */
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
 * 为数组结果构造 meta(count)。多数热搜接口上游固定条数(≤50),无续拉概念。
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
