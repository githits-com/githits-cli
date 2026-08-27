import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
  UnifiedSearchProgressPayload,
  UnifiedSearchQueryEcho,
  UnifiedSearchSourceStatusPayload,
  UnifiedSearchStatusCompletedPayload,
  UnifiedSearchStatusIncompletePayload,
  UnifiedSearchStatusResultPayload,
} from "./unified-search-response.js";

export type UnifiedSearchPresentationInput =
  | UnifiedSearchCompletedPayload
  | UnifiedSearchIncompletePayload
  | UnifiedSearchStatusCompletedPayload
  | UnifiedSearchStatusIncompletePayload;

export type UnifiedSearchAvailabilityKind =
  | "no_snapshot"
  | "empty"
  | "interim"
  | "partial"
  | "final";

export interface UnifiedSearchAvailability {
  kind: UnifiedSearchAvailabilityKind;
  hasSnapshot: boolean;
  resultCount: number;
}

export type UnifiedSearchActiveStatus = "PENDING" | "INDEXING" | "SEARCHING";
export type UnifiedSearchTerminalStatus = "DEFERRED" | "TIMEOUT" | "FAILED";

export type UnifiedSearchLifecycle =
  | { kind: "active"; status: UnifiedSearchActiveStatus }
  | { kind: "completed"; status: "COMPLETED" }
  | { kind: "terminal"; status: UnifiedSearchTerminalStatus }
  | { kind: "unknown"; status?: string };

export type UnifiedSearchSourceKind = "code" | "repository_docs" | "site_docs";
export type UnifiedSearchSourceReadiness =
  | "searched"
  | "waiting"
  | "available_not_searched"
  | "unavailable";

export interface UnifiedSearchSourceEntry {
  state: UnifiedSearchSourceReadiness;
  target: string;
  contextTarget?: string;
  resultCount?: number;
  repositoryUrl?: string;
  commitSha?: string;
  siteKey?: string;
  siteUrl?: string;
}

export interface UnifiedSearchSourceGroup {
  kind: UnifiedSearchSourceKind;
  entries: UnifiedSearchSourceEntry[];
}

export interface UnifiedSearchProgressPresentation {
  targetsReady: number;
  targetsTotal: number;
  elapsedMs: number;
  requestedSources?: string[];
}

export interface UnifiedSearchTargetPresentation {
  requested?: string;
  fresh?: string;
  served?: string;
  freshness?: string;
}

export interface UnifiedSearchAlternative {
  version?: string;
  ref: string;
}

export interface UnifiedSearchAlternativeFacts {
  target?: string;
  versions: UnifiedSearchAlternative[];
  versionsRemaining: number;
  refs: UnifiedSearchAlternative[];
  refsRemaining: number;
  suggestedRefs: UnifiedSearchAlternative[];
  suggestedRefsRemaining: number;
}

export type UnifiedSearchConstraintKind =
  | "ignored_filter"
  | "incompatible_filter"
  | "ignored_query_feature"
  | "incompatible_query_feature";

export type UnifiedSearchTrustLimit =
  | {
      kind: "stale";
      target?: string;
      requestedTarget?: string;
      freshTarget?: string;
      servedTarget?: string;
    }
  | { kind: "provisional"; target?: string }
  | {
      kind: "source";
      source: UnifiedSearchSourceKind;
      state: Exclude<UnifiedSearchSourceReadiness, "searched">;
      target?: string;
    }
  | {
      kind: "coverage";
      source: UnifiedSearchSourceKind;
      state: "partial" | "capped";
      target?: string;
      pagesCrawled?: number;
      frontierRemaining?: number;
      estimatedTotalPages?: number;
    }
  | {
      kind: "constraint";
      constraint: UnifiedSearchConstraintKind;
      source?: string;
      values: string[];
    }
  | { kind: "mutable_evidence" };

export type UnifiedSearchWarning =
  | { kind: "query"; message: string }
  | {
      kind: UnifiedSearchConstraintKind;
      source?: string;
      values: string[];
    };

export type UnifiedSearchAction =
  | { kind: "poll"; searchRef: string }
  | { kind: "status"; searchRef: string }
  | { kind: "new_search" }
  | {
      kind: "indexed_alternative";
      target?: string;
      category: "version" | "ref";
      value: string;
    }
  | {
      kind: "query_rewrite";
      rewrites: UnifiedSearchRewriteKind[];
    }
  | { kind: "none" };

export type UnifiedSearchRewriteKind =
  | "shorter_or_broader"
  | "remove_filters"
  | "symbol"
  | "code_grep"
  | "site_shorter_or_broader";

export interface UnifiedSearchPresentation {
  availability: UnifiedSearchAvailability;
  lifecycle: UnifiedSearchLifecycle;
  lifecycleHeadline: "preparing" | "indexing" | "searching" | undefined;
  query?: UnifiedSearchQueryEcho;
  searchRef?: string;
  progress?: UnifiedSearchProgressPresentation;
  targets: UnifiedSearchTargetPresentation[];
  hasMore: boolean;
  sources: UnifiedSearchSourceGroup[];
  trustLimits: UnifiedSearchTrustLimit[];
  warnings: UnifiedSearchWarning[];
  alternatives: UnifiedSearchAlternativeFacts[];
  action: UnifiedSearchAction;
}

interface SnapshotFacts {
  query?: UnifiedSearchQueryEcho;
  partialResults: boolean;
  hasMore: boolean;
  results: UnifiedSearchHitPayload[];
  sourceStatus?: UnifiedSearchSourceStatusPayload[];
  evidenceNotice?: string;
}

interface ProgressFacts {
  progress?: UnifiedSearchProgressPayload;
}

interface CandidateSet {
  target?: string;
  versions: UnifiedSearchAlternative[];
  refs: UnifiedSearchAlternative[];
  suggestedRefs: UnifiedSearchAlternative[];
}

const MAX_ALTERNATIVES = 3;

export function projectUnifiedSearchPresentation(
  payload: UnifiedSearchPresentationInput,
): UnifiedSearchPresentation {
  const snapshot = extractSnapshot(payload);
  const progress = extractProgress(payload);
  const lifecycle = projectLifecycle(payload, progress.progress);
  const availability = projectAvailability(snapshot, lifecycle);
  const sourceStatus = snapshot?.sourceStatus;
  const sources = projectSources(sourceStatus);
  const trustLimits = projectTrustLimits(snapshot, sources, sourceStatus);
  const warnings = projectWarnings(snapshot?.query, sourceStatus);
  const alternatives = projectAlternatives(progress.progress, sourceStatus);

  return {
    availability,
    lifecycle,
    lifecycleHeadline: lifecycleHeadline(lifecycle),
    query: snapshot?.query ?? extractQuery(payload),
    searchRef: extractSearchRef(payload),
    progress: projectProgress(progress.progress),
    targets: projectTargets(progress.progress),
    hasMore: snapshot?.hasMore ?? false,
    sources,
    trustLimits,
    warnings,
    alternatives,
    action: projectAction({
      payload,
      snapshot,
      progress: progress.progress,
      lifecycle,
      availability,
      sources,
      trustLimits,
      alternatives,
    }),
  };
}

function extractSnapshot(
  payload: UnifiedSearchPresentationInput,
): SnapshotFacts | undefined {
  if ("result" in payload) return payload.result;
  if (payload.completed) {
    return {
      query: payload.query,
      partialResults: payload.partialResults,
      hasMore: payload.hasMore,
      results: payload.results,
      sourceStatus: payload.sourceStatus,
      evidenceNotice: payload.evidenceNotice,
    };
  }
  if ("partialResults" in payload && payload.partialResults !== undefined) {
    return {
      query: payload.query,
      partialResults: payload.partialResults,
      hasMore: payload.hasMore,
      results: payload.results,
      sourceStatus: payload.sourceStatus,
      evidenceNotice: payload.evidenceNotice,
    };
  }
  return undefined;
}

function extractProgress(
  payload: UnifiedSearchPresentationInput,
): ProgressFacts {
  return "progress" in payload ? { progress: payload.progress } : {};
}

function extractQuery(
  payload: UnifiedSearchPresentationInput,
): UnifiedSearchQueryEcho | undefined {
  if ("query" in payload) return payload.query;
  return undefined;
}

function extractSearchRef(
  payload: UnifiedSearchPresentationInput,
): string | undefined {
  return "searchRef" in payload ? payload.searchRef : undefined;
}

function projectProgress(
  progress: UnifiedSearchProgressPayload | undefined,
): UnifiedSearchProgressPresentation | undefined {
  if (!progress) return undefined;
  return {
    targetsReady: progress.targetsReady,
    targetsTotal: progress.targetsTotal,
    elapsedMs: progress.elapsedMs,
    ...(progress.requestedSources?.length
      ? {
          requestedSources: progress.requestedSources.map((source) =>
            source.toLowerCase(),
          ),
        }
      : {}),
  };
}

function projectTargets(
  progress: UnifiedSearchProgressPayload | undefined,
): UnifiedSearchTargetPresentation[] {
  return (progress?.targets ?? []).map((target) => ({
    ...(target.requested ? { requested: target.requested } : {}),
    ...(target.resolvedRequested ? { fresh: target.resolvedRequested } : {}),
    ...(target.served ? { served: target.served } : {}),
    ...(target.freshness ? { freshness: target.freshness } : {}),
  }));
}

function projectLifecycle(
  payload: UnifiedSearchPresentationInput,
  progress: UnifiedSearchProgressPayload | undefined,
): UnifiedSearchLifecycle {
  if (payload.completed) return { kind: "completed", status: "COMPLETED" };
  const status = progress?.status;
  switch (status) {
    case "PENDING":
    case "INDEXING":
    case "SEARCHING":
      return { kind: "active", status };
    case "DEFERRED":
    case "TIMEOUT":
    case "FAILED":
      return { kind: "terminal", status };
    default:
      return { kind: "unknown", status };
  }
}

function lifecycleHeadline(
  lifecycle: UnifiedSearchLifecycle,
): "preparing" | "indexing" | "searching" | undefined {
  if (lifecycle.kind !== "active") return undefined;
  switch (lifecycle.status) {
    case "PENDING":
      return "preparing";
    case "INDEXING":
      return "indexing";
    case "SEARCHING":
      return "searching";
  }
}

function projectAvailability(
  snapshot: SnapshotFacts | undefined,
  lifecycle: UnifiedSearchLifecycle,
): UnifiedSearchAvailability {
  if (!snapshot) {
    return { kind: "no_snapshot", hasSnapshot: false, resultCount: 0 };
  }
  const resultCount = snapshot.results.length;
  if (resultCount === 0) {
    return { kind: "empty", hasSnapshot: true, resultCount };
  }
  if (snapshot.partialResults) {
    return { kind: "partial", hasSnapshot: true, resultCount };
  }
  return {
    kind: lifecycle.kind === "active" ? "interim" : "final",
    hasSnapshot: true,
    resultCount,
  };
}

function projectSources(
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): UnifiedSearchSourceGroup[] {
  if (!sourceStatus) return [];
  const groups: UnifiedSearchSourceGroup[] = [];
  for (const entry of sourceStatus) {
    if (entry.contributors && entry.contributors.length > 0) {
      for (const contributor of entry.contributors) {
        const kind =
          contributor.kind === "DOCPACK" ? "site_docs" : "repository_docs";
        const identity = contributorIdentity(entry, contributor);
        appendSourceEntry(groups, kind, {
          state: contributorState(contributor.state),
          ...identity,
          resultCount: contributor.resultCount,
        });
      }
      continue;
    }

    const kind = sourceKind(entry);
    appendSourceEntry(groups, kind, {
      state: sourceState(entry),
      target: sourceTarget(entry),
      resultCount: entry.resultCount,
    });
  }
  return groups;
}

function appendSourceEntry(
  groups: UnifiedSearchSourceGroup[],
  kind: UnifiedSearchSourceKind,
  entry: UnifiedSearchSourceEntry,
): void {
  const group = groups.find((candidate) => candidate.kind === kind);
  if (group) group.entries.push(entry);
  else groups.push({ kind, entries: [entry] });
}

function sourceKind(
  entry: UnifiedSearchSourceStatusPayload,
): UnifiedSearchSourceKind {
  if (entry.source.toLowerCase() === "code") return "code";
  return isSiteTarget(entry.targetLabel, entry)
    ? "site_docs"
    : "repository_docs";
}

function contributorIdentity(
  entry: UnifiedSearchSourceStatusPayload,
  contributor: NonNullable<
    UnifiedSearchSourceStatusPayload["contributors"]
  >[number],
): Pick<
  UnifiedSearchSourceEntry,
  | "target"
  | "contextTarget"
  | "repositoryUrl"
  | "commitSha"
  | "siteKey"
  | "siteUrl"
> {
  const contextTarget = sourceTarget(entry);
  const target =
    contributor.kind === "REPOSITORY_DOCS"
      ? (contributor.repositoryUrl ?? contextTarget)
      : (contributor.siteUrl ?? contributor.siteKey ?? contextTarget);
  return {
    target,
    ...(target !== contextTarget ? { contextTarget } : {}),
    ...(contributor.repositoryUrl
      ? { repositoryUrl: contributor.repositoryUrl }
      : {}),
    ...(contributor.commitSha ? { commitSha: contributor.commitSha } : {}),
    ...(contributor.siteKey ? { siteKey: contributor.siteKey } : {}),
    ...(contributor.siteUrl ? { siteUrl: contributor.siteUrl } : {}),
  };
}

function sourceTarget(entry: UnifiedSearchSourceStatusPayload): string {
  return entry.servedTarget ?? entry.targetLabel;
}

function sourceState(
  entry: UnifiedSearchSourceStatusPayload,
): UnifiedSearchSourceReadiness {
  const states = [entry.indexingStatus, entry.codeIndexState];
  if (states.some((state) => state === "INDEXING" || state === "PENDING")) {
    return "waiting";
  }
  if (states.some((state) => state === "FAILED" || state === "UNAVAILABLE")) {
    return "unavailable";
  }
  return "searched";
}

function contributorState(
  state: "SEARCHED" | "READY" | "PENDING" | "UNAVAILABLE",
): UnifiedSearchSourceReadiness {
  switch (state) {
    case "SEARCHED":
      return "searched";
    case "READY":
      return "available_not_searched";
    case "PENDING":
      return "waiting";
    case "UNAVAILABLE":
      return "unavailable";
  }
}

function projectTrustLimits(
  snapshot: SnapshotFacts | undefined,
  sources: UnifiedSearchSourceGroup[],
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): UnifiedSearchTrustLimit[] {
  const limits: UnifiedSearchTrustLimit[] = [];
  const seen = new Set<string>();
  const add = (limit: UnifiedSearchTrustLimit): void => {
    const key = JSON.stringify(limit);
    if (!seen.has(key)) {
      seen.add(key);
      limits.push(limit);
    }
  };

  for (const group of sources) {
    for (const entry of group.entries) {
      if (entry.state !== "searched") {
        add({
          kind: "source",
          source: group.kind,
          state: entry.state,
          target: entry.target,
        });
      }
    }
  }

  for (const hit of snapshot?.results ?? []) {
    if (!isHitPayload(hit)) continue;
    if (hit.freshness === "STALE") {
      add({
        kind: "stale",
        target: hit.servedTarget ?? hit.target,
        requestedTarget: hit.requestedTarget,
        freshTarget: hit.freshTarget,
        servedTarget: hit.servedTarget,
      });
    }
  }

  for (const entry of sourceStatus ?? []) {
    const target = sourceTarget(entry);
    const freshness = entry.targetResolution?.freshness;
    if (entry.codeIndexState === "STALE" || freshness === "fallback_recent") {
      add({
        kind: "stale",
        target,
        requestedTarget: entry.requestedTarget,
        freshTarget: entry.freshTarget,
        servedTarget: entry.servedTarget,
      });
    }
    if (
      entry.codeIndexState === "PROVISIONAL" ||
      freshness === "provisional" ||
      entry.contributors?.some(
        (contributor) => contributor.freshness === "PROVISIONAL",
      )
    ) {
      add({ kind: "provisional", target });
    }
    const kind = sourceKind(entry);
    addCoverage(add, kind, target, entry.coverage);
    for (const contributor of entry.contributors ?? []) {
      const contributorTargetValue = contributorIdentity(entry, contributor);
      if (contributor.freshness === "STALE") {
        add({ kind: "stale", target: contributorTargetValue.target });
      }
      addCoverage(
        add,
        contributor.kind === "DOCPACK" ? "site_docs" : "repository_docs",
        contributorTargetValue.target,
        contributor.coverage,
      );
    }
    addConstraints(add, entry);
  }

  if (snapshot?.evidenceNotice !== undefined) {
    add({ kind: "mutable_evidence" });
  }
  return limits;
}

function addCoverage(
  add: (limit: UnifiedSearchTrustLimit) => void,
  source: UnifiedSearchSourceKind,
  target: string,
  coverage:
    | {
        coverageState: string;
        pagesCrawled?: number;
        frontierRemaining?: number | null;
        estimatedTotalPages?: number;
      }
    | undefined,
): void {
  if (!coverage) return;
  if (
    coverage.coverageState !== "PARTIAL" &&
    coverage.coverageState !== "CAPPED"
  ) {
    return;
  }
  add({
    kind: "coverage",
    source,
    state: coverage.coverageState.toLowerCase() as "partial" | "capped",
    target,
    pagesCrawled: coverage.pagesCrawled,
    frontierRemaining:
      typeof coverage.frontierRemaining === "number"
        ? coverage.frontierRemaining
        : undefined,
    estimatedTotalPages: coverage.estimatedTotalPages,
  });
}

function addConstraints(
  add: (limit: UnifiedSearchTrustLimit) => void,
  entry: UnifiedSearchSourceStatusPayload,
): void {
  const target = entry.targetLabel;
  const constraints: Array<
    [UnifiedSearchConstraintKind, string[] | undefined]
  > = [
    ["ignored_filter", entry.ignoredFilters],
    ["incompatible_filter", entry.incompatibleFilters],
    ["ignored_query_feature", entry.ignoredQueryFeatures],
    ["incompatible_query_feature", entry.incompatibleQueryFeatures],
  ];
  for (const [constraint, values] of constraints) {
    if (values && values.length > 0) {
      add({ kind: "constraint", constraint, source: target, values });
    }
  }
}

function projectWarnings(
  query: UnifiedSearchQueryEcho | undefined,
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): UnifiedSearchWarning[] {
  const warnings: UnifiedSearchWarning[] = [];
  for (const message of query?.warnings ?? []) {
    warnings.push({ kind: "query", message });
  }
  for (const entry of sourceStatus ?? []) {
    const source = entry.targetLabel;
    const constraints: Array<
      [UnifiedSearchConstraintKind, string[] | undefined]
    > = [
      ["ignored_filter", entry.ignoredFilters],
      ["incompatible_filter", entry.incompatibleFilters],
      ["ignored_query_feature", entry.ignoredQueryFeatures],
      ["incompatible_query_feature", entry.incompatibleQueryFeatures],
    ];
    for (const [kind, values] of constraints) {
      if (values && values.length > 0) warnings.push({ kind, source, values });
    }
  }
  return warnings;
}

function projectAlternatives(
  progress: UnifiedSearchProgressPayload | undefined,
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): UnifiedSearchAlternativeFacts[] {
  const candidates: CandidateSet[] = [];
  for (const target of progress?.targets ?? []) {
    candidates.push({
      target: target.requested,
      versions:
        target.targetResolution?.availableVersions ??
        target.availableVersions ??
        [],
      refs:
        target.targetResolution?.availableRefs ?? target.availableRefs ?? [],
      suggestedRefs:
        target.targetResolution?.suggestedRefs ?? target.suggestedRefs ?? [],
    });
  }
  for (const entry of sourceStatus ?? []) {
    const resolution = entry.targetResolution;
    if (!resolution) continue;
    candidates.push({
      target: sourceTarget(entry),
      versions: resolution.availableVersions,
      refs: resolution.availableRefs,
      suggestedRefs: resolution.suggestedRefs ?? [],
    });
  }
  return candidates
    .filter(
      (candidate) =>
        candidate.versions.length > 0 ||
        candidate.refs.length > 0 ||
        candidate.suggestedRefs.length > 0,
    )
    .map((candidate) => ({
      target: candidate.target,
      ...boundedAlternatives(
        candidate.versions,
        candidate.refs,
        candidate.suggestedRefs,
      ),
    }));
}

function boundedAlternatives(
  versions: UnifiedSearchAlternative[],
  refs: UnifiedSearchAlternative[],
  suggestedRefs: UnifiedSearchAlternative[],
): Omit<UnifiedSearchAlternativeFacts, "target"> {
  return {
    versions: versions.slice(0, MAX_ALTERNATIVES),
    versionsRemaining: Math.max(0, versions.length - MAX_ALTERNATIVES),
    refs: refs.slice(0, MAX_ALTERNATIVES),
    refsRemaining: Math.max(0, refs.length - MAX_ALTERNATIVES),
    suggestedRefs: suggestedRefs.slice(0, MAX_ALTERNATIVES),
    suggestedRefsRemaining: Math.max(
      0,
      suggestedRefs.length - MAX_ALTERNATIVES,
    ),
  };
}

interface ActionInput {
  payload: UnifiedSearchPresentationInput;
  snapshot: SnapshotFacts | undefined;
  progress: UnifiedSearchProgressPayload | undefined;
  lifecycle: UnifiedSearchLifecycle;
  availability: UnifiedSearchAvailability;
  sources: UnifiedSearchSourceGroup[];
  trustLimits: UnifiedSearchTrustLimit[];
  alternatives: UnifiedSearchAlternativeFacts[];
}

function projectAction(input: ActionInput): UnifiedSearchAction {
  if (input.lifecycle.kind === "active") {
    const searchRef = extractSearchRef(input.payload);
    return searchRef ? { kind: "poll", searchRef } : { kind: "none" };
  }
  if (
    input.lifecycle.kind === "terminal" ||
    input.lifecycle.kind === "unknown"
  ) {
    return { kind: "new_search" };
  }
  if (
    input.lifecycle.kind === "completed" &&
    input.snapshot?.evidenceNotice !== undefined
  ) {
    const searchRef = extractSearchRef(input.payload);
    if (searchRef) return { kind: "status", searchRef };
  }
  if (!input.snapshot || input.availability.kind !== "empty") {
    return { kind: "none" };
  }

  const hasIndexing = hasIndexingTrustSignal(input.snapshot.sourceStatus);
  if (hasIndexing) {
    const alternative = firstAlternative(input.alternatives);
    if (alternative) return alternative;
    return { kind: "new_search" };
  }
  if (
    input.trustLimits.some(
      (limit) =>
        limit.kind === "source" ||
        limit.kind === "coverage" ||
        limit.kind === "mutable_evidence" ||
        limit.kind === "stale",
    )
  ) {
    return { kind: "none" };
  }

  if (isStandaloneSiteSearch(input.snapshot.sourceStatus)) {
    return {
      kind: "query_rewrite",
      rewrites: ["site_shorter_or_broader"],
    };
  }
  const query = input.snapshot.query;
  const rewrites: UnifiedSearchRewriteKind[] = ["shorter_or_broader"];
  if (hasRestrictiveFilters(query)) rewrites.push("remove_filters");
  const symbolSource = query?.sources?.some(
    (source) => source.toLowerCase() === "symbol",
  );
  if (!symbolSource) rewrites.push("symbol");
  rewrites.push("code_grep");
  return { kind: "query_rewrite", rewrites };
}

function firstAlternative(
  alternatives: UnifiedSearchAlternativeFacts[],
): UnifiedSearchAction | undefined {
  for (const alternative of alternatives) {
    const version = alternative.versions[0];
    if (version) {
      return {
        kind: "indexed_alternative",
        target: alternative.target,
        category: "version",
        value: version.version ?? version.ref,
      };
    }
    const ref = alternative.refs[0];
    if (ref) {
      return {
        kind: "indexed_alternative",
        target: alternative.target,
        category: "ref",
        value: ref.ref,
      };
    }
  }
  return undefined;
}

function hasIndexingTrustSignal(
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): boolean {
  return Boolean(
    sourceStatus?.some(
      (entry) =>
        entry.indexingStatus === "INDEXING" ||
        entry.codeIndexState === "INDEXING" ||
        entry.codeIndexState === "PROVISIONAL" ||
        entry.targetResolution?.freshness === "indexing" ||
        entry.targetResolution?.freshness === "provisional" ||
        entry.contributors?.some(
          (contributor) => contributor.freshness === "PROVISIONAL",
        ),
    ),
  );
}

function hasRestrictiveFilters(
  query: UnifiedSearchQueryEcho | undefined,
): boolean {
  const filters = query?.filters;
  return Boolean(
    filters?.kind ||
      filters?.category ||
      filters?.pathPrefix ||
      filters?.fileIntent ||
      filters?.publicOnly === true ||
      (query?.raw &&
        /(?:^|\s)(?:kind|category|path|lang|name|intent):/i.test(query.raw)),
  );
}

function isStandaloneSiteSearch(
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): boolean {
  return Boolean(
    sourceStatus?.length &&
      sourceStatus.every((entry) => isSiteTarget(entry.targetLabel, entry)),
  );
}

function isSiteTarget(
  target: string,
  entry: UnifiedSearchSourceStatusPayload,
): boolean {
  return Boolean(
    target.startsWith("site:") ||
      entry.targetResolution?.requested?.site ||
      entry.targetResolution?.resolvedRequested?.site ||
      entry.targetResolution?.served?.site,
  );
}

function isHitPayload(value: unknown): value is {
  target: string;
  requestedTarget?: string;
  freshTarget?: string;
  servedTarget?: string;
  freshness?: string;
} {
  return Boolean(value && typeof value === "object" && "target" in value);
}
