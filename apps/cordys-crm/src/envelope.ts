/**
 * rxcordys 统一输出格式工具:Cordys 统一响应解包 + 分页载荷构造 + 分页 meta。
 *
 * Cordys 统一响应结构:
 *   { code: 100200, message, messageDetail, data }
 *   - code === 100200 → 成功,data 为业务数据
 *   - 否则 → 业务错误(message/messageDetail 有原因)
 *
 * 列表端点 data = { list, total, current, pageSize }(无 hasMore,需自行计算 complete)。
 */

import { errs, type Meta, type TransportResponse } from "@renxqoo/agent-data-cli";
import { DEFAULT_PAGE_PAYLOAD, SUCCESS_CODE, type PagePayload } from "./constants.js";

/** Cordys 统一统一输出格式的 data 字段类型。 */
interface CordysEnvelope {
  code?: number;
  message?: string | null;
  messageDetail?: string | null;
  data?: unknown;
}

/**
 * 解包 Cordys 响应:成功返回 data,业务错误(非 100200)抛 APIError。
 *
 * 注意:Cordys 业务错误可能 HTTP 200 + code≠100200,所以必须解包校验,
 * 不能只靠 HTTP status(errorOnStatus 兜不住这种)。
 */
export function unwrap<T = unknown>(res: TransportResponse): T {
  const env = res.data as CordysEnvelope | undefined;
  // 非标准统一输出格式(无 code 字段):HTTP 非 2xx 由 errorOnStatus 兜底;2xx 原样返回
  if (!env || typeof env.code !== "number") {
    return (res.data as T) ?? (null as unknown as T);
  }
  if (env.code !== SUCCESS_CODE) {
    const detail = env.messageDetail ? ` (${env.messageDetail})` : "";
    const message = env.message
      ? `${env.message}${detail}`
      : `Cordys 业务错误 code=${env.code}${detail}`;
    throw new errs.APIError({
      subtype: mapCordysCodeToSubtype(env.code),
      code: env.code,
      message,
      hint: env.messageDetail ?? undefined,
    });
  }
  return env.data as T;
}

/** Cordys 业务码 → cli-sdk subtype 映射(常见的几个)。 */
function mapCordysCodeToSubtype(code: number): string {
  // Cordys 文档枚举:ACCESS_DENIED / INVALID_KEY / INVALID_REQUEST / INVALID_FILTER
  // 这些是字符串而非数字码,但失败时 code 字段会是其他数值。按范围兜底映射。
  if (code === 401 || code === 403) return "forbidden";
  if (code === 404) return "not_found";
  if (code === 429) return "rate_limited";
  if (code >= 500) return "server_error";
  return "server_error";
}

/** 列表分页响应的 data 结构。 */
export interface PagedData<T = unknown> {
  list: T[];
  total: number;
  current: number;
  pageSize: number;
}

/**
 * 构造 page 请求载荷:默认值 + 用户 JSON 合并。
 * 非字符串入参当 keyword(对齐 Cordys 原版:非 JSON 字符串 = 模糊搜索关键词)。
 */
export function buildPagePayload(
  input?: string | Record<string, unknown>,
): PagePayload & Record<string, unknown> {
  const base = structuredClone(DEFAULT_PAGE_PAYLOAD) as PagePayload;
  if (input === undefined || input === "") return base;
  if (typeof input === "string") {
    // 尝试解析为 JSON;失败则当 keyword
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return mergePayload(base, parsed as Record<string, unknown>);
      }
      // JSON 但非对象(如纯数字/字符串),当 keyword
      base.keyword = input;
      return base;
    } catch {
      base.keyword = input;
      return base;
    }
  }
  return mergePayload(base, input);
}

/** 合并 page payload:用户值覆盖默认值,current/pageSize 保底 ≥1。 */
function mergePayload(
  base: PagePayload,
  user: Record<string, unknown>,
): PagePayload & Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base, ...user };
  // 保底:current/pageSize 不合法时回退默认;pageSize 上限 200(防 Cordys 拒大值)
  if (typeof merged.current !== "number" || merged.current < 1) merged.current = 1;
  if (typeof merged.pageSize !== "number" || merged.pageSize < 1) merged.pageSize = 30;
  if ((merged.pageSize as number) > 200) merged.pageSize = 200;
  return merged as PagePayload & Record<string, unknown>;
}

/**
 * 从分页响应构造 meta(count + pagination.complete)。
 * complete 判定:current * pageSize >= total(无 hasMore 字段)。
 */
export function pagedMeta<T>(paged: PagedData<T>): Meta {
  const { list, total, current, pageSize } = paged;
  const complete = current * pageSize >= total;
  return {
    count: list.length,
    pagination: {
      complete,
      items: list.length,
      pages: 1,
      nextToken: complete ? undefined : String(current + 1),
    },
  };
}

/** 安全解析 JSON 字符串(写入命令的 body 参数);失败抛 ValidationError。 */
export function parseJsonBody(raw: string | undefined, param: string): unknown {
  if (raw === undefined || raw === "") {
    throw new errs.ValidationError({
      subtype: "missing_required",
      param,
      message: `缺少 ${param}(JSON 字符串)`,
      hint: `传入 JSON,如 '{"name":"客户A"}'`,
    });
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new errs.ValidationError({
      subtype: "invalid_argument",
      param,
      message: `${param} 不是合法 JSON: ${raw}`,
      hint: "检查 JSON 引号/逗号是否闭合",
      cause: cause instanceof Error ? cause : undefined,
    });
  }
}
