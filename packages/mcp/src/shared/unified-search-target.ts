import type { UnifiedSearchTarget } from "@githits/core-internal";
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
): UnifiedSearchTarget {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("Target spec cannot be empty.");
  }

  if (isSiteTargetSpec(trimmed)) {
    return { site: normaliseSiteTargetSpec(trimmed) };
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

function isSiteTargetSpec(spec: string): boolean {
  return spec.toLowerCase().startsWith("site:");
}

function normaliseSiteTargetSpec(spec: string): string {
  const value = spec.slice("site:".length).trim();
  if (value.length === 0) {
    throw new InvalidArgumentError(
      "Site target cannot be empty. Expected site:<host[/path]> for an already-indexed documentation site.",
    );
  }

  let host: string;
  let path: string;
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      host = url.host;
      path = url.pathname;
    } else {
      const slashIndex = value.indexOf("/");
      host = slashIndex === -1 ? value : value.slice(0, slashIndex);
      path = slashIndex === -1 ? "" : value.slice(slashIndex);
    }
  } catch {
    throw new InvalidArgumentError(
      `Invalid site target ${JSON.stringify(spec)}. Expected site:<host[/path]> or site:https://<host[/path]>.`,
    );
  }

  const canonical = `${host.toLowerCase()}${path}`.replace(/\/+$/, "");
  if (canonical.length === 0 || /\s/.test(canonical)) {
    throw new InvalidArgumentError(
      `Invalid site target ${JSON.stringify(spec)}. Expected site:<host[/path]> for an already-indexed documentation site.`,
    );
  }

  return `site:${canonical}`;
}
