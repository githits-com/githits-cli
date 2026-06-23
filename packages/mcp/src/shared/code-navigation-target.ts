import type { CodeNavigationTarget } from "@githits/core-internal";
import { toCodeNavigationRegistry } from "./code-navigation.js";
import {
  InvalidArgumentError,
  InvalidPackageSpecError,
  parsePackageSpec,
  UnsupportedRegistryError,
} from "./package-spec.js";
import {
  buildInvalidTargetSpecError,
  isRepositoryTargetSpec,
  parseRepositoryTargetSpec,
} from "./repository-target.js";

/**
 * Parse a compact code-navigation target string.
 *
 * Package targets use the shared package spec grammar, e.g.
 * `npm:react@18.2.0` or `npm:react` for the latest release. Repository
 * targets are full URLs, `github.com/owner/repo` shorthands, or
 * `github:owner/repo` shorthands with an optional `#gitRef` or `@gitRef`
 * suffix, e.g.
 * `https://github.com/facebook/react#HEAD`, `github.com/facebook/react#HEAD`,
 * `github:facebook/react#HEAD`, or `github.com/facebook/react@HEAD`.
 * Omitted refs request the backend-resolved default branch.
 */
export function parseCodeNavigationTargetSpec(
  spec: string,
): CodeNavigationTarget {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("Target spec cannot be empty.");
  }

  if (isRepositoryTargetSpec(trimmed)) {
    return parseRepositoryTargetSpec(trimmed);
  }

  let parsed: ReturnType<typeof parsePackageSpec>;
  try {
    parsed = parsePackageSpec(trimmed);
  } catch (error) {
    if (
      error instanceof InvalidPackageSpecError ||
      error instanceof UnsupportedRegistryError
    ) {
      throw buildInvalidTargetSpecError(trimmed, error.message);
    }
    throw error;
  }

  return {
    registry: toCodeNavigationRegistry(parsed.registry),
    packageName: parsed.name,
    version: parsed.version,
  };
}
