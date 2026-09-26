import type {
  ListAvailableVersion,
  ListBrowseAction,
  ListIndexingEstimate,
  ListReadAction,
  ListResolution,
  ListResult,
  ListSitePreparation,
  ListTargetIdentity,
  ListTargetResolution,
} from "@githits/core-internal";

/** The selected backend fields, projected as one camelCase success payload. */
export type ListResponse = ListResult;

/** Copy only fields selected by `Query.list`, retaining meaningful nulls. */
export function projectListResult(result: ListResult): ListResponse {
  const projected: ListResponse = {
    inventoryKind: result.inventoryKind,
    requestedTarget: result.requestedTarget,
    canonicalTarget: result.canonicalTarget,
    entries: result.entries.map((entry) => ({
      kind: entry.kind,
      path: entry.path,
      title: entry.title,
      read: entry.read === null ? null : projectReadAction(entry.read),
      browse: entry.browse === null ? null : projectBrowseAction(entry.browse),
      ...(entry.language !== undefined ? { language: entry.language } : {}),
      ...(entry.fileType !== undefined ? { fileType: entry.fileType } : {}),
      ...(entry.intent !== undefined ? { intent: entry.intent } : {}),
      ...(entry.byteSize !== undefined ? { byteSize: entry.byteSize } : {}),
      ...(entry.lineCount !== undefined ? { lineCount: entry.lineCount } : {}),
      ...(entry.contentHash !== undefined
        ? { contentHash: entry.contentHash }
        : {}),
    })),
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
    indexedVersion: result.indexedVersion,
    codeIndexState: result.codeIndexState,
    indexingStatus: result.indexingStatus,
    indexingRef: result.indexingRef,
    inventoryState: result.inventoryState,
    crawlStatus: result.crawlStatus,
    coverageState: result.coverageState,
    coverageReason: result.coverageReason,
    preparation:
      result.preparation === null
        ? null
        : projectPreparation(result.preparation),
  };

  if (result.resolution !== undefined) {
    projected.resolution =
      result.resolution === null ? null : projectResolution(result.resolution);
  }
  if (result.targetResolution !== undefined) {
    projected.targetResolution =
      result.targetResolution === null
        ? null
        : projectTargetResolution(result.targetResolution);
  }
  if (result.availableVersions !== undefined) {
    projected.availableVersions =
      result.availableVersions === null
        ? null
        : result.availableVersions.map(projectAvailableVersion);
  }
  if (result.indexingEstimate !== undefined) {
    projected.indexingEstimate =
      result.indexingEstimate === null
        ? null
        : projectIndexingEstimate(result.indexingEstimate);
  }

  return projected;
}

function projectReadAction(action: ListReadAction): ListReadAction {
  return {
    target: action.target,
    path: action.path,
  };
}

function projectBrowseAction(action: ListBrowseAction): ListBrowseAction {
  return {
    target: action.target,
    paths: action.paths === null ? null : [...action.paths],
  };
}

function projectAvailableVersion(
  version: ListAvailableVersion,
): ListAvailableVersion {
  return { version: version.version, ref: version.ref };
}

function projectResolution(resolution: ListResolution): ListResolution {
  return {
    requestedVersion: resolution.requestedVersion,
    requestedRef: resolution.requestedRef,
    resolvedRef: resolution.resolvedRef,
    commitSha: resolution.commitSha,
  };
}

function projectTargetIdentity(
  identity: ListTargetIdentity,
): ListTargetIdentity {
  return {
    kind: identity.kind,
    registry: identity.registry,
    packageName: identity.packageName,
    version: identity.version,
    repoUrl: identity.repoUrl,
    gitRef: identity.gitRef,
    commitSha: identity.commitSha,
  };
}

function projectTargetResolution(
  resolution: ListTargetResolution,
): ListTargetResolution {
  return {
    requested:
      resolution.requested === null
        ? null
        : projectTargetIdentity(resolution.requested),
    resolvedRequested:
      resolution.resolvedRequested === null
        ? null
        : projectTargetIdentity(resolution.resolvedRequested),
    served:
      resolution.served === null
        ? null
        : projectTargetIdentity(resolution.served),
    freshness: resolution.freshness,
    freshnessReason: resolution.freshnessReason,
    indexingRef: resolution.indexingRef,
    availableVersions:
      resolution.availableVersions === null
        ? null
        : resolution.availableVersions.map(projectAvailableVersion),
    availableRefs:
      resolution.availableRefs === null
        ? null
        : resolution.availableRefs.map(projectAvailableVersion),
    suggestedRefs:
      resolution.suggestedRefs === null
        ? null
        : resolution.suggestedRefs.map(projectAvailableVersion),
  };
}

function projectIndexingEstimate(
  estimate: ListIndexingEstimate,
): ListIndexingEstimate {
  return {
    lowerSeconds: estimate.lowerSeconds,
    upperSeconds: estimate.upperSeconds,
    elapsedSeconds: estimate.elapsedSeconds,
    sampleCount: estimate.sampleCount,
    source: estimate.source,
  };
}

function projectPreparation(
  preparation: ListSitePreparation,
): ListSitePreparation {
  return {
    selected: preparation.selected,
    enqueued: preparation.enqueued,
    activeJobs: preparation.activeJobs.map((job) => ({
      mode: job.mode,
      state: job.state,
    })),
    awaited: preparation.awaited.map((wait) => ({
      mode: wait.mode,
      outcome: wait.outcome,
    })),
  };
}
