/**
 * Shared request builder for `pkg_changelog`. CLI and MCP normalise
 * inputs here so addressing, interval classification, version
 * validation, and limit/mode exclusion cannot diverge.
 *
 * Responsibilities:
 * - Require a package-only compact `target`.
 * - Classify latest, exact, and interval suffixes.
 * - Adapt legacy CLI `--from` / `--to` onto the same modes.
 * - Reject exact/inline-endpoint conflicts and `limit` outside latest
 *   or upper-cap mode.
 * - Normalise Go / Swift version spelling.
 * - Emit `explicitFilterFields` so the envelope echoes only caller
 *   intent.
 */

import type {
  PackageChangelogParams,
  PackageChangelogView,
} from "@githits/core-internal";
import { toPkgseerRegistry } from "@githits/core-internal";
import type { ChangelogChangesView } from "./changelog-changes.js";
import { normaliseChangelogChanges } from "./changelog-changes.js";
import { parsePackageChangelogTarget } from "./package-changelog-target.js";
import { InvalidPackageSpecError } from "./package-spec.js";
import { normalisePackageVersion } from "./package-version.js";

export type { ChangelogChangesView } from "./changelog-changes.js";

export interface PackageChangelogRequestInput {
  /** Compact package target. Required. */
  target?: string;
  /** CLI `--from` exclusive start. Duplicate of an inline from bound is rejected. */
  fromVersion?: string;
  /** CLI `--to` inclusive end / latest-mode cap. Duplicate of an inline to bound is rejected. */
  toVersion?: string;
  /** Latest-mode entry count cap. Rejected for exact and lower-bound range targets. */
  limit?: number;
  view?: PackageChangelogView;
  /** Cumulative statement filter; ignored outside statement mode. */
  changes?: string;
}

/** Fields whose *explicit* presence the envelope echoes under `filter.*`. */
export type ExplicitFilterField =
  | "fromVersion"
  | "toVersion"
  | "limit"
  | "version"
  | "changes";

export type PackageChangelogRequestMode = "latest" | "exact" | "range";

export interface PackageChangelogRequestBuildResult {
  params: PackageChangelogParams;
  changes?: ChangelogChangesView;
  mode: PackageChangelogRequestMode;
  /**
   * Set of filter fields the caller explicitly supplied. The envelope
   * consults this set instead of `params.*` so backend defaults
   * (latest = 10) don't round-trip as caller intent.
   */
  explicitFilterFields: Set<ExplicitFilterField>;
}

export function buildPackageChangelogParams(
  input: PackageChangelogRequestInput,
): PackageChangelogRequestBuildResult {
  const target = input.target?.trim() ?? "";
  if (target.length === 0) {
    throw new InvalidPackageSpecError(
      "`pkg changelog` requires a package spec (e.g. `npm:express`).",
    );
  }

  const parsed = parsePackageChangelogTarget(target);
  const registry = toPkgseerRegistry(parsed.registry);
  const flagFrom = normaliseBound(input.fromVersion, registry, "--from");
  const flagTo = normaliseBound(input.toVersion, registry, "--to");
  const limit = normaliseLimit(input.limit);
  const view = input.view ?? "statements";
  const changes =
    view === "statements"
      ? normaliseChangelogChanges(input.changes)
      : undefined;
  const statementTiers: PackageChangelogParams["statementTiers"] =
    changes === "actionable"
      ? ["MUST_ACT"]
      : changes === "important"
        ? ["MUST_ACT", "SHOULD_KNOW"]
        : undefined;
  const explicitChanges =
    changes !== undefined && Boolean(input.changes?.trim());

  if (parsed.mode === "exact") {
    rejectExactConflicts(flagFrom, flagTo, limit);
    const version = normaliseBound(parsed.version, registry, "version");
    if (version === undefined) {
      throw new InvalidPackageSpecError(
        "Selected-release target is missing a version.",
      );
    }
    return {
      mode: "exact",
      changes,
      params: {
        registry,
        packageName: parsed.name,
        version,
        view,
        statementTiers,
      },
      explicitFilterFields: new Set<ExplicitFilterField>(
        explicitChanges ? ["version", "changes"] : ["version"],
      ),
    };
  }

  const inlineFrom =
    parsed.mode === "range"
      ? normaliseBound(parsed.fromVersion, registry, "from version")
      : undefined;
  const inlineTo = normaliseBound(parsed.toVersion, registry, "to version");

  if (inlineFrom !== undefined && flagFrom !== undefined) {
    throw new InvalidPackageSpecError(
      "Positional range already contains a from version. Drop `--from`, or use a bare package target with `--from`.",
    );
  }
  if (inlineTo !== undefined && flagTo !== undefined) {
    throw new InvalidPackageSpecError(
      "Positional target already contains a to version. Drop `--to`, or use a bare package target with `--to`.",
    );
  }

  const fromVersion = inlineFrom ?? flagFrom;
  const toVersion = inlineTo ?? flagTo;
  const mode: PackageChangelogRequestMode =
    fromVersion !== undefined ? "range" : "latest";

  if (fromVersion !== undefined && limit !== undefined) {
    throw new InvalidPackageSpecError(
      "`--limit` / `limit` is a latest-mode input; drop `--limit` for range mode, or drop `--from` / the from bound to cap by count instead.",
    );
  }

  const explicit = new Set<ExplicitFilterField>();
  if (explicitChanges) explicit.add("changes");
  if (fromVersion !== undefined) explicit.add("fromVersion");
  if (toVersion !== undefined) explicit.add("toVersion");
  if (limit !== undefined) explicit.add("limit");

  return {
    mode,
    changes,
    params: {
      registry,
      packageName: parsed.name,
      fromVersion,
      toVersion,
      limit,
      view,
      statementTiers,
    },
    explicitFilterFields: explicit,
  };
}

function rejectExactConflicts(
  fromVersion: string | undefined,
  toVersion: string | undefined,
  limit: number | undefined,
): void {
  const extras: string[] = [];
  if (fromVersion !== undefined) extras.push("`--from`");
  if (toVersion !== undefined) extras.push("`--to`");
  if (limit !== undefined) extras.push("`limit`");
  if (extras.length === 0) return;
  throw new InvalidPackageSpecError(
    `Inline single-release target already selects one release; drop ${joinList(extras)}.`,
  );
}

function joinList(items: string[]): string {
  if (items.length === 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function normaliseBound(
  raw: string | undefined,
  registry: PackageChangelogParams["registry"],
  fieldName: string,
): string | undefined {
  return normalisePackageVersion(raw, registry, {
    rejectLeadingV: true,
    fieldName,
  });
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

export interface PackageChangelogViewInput {
  omitBodies?: boolean;
  verbatim?: boolean;
  verbose?: boolean;
  bodyLines?: number;
  json?: boolean;
}

/** Resolve the view once; explicit raw-note switches cannot coexist with timeline. */
export function resolvePackageChangelogView(input: PackageChangelogViewInput): {
  view: PackageChangelogView;
  bodyPreviewLines?: number;
} {
  const fullNotes = input.verbatim === true || input.verbose === true;
  if (input.omitBodies && fullNotes)
    throw new InvalidPackageSpecError(
      "--no-body / omit_bodies cannot be combined with --verbatim / verbatim or its --verbose / verbose alias.",
    );
  if (input.omitBodies) return { view: "timeline" };
  if (fullNotes) return { view: "verbatim" };
  if (!input.json && input.bodyLines !== undefined) {
    if (
      !Number.isInteger(input.bodyLines) ||
      input.bodyLines < 1 ||
      input.bodyLines > 50
    )
      throw new InvalidPackageSpecError(
        `body_lines must be an integer between 1 and 50. Got ${input.bodyLines}.`,
      );
    return { view: "verbatim", bodyPreviewLines: input.bodyLines };
  }
  return { view: "statements" };
}
