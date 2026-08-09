/**
 * rxcordys 模块常量 + 默认请求载荷。
 *
 * Cordys 的核心设计是「模块作为路径段」:
 *   - 单层模块(lead/account/opportunity/contact/contract/order)→ /lead/page、/account/{id}
 *   - 斜杠模块(contract/payment-plan、opportunity/quotation、account/contact)→ /contract/payment-plan/page
 * 命令统一接收 <module> 参数,拼出路径,无需为每个模块单独写命令。
 */

/** Cordys 成功业务码(统一信封 { code, message, messageDetail, data })。 */
export const SUCCESS_CODE = 100200;

/** 一级模块(无斜杠),支持 view/get/page/search/follow 等通用命令。 */
export const PRIMARY_MODULES = [
  "lead",
  "account",
  "opportunity",
  "contact",
  "contract",
  "order",
] as const;

/** 支持写入的模块(add/update/form)。斜杠模块代表子资源。 */
export const WRITE_MODULES = [
  "lead",
  "account",
  "opportunity",
  "account/contact",
  "lead/follow/plan",
  "lead/follow/record",
  "account/follow/plan",
  "account/follow/record",
  "opportunity/follow/plan",
  "opportunity/follow/record",
  "contract",
  "contract/payment-plan",
  "contract/payment-record",
  "invoice",
  "contract/business-title",
  "opportunity/quotation",
  "order",
] as const;

/** 支持 batch-update 的模块子集。 */
export const BATCH_UPDATE_MODULES = [
  "lead",
  "account",
  "opportunity",
  "account/contact",
  "contract",
  "order",
] as const;

/** 支持跟进(follow plan/record)的一级模块。 */
export const FOLLOW_MODULES = ["lead", "account", "opportunity"] as const;

/** page 请求的默认载荷(merge 时用户 JSON 覆盖默认值)。 */
export const DEFAULT_PAGE_PAYLOAD = {
  current: 1,
  pageSize: 30,
  sort: {},
  combineSearch: { searchMode: "AND" as const, conditions: [] as unknown[] },
  keyword: "",
  viewId: "ALL",
  filters: [] as unknown[],
};

export type PagePayload = typeof DEFAULT_PAGE_PAYLOAD;

/** 视图列表支持的一级模块(对应 /{module}/view/list)。 */
export const VIEW_MODULES = [
  "lead",
  "opportunity",
  "account",
  "contact",
  "contract",
  "order",
] as const;

/** 统计(首页)搜索类型。 */
export const HOME_SEARCH_TYPES = ["ALL", "SELF", "DEPARTMENT"] as const;

/** 审批待办类型。 */
export const APPROVAL_TODO_KINDS = ["pending", "processed", "initiated", "cc", "count"] as const;

/** 审批动作类型。 */
export const APPROVAL_ACTIONS = [
  "approve",
  "reject",
  "back",
  "sign",
  "revoke",
  "batch-approve",
  "batch-reject",
] as const;

/** 集合辅助:判断值是否在只读元组里(运行时校验用)。 */
export function isOneOf<T extends string>(value: string, list: readonly T[]): value is T {
  return (list as readonly string[]).includes(value);
}
