import type { TargetResolution } from "../services/index.js";

export interface LeanTargetResolutionIdentity {
  kind?: string;
  registry?: string;
  packageName?: string;
  version?: string;
  repoUrl?: string;
  gitRef?: string;
  commitSha?: string;
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
}

export interface TargetResolutionRetryCandidates {
  freshness?: string;
  indexingRef?: string;
  availableVersions?: LeanAvailableArtifact[];
  availableRefs?: LeanAvailableArtifact[];
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
  };
}

export function buildTargetResolutionNotes(
  resolution: LeanTargetResolution | undefined,
): string[] {
  if (!resolution) return [];

  const lines: string[] = [];
  const requested = formatIdentity(resolution.requested);
  const fresh = formatIdentity(resolution.resolvedRequested);
  const served = formatIdentity(resolution.served);
  const reason = resolution.freshnessReason
    ? ` (${resolution.freshnessReason})`
    : "";

  switch (resolution.freshness) {
    case "fallback_recent": {
      const parts = ["using recent index"];
      if (served) parts.push(`served=${served}`);
      if (fresh && identitiesMateriallyDiffer(fresh, served)) {
        parts.push(`fresh=${fresh}`);
      }
      lines.push(`${parts.join(" | ")}${reason}`);
      break;
    }
    case "indexing": {
      const parts = ["indexing fresh target"];
      if (requested) parts.push(`requested=${requested}`);
      if (fresh) parts.push(`fresh=${fresh}`);
      if (resolution.indexingRef)
        parts.push(`indexingRef=${resolution.indexingRef}`);
      lines.push(`${parts.join(" | ")}${reason}`);
      break;
    }
    case "unavailable": {
      const parts = ["target unavailable"];
      if (requested) parts.push(`requested=${requested}`);
      lines.push(`${parts.join(" | ")}${reason}`);
      break;
    }
    case "current": {
      // `current` is a healthy state. The backend may describe requested,
      // resolved, and served identities at different abstraction layers
      // (for example npm:express -> GitHub tag@sha), but the freshness value
      // is the authoritative user-facing signal: no action is needed.
      break;
    }
    default: {
      if (resolution.freshness || identitiesDiffer(requested, fresh, served)) {
        const parts = [
          `target resolution: ${resolution.freshness ?? "unknown"}`,
        ];
        if (served) parts.push(`served=${served}`);
        if (requested) parts.push(`requested=${requested}`);
        if (fresh && fresh !== served) parts.push(`fresh=${fresh}`);
        lines.push(`${parts.join(" | ")}${reason}`);
      }
      break;
    }
  }

  const candidates = buildRetryCandidateLine(resolution);
  if (candidates) lines.push(candidates);
  return lines;
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

export function buildResolutionFromRetryCandidates(
  target: TargetResolutionRetryCandidates,
): LeanTargetResolution | undefined {
  if (!target.availableVersions?.length && !target.availableRefs?.length) {
    return undefined;
  }
  return {
    freshness: target.freshness,
    indexingRef: target.indexingRef,
    availableVersions: target.availableVersions ?? [],
    availableRefs: target.availableRefs ?? [],
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
  return out;
}

function projectArtifact(
  artifact: LeanAvailableArtifact,
): LeanAvailableArtifact {
  return artifact.version
    ? { version: artifact.version, ref: artifact.ref }
    : { ref: artifact.ref };
}

function formatIdentity(
  identity: LeanTargetResolutionIdentity | undefined,
): string | undefined {
  if (!identity) return undefined;
  if (identity.registry && identity.packageName) {
    const version = identity.version ? `@${identity.version}` : "";
    const commit = identity.commitSha ? `#${shortSha(identity.commitSha)}` : "";
    return `${identity.registry.toLowerCase()}:${identity.packageName}${version}${commit}`;
  }
  if (identity.repoUrl) {
    const ref = identity.gitRef ? `#${identity.gitRef}` : "";
    const commit = identity.commitSha ? `@${shortSha(identity.commitSha)}` : "";
    return `${identity.repoUrl}${ref}${commit}`;
  }
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
