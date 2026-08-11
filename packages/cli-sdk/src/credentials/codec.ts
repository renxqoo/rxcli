import { ConfigError } from "../errs/index.js";

const NAMESPACE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertCredentialNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new ConfigError({
      subtype: "invalid_config",
      message: `Invalid credential namespace: ${JSON.stringify(namespace)}`,
    });
  }
}

export function encodeJsonDocument(data: Record<string, unknown>, label: string): string {
  try {
    const encoded = JSON.stringify(data, null, 2);
    if (encoded === undefined) throw new Error("document is not JSON serializable");
    decodeJsonDocument(encoded, label);
    return encoded + "\n";
  } catch (cause) {
    if (cause instanceof ConfigError) throw cause;
    throw invalidDocument(label, cause);
  }
}

export function decodeJsonDocument(text: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("document root must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    throw invalidDocument(label, cause);
  }
}

export function roundTripJsonDocument(
  data: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  return decodeJsonDocument(encodeJsonDocument(data, label), label);
}

function invalidDocument(label: string, cause: unknown): ConfigError {
  return new ConfigError({
    subtype: "invalid_config",
    message: `Invalid JSON document: ${label}`,
    cause,
  });
}
