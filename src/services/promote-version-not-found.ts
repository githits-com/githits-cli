/**
 * Shared "generic error → typed `VERSION_NOT_FOUND`" promoter.
 *
 * Called from versioned query executors (`packageVulnerabilities`,
 * `packageDependencies`, `packageChangelog`) right after
 * `createGraphQLError`. When the backend has not yet been updated to
 * emit `extensions.code = "VERSION_NOT_FOUND"` with structured
 * `package` / `requested_version` / `available_versions` fields, it
 * falls back to a generic backend error with the literal message "No
 * matching version found". This helper recognises that shape and
 * promotes it to the typed {@link PackageIntelligenceVersionNotFoundError}
 * so downstream surfaces can render structured, actionable error details.
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
 * - Only promotes when at least one version field (`version`,
 *   `fromVersion`, `toVersion`) is set — if the caller asked for the
 *   unconstrained latest timeline, a "no matching version" message
 *   can only reflect an unrelated upstream condition.
 * - `details.package` is qualified with the lowercase registry prefix
 *   (e.g. `"npm:lodash"`) when both `registry` and `packageName` are
 *   provided. In repo-URL addressing mode (`packageChangelog`) neither
 *   is available; `details.package` is omitted entirely.
 * - `details.requestedVersion` preference order when multiple are
 *   set: `version` → `fromVersion` → `toVersion`. First non-null
 *   wins. Range-mode requests typically set `fromVersion`, which is
 *   the most likely culprit when the backend rejects the version.
 */

import type { PkgseerRegistry } from "../shared/pkgseer-registry.js";
import {
  PackageIntelligenceBackendError,
  PackageIntelligenceVersionNotFoundError,
} from "./package-intelligence-service.js";

/**
 * Minimal shape shared by every versioned-query params type we route
 * through this helper. All fields optional so repo-URL-addressed
 * queries (`packageChangelog`) can also flow through — the helper
 * omits any detail it can't synthesize.
 */
export interface PromotableVersionedQueryParams {
  registry?: PkgseerRegistry;
  packageName?: string;
  version?: string;
  fromVersion?: string;
  toVersion?: string;
}

export function promoteGenericVersionNotFound(
  error: Error,
  params: PromotableVersionedQueryParams,
): Error {
  if (!(error instanceof PackageIntelligenceBackendError)) return error;
  if (error.graphqlCode !== undefined) return error;
  const requestedVersion = pickRequestedVersion(params);
  if (!requestedVersion) return error;
  if (!/no matching version/i.test(error.message)) return error;
  const qualifiedName = synthesizeQualifiedName(params);
  return new PackageIntelligenceVersionNotFoundError(
    error.message,
    qualifiedName,
    requestedVersion,
    undefined,
  );
}

function pickRequestedVersion(
  params: PromotableVersionedQueryParams,
): string | undefined {
  if (params.version) return params.version;
  if (params.fromVersion) return params.fromVersion;
  if (params.toVersion) return params.toVersion;
  return undefined;
}

function synthesizeQualifiedName(
  params: PromotableVersionedQueryParams,
): string | undefined {
  if (!params.registry || !params.packageName) return undefined;
  return `${params.registry.toLowerCase()}:${params.packageName}`;
}
