import type { PkgseerRegistry } from "@githits/core-internal";
import { InvalidPackageSpecError } from "./package-spec.js";

export interface PackageVersionNormalisationOptions {
  /** Preserve the caller boundary's existing non-Swift leading-v rejection. */
  rejectLeadingV?: boolean;
  /** User-facing field name for validation errors. */
  fieldName?: string;
}

/**
 * Normalise an optional exact package version at the shared CLI/MCP boundary.
 * Go module versions are canonical with a lowercase `v`; callers may omit it.
 * Other registries retain the existing package-version contract.
 */
export function normalisePackageVersion(
  raw: string | undefined,
  registry: PkgseerRegistry | undefined,
  options: PackageVersionNormalisationOptions = {},
): string | undefined {
  if (raw === undefined) return undefined;
  const version = raw.trim();
  if (version.length === 0) return undefined;

  if (registry === "GO") {
    if (/^[0-9]/.test(version)) return `v${version}`;
    if (/^v[0-9]/.test(version)) return version;
  }

  if (
    options.rejectLeadingV === true &&
    registry !== "SWIFT" &&
    /^v[0-9]/i.test(version)
  ) {
    const fieldName = options.fieldName ?? "version";
    throw new InvalidPackageSpecError(
      `Invalid ${fieldName} '${version}': it looks like a git tag. Use the canonical package version without a leading 'v' (for example '${version.slice(1)}').`,
    );
  }

  return version;
}
