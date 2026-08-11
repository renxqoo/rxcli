/**
 * rxx —— 错误友好化处理
 *
 * 把 rxx 内部错误(LoaderError / ManifestValidationError / PlaceholderError)
 * 转成 cli-sdk 的类型化错误(errs.*),让 agent 能拿到结构化错误subtype/hint/param,
 * 而不是一团 internal/unknown。
 *
 * 错误来源 → cli-sdk 类别映射:
 *   not_installed / invalid_url          → ValidationError (exit 2)
 *   insecure / unsigned / validation     → ValidationError (exit 2)
 *   signature_failed                      → AuthenticationError (exit 3) 鉴权类(信任失败)
 *   network / fetch_timeout               → NetworkError (exit 4)
 *   http_error (按 status 映射) / parse_error → APIError (exit 1)
 *   response_too_large                    → PolicyError (exit 6) 策略拦截
 *
 * 每个 subtype 配语义化的 message + hint(agent 可据此恢复或求助)。
 */

import { errs, type CliError } from "@renxqoo/agent-data-cli";
import { LoaderError, type LoaderErrorSubtype } from "./manifest/loader.js";
import { ManifestValidationError } from "./manifest/validate.js";
import { PlaceholderError } from "./executor/placeholders.js";
import { InvalidServiceNameError } from "./security.js";

/**
 * 把 rxx 内部错误转成 cli-sdk 类型化错误(CliError)。
 *
 * 未知错误包装成 internal/unknown(不再透传裸 Error,保证框架总拿到 CliError
 * 走统一 envelope 序列化)。调用方 throw rxxError(err) 即可。
 */
export function rxxError(err: unknown): CliError {
  // LoaderError(网络/URL/签名/校验)
  if (err instanceof LoaderError) {
    return loaderToCliError(err);
  }
  // InvalidServiceNameError(名字非法 → validation/invalid_argument)
  if (err instanceof InvalidServiceNameError) {
    return new errs.ValidationError({
      subtype: "invalid_argument",
      param: "name",
      message: err.message,
      hint: "Service name must be lowercase alphanumeric + dash, 2-64 chars, start with a letter.",
    });
  }
  // ManifestValidationError(字段不合法)
  if (err instanceof ManifestValidationError) {
    return new errs.ValidationError({
      subtype: "invalid_config",
      param: err.field,
      message: err.message,
      hint: manifestFixHint(err.field),
    });
  }
  // PlaceholderError(占位符替换失败,如缺参数)—— 已在 dynamic-command 里转,这里兜底
  if (err instanceof PlaceholderError) {
    return new errs.ValidationError({
      subtype: "missing_required",
      param: err.param,
      message: err.message,
      hint: `Provide --${err.param} <value>`,
    });
  }
  // 已经是 CliError → 原样返回(避免双重包装)
  if (err instanceof errs.CliError) {
    return err;
  }
  // 未知错误 → internal/unknown(保证框架拿到 CliError 走 envelope)
  const message = err instanceof Error ? err.message : String(err);
  return new errs.InternalError({
    subtype: "unknown",
    message,
    hint: "An unexpected error occurred. This is likely a bug in rxx.",
  });
}

function loaderToCliError(err: LoaderError): CliError {
  const base = { message: err.message };
  switch (err.subtype as LoaderErrorSubtype) {
    case "not_installed":
      return new errs.ValidationError({
        ...base,
        subtype: "missing_config",
        hint: `Run \`rxx init <url>\` to install this service first. Run \`rxx list\` to see installed services.`,
      });
    case "invalid_url":
      return new errs.ValidationError({
        ...base,
        subtype: "invalid_argument",
        param: "url",
        hint: `Provide a valid http(s) URL pointing to a manifest JSON.`,
      });
    case "insecure":
      return new errs.ValidationError({
        ...base,
        subtype: "invalid_config",
        hint: `Use HTTPS, or pass --insecure for local development.`,
      });
    case "unsigned":
      return new errs.ValidationError({
        ...base,
        subtype: "invalid_config",
        hint: `This manifest is unsigned. Pass --unsigned to accept (WARNING: untrusted, verify source yourself).`,
      });
    case "validation_failed": {
      // 从附带的 issues 提取首个 error 的 field 当 param
      const firstIssue = err.issues?.[0];
      return new errs.ValidationError({
        ...base,
        subtype: "invalid_config",
        param: firstIssue?.field,
        hint:
          firstIssue?.hint ?? `The manifest is malformed. Contact the service publisher to fix it.`,
      });
    }
    case "signature_failed":
      // 信任失败属鉴权类(signature/publicKey 不匹配 = 身份不可信),
      // 非 authorization(scope 问题)。用 AuthenticationError + signature_failed subtype。
      return new errs.AuthenticationError({
        ...base,
        subtype: "signature_failed",
        hint: `Manifest signature does not match — it may have been tampered with, or the publisher's key changed. Run \`rxx remove <name> && rxx init <url>\` to reinstall with the new key.`,
      });
    case "network":
      return new errs.NetworkError({
        ...base,
        subtype: "connection_refused",
        retryable: true,
        hint: `Check the URL, your network connection, and that the manifest server is reachable.`,
      });
    case "fetch_timeout":
      return new errs.NetworkError({
        ...base,
        subtype: "timeout",
        retryable: true,
        hint: `The manifest server took too long to respond. Check the URL or retry.`,
      });
    case "http_error": {
      // 按真实 HTTP status 映射 subtype(不再一律 not_found)
      const status = err.status;
      const subtype = httpStatusToSubtype(status);
      return new errs.APIError({
        ...base,
        subtype,
        code: status,
        hint: `The manifest endpoint returned ${status ?? "an error"}. Verify the URL is correct and the manifest exists.`,
      });
    }
    case "parse_error":
      return new errs.InternalError({
        ...base,
        subtype: "decode_failure",
        hint: `The endpoint did not return valid JSON. Verify it serves a manifest JSON.`,
      });
    case "response_too_large":
      return new errs.PolicyError({
        ...base,
        subtype: "content_blocked",
        hint: `The manifest response exceeded the maximum allowed size (1MB). The server may be misconfigured or malicious.`,
      });
    case "version_mismatch":
      return new errs.ConfigError({
        ...base,
        subtype: "invalid_config",
        hint: `Upgrade rxx to the required version, or contact the service publisher to lower minCliVersion.`,
      });
    default:
      return new errs.InternalError({ ...base, subtype: "unknown" });
  }
}

/** HTTP status → API subtype 映射(不再一律 not_found)。 */
function httpStatusToSubtype(status: number | undefined): string {
  if (status === undefined) return "unknown";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "unknown"; // 其他 4xx 归 unknown(无更细分类)
  return "unknown";
}

/** manifest 字段错误的修复提示(按常见字段给针对性 hint)。 */
function manifestFixHint(field: string): string {
  if (field === "name")
    return `name must be lowercase alphanumeric + dash, 2-64 chars, start with a letter.`;
  if (field === "version") return `version must be a semver string like "1.0.0".`;
  if (field.startsWith("api.")) return `api.baseUrl must be a valid HTTPS URL.`;
  if (field.startsWith("auth."))
    return `auth section requires type:"oauth2", baseUrl, credentialNamespace.`;
  if (field.includes("http.method")) return `http.method must be GET/POST/PUT/PATCH/DELETE.`;
  if (field.includes("http.path")) return `http.path must start with "/" (relative to baseUrl).`;
  if (field.includes("response.data")) return `response.data is required (use "." for whole body).`;
  return `Fix this field in the manifest and re-publish.`;
}
