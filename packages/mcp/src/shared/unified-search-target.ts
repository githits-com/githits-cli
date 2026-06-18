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

export function parseUnifiedSearchTargetSpec(
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
