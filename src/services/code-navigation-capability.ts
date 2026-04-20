/**
 * Capability state derived from the current bearer token.
 */
export type CodeNavigationCapability = "enabled" | "disabled" | "unknown";

interface JwtPayloadShape {
  feature_flags?: unknown;
  claims?: { feature_flags?: unknown };
}

/**
 * Derives code navigation capability from a Supabase JWT.
 *
 * The CLI does not have the signing secret, so this decodes the JWT payload
 * without verifying the signature. Opaque or malformed tokens return unknown.
 */
export function getCodeNavigationCapability(
  token: string | undefined,
): CodeNavigationCapability {
  if (!token) return "unknown";

  const payload = parseJwtPayload(token);
  if (!payload) return "unknown";

  const featureFlags = extractFeatureFlags(payload);
  if (!featureFlags) return "unknown";

  return featureFlags.includes("code_navigation") ? "enabled" : "disabled";
}

function extractFeatureFlags(payload: JwtPayloadShape): string[] | null {
  if (isStringArray(payload.feature_flags)) {
    return payload.feature_flags;
  }

  if (payload.claims && isStringArray(payload.claims.feature_flags)) {
    return payload.claims.feature_flags;
  }

  return null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function parseJwtPayload(token: string): JwtPayloadShape | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const decoded = Buffer.from(toBase64(parts[1] ?? ""), "base64").toString(
      "utf8",
    );
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as JwtPayloadShape;
  } catch {
    return null;
  }
}

function toBase64(base64Url: string): string {
  const normalized = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  if (padding === 0) return normalized;
  return normalized.padEnd(normalized.length + (4 - padding), "=");
}
