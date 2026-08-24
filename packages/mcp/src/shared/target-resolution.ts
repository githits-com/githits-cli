import type { TargetResolution } from "@githits/core-internal";
import { formatRepositoryTarget } from "./repository-target.js";

export interface LeanTargetResolutionIdentity {
  kind?: string;
  registry?: string;
  packageName?: string;
  version?: string;
  repoUrl?: string;
  gitRef?: string;
  commitSha?: string;
  site?: string;
}

export interface LeanAvailableArtifact {
  version?: string;
  ref: string;
}

export interface LeanTargetResolution {
  requested?: LeanTargetResolutionIdentity;
  resolvedRequested?: LeanTargetResolutionIdentity;
  served?: LeanTargetResolutionIdentity;
  freshness?: string;
  freshnessReason?: string;
  indexingRef?: string;
  availableVersions: LeanAvailableArtifact[];
  availableRefs: LeanAvailableArtifact[];
  suggestedRefs?: LeanAvailableArtifact[];
}

export interface TargetResolutionRetryCandidates {
  freshness?: string;
  indexingRef?: string;
  availableVersions?: LeanAvailableArtifact[];
  availableRefs?: LeanAvailableArtifact[];
  suggestedRefs?: LeanAvailableArtifact[];
}

export function projectTargetResolution(
  resolution: TargetResolution | undefined,
): LeanTargetResolution | undefined {
  if (!resolution) return undefined;
  return {
    ...(resolution.requested
      ? { requested: projectIdentity(resolution.requested) }
      : {}),
    ...(resolution.resolvedRequested
      ? { resolvedRequested: projectIdentity(resolution.resolvedRequested) }
      : {}),
    ...(resolution.served
      ? { served: projectIdentity(resolution.served) }
      : {}),
    ...(resolution.freshness ? { freshness: resolution.freshness } : {}),
    ...(resolution.freshnessReason
      ? { freshnessReason: resolution.freshnessReason }
      : {}),
    ...(resolution.indexingRef ? { indexingRef: resolution.indexingRef } : {}),
    availableVersions: resolution.availableVersions.map(projectArtifact),
    availableRefs: resolution.availableRefs.map(projectArtifact),
    suggestedRefs: (resolution.suggestedRefs ?? []).map(projectArtifact),
  };
}

export function buildTargetResolutionNotes(
  resolution: LeanTargetResolution | undefined,
): string[] {
  if (!resolution) return [];

  const lines: string[] = [];
  const requested = formatTargetResolutionIdentity(resolution.requested);
  const fresh = formatTargetResolutionIdentity(resolution.resolvedRequested);
  const served = formatTargetResolutionIdentity(resolution.served);
  const reason = formatFreshnessReason(
    resolution.freshnessReason,
    resolution.freshness,
  );

  switch (resolution.freshness) {
    case "fallback_recent": {
      const parts = [reason ?? "Using recent indexed snapshot"];
      if (served) parts.push(`served=${served}`);
      if (fresh && identitiesMateriallyDiffer(fresh, served)) {
        parts.push(`fresh=${fresh}`);
      }
      lines.push(parts.join(" | "));
      break;
    }
    case "indexing": {
      const parts = [reason ?? "Fresh target is being indexed"];
      if (requested) parts.push(`requested=${requested}`);
      if (fresh) parts.push(`fresh=${fresh}`);
      if (resolution.indexingRef)
        parts.push(`indexingRef=${resolution.indexingRef}`);
      lines.push(parts.join(" | "));
      break;
    }
    case "provisional": {
      // A provisional result is queryable, but only its exact served identity
      // is authoritative. Do not render requested refs as a retry target.
      const parts = ["provisional (still indexing)"];
      if (reason) parts.push(reason);
      if (served) parts.push(`served=${served}`);
      if (resolution.indexingRef)
        parts.push(`indexingRef=${resolution.indexingRef}`);
      lines.push(parts.join(" | "));
      break;
    }
    case "unavailable": {
      const parts = [reason ?? "Target unavailable"];
      if (requested) parts.push(`requested=${requested}`);
      lines.push(parts.join(" | "));
      break;
    }
    case "current": {
      // `current` is a healthy state. The backend may describe requested,
      // resolved, and served identities at different abstraction layers
      // (for example npm:express -> GitHub tag@sha), but the freshness value
      // is the authoritative user-facing signal: no action is needed. This
      // also suppresses retry candidates retained from an earlier indexing
      // snapshot, including after a waited search completes.
      return lines;
    }
    default: {
      if (resolution.freshness || identitiesDiffer(requested, fresh, served)) {
        const parts = [
          `target resolution: ${resolution.freshness ?? "unknown"}`,
        ];
        if (served) parts.push(`served=${served}`);
        if (requested) parts.push(`requested=${requested}`);
        if (fresh && fresh !== served) parts.push(`fresh=${fresh}`);
        if (reason) parts.push(reason);
        lines.push(parts.join(" | "));
      }
      break;
    }
  }

  const candidates = buildRetryCandidateLine(resolution);
  if (candidates) lines.push(candidates);
  const suggestions = buildSuggestedRefsLine(resolution);
  if (suggestions) lines.push(suggestions);
  return lines;
}

function formatFreshnessReason(
  reason: string | undefined,
  freshness: string | undefined,
): string | undefined {
  switch (reason) {
    case undefined:
    case "exact_current":
    case "exact_provisional":
      return undefined;
    case "no_current_fallback":
      if (freshness === "fallback_recent") {
        return "Serving an older indexed snapshot; current target is still being indexed";
      }
      return "Fresh target is being indexed; no current snapshot is available yet";
    case "ref_resolution_deferred":
      return "Using recent indexed snapshot while branch resolution is deferred";
    case "requested_ref_indexing":
      return "Requested ref is being indexed";
    default:
      return `freshnessReason=${reason}`;
  }
}

export function buildRetryCandidateLine(
  resolution: LeanTargetResolution | undefined,
): string | undefined {
  if (!resolution) return undefined;
  const parts: string[] = [];
  if (resolution.availableVersions.length > 0) {
    parts.push(
      `versions=${resolution.availableVersions.map(formatArtifact).join(",")}`,
    );
  }
  if (resolution.availableRefs.length > 0) {
    parts.push(
      `refs=${resolution.availableRefs.map(formatArtifact).join(",")}`,
    );
  }
  return parts.length > 0 ? `queryable now: ${parts.join(" | ")}` : undefined;
}

export function buildSuggestedRefsLine(
  resolution: LeanTargetResolution | undefined,
): string | undefined {
  const refs = resolution?.suggestedRefs ?? [];
  if (refs.length === 0) return undefined;
  return `suggested refs (may need indexing): ${refs
    .map(formatArtifact)
    .join(",")}`;
}

export function buildResolutionFromRetryCandidates(
  target: TargetResolutionRetryCandidates,
): LeanTargetResolution | undefined {
  if (
    !target.availableVersions?.length &&
    !target.availableRefs?.length &&
    !target.suggestedRefs?.length
  ) {
    return undefined;
  }
  return {
    freshness: target.freshness === "CURRENT" ? "current" : target.freshness,
    indexingRef: target.indexingRef,
    availableVersions: target.availableVersions ?? [],
    availableRefs: target.availableRefs ?? [],
    suggestedRefs: target.suggestedRefs ?? [],
  };
}

function projectIdentity(
  identity: NonNullable<TargetResolution["requested"]>,
): LeanTargetResolutionIdentity {
  const out: LeanTargetResolutionIdentity = {};
  if (identity.kind) out.kind = identity.kind;
  if (identity.registry) out.registry = identity.registry;
  if (identity.packageName) out.packageName = identity.packageName;
  if (identity.version) out.version = identity.version;
  if (identity.repoUrl) out.repoUrl = identity.repoUrl;
  if (identity.gitRef) out.gitRef = identity.gitRef;
  if (identity.commitSha) out.commitSha = identity.commitSha;
  if (identity.site) out.site = identity.site;
  return out;
}

function projectArtifact(
  artifact: LeanAvailableArtifact,
): LeanAvailableArtifact {
  return artifact.version
    ? { version: artifact.version, ref: artifact.ref }
    : { ref: artifact.ref };
}

export function formatTargetResolutionIdentity(
  identity: LeanTargetResolutionIdentity | undefined,
): string | undefined {
  if (!identity) return undefined;
  if (identity.registry && identity.packageName) {
    const version = identity.version ? `@${identity.version}` : "";
    const commit = identity.commitSha ? `#${shortSha(identity.commitSha)}` : "";
    return `${identity.registry.toLowerCase()}:${identity.packageName}${version}${commit}`;
  }
  if (identity.repoUrl) {
    const target = formatRepositoryTarget(identity.repoUrl, identity.gitRef);
    const commit = identity.commitSha ? `@${shortSha(identity.commitSha)}` : "";
    return `${target}${commit}`;
  }
  if (identity.site) return identity.site;
  return (
    identity.gitRef ?? identity.version ?? identity.commitSha ?? identity.kind
  );
}

function formatArtifact(artifact: LeanAvailableArtifact): string {
  return artifact.version
    ? `${artifact.version}@${artifact.ref}`
    : artifact.ref;
}

function identitiesDiffer(
  requested: string | undefined,
  fresh: string | undefined,
  served: string | undefined,
): boolean {
  if (!served) return Boolean(requested || fresh);
  return Boolean(
    (requested && requested !== served) || (fresh && fresh !== served),
  );
}

function identitiesMateriallyDiffer(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (!left || !right) return Boolean(left || right);
  return stripShortCommit(left) !== stripShortCommit(right);
}

function stripShortCommit(value: string): string {
  return value.replace(/[@#][0-9a-f]{7}$/i, "");
}

function shortSha(value: string): string {
  return /^[0-9a-f]{12,}$/i.test(value) ? value.slice(0, 7) : value;
}
