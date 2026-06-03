import type { CodeNavigationTarget } from "../services/code-navigation-service.js";
import { toCodeNavigationRegistry } from "./code-navigation.js";
import { InvalidArgumentError, parsePackageSpec } from "./package-spec.js";

export function parseUnifiedSearchTargetSpec(
  spec: string,
): CodeNavigationTarget {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("Target spec cannot be empty.");
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return parseDiscoveryRepoTarget(trimmed);
  }

  const parsed = parsePackageSpec(trimmed);
  return {
    registry: toCodeNavigationRegistry(parsed.registry),
    packageName: parsed.name,
    version: parsed.version,
  };
}

function parseDiscoveryRepoTarget(spec: string): CodeNavigationTarget {
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
