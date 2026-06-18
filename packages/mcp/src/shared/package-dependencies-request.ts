/**
 * Shared request builder for the `package_dependencies` tool. Both
 * the CLI command and the MCP tool normalise their inputs here so the
 * two surfaces cannot diverge on validation rules, registry coercion,
 * or lifecycle parsing.
 *
 * Responsibilities:
 * - Trim + validate `packageName`.
 * - Normalise registry case and restrict to the registries that the
 *   upstream `packageDependencies` resolver supports (see
 *   `SUPPORTED_DEPS_REGISTRIES`). Other known registries are rejected
 *   with a tool-specific message; truly unknown registries fall
 *   through to the shared `UnsupportedRegistryError`.
 * - Reject tag-style versions (`v4.18.0`) client-side — the `v` prefix
 *   is a git-tag convention, not a canonical version on most supported
 *   registries. Swift is the exception: SwiftPM packages commonly use
 *   `v`-prefixed release tags and the backend normalizes them.
 * - Parse the comma-separated lifecycle list into the canonical
 *   lowercase enum set; reject unknown tokens.
 * - Enforce `maxDepth` bounds (1–10).
 */

import type { PackageDependenciesParams } from "@githits/core-internal";
import {
  isKnownPkgseerRegistryArg,
  PKGSEER_REGISTRY_ARGS,
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
 * the `packageDependencies` query specifically. Name-prefix
 * `Unsupported` routes via the shared classifier to
 * `INVALID_ARGUMENT`. Message is tool-specific.
 */
export class UnsupportedDependenciesRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDependenciesRegistryError";
  }
}

export type DependencyLifecycle =
  | "runtime"
  | "development"
  | "build"
  | "peer"
  | "optional";

export type DependencyLifecycleInput = DependencyLifecycle | "all";

const LIFECYCLES: readonly DependencyLifecycle[] = [
  "runtime",
  "development",
  "build",
  "peer",
  "optional",
] as const;

const LIFECYCLE_ORDER: Readonly<Record<DependencyLifecycle, number>> = {
  runtime: 0,
  development: 1,
  build: 2,
  peer: 3,
  optional: 4,
};

export const SUPPORTED_DEPS_REGISTRIES: ReadonlySet<PkgseerRegistry> = new Set([
  "NPM",
  "PYPI",
  "HEX",
  "CRATES",
  "VCPKG",
  "ZIG",
  "RUBYGEMS",
  "GO",
  "SWIFT",
]);

/**
 * Lowercase deps-supported registries, comma-separated, in the
 * canonical order defined by `PKGSEER_REGISTRY_ARGS`. Derived rather
 * than hand-rolled so the order propagates from the single source of
 * truth and a future registry addition shows up here automatically.
 */
export const SUPPORTED_DEPS_REGISTRIES_LIST: string =
  PKGSEER_REGISTRY_ARGS.filter((arg) =>
    SUPPORTED_DEPS_REGISTRIES.has(toPkgseerRegistry(arg)),
  ).join(", ");

export function supportsDependenciesRegistry(
  registry: PkgseerRegistry,
): boolean {
  return SUPPORTED_DEPS_REGISTRIES.has(registry);
}

export interface PackageDependenciesRequestInput {
  /** Lowercase registry surface value (`npm`, `pypi`, …). */
  registry: string;
  /** Raw package name — may carry surrounding whitespace. */
  packageName: string;
  /** Optional version — backend defaults to latest when omitted. */
  version?: string;
  /** Optional flag to include transitive graph. */
  includeTransitive?: boolean;
  /** Optional traversal depth (1–10). */
  maxDepth?: number;
  /**
   * Optional lifecycle filter: CSV string or pre-split array. Tokens
   * are trimmed, lowercased, validated, deduplicated, and sorted by
   * canonical display order before going on the wire. Empty input is
   * treated as no filter.
   */
  lifecycle?: string | string[];
}

export interface PackageDependenciesRequestBuildResult {
  params: PackageDependenciesParams;
  /**
   * Canonical lifecycle list that went on the wire (sorted,
   * deduplicated). Surfaces verbatim as the envelope's
   * `filter.lifecycles` when non-empty. Empty array means "no filter".
   */
  canonicalLifecycles: DependencyLifecycleInput[];
  wireLifecycles: DependencyLifecycle[];
}

export function buildPackageDependenciesParams(
  input: PackageDependenciesRequestInput,
): PackageDependenciesRequestBuildResult {
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
  if (!supportsDependenciesRegistry(registry)) {
    throw new UnsupportedDependenciesRegistryError(
      `pkg deps only supports ${SUPPORTED_DEPS_REGISTRIES_LIST}. Got: ${normalisedRegistryArg}.`,
    );
  }

  const version = normaliseVersion(input.version, registry);

  const canonicalLifecycles = resolveLifecycles(input.lifecycle);
  const wireLifecycles = canonicalLifecycles.filter(
    (entry): entry is DependencyLifecycle =>
      entry !== "runtime" && entry !== "all",
  );

  const maxDepth = input.maxDepth;
  if (maxDepth !== undefined) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 10) {
      throw new InvalidPackageSpecError(
        `Transitive depth must be an integer between 1 and 10. Got ${maxDepth}.`,
      );
    }
  }

  return {
    canonicalLifecycles,
    wireLifecycles,
    params: {
      registry,
      packageName: trimmedName,
      version,
      includeTransitive: input.includeTransitive,
      maxDepth,
      lifecycle: wireLifecycles.length > 0 ? wireLifecycles : undefined,
    },
  };
}

function normaliseVersion(
  raw: string | undefined,
  registry: PkgseerRegistry,
): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (registry !== "SWIFT" && /^v[0-9]/i.test(trimmed)) {
    throw new InvalidPackageSpecError(
      `Version '${trimmed}' looks like a git tag. Use the canonical version without a leading 'v' (e.g. ${trimmed.slice(1)}).`,
    );
  }
  return trimmed;
}

function resolveLifecycles(
  raw: string | string[] | undefined,
): DependencyLifecycleInput[] {
  if (raw === undefined) return [];
  const tokens = Array.isArray(raw)
    ? raw.flatMap((entry) => entry.split(","))
    : raw.split(",");
  const seen = new Set<DependencyLifecycleInput>();
  for (const token of tokens) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    const lower = trimmed.toLowerCase();
    if (!isLifecycleInput(lower)) {
      throw new InvalidPackageSpecError(
        `Unknown lifecycle '${trimmed}'. Expected one of: ${LIFECYCLES.join(", ")}, all.`,
      );
    }
    seen.add(lower);
  }
  if (seen.has("all") && seen.size > 1) {
    throw new InvalidPackageSpecError(
      "lifecycle=all cannot be combined with other lifecycle values.",
    );
  }
  return Array.from(seen).sort(lifecycleInputSort);
}

export function isLifecycle(value: string): value is DependencyLifecycle {
  return (LIFECYCLES as readonly string[]).includes(value);
}

function isLifecycleInput(value: string): value is DependencyLifecycleInput {
  return value === "all" || isLifecycle(value);
}

function lifecycleInputSort(
  a: DependencyLifecycleInput,
  b: DependencyLifecycleInput,
): number {
  if (a === "all") return b === "all" ? 0 : 1;
  if (b === "all") return -1;
  return LIFECYCLE_ORDER[a] - LIFECYCLE_ORDER[b];
}
