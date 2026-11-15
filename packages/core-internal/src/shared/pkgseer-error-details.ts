import type { ServiceDiagnostics } from "../services/runtime-diagnostics.js";
import { normalizeSingleLineText } from "./http-error-detail.js";

/** Allowlisted provider facts shared by service errors and transport envelopes. */
export interface PkgseerErrorDetails {
  rateLimitScope?:
    | "repository_provider"
    | "app_admission"
    | "operation"
    | "registry";
  tokenSource?: "app" | "user" | "supabase_user";
  retryAfterMs?: number;
  retryAfterSeconds?: number;
  repoUrl?: string;
  gitRef?: string | null;
}

/** Parse safe facts without forwarding arbitrary extensions or provider bodies. */
export function parsePkgseerErrorDetails(
  extensions: Record<string, unknown> | undefined,
): PkgseerErrorDetails {
  if (!extensions) return {};
  const details: PkgseerErrorDetails = {};
  const scope = extensions.rate_limit_scope ?? extensions.rateLimitScope;
  if (
    scope === "repository_provider" ||
    scope === "app_admission" ||
    scope === "operation" ||
    scope === "registry"
  )
    details.rateLimitScope = scope;
  const source = extensions.token_source ?? extensions.tokenSource;
  if (source === "app" || source === "user" || source === "supabase_user")
    details.tokenSource = source;
  const ms = extensions.retry_after_ms ?? extensions.retryAfterMs;
  if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
    details.retryAfterMs = ms;
    details.retryAfterSeconds = ms / 1000;
  } else {
    const seconds = extensions.retryAfter;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0)
      details.retryAfterSeconds = seconds;
  }
  const repo = boundedText(extensions.repo_url ?? extensions.repoUrl);
  if (repo !== undefined) details.repoUrl = repo;
  const ref =
    extensions.git_ref !== undefined ? extensions.git_ref : extensions.gitRef;
  if (ref === null) details.gitRef = null;
  else {
    const text = boundedText(ref);
    if (text !== undefined) details.gitRef = text;
  }
  return details;
}

interface GraphQLError {
  extensions?: Record<string, unknown>;
}

/** A provider throttle must not be hidden by a sibling missing-source error. */
export function getPrimaryExtensions(
  errors: GraphQLError[],
): Record<string, unknown> | undefined {
  const provider = errors.find(
    ({ extensions }) =>
      extensions?.code === "RATE_LIMITED" &&
      (extensions.rate_limit_scope ?? extensions.rateLimitScope) ===
        "repository_provider",
  );
  if (provider) {
    const access = errors.find(
      ({ extensions }) =>
        typeof extensions?.code === "string" &&
        [
          "AUTHENTICATION_REQUIRED",
          "UNAUTHORIZED",
          "FORBIDDEN",
          "ACCESS_DENIED",
          "FEATURE_FLAG_REQUIRED",
        ].includes(extensions.code),
    );
    return (access ?? provider).extensions;
  }
  return errors.find(
    ({ extensions }) => extensions && Object.keys(extensions).length > 0,
  )?.extensions;
}

/** HTTP 429 may use either a GraphQL envelope or a direct API error object. */
export function httpRateLimitExtensions(
  body: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(body)) return undefined;
  if (Array.isArray(body.errors)) {
    const errors = body.errors.filter(isRecord).map((error) => ({
      extensions: isRecord(error.extensions) ? error.extensions : undefined,
    }));
    return getPrimaryExtensions(errors);
  }
  return isRecord(body.extensions) ? body.extensions : body;
}

/** Emit only classification dimensions, never messages, identities or bodies. */
export function recordPkgseerRateLimit(
  diagnostics: ServiceDiagnostics | undefined,
  area: string,
  code: unknown,
  details: PkgseerErrorDetails,
): void {
  if (code !== "RATE_LIMITED" || !diagnostics?.isEnabled(area)) return;
  diagnostics.debug(area, {
    event: "rate-limited",
    code,
    ...(details.rateLimitScope
      ? { rate_limit_scope: details.rateLimitScope }
      : {}),
    ...(details.tokenSource ? { token_source: details.tokenSource } : {}),
  });
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = normalizeSingleLineText(value);
  return text && text.length <= 500 ? text : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
