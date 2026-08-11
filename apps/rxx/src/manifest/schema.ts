/**
 * rxx —— manifest schema 类型定义
 *
 * 这是 manifest 的开放契约,**刻意不 import cli-sdk 类型**。
 * 任何语言/工具都可以实现这个 schema,不绑定 @renxqoo/agent-data-cli。
 *
 * 结构对齐 DESIGN.md 第 3 章:manifest 是 cli-sdk CommandSpec 的可序列化子集,
 * run 函数被拆成 {http, response} 两段可序列化描述。
 *
 * args 字段结构与 cli-sdk ArgsSpec 对齐(零转换),但不引用其类型——
 * 让 manifest schema 独立演进,cli-sdk 实现适配即可。
 */

// ============================================================================
// 参数定义(对齐 cli-sdk ArgsSpec 结构,但独立声明)
// ============================================================================

export type ManifestArgType = "string" | "number" | "boolean" | "array";

export interface ManifestArgSpec {
  type: ManifestArgType;
  required?: boolean;
  /** true 则 positional(如 `get <id>` 而非 `get --id <id>`)。 */
  positional?: boolean;
  /** 进 SKILL.md 参数表。 */
  desc?: string;
  /** 不跟 type 联动的简化默认值。 */
  default?: unknown;
  /** number 类型:最小值(含)。AI 常传负数/0,声明 min 拦截。 */
  min?: number;
  /** number 类型:最大值(含)。AI 常传超大数,声明 max 拦截。 */
  max?: number;
  /** number 类型:是否必须整数(默认 true,分页 limit/cursor 等都是整数)。 */
  integer?: boolean;
}

export type ManifestArgsSpec = Record<string, ManifestArgSpec>;

// ============================================================================
// HTTP 映射(替代 run 函数的"发请求"部分)
// ============================================================================

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * HTTP 请求映射。值含 `{argName}` 占位符,运行时用 args 替换。
 *
 * path 占位符:替换前强制 encodeURIComponent,且结果含 `/` 则拒绝(path traversal 防护)。
 * query/body/headers 占位符:转字符串;空值的键省略(不发)。
 */
export interface HttpMapping {
  method: HttpMethod;
  /** 含 `{argName}` 占位符。 */
  path: string;
  /** 值含 `{argName}` 占位符;空值的键省略。 */
  query?: Record<string, string>;
  /** 仅 POST/PUT/PATCH;值含 `{argName}` 占位符。 */
  body?: Record<string, unknown>;
  /** 值含 `{argName}` 占位符。 */
  headers?: Record<string, string>;
}

// ============================================================================
// 响应映射(替代 run 函数的"包成 CommandResult"部分)
// ============================================================================

/**
 * 字段映射:从响应里按路径取值。
 * - `"."` = 整个 res.data
 * - `"orders"` = res.data.orders
 * - `"data.items"` = res.data.data.items(点号嵌套)
 */
export type FieldPath = string;

export interface PaginationFieldMap {
  /** 读 res.data[field],invert 后填入 Pagination.complete。 */
  complete?: { field: string; invert?: boolean };
  /** 读 res.data[field] 当 nextToken。 */
  nextToken?: { field: string };
  /** 可选:记录数(通常从 data 数组长度推断)。 */
  items?: { field: string };
}

export interface ResponseMapping {
  /** 从 res.data 提取业务数据。 */
  data: FieldPath;
  /** 分页字段映射(对齐 cli-sdk Pagination 契约)。 */
  pagination?: PaginationFieldMap;
  /** 额外 meta 字段映射(键 → field 路径)。 */
  meta?: Record<string, FieldPath>;
}

// ============================================================================
// 单个命令定义
// ============================================================================

export interface ManifestCommand {
  description: string;
  /** 参数定义,结构对齐 cli-sdk ArgsSpec。 */
  args?: ManifestArgsSpec;
  /** HTTP 请求映射。 */
  http: HttpMapping;
  /** 响应映射。 */
  response: ResponseMapping;
}

/** 命令组:key=命令名。 */
export type ManifestCommandGroup = Record<string, ManifestCommand>;

// ============================================================================
// 鉴权(全部可序列化,喂给 cli-sdk defineAuth)
// ============================================================================

export type AuthFlow = "device" | "authorization_code" | "client_credentials";

export interface ManifestAuth {
  type: "oauth2";
  /** OAuth/auth 中间层地址。 */
  baseUrl: string;
  /** OAuth scope,空字符串=不带 scope。 */
  scope?: string;
  grantTypes?: string[];
  /** 凭证隔离命名空间(决定 credentials/<ns>.json)。 */
  credentialNamespace: string;
  flow?: AuthFlow;
  /** RFC 7591 client_metadata。 */
  clientMetadata?: Record<string, unknown>;
  /** authorization_code flow 回调端口(不传=随机)。 */
  redirectPort?: number;
}

// ============================================================================
// 回退声明(某命令无法动态化)
// ============================================================================

export interface FallbackCommand {
  dynamic: false;
  reason?: string;
  installHint?: string;
}

export type FallbackMap = Record<string, FallbackCommand>;

// ============================================================================
// 签名(信任链)
// ============================================================================

export interface ManifestSignature {
  /** base64 Ed25519 签名,签名内容 = sha256(hosts + canonicalJSON(body))。 */
  signature?: string;
  /** base64 Ed25519 公钥(首次发布用;后续 pinning)。 */
  publicKey?: string;
  /** 公钥指纹(sha256,供用户肉眼核对)。 */
  keyFingerprint?: string;
  /** 签名时间(ISO)。 */
  signedAt?: string;
  /** 进签名内容的 host 列表。 */
  signedHosts?: string[];
}

// ============================================================================
// 完整 Manifest
// ============================================================================

export interface Manifest {
  // —— 服务元信息 ——
  name: string;
  description: string;
  version: string;
  /** 要求的 rxx 最低版本,不满足拒绝执行。 */
  minCliVersion?: string;
  homepage?: string;

  // —— 鉴权 ——
  auth?: ManifestAuth;

  // —— API 端点 ——
  api: { baseUrl: string };

  // —— HTTP 状态 → 错误子类型映射 ——
  errorOnStatus?: Record<string, string>;

  // —— 命令 ——
  commands?: ManifestCommandGroup;
  namespaces?: Record<string, ManifestCommandGroup>;

  // —— 回退 ——
  fallback?: FallbackMap;

  // —— 签名 ——
  signature?: ManifestSignature;
}

// ============================================================================
// 辅助:从 manifest 提取 host(签名/SSRF 校验用)
// ============================================================================

/** 提取 manifest 里所有涉及网络的 host(api + auth)。 */
export function extractHosts(m: Manifest): string[] {
  const hosts: string[] = [];
  if (m.api?.baseUrl) {
    const h = hostOf(m.api.baseUrl);
    if (h) hosts.push(h);
  }
  if (m.auth?.baseUrl) {
    const h = hostOf(m.auth.baseUrl);
    if (h) hosts.push(h);
  }
  return [...new Set(hosts)];
}

/** 从 URL 提取 host(小写,带端口)。无效返回 null。 */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.host.toLowerCase();
  } catch {
    return null;
  }
}
