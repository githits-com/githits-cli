/**
 * Client-side capability matrices for package-intelligence registries.
 *
 * The registry taxonomy in `@githits/core-internal` describes every known
 * backend registry. These definitions describe which package-intelligence
 * queries the client can call today, so request builders and ecosystem audits
 * share one capability source instead of drifting independently.
 */

import {
  PKGSEER_REGISTRY_ARGS,
  type PkgseerRegistry,
  type PkgseerRegistryArg,
  toPkgseerRegistry,
} from "@githits/core-internal";

/** Lowercase dependency registries in canonical `PKGSEER_REGISTRY_ARGS` order. */
export const SUPPORTED_DEPS_REGISTRY_ARGS: readonly PkgseerRegistryArg[] =
  PKGSEER_REGISTRY_ARGS;

/** Comma-separated lowercase dependency registries for user-facing text. */
export const SUPPORTED_DEPS_REGISTRIES_LIST: string =
  SUPPORTED_DEPS_REGISTRY_ARGS.join(", ");

/** Registries with vulnerability data; vcpkg and Zig are not included. */
export const SUPPORTED_VULN_REGISTRY_ARGS = [
  "npm",
  "pypi",
  "hex",
  "crates",
  "nuget",
  "maven",
  "packagist",
  "rubygems",
  "go",
  "swift",
] as const satisfies readonly PkgseerRegistryArg[];

export const SUPPORTED_VULN_REGISTRIES: ReadonlySet<PkgseerRegistry> = new Set(
  SUPPORTED_VULN_REGISTRY_ARGS.map(toPkgseerRegistry),
);

/** Comma-separated lowercase vulnerability registries for user-facing text. */
export const SUPPORTED_VULN_REGISTRIES_LIST: string =
  SUPPORTED_VULN_REGISTRY_ARGS.join(", ");

/** Vulnerability registry list with the existing error-message conjunction. */
export const SUPPORTED_VULN_REGISTRIES_HUMAN: string =
  "npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift";

export function supportsVulnerabilitiesRegistry(
  registry: PkgseerRegistry,
): boolean {
  return SUPPORTED_VULN_REGISTRIES.has(registry);
}
