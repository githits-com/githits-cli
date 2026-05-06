/**
 * Shared request builder for the `package_changelog` tool. The CLI
 * command and the MCP tool normalise their inputs here so the two
 * surfaces cannot diverge on addressing rules, version validation,
 * or mode/limit mutual exclusion.
 *
 * Responsibilities:
 * - Enforce addressing XOR: exactly one of (a) `<spec>` (registry +
 *   packageName) or (b) `repoUrl`. Reject both-present, none-present,
 *   and malformed `<spec>`.
 * - Reject tag-style versions (`v4.18.0`) on `fromVersion` /
 *   `toVersion` — leading `v` is a git-tag convention, not a
 *   canonical version.
 * - Reject `<spec>@<version>`: the `pkg changelog` family does not
 *   give `@version` a meaning (unlike `pkg vulns` and `pkg deps`).
 *   Redirect callers to `--to` / `to_version`.
 * - Reject `fromVersion` + `limit` together (backend says range mode
 *   has no count cap; we catch it before the wire).
 * - Enforce `limit` range (1–50).
 * - Emit an `explicitFilterFields` set so the response envelope only
 *   echoes `filter.*` for caller-supplied fields, not backend
 *   defaults.
 */

import type { PackageChangelogParams } from "../services/index.js";
import {
  InvalidPackageSpecError,
  UnsupportedRegistryError,
} from "./package-spec.js";
import {
  isKnownPkgseerRegistryArg,
  PKGSEER_REGISTRY_LIST,
  type PkgseerRegistryArg,
  toPkgseerRegistry,
} from "./pkgseer-registry.js";

/**
 * Raw inputs from either CLI or MCP, pre-normalisation. Keep every
 * field optional so the builder is the single place enforcing the
 * XOR + co-occurrence rules.
 */
export interface PackageChangelogRequestInput {
  /** Lowercase registry surface value (`npm`, `pypi`, …). */
  registry?: string;
  /** Raw package name — trimmed before validation. */
  packageName?: string;
  /** GitHub repo URL. Mutex with `registry` + `packageName`. */
  repoUrl?: string;
  /** Optional git branch/tag for CHANGELOG.md. */
  gitRef?: string;
  /** Optional `<spec>@<version>` captured from the spec parser. Always rejected here. */
  specVersion?: string;
  /** Range-mode start version. */
  fromVersion?: string;
  /** End-of-range / latest-mode cap. */
  toVersion?: string;
  /** Latest-mode entry count cap. */
  limit?: number;
}

/** Fields whose *explicit* presence the envelope echoes under `filter.*`. */
export type ExplicitFilterField =
  | "fromVersion"
  | "toVersion"
  | "limit"
  | "gitRef";

export interface PackageChangelogRequestBuildResult {
  params: PackageChangelogParams;
  /**
   * Set of filter fields the caller explicitly supplied. The envelope
   * consults this set instead of `params.*` to decide whether to
   * echo a field under `filter.*`, so backend defaults (latest = 10)
   * don't accidentally round-trip as caller intent.
   */
  explicitFilterFields: Set<ExplicitFilterField>;
}

export function buildPackageChangelogParams(
  input: PackageChangelogRequestInput,
): PackageChangelogRequestBuildResult {
  if (input.specVersion !== undefined) {
    throw new InvalidPackageSpecError(
      "`<spec>@<version>` isn't supported for pkg changelog — use `--to <version>` for entries up to a version, or `--from <version>` for a full range.",
    );
  }

  const addressing = resolveAddressing(input);
  const gitRef = normaliseGitRef(input.gitRef);
  const fromVersion = normaliseVersion(input.fromVersion, "from");
  const toVersion = normaliseVersion(input.toVersion, "to");
  const limit = normaliseLimit(input.limit);

  if (fromVersion !== undefined && limit !== undefined) {
    throw new InvalidPackageSpecError(
      "`--limit` / `limit` is a latest-mode input; drop `--limit` for range mode, or drop `--from` / `from_version` to cap by count instead.",
    );
  }

  const explicit = new Set<ExplicitFilterField>();
  if (fromVersion !== undefined) explicit.add("fromVersion");
  if (toVersion !== undefined) explicit.add("toVersion");
  if (limit !== undefined) explicit.add("limit");
  if (gitRef !== undefined) explicit.add("gitRef");

  return {
    params: {
      ...addressing,
      gitRef,
      fromVersion,
      toVersion,
      limit,
    },
    explicitFilterFields: explicit,
  };
}

type ResolvedAddressing =
  | {
      registry: PackageChangelogParams["registry"];
      packageName: string;
      repoUrl?: undefined;
    }
  | { repoUrl: string; registry?: undefined; packageName?: undefined };

function resolveAddressing(
  input: PackageChangelogRequestInput,
): ResolvedAddressing {
  const hasSpec = Boolean(input.registry || input.packageName);
  const hasRepoUrl = Boolean(input.repoUrl?.trim());

  if (hasSpec && hasRepoUrl) {
    throw new InvalidPackageSpecError(
      "Provide either `<spec>` (registry + name) or `--repo-url` / `repo_url`, not both.",
    );
  }
  if (!hasSpec && !hasRepoUrl) {
    throw new InvalidPackageSpecError(
      "`pkg changelog` requires a package spec (e.g. `npm:express`) or `--repo-url` / `repo_url`.",
    );
  }

  if (hasRepoUrl) {
    const repoUrl = (input.repoUrl as string).trim();
    if (!isUrlShape(repoUrl)) {
      throw new InvalidPackageSpecError(
        `'${repoUrl}' does not look like a URL. Pass a full GitHub URL (e.g. https://github.com/expressjs/express).`,
      );
    }
    return { repoUrl };
  }

  const packageName = input.packageName?.trim() ?? "";
  if (!packageName) {
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
  return { registry, packageName };
}

function normaliseGitRef(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normaliseVersion(
  raw: string | undefined,
  field: "from" | "to",
): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (/^v[0-9]/i.test(trimmed)) {
    const flag = field === "from" ? "--from" : "--to";
    throw new InvalidPackageSpecError(
      `Version '${trimmed}' looks like a git tag. Use the canonical version without a leading 'v' (e.g. ${flag} ${trimmed.slice(1)}).`,
    );
  }
  return trimmed;
}

function normaliseLimit(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 1 || raw > 50) {
    throw new InvalidPackageSpecError(
      `\`limit\` must be an integer between 1 and 50. Got ${raw}.`,
    );
  }
  return raw;
}

/**
 * Minimal URL-shape test. We want to reject obvious non-URLs like
 * `"not a url"` client-side so agents get an actionable error instead
 * of an opaque `BACKEND_ERROR`. Backend handles host-specific
 * validation (GitHub-only enforcement etc.).
 */
function isUrlShape(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
