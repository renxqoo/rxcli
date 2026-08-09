/**
 * approvals —— 审批模块(todo 待办 / action 动作 / resource 资源 / flow 流程)。
 *
 * 端点:
 *   — 待办(approval-todo)—
 *   POST /approval-todo/pending/page     待审批
 *   POST /approval-todo/processed/page   已审批
 *   POST /approval-todo/initiated/page   我发起的
 *   POST /approval-todo/cc/page          抄送我的
 *   GET  /approval-todo/pending/count    待审批数量
 *   — 动作(approval-action)— 全 POST
 *   /approval-action/approve | reject | back | sign | revoke | batch-approve | batch-reject
 *   — 资源(approval-resource)—
 *   POST /approval-resource/push | revoke
 *   GET  /approval-resource/simple-detail/{id} | detail/{id}
 *   — 流程(approval-flow)—
 *   POST /approval-flow/page             流程列表
 *   GET  /approval-flow/get/{id}         流程详情
 *   POST /approval-flow/add | update     新增/更新流程
 *   GET  /approval-flow/enable/{id}?enable=true | disable/{id}?enable=false
 *   GET  /approval-flow/get-by-form-type/{formType}
 *   GET  /approval-flow/status-permission/setting/{formType}
 *   POST /approval-flow/webhook/test
 */

import {
  defineCommands,
  defineCommand,
  errs,
  ValidationError,
  type CommandGroup,
} from "@renxqoo/agent-data-cli";
import { APPROVAL_TODO_KINDS, APPROVAL_ACTIONS, isOneOf } from "../constants.js";
import { unwrap, buildPagePayload, pagedMeta, parseJsonBody, type PagedData } from "../envelope.js";
import { ensureConfirmed } from "./leads.js";

export const approvalsCommands: CommandGroup = defineCommands({
  /** todo:审批待办查询(kind ∈ pending/processed/initiated/cc/count)。 */
  todo: defineCommand<{ kind: string; payload: string }>({
    name: "todo",
    description: "查询审批待办(pending/processed/initiated/cc/count)",
    args: {
      kind: {
        type: "string",
        required: true,
        positional: true,
        desc: "待办类型(pending/processed/initiated/cc/count)",
      },
      payload: {
        type: "string",
        desc: "分页/筛选载荷 JSON(含可选 resourceType: ALL/QUOTATION/CONTRACT/ORDER/INVOICE)",
      },
    },
    async run(args, ctx) {
      if (!isOneOf(args.kind, APPROVAL_TODO_KINDS)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<kind>",
          message: `todo kind 只能是 ${APPROVAL_TODO_KINDS.join("/")},收到 "${args.kind}"`,
        });
      }
      // count 是 GET,其余是 POST 分页
      if (args.kind === "count") {
        const res = await ctx.get(`/approval-todo/pending/count`);
        return { data: unwrap(res) };
      }
      const body = buildPagePayload(args.payload);
      const res = await ctx.post(`/approval-todo/${args.kind}/page`, body);
      const data = unwrap<PagedData>(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** action:审批动作(approve/reject/back/sign/revoke/batch-approve/batch-reject)。 */
  action: defineCommand<{ action: string; data: string; dryRun: boolean; yes: boolean }>({
    name: "action",
    description: "执行审批动作(approve/reject/back/sign/revoke/batch-approve/batch-reject)",
    args: {
      action: {
        type: "string",
        required: true,
        positional: true,
        desc: "动作类型(approve/reject/back/sign/revoke/batch-approve/batch-reject)",
      },
      data: {
        type: "string",
        required: true,
        positional: true,
        desc: "动作数据 JSON(含审批单 ID 等)",
      },
      dryRun: { type: "boolean", desc: "仅校验不提交" },
      yes: { type: "boolean", desc: "跳过确认直接提交" },
    },
    async run(args, ctx) {
      if (!isOneOf(args.action, APPROVAL_ACTIONS)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<action>",
          message: `action 只能是 ${APPROVAL_ACTIONS.join("/")},收到 "${args.action}"`,
        });
      }
      const body = parseJsonBody(args.data, "<data>");
      if (args.dryRun) return { data: null, meta: { dryRun: true } };
      ensureConfirmed(
        args.yes,
        `审批动作 ${args.action}`,
        `rxcordys approvals action ${args.action} '<json>' --yes`,
      );
      const res = await ctx.post(`/approval-action/${args.action}`, body);
      return {
        data: unwrap(res),
        meta: { rollback: `审批动作 ${args.action} 执行后不可自动撤销,需联系发起人或管理员` },
      };
    },
  }),

  /** resource:审批资源(push 推送 / revoke 撤销 / simple-detail / detail)。 */
  resource: defineCommand<{ action: string; arg: string }>({
    name: "resource",
    description: "审批资源操作(push/revoke/simple-detail/detail)",
    args: {
      action: {
        type: "string",
        required: true,
        positional: true,
        desc: "操作(push/revoke/simple-detail/detail)",
      },
      arg: { type: "string", desc: "push/revoke 传 JSON;simple-detail/detail 传 resourceId" },
    },
    async run(args, ctx) {
      switch (args.action) {
        case "push":
        case "revoke": {
          const body = parseJsonBody(args.arg, "<arg>");
          const res = await ctx.post(`/approval-resource/${args.action}`, body);
          return { data: unwrap(res) };
        }
        case "simple-detail":
        case "detail": {
          if (!args.arg) {
            throw new errs.ValidationError({
              subtype: "missing_required",
              param: "<arg>",
              message: `${args.action} 需要 resourceId`,
            });
          }
          const res = await ctx.get(
            `/approval-resource/${args.action}/${encodeURIComponent(args.arg)}`,
          );
          return { data: unwrap(res) };
        }
        default:
          throw new errs.ValidationError({
            subtype: "invalid_argument",
            param: "<action>",
            message: `resource action 只能是 push/revoke/simple-detail/detail,收到 "${args.action}"`,
          });
      }
    },
  }),

  /** flow:审批流程配置(page/get/add/update/enable/disable/by-form/setting/webhook-test)。 */
  flow: defineCommand<{
    action: string;
    arg: string;
    payload: string;
    dryRun: boolean;
    yes: boolean;
  }>({
    name: "flow",
    description: "审批流程配置(page/get/add/update/enable/disable/by-form/setting/webhook-test)",
    args: {
      action: {
        type: "string",
        required: true,
        positional: true,
        desc: "操作(page/get/add/update/enable/disable/by-form/setting/webhook-test)",
      },
      arg: { type: "string", desc: "get/enable/disable/by-form/setting 传 id 或 formType" },
      payload: { type: "string", desc: "page/add/update/webhook-test 的 body JSON" },
      dryRun: { type: "boolean", desc: "仅校验不提交(add/update)" },
      yes: { type: "boolean", desc: "跳过确认直接提交(add/update)" },
    },
    async run(args, ctx) {
      switch (args.action) {
        case "page": {
          const res = await ctx.post(`/approval-flow/page`, buildPagePayload(args.payload));
          const data = unwrap<PagedData>(res);
          return { data: data.list, meta: pagedMeta(data) };
        }
        case "get":
        case "enable":
        case "disable": {
          if (!args.arg) throw missingIdError(args.action);
          const suffix =
            args.action === "enable"
              ? `?enable=true`
              : args.action === "disable"
                ? `?enable=false`
                : "";
          const path =
            args.action === "enable" || args.action === "disable"
              ? `/approval-flow/enable/${encodeURIComponent(args.arg)}${suffix}`
              : `/approval-flow/get/${encodeURIComponent(args.arg)}`;
          const res = await ctx.get(path);
          return { data: unwrap(res) };
        }
        case "by-form":
        case "setting": {
          if (!args.arg) throw missingIdError(args.action, "formType");
          const path =
            args.action === "by-form"
              ? `/approval-flow/get-by-form-type/${encodeURIComponent(args.arg)}`
              : `/approval-flow/status-permission/setting/${encodeURIComponent(args.arg)}`;
          const res = await ctx.get(path);
          return { data: unwrap(res) };
        }
        case "add":
        case "update":
        case "webhook-test": {
          const body = args.payload ? parseJsonBody(args.payload, "<payload>") : {};
          if (args.action !== "webhook-test") {
            if (args.dryRun) return { data: null, meta: { dryRun: true } };
            ensureConfirmed(
              args.yes,
              `审批流程 ${args.action}`,
              `rxcordys approvals flow ${args.action} '<json>' --yes`,
            );
          }
          const res = await ctx.post(`/approval-flow/${args.action}`, body);
          return { data: unwrap(res) };
        }
        default:
          throw new errs.ValidationError({
            subtype: "invalid_argument",
            param: "<action>",
            message: `flow action 不支持 "${args.action}"`,
            hint: "可选:page/get/add/update/enable/disable/by-form/setting/webhook-test",
          });
      }
    },
  }),
});

function missingIdError(action: string, label = "id"): ValidationError {
  return new errs.ValidationError({
    subtype: "missing_required",
    param: "<arg>",
    message: `flow ${action} 需要 ${label}`,
  });
}
