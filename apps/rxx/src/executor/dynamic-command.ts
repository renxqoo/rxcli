/**
 * rxx —— 通用执行器:manifest 命令 → cli-sdk CommandSpec
 *
 * manifest 的 `{args, http, response}` 三段描述,包成一个 cli-sdk CommandSpec。
 * run 函数做三件事:
 *   1. 占位符替换(path/query/body/headers → 安全编码后的 RequestOptions)
 *   2. 调 ctx.request(鉴权/401续期/envelope 全部由 cli-sdk 接管)
 *   3. 字段映射(response.data/pagination → {data,meta},对齐 envelope 契约)
 *
 * manifest.args 结构与 cli-sdk ArgsSpec 对齐,零转换复用。
 */

import {
  defineCommand,
  errs,
  type CommandSpec,
  type CommandContext,
  type CommandResult,
} from "@renxqoo/agent-data-cli";
import type { HttpMethod, Manifest, ManifestCommand } from "../manifest/schema.js";
import { fillPath, fillMap, fillBody, PlaceholderError } from "./placeholders.js";
import { mapResponse } from "./response-map.js";

/**
 * 把 manifest 的一个命令,包成 cli-sdk 的 CommandSpec。
 *
 * @param name 命令名(如 "list")
 * @param mc manifest 命令定义
 */
export function manifestToCommand<State = unknown>(
  name: string,
  mc: ManifestCommand,
): CommandSpec<Record<string, unknown>, unknown, State> {
  return defineCommand<Record<string, unknown>, unknown, State>({
    name,
    description: mc.description,
    // manifest.args 结构对齐 ArgsSpec,直接复用
    args: mc.args as Record<string, any> | undefined,
    async run(
      args: Record<string, unknown>,
      ctx: CommandContext<State>,
    ): Promise<CommandResult | void> {
      const req = buildRequest(mc, args);
      const res = await ctx.request<unknown>(req);
      const result = mapResponse(res.data, mc.response);
      return { data: result.data, meta: result.meta } as CommandResult;
    },
  });
}

/**
 * 把完整 manifest 的 namespaces/commands,转成 defineCli 需要的结构。
 * 返回 { commands, namespaces },可同时喂给 defineCli 和 skill 生成器。
 */
export function manifestToCommands<State = unknown>(
  m: Manifest,
): {
  commands: Record<string, CommandSpec<any, unknown, State>>;
  namespaces: Record<string, Record<string, CommandSpec<any, unknown, State>>>;
} {
  const commands: Record<string, CommandSpec<any, unknown, State>> = {};
  const namespaces: Record<string, Record<string, CommandSpec<any, unknown, State>>> = {};

  if (m.commands) {
    for (const [cmdName, mc] of Object.entries(m.commands)) {
      commands[cmdName] = manifestToCommand<State>(cmdName, mc);
    }
  }

  if (m.namespaces) {
    for (const [nsName, group] of Object.entries(m.namespaces)) {
      // inline 命令组转换(原 manifestToCommandGroup,只此处用)
      const nsCmds: Record<string, CommandSpec<any, unknown, State>> = {};
      for (const [cmdName, mc] of Object.entries(group)) {
        nsCmds[cmdName] = manifestToCommand<State>(cmdName, mc);
      }
      namespaces[nsName] = nsCmds;
    }
  }

  return { commands, namespaces };
}

// ============================================================================
// 内部:从 args + http 映射构造 RequestOptions
// ============================================================================

import type { RequestOptions } from "@renxqoo/agent-data-cli";

function buildRequest(mc: ManifestCommand, args: Record<string, unknown>): RequestOptions {
  const http = mc.http;
  try {
    // 参数范围校验(AI 高频错误:超大/负数/小数 limit)——在 placeholder 替换前
    validateArgValues(mc, args);
    const path = fillPath(http.path, args);
    const query = http.query ? fillMap(http.query, args) : undefined;
    const headers = http.headers ? fillMap(http.headers, args) : undefined;
    const body = http.body ? fillBody(http.body, args) : undefined;

    const req: RequestOptions = { method: http.method as HttpMethod, path };
    if (query && Object.keys(query).length > 0) req.query = query;
    if (body && Object.keys(body).length > 0) req.body = body;
    if (headers && Object.keys(headers).length > 0) req.headers = headers;
    return req;
  } catch (err) {
    if (err instanceof PlaceholderError) {
      throw new errs.ValidationError({
        subtype: "missing_required",
        param: err.param,
        message: err.message,
        hint: `Provide --${err.param} <value>`,
      });
    }
    throw err;
  }
}

/**
 * 校验 args 的实际值是否符合 manifest 声明的约束(number 范围/整数)。
 *
 * 针对 AI 高频错误:
 *   - number 类型默认必须整数(除非 manifest 声明 integer:false)
 *   - min/max 边界校验(声明了才查)
 *   - 超大数(Number.isFinite 拦截 Infinity;整数安全范围拦截精度丢失)
 *
 * cli-sdk 已校验了 type(字符串能转 number)、required。这里补范围/整数。
 */
function validateArgValues(mc: ManifestCommand, args: Record<string, unknown>): void {
  if (!mc.args) return;
  for (const [name, spec] of Object.entries(mc.args)) {
    if (spec.type !== "number") continue;
    const raw = args[name];
    if (raw === undefined || raw === null) continue; // required 由 cli-sdk 查
    // cli-sdk 把 number 参数解析为 number 类型,但防御性再转一次
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) {
      throw new errs.ValidationError({
        subtype: "out_of_range",
        param: name,
        message: `--${name} is not a finite number: ${raw}`,
        hint: `Provide a finite number for --${name}.`,
      });
    }
    const mustInteger = spec.integer !== false; // 默认整数
    if (mustInteger && !Number.isInteger(n)) {
      throw new errs.ValidationError({
        subtype: "out_of_range",
        param: name,
        message: `--${name} must be an integer, got: ${raw}`,
        hint: `Provide an integer for --${name}.`,
      });
    }
    if (spec.min !== undefined && n < spec.min) {
      throw new errs.ValidationError({
        subtype: "out_of_range",
        param: name,
        message: `--${name} must be >= ${spec.min}, got: ${n}`,
        hint: `Provide a value >= ${spec.min} for --${name}.`,
      });
    }
    if (spec.max !== undefined && n > spec.max) {
      throw new errs.ValidationError({
        subtype: "out_of_range",
        param: name,
        message: `--${name} must be <= ${spec.max}, got: ${n}`,
        hint: `Provide a value <= ${spec.max} for --${name}.`,
      });
    }
  }
}
