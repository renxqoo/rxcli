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

import * as z from "zod";
import {
  defineCommands,
  defineCommand,
  errs,
  ValidationError,
  type CommandGroup,
} from "@renxqoo/agent-data-cli";
import { APPROVAL_TODO_KINDS, APPROVAL_ACTIONS, isOneOf } from "../constants.js";
import { unwrap, unwrapPaged, buildPagePayload, pagedMeta, parseJsonBody } from "../envelope.js";

const writePolicy = { mode: "write", dryRun: true, confirmation: "required" } as const;

export const approvalsCommands: CommandGroup = defineCommands({
  /** todo:审批待办查询(kind ∈ pending/processed/initiated/cc/count)。 */
  todo: defineCommand({
    name: "todo",
    description: "查询审批待办(pending/processed/initiated/cc/count)",
    args: {
      schema: z.object({
        kind: z.string().describe("待办类型(pending/processed/initiated/cc/count)"),
        payload: z
          .string()
          .describe("分页/筛选载荷 JSON(含可选 resourceType: ALL/QUOTATION/CONTRACT/ORDER/INVOICE)")
          .optional(),
      }),
      pos: ["kind"],
    },
    async run(ctx, { kind, payload }) {
      if (!isOneOf(kind, APPROVAL_TODO_KINDS)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<kind>",
          message: `todo kind must be ${APPROVAL_TODO_KINDS.join("/")}, got "${kind}"`,
        });
      }
      // count 是 GET,其余是 POST 分页
      if (kind === "count") {
        const res = await ctx.get(`/approval-todo/pending/count`);
        return { data: unwrap(res) };
      }
      const body = buildPagePayload(payload);
      const res = await ctx.post(`/approval-todo/${kind}/page`, body);
      const data = unwrapPaged(res);
      return { data: data.list, meta: pagedMeta(data) };
    },
  }),

  /** action:审批动作(approve/reject/back/sign/revoke/batch-approve/batch-reject)。 */
  action: defineCommand({
    name: "action",
    description: "执行审批动作(approve/reject/back/sign/revoke/batch-approve/batch-reject)",
    args: {
      schema: z.object({
        action: z
          .string()
          .describe("动作类型(approve/reject/back/sign/revoke/batch-approve/batch-reject)"),
        data: z.string().describe("动作数据 JSON(含审批单 ID 等)"),
      }),
      pos: ["action", "data"],
    },
    policy: { mode: "write", dryRun: true, confirmation: "required" },
    async run(ctx, { action, data }) {
      if (!isOneOf(action, APPROVAL_ACTIONS)) {
        throw new errs.ValidationError({
          subtype: "invalid_argument",
          param: "<action>",
          message: `action must be ${APPROVAL_ACTIONS.join("/")}, got "${action}"`,
        });
      }
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/approval-action/${action}`, body);
      return {
        data: unwrap(res),
        meta: { rollback: `审批动作 ${action} 执行后不可自动撤销,需联系发起人或管理员` },
      };
    },
  }),

  /** resource:审批资源(push 推送 / revoke 撤销 / simple-detail / detail)。 */
  resource: defineCommand({
    name: "resource",
    description: "审批资源操作(push/revoke/simple-detail/detail)",
    args: {
      schema: z.object({
        action: z.string().describe("操作(push/revoke/simple-detail/detail)"),
        arg: z
          .string()
          .describe("push/revoke 传 JSON;simple-detail/detail 传 resourceId")
          .optional(),
      }),
      pos: ["action"],
    },
    async run(ctx, { action, arg }) {
      switch (action) {
        case "push":
        case "revoke": {
          const body = parseJsonBody(arg, "<arg>");
          const res = await ctx.post(`/approval-resource/${action}`, body);
          return { data: unwrap(res) };
        }
        case "simple-detail":
        case "detail": {
          if (!arg) {
            throw new errs.ValidationError({
              subtype: "missing_required",
              param: "<arg>",
              message: `${action} requires resourceId`,
            });
          }
          const res = await ctx.get(`/approval-resource/${action}/${encodeURIComponent(arg)}`);
          return { data: unwrap(res) };
        }
        default:
          throw new errs.ValidationError({
            subtype: "invalid_argument",
            param: "<action>",
            message: `resource action must be push/revoke/simple-detail/detail, got "${action}"`,
          });
      }
    },
  }),

  /**
   * flow:审批流程配置的「读」操作(page/get/enable/disable/by-form/setting)。
   *
   * 注:cli-sdk 的 write policy 是命令级,无法对单条 dispatch 命令的部分 action 生效,
   * 故写操作(add/update/webhook-test)已拆为独立命令 flow-add/flow-update/flow-webhook-test,
   * 各自套用 --dry-run / --yes 确认门;此处只保留读 action。
   * (enable/disable 是 GET 幂等开关,保留在此;如需更严格可后续再拆。)
   */
  flow: defineCommand({
    name: "flow",
    description:
      "审批流程配置-读(page/get/enable/disable/by-form/setting;写见 flow-add/flow-update/flow-webhook-test)",
    args: {
      schema: z.object({
        action: z
          .string()
          .describe("操作(page/get/add/update/enable/disable/by-form/setting/webhook-test)"),
        arg: z.string().describe("get/enable/disable/by-form/setting 传 id 或 formType").optional(),
        payload: z.string().describe("page/add/update/webhook-test 的 body JSON").optional(),
      }),
      pos: ["action"],
    },
    async run(ctx, { action, arg, payload }) {
      switch (action) {
        case "page": {
          const res = await ctx.post(`/approval-flow/page`, buildPagePayload(payload));
          const data = unwrapPaged(res);
          return { data: data.list, meta: pagedMeta(data) };
        }
        case "get":
        case "enable":
        case "disable": {
          if (!arg) throw missingIdError(action);
          const suffix =
            action === "enable" ? `?enable=true` : action === "disable" ? `?enable=false` : "";
          const path =
            action === "enable" || action === "disable"
              ? `/approval-flow/enable/${encodeURIComponent(arg)}${suffix}`
              : `/approval-flow/get/${encodeURIComponent(arg)}`;
          const res = await ctx.get(path);
          return { data: unwrap(res) };
        }
        case "by-form":
        case "setting": {
          if (!arg) throw missingIdError(action, "formType");
          const path =
            action === "by-form"
              ? `/approval-flow/get-by-form-type/${encodeURIComponent(arg)}`
              : `/approval-flow/status-permission/setting/${encodeURIComponent(arg)}`;
          const res = await ctx.get(path);
          return { data: unwrap(res) };
        }
        case "add":
        case "update":
        case "webhook-test":
          // 写操作已拆为独立命令(flow-add/flow-update/flow-webhook-test)以套用写入确认门。
          // cli-sdk 的 write policy 是命令级,无法对单条 dispatch 命令的部分 action 生效。
          throw new errs.ValidationError({
            subtype: "invalid_argument",
            param: "<action>",
            message: `flow ${action} is a write and has moved to a dedicated command for confirmation gating`,
            hint: `Use: approvals flow-${action} <data> [--dry-run] [--yes]`,
          });
        default:
          throw new errs.ValidationError({
            subtype: "invalid_argument",
            param: "<action>",
            message: `flow action unsupported: "${action}"`,
            hint: "Valid: page/get/add/update/enable/disable/by-form/setting/webhook-test",
          });
      }
    },
  }),

  /** flow-add:新增审批流程配置(独立写命令,套用 --dry-run / --yes)。 */
  "flow-add": defineCommand({
    name: "flow-add",
    description: "新增审批流程配置(原 flow add;独立命令以套用写入确认门)",
    args: {
      schema: z.object({ data: z.string().describe("审批流程配置 JSON") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/approval-flow/add`, body);
      return {
        data: unwrap(res),
        meta: { rollback: "审批流程新增后可通过 approvals flow-update 或管理界面调整" },
      };
    },
  }),

  /** flow-update:更新审批流程配置(独立写命令)。 */
  "flow-update": defineCommand({
    name: "flow-update",
    description: "更新审批流程配置(原 flow update;独立命令以套用写入确认门)",
    args: {
      schema: z.object({ data: z.string().describe("审批流程配置 JSON(含 id)") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/approval-flow/update`, body);
      return { data: unwrap(res) };
    },
  }),

  /** flow-webhook-test:触发审批流程 webhook 测试(独立写命令)。 */
  "flow-webhook-test": defineCommand({
    name: "flow-webhook-test",
    description: "触发审批流程 webhook 测试(原 flow webhook-test;独立命令以套用写入确认门)",
    args: {
      schema: z.object({ data: z.string().describe("webhook 测试 JSON") }),
      pos: ["data"],
    },
    policy: writePolicy,
    async run(ctx, { data }) {
      const body = parseJsonBody(data, "<data>");
      const res = await ctx.post(`/approval-flow/webhook/test`, body);
      return { data: unwrap(res) };
    },
  }),
});

function missingIdError(action: string, label = "id"): ValidationError {
  return new errs.ValidationError({
    subtype: "missing_required",
    param: "<arg>",
    message: `flow ${action} requires ${label}`,
  });
}
