/**
 * Package-only changelog target parser. Composes {@link parsePackageSpec}
 * and classifies the optional `@` suffix as latest, one selected release,
 * or an interval. Interval grammar matches upgrade-review (`..`, reject
 * `...`) while also admitting open bounds.
 */

import {
  InvalidPackageSpecError,
  type KnownRegistry,
  parsePackageSpec,
} from "./package-spec.js";
import { isRepositoryTargetSpec } from "./repository-target.js";

export type ChangelogTargetMode = "latest" | "exact" | "range";

export type ParsedPackageChangelogTarget =
  | {
      mode: "latest";
      registry: KnownRegistry;
      name: string;
      toVersion?: string;
    }
  | {
      mode: "exact";
      registry: KnownRegistry;
      name: string;
      version: string;
    }
  | {
      mode: "range";
      registry: KnownRegistry;
      name: string;
      fromVersion: string;
      toVersion?: string;
    };

const PACKAGE_ONLY_MESSAGE =
  "`pkg_changelog` is package-only. Use a `registry:name` target such as `npm:express`, not a repository or site coordinate.";

/**
 * Parse a compact package changelog target.
 *
 * Accepted forms:
 * - `npm:express` — latest
 * - `npm:express@5.2.1` — one selected release
 * - `npm:express@4.21.2..5.2.1` — closed range `(from, to]`
 * - `npm:express@4.21.2..` — range to latest
 * - `npm:express@..5.2.1` — latest up to an inclusive cap
 */
export function parsePackageChangelogTarget(
  spec: string,
): ParsedPackageChangelogTarget {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new InvalidPackageSpecError(
      "Package spec cannot be empty. Expected <registry>:<name>[@<version> or @<from>..<to>].",
    );
  }
  if (isNonPackageChangelogTarget(trimmed)) {
    throw new InvalidPackageSpecError(PACKAGE_ONLY_MESSAGE);
  }

  const parsed = parsePackageSpec(trimmed);
  if (parsed.version === undefined) {
    return {
      mode: "latest",
      registry: parsed.registry,
      name: parsed.name,
    };
  }
  return classifyVersionSuffix(parsed.registry, parsed.name, parsed.version);
}

function classifyVersionSuffix(
  registry: KnownRegistry,
  name: string,
  suffix: string,
): ParsedPackageChangelogTarget {
  if (suffix.includes("...")) {
    throw new InvalidPackageSpecError(
      `Invalid changelog interval '${suffix}'. Use '..' between endpoints; '...' is not supported.`,
    );
  }
  if (!suffix.includes("..")) {
    return { mode: "exact", registry, name, version: suffix };
  }

  const parts = suffix.split("..");
  if (parts.length !== 2) {
    throw new InvalidPackageSpecError(
      `Invalid changelog interval '${suffix}'. Expected at most one '..' between endpoints.`,
    );
  }
  const fromVersion = emptyToUndefined(parts[0]);
  const toVersion = emptyToUndefined(parts[1]);
  if (fromVersion === undefined && toVersion === undefined) {
    throw new InvalidPackageSpecError(
      "Empty changelog interval '@..' is not supported. Provide a from bound, a to bound, or both.",
    );
  }
  if (fromVersion === undefined) {
    return { mode: "latest", registry, name, toVersion };
  }
  return { mode: "range", registry, name, fromVersion, toVersion };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isNonPackageChangelogTarget(spec: string): boolean {
  if (isRepositoryTargetSpec(spec)) return true;
  const lower = spec.toLowerCase();
  return (
    lower.startsWith("site:") ||
    lower.startsWith("http:") ||
    lower.startsWith("https:")
  );
}
