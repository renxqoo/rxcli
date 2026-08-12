/**
 * rxx —— 动态 auth:manifest.auth → cli-sdk defineAuth
 *
 * 已验证:defineAuth 的 DefineAuthOptions 全部是可序列化配置(无业务必须传函数),
 * 调用时零网络请求(冷装配安全)。manifest 的 auth 段直接喂。
 *
 * 两种情况:
 *   - 有 auth → defineAuth(透传配置,自动生成 login/status/logout/register + 钩子)
 *   - 无 auth → no-op plugin(api.baseUrl 直连,不做鉴权)
 *
 * env 注入:支持 `<NAME>_BEARER_TOKEN` 环境变量(sandbox/CI/admin 预签 JWT 场景)。
 */

import { defineAuth, fileStore, type Plugin, type ClientMetadata } from "@renxqoo/agent-data-cli";
import type { Manifest, ManifestAuth } from "../manifest/schema.js";
import { getRxDir } from "../config.js";

/**
 * 从 manifest 构造 auth 插件。
 *
 * async 因为 defineAuth 本身是 async(内部做 credential store 初始化)。
 *
 * @param m manifest
 * @returns auth Plugin(有 auth)或 no-op plugin(无 auth)
 */
export async function buildAuthFromManifest<State = unknown>(m: Manifest): Promise<Plugin<State>> {
  if (!m.auth) {
    return noAuthPlugin<State>();
  }
  return defineAuth<State>(manifestAuthToOptions(m.name, m.auth));
}

/** manifest.auth → DefineAuthOptions(可序列化配置透传,clientMetadata 内容校验)。 */
function manifestAuthToOptions(name: string, auth: ManifestAuth) {
  // env 注入 token:<NAME>_BEARER_TOKEN(大写,非字母数字转下划线)
  const envKey = `${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BEARER_TOKEN`;
  const bearerToken = process.env[envKey];

  // 校验 clientMetadata 内容(防 manifest 里塞非法结构)
  const clientMetadata = sanitizeClientMetadata(auth.clientMetadata);

  return {
    credentialNamespace: auth.credentialNamespace,
    baseUrl: auth.baseUrl,
    scope: auth.scope,
    flow: auth.flow ?? ("device" as const),
    // 目录由 app 决定(cli-sdk 不内置默认):rxx 用 ~/.rxx
    store: fileStore({ dir: getRxDir() }),
    clientMetadata,
    redirectPort: auth.redirectPort,
    bearerToken,
  };
}

/**
 * 清洗 manifest 的 clientMetadata:校验类型,只保留已知字段。
 *
 * manifest 的 clientMetadata 是 Record<string, unknown>(不可信),
 * ClientMetadata 的 client_name/redirect_uris 等有具体类型。
 * client_name 非字符串时抛错(RFC 7591 要求)。
 */
function sanitizeClientMetadata(
  raw: Record<string, unknown> | undefined,
): ClientMetadata | undefined {
  if (!raw) return undefined;
  const out: ClientMetadata = {};
  if (raw.client_name !== undefined) {
    if (typeof raw.client_name !== "string") {
      throw new Error(
        `auth.clientMetadata.client_name must be a string, got ${typeof raw.client_name}`,
      );
    }
    out.client_name = raw.client_name;
  }
  if (Array.isArray(raw.redirect_uris)) {
    out.redirect_uris = raw.redirect_uris.filter((u) => typeof u === "string");
  }
  if (Array.isArray(raw.grant_types)) {
    out.grant_types = raw.grant_types.filter((g) => typeof g === "string");
  }
  if (Array.isArray(raw.response_types)) {
    out.response_types = raw.response_types.filter((r) => typeof r === "string");
  }
  if (typeof raw.scope === "string") out.scope = raw.scope;
  if (typeof raw.token_endpoint_auth_method === "string") {
    out.token_endpoint_auth_method = raw.token_endpoint_auth_method;
  }
  return out;
}

/**
 * 无 auth 的 no-op plugin。
 * 不做任何鉴权,api.baseUrl 直连(适合公开 API / 测试场景)。
 */
function noAuthPlugin<State = unknown>(): Plugin<State> {
  return {
    name: "no-auth",
    enforce: "pre",
    async beforeCommand() {
      /* no-op:不校验凭证 */
    },
    async beforeRequest(_ctx, request) {
      return { ...request };
    },
  };
}
