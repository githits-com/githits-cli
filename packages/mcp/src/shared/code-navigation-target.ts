import type { CodeNavigationTarget } from "@githits/core-internal";
import { toCodeNavigationRegistry } from "./code-navigation.js";
import { InvalidArgumentError, parsePackageSpec } from "./package-spec.js";

/**
 * Parse a compact code-navigation target string.
 *
 * Package targets use the shared package spec grammar, e.g.
 * `npm:react@18.2.0` or `npm:react` for the latest release. Repository
 * targets are full URLs with an optional `#gitRef` suffix, e.g.
 * `https://github.com/facebook/react#HEAD`. Omitted refs request the
 * backend-resolved default branch.
 */
export function parseCodeNavigationTargetSpec(
  spec: string,
): CodeNavigationTarget {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("Target spec cannot be empty.");
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return parseRepoTarget(trimmed);
  }

  const parsed = parsePackageSpec(trimmed);
  return {
    registry: toCodeNavigationRegistry(parsed.registry),
    packageName: parsed.name,
    version: parsed.version,
  };
}

function parseRepoTarget(spec: string): CodeNavigationTarget {
  const hashIndex = spec.lastIndexOf("#");
  if (hashIndex === -1) {
    return { repoUrl: spec };
  }

  const repoUrl = spec.slice(0, hashIndex);
  const gitRef = spec.slice(hashIndex + 1);
  if (!repoUrl || !gitRef) {
    throw new InvalidArgumentError(
      "Repository target must be a full URL with optional #gitRef suffix.",
    );
  }

  return { repoUrl, gitRef };
}
