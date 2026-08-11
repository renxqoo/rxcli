/**
 * rxx —— 通用执行器:manifest 命令 → cli-sdk CommandSpec
 *
 * manifest 的 `{args, http, response, [input], [operation]}` 描述,包成一个 cli-sdk CommandSpec。
 * run 函数做三件事:
 *   1. 占位符替换(path/query/body/headers → 安全编码后的 RequestOptions)
 *   2. 调 ctx.request(鉴权/401续期/envelope 全部由 cli-sdk 接管)
 *   3. 字段映射(response.data/pagination → {data,meta},对齐 envelope 契约)
 *
 * 参数契约:manifest 的 ManifestArgsSpec 在装配期编译为 Zod schema(cli-sdk 统一输入契约);
 * number 的范围/整数约束仍由 validateArgValues 在 run 内补校验(覆盖 NaN/Infinity 等 coerce 边界)。
 */

import {
  defineCommand,
  errs,
  type CommandSpec,
  type CommandResult,
  type CommandPolicy,
  type WritePolicy,
} from "@renxqoo/agent-data-cli";
import * as zod from "zod";
import type {
  HttpMethod,
  Manifest,
  ManifestCommand,
  ManifestArgsSpec,
  ManifestArgSpec,
  ManifestOperationPolicy,
} from "../manifest/schema.js";
import { fillPath, fillMap, fillBody, PlaceholderError } from "./placeholders.js";
import { mapResponse } from "./response-map.js";
import Ajv2020 from "ajv/dist/2020.js";
import type { RequestOptions } from "@renxqoo/agent-data-cli";

/**
 * 把 manifest 的一个命令,包成 cli-sdk 的 CommandSpec。
 *
 * @param name 命令名(如 "list")
 * @param mc manifest 命令定义
 */
export function manifestToCommand<State = unknown>(
  name: string,
  mc: ManifestCommand,
): CommandSpec<any, unknown, State> {
  if (mc.input) return manifestToStructuredCommand<State>(name, mc);
  const compiled = manifestArgsToZod(mc.args);
  const policy = manifestOperationToPolicy(mc.operation);
  // argv 命令:有 args 走 schema 装载,无 args 走 NoArgs 装载(分支以让 TS 解析 overload)
  const spec = compiled
    ? {
        name,
        description: mc.description,
        args: compiled,
        policy,
        run: makeRunner(mc),
      }
    : {
        name,
        description: mc.description,
        policy,
        run: makeRunner(mc),
      };
  return defineCommand(spec as any) as CommandSpec<any, unknown, State>;
}

/** 生成动态命令的 run:placeholder 替换 → ctx.request → response 映射。 */
function makeRunner(mc: ManifestCommand) {
  return async (ctx: any, args: unknown): Promise<CommandResult | void> => {
    const req = buildRequest(mc, (args ?? {}) as Record<string, unknown>);
    const res = await ctx.request(req);
    const result = mapResponse(res.data, mc.response);
    return { data: result.data, meta: result.meta } as CommandResult;
  };
}

/**
 * 结构化输入(JSON 全文档)命令:manifest.input.jsonSchema → Zod JSON 模式。
 *
 * cli-sdk 的 JSON 模式要求 args.schema 是 ZodObject;这里用 looseObject + superRefine
 * 桥接 ajv(JSON Schema 校验),满足 assertZodObject 同时复用 manifest 的 JSON Schema。
 * 整份校验后的文档作为 run 的唯一入参(即 body 来源)。
 */
function manifestToStructuredCommand<State>(
  name: string,
  mc: ManifestCommand,
): CommandSpec<any, unknown, State> {
  const input = mc.input!;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    loadSchema: undefined,
  });
  const validate = ajv.compile(input.jsonSchema);
  const schema = zod.looseObject({}).check(
    zod.superRefine((value, context) => {
      if (validate(value)) return;
      for (const issue of validate.errors ?? []) {
        context.addIssue({
          code: "custom",
          message: issue.message ?? issue.keyword,
          path: jsonPointerPath(issue.instancePath),
          input: value,
        });
      }
    }),
  );
  const cmd = defineCommand({
    name,
    description: mc.description,
    args: { type: "json", schema },
    policy: manifestOperationToPolicy(mc.operation),
    async run(ctx, input): Promise<CommandResult | void> {
      const req = buildRequest(mc, input as Record<string, unknown>, input);
      const res = await ctx.request<unknown>(req);
      const result = mapResponse(res.data, mc.response);
      return { data: result.data, meta: result.meta } as CommandResult;
    },
  });
  return cmd as CommandSpec<any, unknown, State>;
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
// manifest → Zod / policy 编译
// ============================================================================

/** manifest ManifestArgsSpec → cli-sdk 的 argv schema + 位置参数顺序。 */
function manifestArgsToZod(
  args?: ManifestArgsSpec,
): { schema: zod.ZodObject; pos: string[] } | undefined {
  if (!args || Object.keys(args).length === 0) return undefined;
  const shape: Record<string, zod.ZodType> = {};
  const pos: string[] = [];
  for (const [name, spec] of Object.entries(args)) {
    shape[name] = manifestArgToZodType(spec);
    if (spec.positional) pos.push(name);
  }
  return { schema: zod.object(shape), pos };
}

/** 单个 manifest 参数 → Zod 字段(argv 模式:number 用 coerce,范围/整数由 validateArgValues 补)。 */
function manifestArgToZodType(spec: ManifestArgSpec): zod.ZodType {
  let field: zod.ZodType;
  switch (spec.type) {
    case "boolean":
      field = zod.boolean();
      break;
    case "array":
      field = zod.array(zod.string());
      break;
    case "number":
      field = zod.coerce.number();
      break;
    default:
      field = zod.string();
  }
  if (spec.desc) field = field.describe(spec.desc);
  if (spec.default !== undefined) field = field.default(spec.default);
  else if (!spec.required) field = field.optional();
  return field;
}

/** manifest ManifestOperationPolicy → cli-sdk CommandPolicy。 */
function manifestOperationToPolicy(operation?: ManifestOperationPolicy): CommandPolicy {
  if (!operation || operation.kind === "read") return { mode: "read" };
  const policy: WritePolicy = { mode: "write" };
  if (operation.dryRun) policy.dryRun = true;
  if (operation.confirmation) policy.confirmation = operation.confirmation;
  if (operation.idempotency) {
    policy.idempotency = operation.idempotency.mode;
    if (operation.idempotency.header) policy.idempotencyHeader = operation.idempotency.header;
  }
  return policy;
}

// ============================================================================
// 内部:从 args + http 映射构造 RequestOptions
// ============================================================================

function buildRequest(
  mc: ManifestCommand,
  args: Record<string, unknown>,
  input?: unknown,
): RequestOptions {
  const http = mc.http;
  try {
    // 参数范围校验(AI 高频错误:超大/负数/小数 limit)——在 placeholder 替换前
    validateArgValues(mc, args);
    const path = fillPath(http.path, args);
    const query = http.query ? fillMap(http.query, args) : undefined;
    const headers = http.headers ? fillMap(http.headers, args) : undefined;
    const body = isInputBody(http.body)
      ? selectInput(input, http.body.pointer)
      : http.body
        ? fillBody(http.body, args)
        : undefined;

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

function isInputBody(body: unknown): body is { kind: "input"; pointer?: string } {
  return Boolean(body && typeof body === "object" && (body as any).kind === "input");
}

function selectInput(input: unknown, pointer?: string): unknown {
  if (!pointer || pointer === "") return input;
  if (!pointer.startsWith("/")) {
    throw new errs.ValidationError({
      subtype: "invalid_argument",
      param: "http.body.pointer",
      message: "Input body pointer must be an RFC 6901 JSON Pointer",
    });
  }
  let current: any = input;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object" || !(key in current)) {
      throw new errs.ValidationError({
        subtype: "invalid_argument",
        param: "input",
        message: `Input pointer ${pointer} does not exist in validated input`,
      });
    }
    current = current[key];
  }
  return current;
}

function jsonPointerPath(pointer: string): Array<string | number> {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((segment) => (/^(?:0|[1-9]\d*)$/.test(segment) ? Number(segment) : segment));
}

/**
 * 校验 args 的实际值是否符合 manifest 声明的约束(number 范围/整数)。
 *
 * 针对 AI 高频错误:
 *   - number 类型默认必须整数(除非 manifest 声明 integer:false)
 *   - min/max 边界校验(声明了才查)
 *   - 超大数(Number.isFinite 拦截 Infinity;整数安全范围拦截精度丢失)
 *
 * Zod 已校验了 argv 模式下 number 的可 coercion;这里补范围/整数/有限性。
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
