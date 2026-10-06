import type { DiscoveryIndexingEstimate } from "@githits/core-internal";
import { formatRepositoryTarget } from "./repository-target.js";
import {
  buildRetryCandidateLine,
  buildSuggestedRefsLine,
} from "./target-resolution.js";
import { sanitizeTerminalText, wrapTerminalProse } from "./terminal-text.js";

/** Selected provenance facts; null and omitted wire fields both mean unknown. */
export interface SourceProvenanceIdentity {
  kind?: string | null;
  registry?: string | null;
  packageName?: string | null;
  version?: string | null;
  repoUrl?: string | null;
  gitRef?: string | null;
  commitSha?: string | null;
  committedAt?: string | null;
  site?: string | null;
}

export interface SourceProvenanceResolution {
  requested?: SourceProvenanceIdentity | null;
  resolvedRequested?: SourceProvenanceIdentity | null;
  served?: SourceProvenanceIdentity | null;
  freshness?: string | null;
  freshnessReason?: string | null;
  availableVersions?:
    | readonly { version?: string | null; ref: string }[]
    | null;
  availableRefs?: readonly { version?: string | null; ref: string }[] | null;
  suggestedRefs?: readonly { version?: string | null; ref: string }[] | null;
}

export interface SourceRowFacts {
  target?: string;
  identity?: SourceProvenanceIdentity | null;
  qualifiers?: readonly string[];
}

export interface SourceTextOptions {
  width?: number;
  repositoryState?: "indexing" | "indexing when observed";
}

export function formatProvenanceRow(
  target: string,
  details: readonly string[],
): string {
  return sanitizeTerminalText(
    `${target}${details.length ? ` (${details.join(", ")})` : ""}`,
  );
}

/** Display labels never replace exact backend action operands. */
export function formatSourceIdentity(
  identity: SourceProvenanceIdentity | null | undefined,
  fallback?: string,
): string | undefined {
  if (identity?.repoUrl)
    return formatRepositoryTarget(
      identity.repoUrl,
      identity.commitSha?.slice(0, 8) ?? identity.gitRef ?? undefined,
    );
  if (identity?.registry && identity.packageName)
    return `${identity.registry.toLowerCase()}:${identity.packageName}${identity.version ? `@${identity.version}` : ""}`;
  return (
    identity?.site ??
    fallback ??
    identity?.commitSha?.slice(0, 8) ??
    identity?.gitRef ??
    identity?.version ??
    undefined
  );
}

/** One shared row grammar, with independently known dates and historical refs. */
export function formatSourceRow(facts: SourceRowFacts): string {
  const identity = facts.identity;
  const target = formatSourceIdentity(identity, facts.target) ?? "Source";
  const details = [
    ...(identity?.commitSha && identity.committedAt
      ? [`committed ${identity.committedAt.slice(0, 10)}`]
      : []),
    ...(identity?.commitSha &&
    identity.gitRef &&
    !/^[0-9a-f]{7,40}$/i.test(identity.gitRef)
      ? [`indexed from ref ${identity.gitRef}`]
      : []),
    ...(facts.qualifiers ?? []),
  ];
  return formatProvenanceRow(target, details);
}

export function renderSourceSection(
  sources: readonly SourceRowFacts[],
  options: SourceTextOptions = {},
): string[] {
  return sources.length
    ? [
        "Sources:",
        ...sources.flatMap((source) =>
          wrapTerminalProse(`  - ${formatSourceRow(source)}`, options.width),
        ),
      ]
    : [];
}

/** Match supplied full identities before formatting; refs and prefixes are not proof. */
export function sameRepositoryCommit(
  left: SourceProvenanceIdentity | null | undefined,
  right: SourceProvenanceIdentity | null | undefined,
): boolean {
  return Boolean(
    left?.repoUrl &&
      left.commitSha &&
      left.repoUrl === right?.repoUrl &&
      left.commitSha === right.commitSha,
  );
}

export function preparationMatchesIdentity(
  entry: DiscoveryIndexingEstimate,
  identity: SourceProvenanceIdentity | null | undefined,
): boolean {
  return (
    entry.kind === "REPOSITORY" &&
    sameRepositoryCommit(
      { repoUrl: entry.repositoryUrl, commitSha: entry.commitSha },
      identity,
    )
  );
}

/** Preparation dates come only from matching independently dated requested facts. */
export function preparationRequestedFacts(
  entry: DiscoveryIndexingEstimate,
  resolutions: readonly SourceProvenanceResolution[],
): { committedAt?: string; observedHead: boolean } {
  const matching = resolutions.filter((resolution) =>
    preparationMatchesIdentity(entry, resolution.resolvedRequested),
  );
  return {
    committedAt:
      matching.find((resolution) => resolution.resolvedRequested?.committedAt)
        ?.resolvedRequested?.committedAt ?? undefined,
    observedHead: matching.some((resolution) =>
      ["repo_head", "repo_default_branch"].includes(
        resolution.requested?.kind ?? "",
      ),
    ),
  };
}

/** State qualifiers describe backend artifact freshness, never date arithmetic. */
export function resolutionSourceFacts(
  resolution: SourceProvenanceResolution | null | undefined,
): SourceRowFacts[] {
  if (!resolution?.served || !formatSourceIdentity(resolution.served))
    return [];
  return [
    {
      identity: resolution.served,
      qualifiers:
        resolution.freshness === "fallback_recent"
          ? ["older snapshot"]
          : resolution.freshness === "provisional"
            ? ["provisional"]
            : [],
    },
  ];
}

/** Preparation conveys request intent without identifying an unknown requested commit. */
function preparationConveysRequestedFacts(
  resolution: SourceProvenanceResolution,
  preparation: readonly DiscoveryIndexingEstimate[] | undefined,
): boolean {
  const requested = resolution.resolvedRequested ?? resolution.requested;
  const requestedLabel = formatSourceIdentity(resolution.requested);
  return (
    preparation?.some(
      (entry) =>
        preparationMatchesIdentity(entry, requested) ||
        Boolean(
          !requested?.commitSha &&
            requestedLabel &&
            entry.targets.includes(requestedLabel),
        ),
    ) ?? false
  );
}

/** Describe requested-ref work without claiming the observed requested SHA is the job. */
export function formatRequestedIndexingExplanation(
  resolution: SourceProvenanceResolution | null | undefined,
  preparation: readonly DiscoveryIndexingEstimate[] | undefined,
  repositoryState: SourceTextOptions["repositoryState"] = "indexing",
): string | undefined {
  if (
    !resolution ||
    resolution.freshness === "current" ||
    !["requested_ref_indexing", "no_current_fallback"].includes(
      resolution.freshnessReason ?? "",
    ) ||
    preparationConveysRequestedFacts(resolution, preparation)
  )
    return undefined;
  const historical = repositoryState === "indexing when observed";
  const indexing = historical
    ? "was being indexed when observed"
    : "is being indexed";
  return resolution.freshnessReason === "no_current_fallback" &&
    !resolution.served
    ? `Requested target ${indexing}; no current snapshot ${historical ? "was available then" : "is available yet"}.`
    : `Requested ref ${indexing}.`;
}

/** Retain recovery and requested facts while replacing internal identity serialization. */
export function renderResolutionDetails(
  resolution: SourceProvenanceResolution | null | undefined,
  preparation: readonly DiscoveryIndexingEstimate[] | undefined,
  options: SourceTextOptions = {},
): string[] {
  if (!resolution || resolution.freshness === "current") return [];
  const lines: string[] = [];
  const requested = formatRequestedProvenance(resolution, preparation);
  if (requested) lines.push(requested);
  const reason = resolution.freshnessReason;
  if (resolution.freshness === "unavailable") lines.push("Target unavailable.");
  if (reason === "ref_resolution_deferred")
    lines.push("Branch resolution is deferred.");
  else if (
    reason === "requested_ref_indexing" ||
    reason === "no_current_fallback"
  ) {
    const explanation = formatRequestedIndexingExplanation(
      resolution,
      preparation,
      options.repositoryState,
    );
    if (explanation) lines.push(explanation);
  } else if (resolution.freshness === "indexing" && !preparation?.length) {
    lines.push("Requested target is being indexed.");
  }
  if (
    !resolution.freshness ||
    !["fallback_recent", "indexing", "provisional", "unavailable"].includes(
      resolution.freshness,
    )
  )
    lines.push(
      `Resolution state: ${resolution.freshness ?? "unknown"}${reason ? `; reason: ${reason}` : ""}`,
    );
  else if (
    reason &&
    ![
      "exact_current",
      "exact_provisional",
      "no_current_fallback",
      "ref_resolution_deferred",
      "requested_ref_indexing",
    ].includes(reason)
  )
    lines.push(`Resolution reason: ${reason}`);
  const artifacts = (
    values: SourceProvenanceResolution["availableRefs"],
  ): { version?: string; ref: string }[] =>
    (values ?? []).map((value) => ({
      ref: value.ref,
      ...(value.version ? { version: value.version } : {}),
    }));
  const recovery = {
    availableVersions: artifacts(resolution.availableVersions),
    availableRefs: artifacts(resolution.availableRefs),
    suggestedRefs: artifacts(resolution.suggestedRefs),
  };
  for (const line of [
    buildRetryCandidateLine(recovery),
    buildSuggestedRefsLine(recovery),
  ])
    if (line) lines.push(line);
  return lines.flatMap((line) =>
    wrapTerminalProse(
      sanitizeTerminalText(
        options.repositoryState === "indexing when observed"
          ? line.replaceAll(
              "is being indexed",
              "was being indexed when observed",
            )
          : line,
      ),
      options.width,
      "  ",
    ),
  );
}

/** A requested commit remains separate when preparation points at different work. */
export function formatRequestedProvenance(
  resolution: SourceProvenanceResolution | null | undefined,
  preparation: readonly DiscoveryIndexingEstimate[] | undefined,
): string | undefined {
  if (!resolution || resolution.freshness === "current") return undefined;
  const requested = resolution.resolvedRequested ?? resolution.requested;
  const target = formatSourceIdentity(requested);
  if (
    !requested ||
    !target ||
    preparationConveysRequestedFacts(resolution, preparation)
  )
    return undefined;
  if (
    sameRepositoryCommit(requested, resolution.served) &&
    !(requested.committedAt && !resolution.served?.committedAt)
  )
    return undefined;
  return `Requested: ${formatProvenanceRow(target, [
    ...(requested.commitSha && requested.committedAt
      ? [`committed ${requested.committedAt.slice(0, 10)}`]
      : []),
    ...(["repo_head", "repo_default_branch"].includes(
      resolution.requested?.kind ?? "",
    ) && requested.commitSha
      ? ["observed HEAD"]
      : []),
  ])}`;
}
