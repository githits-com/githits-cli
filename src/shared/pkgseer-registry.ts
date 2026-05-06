/**
 * Registry taxonomy shared by code-navigation and package-intelligence
 * services. Single source of truth for:
 *
 * - `PkgseerRegistry` — the uppercase backend enum (what GraphQL expects).
 * - `PkgseerRegistryArg` — the lowercase surface value (CLI + MCP input).
 * - Lowercase ↔ uppercase conversion.
 *
 * Back-compat: `src/shared/code-navigation.ts` re-exports these under
 * the existing `CodeNavigationRegistry*` names.
 */

export type PkgseerRegistry =
  | "NPM"
  | "PYPI"
  | "HEX"
  | "CRATES"
  | "NUGET"
  | "MAVEN"
  | "ZIG"
  | "VCPKG"
  | "PACKAGIST"
  | "RUBYGEMS"
  | "GO";

export const PKGSEER_REGISTRY_ARGS = [
  "npm",
  "pypi",
  "hex",
  "crates",
  "nuget",
  "maven",
  "zig",
  "vcpkg",
  "packagist",
  "rubygems",
  "go",
] as const;

export type PkgseerRegistryArg = (typeof PKGSEER_REGISTRY_ARGS)[number];

const registryMap = {
  npm: "NPM",
  pypi: "PYPI",
  hex: "HEX",
  crates: "CRATES",
  nuget: "NUGET",
  maven: "MAVEN",
  zig: "ZIG",
  vcpkg: "VCPKG",
  packagist: "PACKAGIST",
  rubygems: "RUBYGEMS",
  go: "GO",
} as const satisfies Record<PkgseerRegistryArg, PkgseerRegistry>;

export const PKGSEER_REGISTRY_LIST = PKGSEER_REGISTRY_ARGS.join(", ");

/**
 * Lowercase surface value → uppercase backend enum. Exhaustive over
 * the surface union; callers that pass arbitrary strings should
 * validate via {@link isKnownPkgseerRegistryArg} first.
 */
export function toPkgseerRegistry(
  registry: PkgseerRegistryArg,
): PkgseerRegistry {
  return registryMap[registry];
}

/**
 * Uppercase backend enum → lowercase surface value. Used when
 * lowering a response field for user display.
 */
export function toPkgseerRegistryLowercase(
  registry: PkgseerRegistry,
): PkgseerRegistryArg {
  for (const [lower, upper] of Object.entries(registryMap)) {
    if (upper === registry) return lower as PkgseerRegistryArg;
  }
  // Exhaustive over `PkgseerRegistry`; only reachable on schema drift.
  throw new Error(
    `Unknown registry value: ${String(registry)} (schema drift?)`,
  );
}

export function isKnownPkgseerRegistryArg(
  value: string,
): value is PkgseerRegistryArg {
  return value in registryMap;
}

export function knownPkgseerRegistryArgs(): ReadonlyArray<PkgseerRegistryArg> {
  return PKGSEER_REGISTRY_ARGS;
}
