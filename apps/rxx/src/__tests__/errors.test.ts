/**
 * rxx —— errors.ts 单元测试(rxxError 错误映射)
 *
 * friendly-errors.test.ts 做端到端(经 server 签名);
 * 这里做纯单元测试,覆盖 errors.ts 的每个 subtype → CliError 映射,
 * 特别是 signature_failed 分类修正(从 authorization/forbidden → authentication/signature_failed)、
 * http_error 按 status 映射、新增 response_too_large/fetch_timeout。
 */

import { describe, it, expect } from "vitest";
import { rxxError } from "../errors.js";
import { LoaderError } from "../manifest/loader.js";
import { ManifestValidationError } from "../manifest/validate.js";
import { PlaceholderError } from "../executor/placeholders.js";
import { InvalidServiceNameError } from "../security.js";
import { errs } from "@renxqoo/agent-data-cli";

describe("rxxError —— signature_failed 分类修正", () => {
  it("signature_failed → AuthenticationError(非 PermissionError/forbidden)", () => {
    const err = rxxError(new LoaderError("sig mismatch", "signature_failed"));
    expect(err).toBeInstanceOf(errs.AuthenticationError);
    expect(err.subtype).toBe("signature_failed");
    expect(err.category).toBe("authentication");
  });
});

describe("rxxError —— http_error 按 status 映射", () => {
  it("404 → not_found", () => {
    const err = rxxError(new LoaderError("404", "http_error", undefined, 404));
    expect(err).toBeInstanceOf(errs.APIError);
    expect(err.subtype).toBe("not_found");
    expect(err.code).toBe(404);
  });
  it("409 → conflict", () => {
    const err = rxxError(new LoaderError("409", "http_error", undefined, 409));
    expect(err.subtype).toBe("conflict");
  });
  it("429 → rate_limited", () => {
    const err = rxxError(new LoaderError("429", "http_error", undefined, 429));
    expect(err.subtype).toBe("rate_limited");
  });
  it("500 → server_error", () => {
    const err = rxxError(new LoaderError("500", "http_error", undefined, 500));
    expect(err.subtype).toBe("server_error");
  });
  it("503 → server_error", () => {
    const err = rxxError(new LoaderError("503", "http_error", undefined, 503));
    expect(err.subtype).toBe("server_error");
  });
  it("400(其他 4xx)→ unknown", () => {
    const err = rxxError(new LoaderError("400", "http_error", undefined, 400));
    expect(err.subtype).toBe("unknown");
  });
  it("无 status → unknown", () => {
    const err = rxxError(new LoaderError("err", "http_error"));
    expect(err.subtype).toBe("unknown");
  });
});

describe("rxxError —— 新增 network/policy 映射", () => {
  it("fetch_timeout → NetworkError/timeout", () => {
    const err = rxxError(new LoaderError("timeout", "fetch_timeout"));
    expect(err).toBeInstanceOf(errs.NetworkError);
    expect(err.subtype).toBe("timeout");
    expect((err as any).retryable).toBe(true);
  });
  it("response_too_large → PolicyError/content_blocked", () => {
    const err = rxxError(new LoaderError("too big", "response_too_large"));
    expect(err).toBeInstanceOf(errs.PolicyError);
    expect(err.subtype).toBe("content_blocked");
  });
  it("parse_error → InternalError/decode_failure", () => {
    const err = rxxError(new LoaderError("bad json", "parse_error"));
    expect(err).toBeInstanceOf(errs.InternalError);
    expect(err.subtype).toBe("decode_failure");
  });
});

describe("rxxError —— 返回类型与未知错误", () => {
  it("返回 CliError(可赋值给框架期望的类型)", () => {
    const err = rxxError(new LoaderError("x", "network"));
    expect(err).toBeInstanceOf(errs.CliError);
  });
  it("InvalidServiceNameError → ValidationError/invalid_argument", () => {
    const err = rxxError(new InvalidServiceNameError("BAD NAME"));
    expect(err).toBeInstanceOf(errs.ValidationError);
    expect(err.subtype).toBe("invalid_argument");
    expect((err as any).param).toBe("name");
  });
  it("已是 CliError → 原样返回(不双重包装)", () => {
    const original = new errs.ValidationError({ subtype: "invalid_argument", message: "x" });
    const result = rxxError(original);
    expect(result).toBe(original);
  });
  it("未知 Error → InternalError/unknown(非裸 Error 透传)", () => {
    const err = rxxError(new Error("boom"));
    expect(err).toBeInstanceOf(errs.InternalError);
    expect(err.subtype).toBe("unknown");
    expect(err.message).toBe("boom");
  });
  it("非 Error 值(字符串)→ InternalError/unknown", () => {
    const err = rxxError("oops");
    expect(err).toBeInstanceOf(errs.InternalError);
    expect(err.message).toBe("oops");
  });
});

// ============================================================================
// 补全:loaderToCliError 其余 subtype(异常路径全覆盖)
// ============================================================================

describe("rxxError —— loaderToCliError 全 subtype", () => {
  it("not_installed → ValidationError/missing_config", () => {
    const err = rxxError(new LoaderError("not installed", "not_installed"));
    expect(err).toBeInstanceOf(errs.ValidationError);
    expect(err.subtype).toBe("missing_config");
    expect((err as any).hint).toMatch(/rxx init/);
  });
  it("invalid_url → ValidationError/invalid_argument + param:url", () => {
    const err = rxxError(new LoaderError("bad url", "invalid_url"));
    expect(err).toBeInstanceOf(errs.ValidationError);
    expect(err.subtype).toBe("invalid_argument");
    expect((err as any).param).toBe("url");
  });
  it("insecure → ValidationError/invalid_config", () => {
    const err = rxxError(new LoaderError("must be https", "insecure"));
    expect(err).toBeInstanceOf(errs.ValidationError);
    expect(err.subtype).toBe("invalid_config");
    expect((err as any).hint).toMatch(/--insecure/);
  });
  it("unsigned → ValidationError/invalid_config", () => {
    const err = rxxError(new LoaderError("unsigned", "unsigned"));
    expect(err).toBeInstanceOf(errs.ValidationError);
    expect(err.subtype).toBe("invalid_config");
    expect((err as any).hint).toMatch(/--unsigned/);
  });
  it("network → NetworkError/connection_refused + retryable", () => {
    const err = rxxError(new LoaderError("conn refused", "network"));
    expect(err).toBeInstanceOf(errs.NetworkError);
    expect(err.subtype).toBe("connection_refused");
    expect((err as any).retryable).toBe(true);
  });
  it("version_mismatch → ConfigError/invalid_config", () => {
    const err = rxxError(new LoaderError("requires >= 1.0", "version_mismatch"));
    expect(err).toBeInstanceOf(errs.ConfigError);
    expect(err.subtype).toBe("invalid_config");
    expect((err as any).hint).toMatch(/Upgrade/);
  });
  it("validation_failed → ValidationError/invalid_config + 首个 issue field 当 param", () => {
    const issues = [
      { level: "error" as const, field: "api.baseUrl", message: "bad" },
      { level: "error" as const, field: "name", message: "bad name" },
    ];
    const err = rxxError(new LoaderError("failed", "validation_failed", issues));
    expect(err).toBeInstanceOf(errs.ValidationError);
    expect(err.subtype).toBe("invalid_config");
    expect((err as any).param).toBe("api.baseUrl");
  });
  it("validation_failed 无 issues → hint 用兜底", () => {
    const err = rxxError(new LoaderError("failed", "validation_failed"));
    expect((err as any).hint).toMatch(/malformed/);
  });
  it("未知 subtype → InternalError/unknown(default 分支)", () => {
    // 构造一个不在枚举里的 subtype
    const err = rxxError(new LoaderError("x", "unknown_subtype" as any));
    expect(err).toBeInstanceOf(errs.InternalError);
    expect(err.subtype).toBe("unknown");
  });
});

describe("rxxError —— httpStatusToSubtype 全分支", () => {
  it("403(其他 4xx)→ unknown", () => {
    const err = rxxError(new LoaderError("403", "http_error", undefined, 403));
    expect(err.subtype).toBe("unknown");
    expect((err as any).code).toBe(403);
  });
  it("502 → server_error", () => {
    expect(rxxError(new LoaderError("502", "http_error", undefined, 502)).subtype).toBe(
      "server_error",
    );
  });
  it("301 非 http_error(非错误状态)→ 不走 http_error 分支", () => {
    // 确认 http_error 只在 !res.ok 时抛,3xx 不算
    // 这里只验证映射逻辑:status undefined → unknown
    expect(rxxError(new LoaderError("err", "http_error")).subtype).toBe("unknown");
  });
});

describe("rxxError —— ManifestValidationError → manifestFixHint", () => {
  it("name 字段 → 专门的 name hint", () => {
    const err = rxxError(new ManifestValidationError("bad", "name"));
    expect((err as any).hint).toMatch(/lowercase alphanumeric/);
  });
  it("version 字段 → semver hint", () => {
    const err = rxxError(new ManifestValidationError("bad", "version"));
    expect((err as any).hint).toMatch(/semver/);
  });
  it("api.baseUrl → HTTPS hint", () => {
    const err = rxxError(new ManifestValidationError("bad", "api.baseUrl"));
    expect((err as any).hint).toMatch(/HTTPS/);
  });
  it("auth.* → auth 配置 hint", () => {
    const err = rxxError(new ManifestValidationError("bad", "auth.type"));
    expect((err as any).hint).toMatch(/oauth2/);
  });
  it("http.method → method hint", () => {
    const err = rxxError(new ManifestValidationError("bad", "commands.x.http.method"));
    expect((err as any).hint).toMatch(/GET\/POST/);
  });
  it("http.path → path hint", () => {
    const err = rxxError(new ManifestValidationError("bad", "commands.x.http.path"));
    expect((err as any).hint).toMatch(/must start with/);
  });
  it("response.data → data hint", () => {
    const err = rxxError(new ManifestValidationError("bad", "commands.x.response.data"));
    expect((err as any).hint).toMatch(/response\.data/);
  });
  it("未知字段 → 兜底 hint", () => {
    const err = rxxError(new ManifestValidationError("bad", "unknown.field"));
    expect((err as any).hint).toMatch(/re-publish/);
  });
});

describe("rxxError —— PlaceholderError 兜底", () => {
  it("PlaceholderError → ValidationError/missing_required + param", () => {
    const err = rxxError(new PlaceholderError("missing id", "id"));
    expect(err).toBeInstanceOf(errs.ValidationError);
    expect(err.subtype).toBe("missing_required");
    expect((err as any).param).toBe("id");
    expect((err as any).hint).toMatch(/--id/);
  });
});
