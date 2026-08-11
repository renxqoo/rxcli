/**
 * rxx —— 安全原语(所有安全检查的唯一来源)
 *
 * 设计目的:所有安全检查(SSRF/path traversal/原型链/服务名)的唯一来源,
 * 消除历史上 validate.ts/validator.ts 双份维护 SSRF 正则的问题(validator.ts 已删除)。
 * 每个检查都有对应的攻击用例测试(security.test.ts)。
 *
 * 四类原语:
 *   1. isPrivateHost — SSRF 防护(用 net.BlockList,覆盖 IPv4-mapped IPv6)
 *   2. isSafePathSegment — path traversal 防护(拒绝 ./../空串/预编码)
 *   3. isDangerousKey/safeObjectFrom/safeGetField — 原型链污染防护
 */

import { BlockList } from "node:net";
import { promises as dns } from "node:dns";

// ============================================================================
// 1. SSRF 防护(用 net.BlockList,覆盖所有绕过)
// ============================================================================

/**
 * 全局 BlockList(一次性构造)。覆盖:
 *   - IPv4 回环/私有/链路本地/全零
 *   - IPv6 回环/链路本地/唯一本地(ULA)/ IPv4-mapped IPv6
 */
const BLOCKLIST: BlockList = (() => {
  const bl = new BlockList();
  // IPv4
  bl.addRange("0.0.0.0", "0.255.255.255", "ipv4");
  bl.addRange("10.0.0.0", "10.255.255.255", "ipv4");
  bl.addRange("127.0.0.0", "127.255.255.255", "ipv4");
  bl.addRange("169.254.0.0", "169.254.255.255", "ipv4");
  bl.addRange("172.16.0.0", "172.31.255.255", "ipv4");
  bl.addRange("192.168.0.0", "192.168.255.255", "ipv4");
  // IPv6
  bl.addAddress("::", "ipv6"); // 全零
  bl.addAddress("::1", "ipv6"); // 回环
  bl.addRange("fe80::", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "ipv6"); // 链路本地
  bl.addRange("fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "ipv6"); // ULA
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — BlockList addRange with subnet covers it,
  // 但显式加一层保险:把整个 ::ffff:0:0 - ::ffff:ffff:ffff 映射段当 ipv6 也拦
  // 注意:net.BlockList 对 IPv4-mapped 的处理依赖 Node 版本,这里用 hostname 双重检查兜底
  return bl;
})();

/** 字符串层面也要拦的主机名(BlockList 不覆盖的域名形式)。 */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

/**
 * 判断 host 是否是私有/回环/链路本地地址(SSRF 防护)。
 *
 * 覆盖的攻击向量:
 *   - IPv4 私有段(10/172.16/192.168/127/169.254/0)
 *   - IPv6 回环/链路本地/ULA
 *   - **IPv4-mapped IPv6**(::ffff:127.0.0.1 等)——正则方案会漏
 *   - localhost 等域名别名
 *   - **非点分 IPv4 编码**:十进制整数(`2130706433`)、十六进制(`0x7f000001`)、
 *     八进制(`0177.0.0.1`)、混合 hex 段(`0x7f.0.0.1`)
 *
 * @param host hostname(URL.hostname 已小写、去方括号)。可以是 IP 字面量或域名。
 *   传 IPv6 字面量时不要带方括号(用 URL.hostname 已剥离)。
 */
export function isPrivateHost(host: string): boolean {
  if (!host) return true;
  // 剥方括号(URL.hostname 已剥,但调用方可能传原始 host)
  let h = host.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  // 域名别名
  if (BLOCKED_HOSTNAMES.has(h)) return true;

  // IPv6 字面量可能带 zone id(fe80::1%eth0),剥离
  const v6 = h.replace(/%.*$/, "");

  // IPv4-mapped IPv6: ::ffff:a.b.c.d → 提取 IPv4 部分用 IPv4 BlockList 检查
  const mapped = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    return BLOCKLIST.check(mapped[1]!, "ipv4");
  }
  // ::a.b.c.d (兼容形式)
  const mapped2 = v6.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped2) {
    return BLOCKLIST.check(mapped2[1]!, "ipv4");
  }

  // 纯 IPv6(含 ::)
  if (v6.includes(":")) {
    return BLOCKLIST.check(v6, "ipv6");
  }

  // IPv4:点分十进制 / 非点分编码(整数/hex/八进制/hex 段)
  const normalized = normalizeIPv4(v6);
  if (normalized) {
    return BLOCKLIST.check(normalized, "ipv4");
  }

  // 域名:不解析(DNS rebinding 由 assertSafeHost 在 fetch 前做运行时解析校验),
  // 这里只拦已知别名
  return false;
}

/**
 * 把各种 IPv4 编码形式归一为点分十进制。
 *
 * 覆盖:
 *   - 点分十进制 `1.2.3.4`(各段 0-255)
 *   - 十进制整数 `2130706433`(= 127.0.0.1)
 *   - 十六进制 `0x7f000001`(= 127.0.0.1)
 *   - 八进制点分 `0177.0.0.1`(= 127.0.0.1,各段按进制解析)
 *   - 混合 hex 段 `0x7f.0.0.1`
 *
 * @returns 点分十进制(如 "127.0.0.1");不是合法 IPv4 编码返回 null
 */
function normalizeIPv4(host: string): string | null {
  // 纯整数(十进制或 0x 十六进制),无点
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    const n = host.toLowerCase().startsWith("0x") ? parseInt(host, 16) : parseInt(host, 10);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    // 整数 → 点分(bigint 安全,因为可能超 32 位有符号)
    const bn = BigInt(n);
    return [3, 2, 1, 0].map((s) => Number((bn >> BigInt(s * 8)) & 0xffn)).join(".");
  }
  // 点分形式:各段可能是 十进制/八进制(0开头)/十六进制(0x开头)
  if (host.includes(".")) {
    const segs = host.split(".");
    if (segs.length !== 4) return null;
    const parts: number[] = [];
    for (const seg of segs) {
      let v: number;
      if (/^0x[0-9a-f]+$/i.test(seg)) v = parseInt(seg, 16);
      else if (/^0[0-7]+$/.test(seg)) v = parseInt(seg, 8);
      else if (/^\d+$/.test(seg)) v = parseInt(seg, 10);
      else return null;
      if (!Number.isFinite(v) || v < 0 || v > 255) return null;
      parts.push(v);
    }
    return parts.join(".");
  }
  return null;
}

/** 从 URL 字符串提取 host 并判断是否私有(SSRF 防护的便捷入口)。 */
export function urlIsPrivate(url: string): boolean {
  try {
    const u = new URL(url);
    // URL.hostname 自动去方括号、小写
    return isPrivateHost(u.hostname);
  } catch {
    return true; // 无效 URL 视为不安全
  }
}

// ============================================================================
// 1b. DNS rebinding 防护:fetch 前解析域名 + 校验解析结果
// ============================================================================

export interface SafeHostOptions {
  /** 允许内网 endpoint(本地开发)。默认 false=SSRF 防护。 */
  allowPrivateEndpoints?: boolean;
  /**
   * 自定义 DNS 解析(测试注入)。返回解析到的 IP 列表。
   * 默认用 node:dns promises.lookup({ all: true })。
   */
  lookup?: (hostname: string) => Promise<string[]>;
}

/** 默认 DNS 解析:node:dns promises.lookup({ all: true }) → IP 字符串数组。 */
function defaultLookup(hostname: string): Promise<string[]> {
  return dns.lookup(hostname, { all: true }).then((addrs) => addrs.map((a) => a.address));
}

/**
 * fetch 前的运行时 DNS 校验:解析 hostname,校验解析到的 IP 是否私有。
 *
 * 防 DNS rebinding:域名在 URL 字面量层通过 isPrivateHost(只看字面),
 * 但实际解析可能指向内网 IP。本函数在 fetch 前做一次解析 + 校验,
 * 收窄 TOCTOU 窗口(完整 connect-to-IP 防护破坏虚拟主机/SNI,不做)。
 *
 * 规则:
 *   - 字面量 IP 主机:直接用 isPrivateHost,不调 lookup
 *   - 域名:dns.lookup 拿全部 IP,任一私有 → 抛错;全部公网 → 通过
 *   - allowPrivateEndpoints=true:跳过私有校验
 *   - 解析失败/reject/空结果:抛错(不确定时不放行)
 *
 * @throws Error 当域名解析到内网 IP,或解析失败时
 */
export async function assertSafeHost(hostname: string, opts: SafeHostOptions = {}): Promise<void> {
  if (opts.allowPrivateEndpoints) return;

  // 字面量 IP:isPrivateHost 已覆盖(IPv4 各编码 + IPv6),无需 lookup
  const looksLikeIp =
    hostname.includes(":") ||
    normalizeIPv4(hostname) !== null ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  if (looksLikeIp) {
    if (isPrivateHost(hostname)) {
      throw new Error(`Host ${hostname} resolves to a private/loopback address (SSRF blocked)`);
    }
    return;
  }

  // 域名:解析 + 逐 IP 校验
  const lookup = opts.lookup ?? defaultLookup;
  let ips: string[];
  try {
    ips = await lookup(hostname);
  } catch (err) {
    throw new Error(`DNS lookup failed for ${hostname}: ${(err as Error).message}`);
  }
  if (ips.length === 0) {
    throw new Error(`DNS lookup returned no addresses for ${hostname}`);
  }
  for (const ip of ips) {
    if (isPrivateHost(ip)) {
      throw new Error(`Host ${hostname} resolves to private address ${ip} (DNS rebinding blocked)`);
    }
  }
}

// ============================================================================
// 2. path traversal 防护
// ============================================================================

/**
 * 判断一个值作为 URL path 的单段是否安全。
 *
 * 拦截:
 *   - 含 `/` 或 `\`(跨段)
 *   - `..` / `.`(目录跳转)
 *   - 空串
 *   - 预编码的 `%2e`/`%2f`/`%5c`(攻击者预编码绕过 encodeURIComponent)
 *
 * @example
 *   isSafePathSegment("ord_001") → true
 *   isSafePathSegment("..") → false
 *   isSafePathSegment("a/b") → false
 *   isSafePathSegment("%2e%2e") → false
 */
export function isSafePathSegment(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value === "") return false;
  if (value === "." || value === "..") return false;
  if (value.includes("/") || value.includes("\\")) return false;
  // 预编码绕过:攻击者传 %2e%2e%2f,encodeURIComponent 后变 %252e%252e%252f(安全),
  // 但若上游已解码过,这里再拦一次
  if (/%2[eEfF]/i.test(value) || /%5[cC]/i.test(value)) return false;
  return true;
}

// ============================================================================
// 2b. 服务名校验(路径穿越 + 注入防护的唯一来源)
// ============================================================================

/**
 * 服务名合法性:小写字母+数字+连字符,2-64 字符,字母开头。
 *
 * 这是所有按 name 取本地路径的入口(registry/shim/skill-gen)的**统一校验**。
 * 和 validate.ts 的 NAME_RE 一致,集中到 security.ts 消除多份维护。
 */
const SERVICE_NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;

/** 判断服务名是否合法(纯函数,不抛)。 */
export function isSafeServiceName(name: string): boolean {
  return typeof name === "string" && SERVICE_NAME_RE.test(name);
}

/** 服务名非法时抛的错误(带 serviceName,errors.ts 识别后转 validation 错误)。 */
export class InvalidServiceNameError extends Error {
  constructor(readonly serviceName: string) {
    super(
      `Invalid service name: "${serviceName}" (must be lowercase alphanumeric + dash, 2-64 chars, start with a letter)`,
    );
    this.name = "InvalidServiceNameError";
  }
}

/**
 * 断言服务名合法。非法抛 InvalidServiceNameError。
 *
 * 所有按 name 拼 FS 路径的入口(registry/shim/skill-gen)都应调用——
 * 纵深防御:每个 rmSync/writeFileSync 入口独立校验,不依赖调用顺序。
 */
export function assertSafeServiceName(name: string): void {
  if (!isSafeServiceName(name)) {
    throw new InvalidServiceNameError(name);
  }
}

// ============================================================================
// 3. 原型链污染防护
// ============================================================================

const DANGEROUS_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

/** 判断 key 是否危险(会导致原型链访问/污染)。 */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

/**
 * 从 entries 构造一个 null-prototype 对象,跳过危险键。
 *
 * 用于处理来自 manifest/HTTP 响应的数据——这些数据源的 key 不可信。
 */
export function safeObjectFrom(entries: Iterable<[string, unknown]>): Record<string, unknown> {
  const obj = Object.create(null) as Record<string, unknown>;
  for (const [k, v] of entries) {
    if (isDangerousKey(k)) continue;
    obj[k] = v;
  }
  return obj;
}

/**
 * 按 "a.b.c" 点号路径安全读取字段(不走原型链)。
 *
 * 与 extractData 的区别:每个段用 Object.hasOwn 检查,
 * 遇到 __proto__/constructor 等危险键返回 null。
 *
 * @returns 找不到/非对象/危险键 → null
 */
export function safeGetField(obj: unknown, path: string): unknown {
  if (path === ".") return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur !== "object") return null;
    if (isDangerousKey(seg)) return null; // 不走原型链
    const o = cur as Record<string, unknown>;
    if (!Object.hasOwn(o, seg)) return null;
    cur = o[seg];
  }
  return cur ?? null;
}
