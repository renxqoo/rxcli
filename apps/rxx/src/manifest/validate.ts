/**
 * rxx —— manifest 校验工具(高性能、纯函数、零 IO)
 *
 * 设计原则:
 *   1. 纯函数:不抛异常,返回结构化结果 { ok, issues }
 *   2. 收集所有错误:不是遇到第一个就停(让用户一次看到全部问题)
 *   3. 高性能:纯同步遍历,无正则编译热路径,1000 次 < 100ms
 *   4. 可复用:不依赖 cli-sdk,任何工具都能用这个校验 manifest
 *
 * issue 结构带 level(error/warning)+ field(精确定位)+ message + 可选 hint。
 * loader/init 用 level=error 的 issue 决定是否拒绝。
 */

import type {
  ManifestCommand,
  ManifestCommandGroup,
  ManifestArgSpec,
  ManifestArgType,
} from "./schema.js";
import { isPrivateHost, isSafeServiceName } from "../security.js";

// ============================================================================
// 公开类型
// ============================================================================

export type ManifestErrorLevel = "error" | "warning";

export interface ManifestIssue {
  level: ManifestErrorLevel;
  /** 精确字段路径(如 "namespaces.orders.list.http.method")。 */
  field: string;
  message: string;
  /** 可选:修复提示。 */
  hint?: string;
}

/**
 * manifest 校验错误(带字段名,供 errors.ts 展示精确 param)。
 * 从原 validator.ts 搬入——validator.ts 已删除,validate.ts 是唯一验证入口。
 */
export class ManifestValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

export interface ValidateOptions {
  /** 允许 HTTP(本地开发)。默认 false=强制 HTTPS。 */
  allowInsecure?: boolean;
  /** 允许内网 endpoint(本地开发)。默认 false=SSRF 防护。 */
  allowPrivateEndpoints?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  issues: ManifestIssue[];
}

// ============================================================================
// 常量
// ============================================================================

const VALID_METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const VALID_ARG_TYPES: ReadonlySet<ManifestArgType> = new Set([
  "string",
  "number",
  "boolean",
  "array",
]);
const VALID_AUTH_FLOWS: ReadonlySet<string> = new Set([
  "device",
  "authorization_code",
  "client_credentials",
]);

// 框架保留参数名(和 cli-sdk RESERVED_FRAMEWORK_ARGS 对齐;接受轻微重复,不污染 cli-sdk API)
const RESERVED_ARG_NAMES: ReadonlySet<string> = new Set(["json", "api-key", "help", "version"]);

// 命令名/namespace 名 charset:字母数字+连字符+下划线。
// 拒绝空格、/、\ 等(破坏 argv 解析);不强制小写(namespace 可大写如驼峰场景)。
const CMD_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

// 合法 errorOnStatus value(cli-sdk SUBTYPE_REGISTRY 已登记的 subtype)。
// 和 cli-sdk 对齐——这里列一份,避免 import cli-sdk(保留 validate 零依赖特性)。
const VALID_ERROR_SUBTYPES: ReadonlySet<string> = new Set([
  "invalid_argument",
  "missing_required",
  "out_of_range",
  "no_token",
  "token_expired",
  "token_revoked",
  "no_credentials",
  "no_refresh_token",
  "missing_scope",
  "app_permission_denied",
  "forbidden",
  "missing_config",
  "invalid_config",
  "unbound_env",
  "timeout",
  "connection_refused",
  "dns_failure",
  "ssl_error",
  "not_found",
  "already_exists",
  "conflict",
  "rate_limited",
  "server_error",
  "content_blocked",
  "challenge_required",
  "access_denied",
  "decode_failure",
  "unknown",
  "contract_violation",
  "high_risk_write",
]);

// semver 简化校验(支持预发布)
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

// SSRF 防护由 security.ts 的 isPrivateHost 统一实现(覆盖 IPv4-mapped IPv6 等绕过)

// ============================================================================
// 主入口
// ============================================================================

// 注:不再共享 OK_RESULT 常量——共享常量被调用方 mutate(如 push issue)会污染后续调用。
// 每次 new 空数组开销可忽略(成功路径低频,且 validate 1000 次 < 100ms 预算内)。

/**
 * 校验 manifest。纯函数,零 IO,返回所有 issue。
 * ok = (无 error 级 issue)。warning 不影响 ok。
 */
export function validate(m: unknown, opts: ValidateOptions = {}): ValidateResult {
  const ctx: Ctx = { opts, issues: [] };
  validateRoot(m as any, ctx);
  if (ctx.issues.length === 0) return { ok: true, issues: [] };
  const ok = !ctx.issues.some((i) => i.level === "error");
  return { ok, issues: ctx.issues };
}

interface Ctx {
  opts: ValidateOptions;
  issues: ManifestIssue[];
}

function addError(ctx: Ctx, field: string, message: string, hint?: string): void {
  ctx.issues.push({ level: "error", field, message, hint });
}

function addWarning(ctx: Ctx, field: string, message: string, hint?: string): void {
  ctx.issues.push({ level: "warning", field, message, hint });
}

// ============================================================================
// root 校验
// ============================================================================

function validateRoot(m: any, ctx: Ctx): void {
  if (!m || typeof m !== "object") {
    addError(ctx, "manifest", "manifest must be an object");
    return;
  }

  // —— 必填元信息 ——
  validateName(m.name, ctx);
  validateDescription(m.description, ctx);
  validateVersion(m.version, ctx);
  if (m.homepage !== undefined && typeof m.homepage !== "string") {
    addError(ctx, "homepage", "homepage must be a string");
  }

  // —— api ——
  validateApi(m.api, ctx);

  // —— auth ——
  if (m.auth !== undefined) validateAuth(m.auth, ctx);

  // —— errorOnStatus ——
  if (m.errorOnStatus !== undefined) validateErrorOnStatus(m.errorOnStatus, ctx);

  // —— 命令存在性 ——
  const hasCommands = m.commands && Object.keys(m.commands).length > 0;
  const hasNamespaces = m.namespaces && Object.keys(m.namespaces).length > 0;
  if (!hasCommands && !hasNamespaces) {
    addError(
      ctx,
      "commands",
      "manifest must define at least one command (commands or namespaces)",
      "Add at least one command under commands or namespaces.",
    );
  }

  // —— 逐命令 ——
  if (m.commands) validateGroup(m.commands, "commands", ctx);
  if (m.namespaces) {
    for (const [ns, group] of Object.entries(
      m.namespaces as Record<string, ManifestCommandGroup>,
    )) {
      // namespace 名 charset:同命令名规则(字母数字+连字符+下划线)
      if (!CMD_NAME_RE.test(ns)) {
        addError(
          ctx,
          `namespaces.${ns}`,
          `namespace name "${ns}" invalid (must be alphanumeric + dash/underscore, start with a letter; no spaces or slashes)`,
        );
      }
      validateGroup(group, `namespaces.${ns}`, ctx);
    }
  }

  // —— E4:unknown key 检测(拼错保护,warning 级)——
  const KNOWN_TOP_KEYS = new Set([
    "name",
    "description",
    "version",
    "minCliVersion",
    "homepage",
    "api",
    "auth",
    "errorOnStatus",
    "commands",
    "namespaces",
    "fallback",
    "signature",
  ]);
  for (const key of Object.keys(m)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      addWarning(ctx, key, `unknown manifest field "${key}" (may be a typo; ignored at runtime)`);
    }
  }
}

// ============================================================================
// 字段校验
// ============================================================================

function validateName(name: any, ctx: Ctx): void {
  if (name === undefined || name === null) {
    addError(ctx, "name", "manifest.name is required (string)");
    return;
  }
  if (typeof name !== "string") {
    addError(ctx, "name", `manifest.name must be a string, got ${typeof name}`);
    return;
  }
  if (!isSafeServiceName(name)) {
    addError(
      ctx,
      "name",
      `manifest.name "${name}" must be lowercase alphanumeric + dash, 2-64 chars, start with a letter`,
      "name must be lowercase alphanumeric + dash, 2-64 chars, start with a letter.",
    );
  }
}

function validateDescription(desc: any, ctx: Ctx): void {
  if (desc === undefined || desc === null) {
    addError(ctx, "description", "manifest.description is required (string)");
    return;
  }
  if (typeof desc !== "string") {
    addError(ctx, "description", `description must be a string, got ${typeof desc}`);
    return;
  }
  if (desc.trim() === "") {
    addError(
      ctx,
      "description",
      "manifest.description must not be empty (agent uses it for semantic matching)",
      "Write a clear description so the agent can match user intent to this service.",
    );
  }
}

function validateVersion(v: any, ctx: Ctx): void {
  if (v === undefined || v === null) {
    addError(ctx, "version", "manifest.version is required (semver string)");
    return;
  }
  if (typeof v !== "string") {
    addError(ctx, "version", `version must be a string, got ${typeof v}`);
    return;
  }
  if (!SEMVER_RE.test(v)) {
    addError(
      ctx,
      "version",
      `version "${v}" is not valid semver (expected X.Y.Z)`,
      'Use semver format like "1.0.0".',
    );
  }
}

function validateApi(api: any, ctx: Ctx): void {
  if (api === undefined || api === null) {
    addError(ctx, "api.baseUrl", "manifest.api is required");
    return;
  }
  if (typeof api !== "object") {
    addError(ctx, "api", "api must be an object");
    return;
  }
  if (typeof api.baseUrl !== "string" || api.baseUrl === "") {
    addError(ctx, "api.baseUrl", "manifest.api.baseUrl is required (string)");
    return;
  }
  validateUrl(api.baseUrl, "api.baseUrl", ctx);
}

function validateAuth(auth: any, ctx: Ctx): void {
  if (typeof auth !== "object") {
    addError(ctx, "auth", "auth must be an object");
    return;
  }
  if (auth.type !== "oauth2") {
    addError(ctx, "auth.type", `auth.type "${auth.type}" unsupported (only "oauth2")`);
  }
  if (typeof auth.baseUrl !== "string" || auth.baseUrl === "") {
    addError(ctx, "auth.baseUrl", "auth.baseUrl is required");
  } else {
    validateUrl(auth.baseUrl, "auth.baseUrl", ctx);
  }
  if (typeof auth.credentialNamespace !== "string" || auth.credentialNamespace === "") {
    addError(ctx, "auth.credentialNamespace", "auth.credentialNamespace is required");
  }
  if (auth.flow !== undefined && !VALID_AUTH_FLOWS.has(auth.flow)) {
    addError(
      ctx,
      "auth.flow",
      `auth.flow "${auth.flow}" invalid (must be device/authorization_code/client_credentials)`,
    );
  }
}

function validateErrorOnStatus(eos: any, ctx: Ctx): void {
  if (typeof eos !== "object") {
    addError(ctx, "errorOnStatus", "errorOnStatus must be an object");
    return;
  }
  for (const [key, value] of Object.entries(eos)) {
    // 合法 key:纯数字("404")或 Nxx("5xx")
    if (!/^\d+$/.test(key) && !/^\dxx$/.test(key)) {
      addError(
        ctx,
        `errorOnStatus.${key}`,
        `status key "${key}" invalid (must be a number like "404" or Nxx like "5xx")`,
      );
    }
    // value 必须是合法 subtype 字符串(对齐 cli-sdk SUBTYPE_REGISTRY)
    if (typeof value !== "string" || !VALID_ERROR_SUBTYPES.has(value)) {
      addError(
        ctx,
        `errorOnStatus.${key}`,
        `errorOnStatus["${key}"] value "${value}" invalid (must be a registered subtype like "not_found"/"server_error")`,
        `Use a cli-sdk registered subtype: not_found, server_error, rate_limited, etc.`,
      );
    }
  }
}

// ============================================================================
// URL 校验(含 SSRF + HTTPS)
// ============================================================================

function validateUrl(url: string, field: string, ctx: Ctx): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    addError(ctx, field, `${field} "${url}" is not a valid URL`);
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    addError(ctx, field, `${field} "${url}" protocol must be http or https`);
    return;
  }
  // HTTPS 强制
  if (parsed.protocol === "http:" && !ctx.opts.allowInsecure) {
    addError(
      ctx,
      field,
      `${field} "${url}" must be HTTPS (use allowInsecure for local dev)`,
      "Use HTTPS, or pass --insecure for local development.",
    );
  }
  // SSRF 防护(用 net.BlockList,覆盖 IPv4-mapped IPv6 等绕过)
  if (!ctx.opts.allowPrivateEndpoints) {
    if (isPrivateHost(parsed.hostname)) {
      addError(
        ctx,
        field,
        `${field} "${url}" points to private/loopback address (SSRF blocked)`,
        "Use a public URL, or pass --private-endpoints for local dev.",
      );
    }
  }
}

// ============================================================================
// 命令组校验
// ============================================================================

function validateGroup(group: any, prefix: string, ctx: Ctx): void {
  if (typeof group !== "object") {
    addError(ctx, prefix, `${prefix} must be an object`);
    return;
  }
  for (const [cmdName, cmd] of Object.entries(group)) {
    // 命令名 charset:字母数字+连字符+下划线,字母开头。
    // 拒绝空格、/、\ 等(破坏 argv 解析)。
    if (!CMD_NAME_RE.test(cmdName)) {
      addError(
        ctx,
        `${prefix}.${cmdName}`,
        `command name "${cmdName}" invalid (must be alphanumeric + dash/underscore, start with a letter; no spaces or slashes)`,
      );
    }
    validateCommand(cmd as ManifestCommand, `${prefix}.${cmdName}`, ctx);
  }
}

function validateCommand(cmd: any, path: string, ctx: Ctx): void {
  if (!cmd || typeof cmd !== "object") {
    addError(ctx, path, `${path} must be an object`);
    return;
  }
  if (typeof cmd.description !== "string" || cmd.description.trim() === "") {
    addError(ctx, `${path}.description`, `${path}.description is required`);
  }
  // args
  if (cmd.args !== undefined) validateArgs(cmd.args, `${path}.args`, ctx);
  // http
  validateHttp(cmd.http, `${path}.http`, ctx);
  // response
  if (!cmd.response || typeof cmd.response !== "object") {
    addError(ctx, `${path}.response`, `${path}.response is required`);
  } else if (typeof cmd.response.data !== "string" || cmd.response.data === "") {
    addError(
      ctx,
      `${path}.response.data`,
      `${path}.response.data is required (use "." for whole body)`,
    );
  }
  if (cmd.response?.pagination)
    validatePagination(cmd.response.pagination, `${path}.response.pagination`, ctx);
}

function validateHttp(http: any, path: string, ctx: Ctx): void {
  if (!http || typeof http !== "object") {
    addError(ctx, path, `${path} is required`);
    return;
  }
  if (!VALID_METHODS.has(http.method)) {
    addError(
      ctx,
      `${path}.method`,
      `${path}.method "${http.method}" invalid (must be GET/POST/PUT/PATCH/DELETE)`,
      "http.method must be GET/POST/PUT/PATCH/DELETE.",
    );
  }
  if (typeof http.path !== "string" || http.path === "") {
    addError(ctx, `${path}.path`, `${path}.path is required`);
  } else if (!http.path.startsWith("/") && !/^https?:\/\//i.test(http.path)) {
    addError(
      ctx,
      `${path}.path`,
      `${path}.path must start with "/" (relative to baseUrl) or be an absolute http(s) URL`,
    );
  }
  // body 只在写方法
  if (http.body !== undefined && (http.method === "GET" || http.method === "DELETE")) {
    addError(ctx, `${path}.body`, `${path}.body should not be set for ${http.method}`);
  }
}

function validateArgs(args: any, path: string, ctx: Ctx): void {
  if (typeof args !== "object") {
    addError(ctx, path, `${path} must be an object`);
    return;
  }
  let sawOptionalPositional = false;
  for (const [argName, spec] of Object.entries(args as Record<string, ManifestArgSpec>)) {
    const argPath = `${path}.${argName}`;
    // 保留名
    if (RESERVED_ARG_NAMES.has(argName)) {
      addError(
        ctx,
        argPath,
        `argument name "${argName}" is reserved by the CLI framework`,
        `Argument "${argName}" is reserved. Rename it.`,
      );
    }
    if (!spec || typeof spec !== "object") {
      addError(ctx, argPath, `${argPath} must be an object`);
      continue;
    }
    if (!VALID_ARG_TYPES.has(spec.type)) {
      addError(
        ctx,
        `${argPath}.type`,
        `type "${spec.type}" invalid (must be string/number/boolean/array)`,
      );
    }
    if (spec.required && spec.default !== undefined) {
      addError(ctx, argPath, `argument "${argName}" cannot declare both required and default`);
    }
    // 数值约束(只对 number 类型有意义;声明在非 number 上是 manifest 错误)
    if (spec.type === "number") {
      if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
        addError(
          ctx,
          `${argPath}.min`,
          `argument "${argName}" min(${spec.min}) > max(${spec.max})`,
        );
      }
      if (spec.min !== undefined && typeof spec.min !== "number") {
        addError(ctx, `${argPath}.min`, `argument "${argName}" min must be a number`);
      }
      if (spec.max !== undefined && typeof spec.max !== "number") {
        addError(ctx, `${argPath}.max`, `argument "${argName}" max must be a number`);
      }
      if (spec.integer !== undefined && typeof spec.integer !== "boolean") {
        addError(ctx, `${argPath}.integer`, `argument "${argName}" integer must be boolean`);
      }
    } else {
      // min/max/integer 只对 number 有意义,声明在别的类型上是混淆
      if (spec.min !== undefined || spec.max !== undefined || spec.integer !== undefined) {
        addError(
          ctx,
          argPath,
          `argument "${argName}" declares min/max/integer but type is "${spec.type}" (only valid for number)`,
        );
      }
    }
    // positional 顺序
    if (spec.positional) {
      if (!spec.required) sawOptionalPositional = true;
      else if (sawOptionalPositional) {
        addError(
          ctx,
          argPath,
          `required positional argument "${argName}" cannot follow an optional positional`,
        );
      }
    }
  }
}

function validatePagination(p: any, path: string, ctx: Ctx): void {
  if (p.complete) {
    if (typeof p.complete.field !== "string" || p.complete.field === "") {
      addError(ctx, `${path}.complete`, `${path}.complete.field is required`);
    }
    // invert 必须是 boolean(response-map.ts 用 `invert ? !raw : !!raw`,非 boolean 会误判)
    if (p.complete.invert !== undefined && typeof p.complete.invert !== "boolean") {
      addError(
        ctx,
        `${path}.complete.invert`,
        `${path}.complete.invert must be boolean, got ${typeof p.complete.invert}`,
      );
    }
  }
  if (p.nextToken && (typeof p.nextToken.field !== "string" || p.nextToken.field === "")) {
    addError(ctx, `${path}.nextToken`, `${path}.nextToken.field is required`);
  }
}
