/**
 * Shared request builder for the `package_vulnerabilities` tool. Both
 * the CLI command and the MCP tool normalise their inputs through this
 * module.
 *
 * Responsibilities:
 * - Trim whitespace on `packageName`; reject empty strings with
 *   `InvalidPackageSpecError`.
 * - Normalise registry case and validate against the shared registry
 *   surface via `pkgseer-registry`; reject unknown registries with
 *   the generic `UnsupportedRegistryError` message.
 * - Gate against the vulnerability-query's narrower registry support
 *   (backend currently excludes vcpkg and zig). Known-
 *   but-unsupported registries are rejected client-side with a
 *   tool-specific message so the backend never sees them. The
 *   predicate `supportsVulnerabilitiesRegistry` lives here (not in
 *   `pkgseer-registry.ts`) because it is a tool-specific capability
 *   matrix, not a registry-taxonomy concern.
 * - Map `minSeverity` label → CVSS float threshold (backend takes a
 *   `Float`; CLI/MCP accept a label for discoverability). Uppercase
 *   input is tolerated.
 * - Reject tag-style versions with a leading `v` (`v1.2.3`) except
 *   for Swift, where `v`-prefixed release tags are accepted and
 *   normalized by the backend. For other registries, this tool accepts
 *   canonical package versions, not git refs; the live backend currently
 *   answers these with an unhelpful generic error, so we fail fast with
 *   an actionable client-side message instead.
 *   TODO(backend): replace this narrow guard with typed,
 *   ecosystem-aware version validation from the backend. Do not grow
 *   ad hoc normalization rules here.
 */

import type { PackageVulnerabilitiesParams } from "@githits/core-internal";
import {
  isKnownPkgseerRegistryArg,
  PKGSEER_REGISTRY_LIST,
  type PkgseerRegistry,
  type PkgseerRegistryArg,
  toPkgseerRegistry,
} from "@githits/core-internal";
import {
  InvalidPackageSpecError,
  UnsupportedRegistryError,
} from "./package-spec.js";

/**
 * Raised when the caller targets a registry that is unsupported by
 * the vulnerabilities query specifically (rather than being unknown
 * to the spec parser). Name-prefix `Unsupported` routes via the
 * shared classifier to `INVALID_ARGUMENT`. Message is tool-specific
 * and points the caller at the supported set.
 */
export class UnsupportedVulnerabilitiesRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedVulnerabilitiesRegistryError";
  }
}

export type SeverityLabel = "low" | "medium" | "high" | "critical";

export const SEVERITY_LABEL_TO_CVSS: Readonly<Record<SeverityLabel, number>> = {
  // 0.1 excludes null-severity advisories (backend drops null when any
  // filter is set) without functionally suppressing `low`-banded
  // entries. Agents/users rarely want to see a million irrelevant
  // advisories, but `--severity low` is available for completeness.
  low: 0.1,
  medium: 4.0,
  high: 7.0,
  critical: 9.0,
};

const SUPPORTED_VULN_REGISTRIES: ReadonlySet<PkgseerRegistry> = new Set([
  "NPM",
  "PYPI",
  "HEX",
  "CRATES",
  "NUGET",
  "MAVEN",
  "PACKAGIST",
  "RUBYGEMS",
  "GO",
  "SWIFT",
]);

const SUPPORTED_VULN_REGISTRIES_HUMAN =
  "npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift";

/**
 * Tool-local capability predicate. Vulnerability data is unavailable
 * for vcpkg and zig on the backend.
 * When a second tool needs per-tool registry restrictions, extract to
 * a dedicated `pkgseer-capabilities.ts` module.
 */
export function supportsVulnerabilitiesRegistry(
  registry: PkgseerRegistry,
): boolean {
  return SUPPORTED_VULN_REGISTRIES.has(registry);
}

export interface PackageVulnerabilitiesRequestInput {
  /** Lowercase registry surface value (`npm`, `pypi`, …). */
  registry: string;
  /** Raw package name — may carry surrounding whitespace. */
  packageName: string;
  /** Optional version string — backend defaults to latest when omitted. */
  version?: string;
  /** Optional severity label; uppercase tolerated. */
  minSeverity?: string;
  /** Optional flag to include withdrawn advisories. */
  includeWithdrawn?: boolean;
  /** Advisory rows to return. Defaults to advisories affecting the inspected version. */
  advisoryScope?: string;
}

export interface PackageVulnerabilitiesFilterEcho {
  minSeverity?: SeverityLabel;
  includeWithdrawn?: true;
  advisoryScope?: AdvisoryScopeLabel;
}

export type AdvisoryScopeLabel = "affected" | "non_affecting" | "all";

const ADVISORY_SCOPE_TO_GRAPHQL = {
  affected: "AFFECTED",
  non_affecting: "NON_AFFECTING",
  all: "ALL",
} as const;

export interface PackageVulnerabilitiesRequestBuildResult {
  params: PackageVulnerabilitiesParams;
  filter?: PackageVulnerabilitiesFilterEcho;
}

export function buildPackageVulnerabilitiesParams(
  input: PackageVulnerabilitiesRequestInput,
): PackageVulnerabilitiesRequestBuildResult {
  const trimmedName = input.packageName?.trim() ?? "";
  if (!trimmedName) {
    throw new InvalidPackageSpecError("Package name is required.");
  }

  const normalisedRegistryArg = input.registry?.trim().toLowerCase() ?? "";
  if (!isKnownPkgseerRegistryArg(normalisedRegistryArg)) {
    throw new UnsupportedRegistryError(
      `Unsupported registry '${input.registry}'. Supported: ${PKGSEER_REGISTRY_LIST}.`,
    );
  }

  const registry = toPkgseerRegistry(
    normalisedRegistryArg as PkgseerRegistryArg,
  );
  if (!supportsVulnerabilitiesRegistry(registry)) {
    throw new UnsupportedVulnerabilitiesRegistryError(
      `pkg vulns only supports ${SUPPORTED_VULN_REGISTRIES_HUMAN}. Got: ${normalisedRegistryArg}.`,
    );
  }

  const severityLabel = resolveMinSeverityLabel(input.minSeverity);
  const minSeverity =
    severityLabel !== undefined
      ? SEVERITY_LABEL_TO_CVSS[severityLabel]
      : undefined;
  const trimmedVersion = input.version?.trim();
  // Temporary guard until the backend returns a typed invalid-version
  // error with per-ecosystem version semantics.
  if (trimmedVersion && registry !== "SWIFT" && /^v\d/i.test(trimmedVersion)) {
    throw new InvalidPackageSpecError(
      `Invalid version '${trimmedVersion}'. Use the canonical package version without a leading 'v' (for example '4.18.0', not 'v4.18.0').`,
    );
  }

  const advisoryScope = resolveAdvisoryScope(input.advisoryScope);
  const filterWithScope = buildFilterEcho(
    severityLabel,
    input.includeWithdrawn,
    advisoryScope,
  );

  return {
    params: {
      registry,
      packageName: trimmedName,
      version:
        trimmedVersion && trimmedVersion.length > 0
          ? trimmedVersion
          : undefined,
      minSeverity,
      includeWithdrawn: input.includeWithdrawn,
      advisoryScope: advisoryScope
        ? ADVISORY_SCOPE_TO_GRAPHQL[advisoryScope]
        : undefined,
    },
    ...(filterWithScope ? { filter: filterWithScope } : {}),
  };
}

function resolveMinSeverityLabel(
  raw: string | undefined,
): SeverityLabel | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const lower = trimmed.toLowerCase();
  if (!isSeverityLabel(lower)) {
    throw new InvalidPackageSpecError(
      `Unsupported severity '${raw}'. Expected one of: low, medium, high, critical.`,
    );
  }
  return lower;
}

function buildFilterEcho(
  minSeverity: SeverityLabel | undefined,
  includeWithdrawn: boolean | undefined,
  advisoryScope?: AdvisoryScopeLabel,
): PackageVulnerabilitiesFilterEcho | undefined {
  const filter: PackageVulnerabilitiesFilterEcho = {};
  if (minSeverity !== undefined) filter.minSeverity = minSeverity;
  if (includeWithdrawn === true) filter.includeWithdrawn = true;
  if (advisoryScope !== undefined && advisoryScope !== "affected") {
    filter.advisoryScope = advisoryScope;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function resolveAdvisoryScope(
  raw: string | undefined,
): AdvisoryScopeLabel | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const lower = trimmed.toLowerCase().replace(/-/g, "_");
  if (lower === "affected" || lower === "non_affecting" || lower === "all") {
    return lower;
  }
  throw new InvalidPackageSpecError(
    `Unsupported advisory scope '${raw}'. Expected one of: affected, non_affecting, all.`,
  );
}

export function isSeverityLabel(value: string): value is SeverityLabel {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  );
}
