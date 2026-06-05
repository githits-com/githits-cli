/**
 * Shared request builder for the `package_summary` tool. Both the CLI
 * command and the MCP tool normalise their inputs here, so the two
 * surfaces cannot diverge on validation rules or registry coercion.
 *
 * Responsibilities:
 * - Trim whitespace on `packageName` and reject empty strings with
 *   an `InvalidPackageSpecError` (name-prefixed so the shared
 *   classifier routes it to `INVALID_ARGUMENT`).
 * - Map lowercase registry surface values to the uppercase backend
 *   enum via `toPkgseerRegistry`, rejecting unknown registries with
 *   `UnsupportedRegistryError`.
 *
 * This builder has no defaults to apply, so it returns only
 * `{ params }` — no `defaulted` array.
 */

import type { PackageSummaryParams } from "@githits/core-internal";
import {
  isKnownPkgseerRegistryArg,
  PKGSEER_REGISTRY_LIST,
  type PkgseerRegistryArg,
  toPkgseerRegistry,
} from "@githits/core-internal";
import {
  InvalidPackageSpecError,
  UnsupportedRegistryError,
} from "./package-spec.js";

export interface PackageSummaryRequestInput {
  /** Lowercase registry surface value (`npm`, `pypi`, …). */
  registry: string;
  /** Raw package name — may carry surrounding whitespace. */
  packageName: string;
}

export interface PackageSummaryRequestBuildResult {
  params: PackageSummaryParams;
}

export function buildPackageSummaryParams(
  input: PackageSummaryRequestInput,
): PackageSummaryRequestBuildResult {
  const trimmedName = input.packageName?.trim() ?? "";
  if (!trimmedName) {
    throw new InvalidPackageSpecError("Package name is required.");
  }

  const normalisedRegistry = input.registry?.trim().toLowerCase() ?? "";
  if (!isKnownPkgseerRegistryArg(normalisedRegistry)) {
    throw new UnsupportedRegistryError(
      `Unsupported registry '${input.registry}'. Supported: ${PKGSEER_REGISTRY_LIST}.`,
    );
  }

  return {
    params: {
      registry: toPkgseerRegistry(normalisedRegistry as PkgseerRegistryArg),
      packageName: trimmedName,
    },
  };
}
