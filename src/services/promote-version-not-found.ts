/**
 * Shared "generic error → typed `VERSION_NOT_FOUND`" promoter.
 *
 * Called from versioned query executors (`packageVulnerabilities`,
 * `packageDependencies`) right after `createGraphQLError`. When the
 * backend has not yet been updated to emit `extensions.code =
 * "VERSION_NOT_FOUND"` with structured `package` / `requested_version`
 * / `available_versions` fields, it falls back to a generic
 * backend error with the literal message "No matching version
 * found". This helper recognises that shape and promotes it to the
 * typed {@link PackageIntelligenceVersionNotFoundError} so downstream
 * surfaces can render structured, actionable error details.
 *
 * TODO(pkgseer-backend): remove once the upstream resolvers all emit
 * the typed `extensions.code = "VERSION_NOT_FOUND"` payload. The typed
 * path in `createGraphQLError` already handles the structured shape;
 * deleting this helper plus its fallback-specific service tests will
 * be the only cleanup needed, and the typed-error parity tests will
 * catch any regression in the structured-details envelope.
 *
 * Guard rails:
 * - Only promotes when `graphqlCode` is absent. Any explicit code
 *   (including INTERNAL_ERROR, UPSTREAM_ERROR, TIMEOUT, …) is
 *   respected as-is so we never swallow real backend signalling or
 *   flip retryability.
 * - Only promotes when `params.version` is set — if the caller asked
 *   for "latest", a "no matching version" message can only reflect
 *   an unrelated upstream condition, not a caller-addressable one.
 * - `details.package` is qualified with the lowercase registry prefix
 *   (e.g. `"npm:lodash"`) so CLI / MCP output matches the shape
 *   produced when the backend sends the typed code.
 */

import type { PkgseerRegistry } from "../shared/pkgseer-registry.js";
import {
  PackageIntelligenceBackendError,
  PackageIntelligenceVersionNotFoundError,
} from "./package-intelligence-service.js";

/**
 * Minimal shape shared by every versioned-query params type we route
 * through this helper. `registry` is the uppercase GraphQL enum value;
 * we lowercase it for the qualified package name.
 */
export interface PromotableVersionedQueryParams {
  registry: PkgseerRegistry;
  packageName: string;
  version?: string;
}

export function promoteGenericVersionNotFound(
  error: Error,
  params: PromotableVersionedQueryParams,
): Error {
  if (!(error instanceof PackageIntelligenceBackendError)) return error;
  if (error.graphqlCode !== undefined) return error;
  if (!params.version) return error;
  if (!/no matching version/i.test(error.message)) return error;
  const qualifiedName = `${params.registry.toLowerCase()}:${params.packageName}`;
  return new PackageIntelligenceVersionNotFoundError(
    error.message,
    qualifiedName,
    params.version,
    undefined,
  );
}
