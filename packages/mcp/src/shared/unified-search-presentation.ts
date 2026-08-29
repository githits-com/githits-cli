import { isKnownRegistry, parsePackageSpec } from "./package-spec.js";
import {
  formatRepositoryTarget,
  parseRepositoryTargetSpec,
} from "./repository-target.js";
import type {
  LeanDocCoverage,
  UnifiedSearchCompletedPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
  UnifiedSearchProgressPayload,
  UnifiedSearchQueryEcho,
  UnifiedSearchSourceStatusPayload,
  UnifiedSearchStatusCompletedPayload,
  UnifiedSearchStatusIncompletePayload,
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

export type UnifiedSearchSourceKind =
  | "code"
  | "symbols"
  | "docs"
  | "repository_docs"
  | "site_docs";
export type UnifiedSearchSourceReadiness =
  | "searched"
  | "waiting"
  | "available_not_searched"
  | "unavailable";

export type UnifiedSearchTargetFamily =
  | "package"
  | "repository"
  | "site"
  | "unknown";

export type UnifiedSearchTerminalReasonKind = "not_found" | "unresolvable";
export type UnifiedSearchTerminalSpecificity = "version" | "ref";

export interface UnifiedSearchTerminalReason {
  kind: UnifiedSearchTerminalReasonKind;
  family: UnifiedSearchTargetFamily;
  specificity?: UnifiedSearchTerminalSpecificity;
}

export type UnifiedSearchFreshnessKind =
  | "current"
  | "stale"
  | "indexing"
  | "pending"
  | "provisional";

export interface UnifiedSearchSourceEntry {
  state: UnifiedSearchSourceReadiness;
  target: string;
  searchTarget: string;
  targetAliases?: string[];
  requestedTarget?: string;
  freshTarget?: string;
  servedTarget?: string;
  resultCount?: number;
  repositoryUrl?: string;
  commitSha?: string;
  siteKey?: string;
  siteUrl?: string;
  terminalReason?: UnifiedSearchTerminalReason;
}

type SourceIdentity = Pick<
  UnifiedSearchSourceEntry,
  | "target"
  | "searchTarget"
  | "targetAliases"
  | "requestedTarget"
  | "freshTarget"
  | "servedTarget"
  | "repositoryUrl"
  | "commitSha"
  | "siteKey"
  | "siteUrl"
>;

type Coverage = Omit<LeanDocCoverage, "frontierRemaining"> & {
  frontierRemaining?: number | null;
};

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

export interface UnifiedSearchSiteSuggestionFacts {
  target: string;
  suggestions: string[];
  truncated: boolean;
}

export interface UnifiedSearchTargetGroup {
  identity: UnifiedSearchTargetPresentation;
  freshnessKind?: UnifiedSearchFreshnessKind;
  sources: UnifiedSearchSourceGroup[];
  alternatives?: UnifiedSearchAlternativeFacts;
  siteSuggestions: UnifiedSearchSiteSuggestionFacts[];
  trustLimits: UnifiedSearchTrustLimit[];
  recovery?: UnifiedSearchTargetRecovery;
}

export type UnifiedSearchTargetRecovery =
  | {
      kind: "try";
      category: "version" | "ref" | "site";
      target: string;
      additionalTargets: string[];
      truncated: boolean;
    }
  | { kind: "fix"; family: UnifiedSearchTargetFamily };

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
  | { kind: "provisional"; target?: string; requestedTarget?: string }
  | {
      kind: "source";
      source: UnifiedSearchSourceKind;
      state: Exclude<UnifiedSearchSourceReadiness, "searched">;
      target?: string;
      requestedTarget?: string;
    }
  | {
      kind: "coverage";
      source: UnifiedSearchSourceKind;
      state: "partial" | "capped";
      target?: string;
      requestedTarget?: string;
      pagesCrawled?: number;
      frontierRemaining?: number;
      estimatedTotalPages?: number;
    }
  | {
      kind: "constraint";
      constraint: UnifiedSearchConstraintKind;
      source?: string;
      target?: string;
      values: string[];
    }
  | { kind: "mutable_evidence" };

export type UnifiedSearchWarning =
  | { kind: "query"; message: string }
  | {
      kind: UnifiedSearchConstraintKind;
      source?: string;
      target?: string;
      values: string[];
    };

export type UnifiedSearchAction =
  | { kind: "poll"; searchRef: string }
  | { kind: "status"; searchRef: string }
  | { kind: "new_search" }
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
  query?: UnifiedSearchQueryEcho;
  progress?: UnifiedSearchProgressPresentation;
  targetGroups: UnifiedSearchTargetGroup[];
  hasMore: boolean;
  warnings: UnifiedSearchWarning[];
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

interface CandidateSet {
  target?: string;
  requestedTarget?: string;
  aliases: string[];
  versions: UnifiedSearchAlternative[];
  refs: UnifiedSearchAlternative[];
  suggestedRefs: UnifiedSearchAlternative[];
}

const MAX_ALTERNATIVES = 3;

export function projectUnifiedSearchPresentation(
  payload: UnifiedSearchPresentationInput,
): UnifiedSearchPresentation {
  const snapshot = extractSnapshot(payload);
  const progress = "progress" in payload ? payload.progress : undefined;
  const lifecycle = projectLifecycle(payload, progress);
  const availability = projectAvailability(snapshot, lifecycle);
  const sourceStatus = snapshot?.sourceStatus;
  const sources = projectSources(sourceStatus);
  const siteSuggestions = projectSiteSuggestions(sourceStatus);
  const trustLimits = projectTrustLimits(snapshot, sources, sourceStatus);
  const query =
    snapshot?.query ?? ("query" in payload ? payload.query : undefined);
  const alternatives = projectAlternatives(progress, sourceStatus);
  const searchRef = "searchRef" in payload ? payload.searchRef : undefined;
  const targets = projectTargets(progress);
  const targetGroups = projectTargetGroups({
    targets,
    sources,
    alternatives,
    siteSuggestions,
    trustLimits,
    lifecycle,
    availability,
    snapshot,
  });
  const warnings = projectWarnings(query, sourceStatus, targetGroups);

  return {
    availability,
    lifecycle,
    query,
    progress: projectProgress(progress),
    targetGroups,
    hasMore: snapshot?.hasMore ?? false,
    warnings,
    action: projectAction({
      searchRef,
      snapshot,
      lifecycle,
      availability,
      targetGroups,
    }),
  };
}

function extractSnapshot(
  payload: UnifiedSearchPresentationInput,
): SnapshotFacts | undefined {
  if ("result" in payload) return payload.result;
  if (!("partialResults" in payload) || payload.partialResults === undefined) {
    return undefined;
  }
  return {
    query: "query" in payload ? payload.query : undefined,
    partialResults: payload.partialResults,
    hasMore: payload.hasMore,
    results: payload.results,
    sourceStatus: payload.sourceStatus,
    evidenceNotice: payload.evidenceNotice,
  };
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

function projectAvailability(
  snapshot: SnapshotFacts | undefined,
  lifecycle: UnifiedSearchLifecycle,
): UnifiedSearchAvailability {
  if (!snapshot) {
    return { kind: "no_snapshot", hasSnapshot: false, resultCount: 0 };
  }
  const resultCount = snapshot.results.length;
  const kind =
    resultCount === 0
      ? "empty"
      : snapshot.partialResults
        ? "partial"
        : lifecycle.kind === "active"
          ? "interim"
          : "final";
  return { kind, hasSnapshot: true, resultCount };
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
    const terminalReason = sourceTerminalReason(entry);
    appendSourceEntry(groups, kind, {
      state: sourceState(entry),
      ...sourceIdentity(entry, kind),
      resultCount: entry.resultCount,
      ...(terminalReason ? { terminalReason } : {}),
    });
  }
  return groups;
}

function projectSiteSuggestions(
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): UnifiedSearchSiteSuggestionFacts[] {
  return (sourceStatus ?? [])
    .filter(
      (entry) =>
        Boolean(entry.suggestedSiteTargets?.length) ||
        entry.suggestedSiteTargetsTruncated === true,
    )
    .map((entry) => ({
      target: sourceTarget(entry),
      suggestions: [...(entry.suggestedSiteTargets ?? [])],
      truncated: entry.suggestedSiteTargetsTruncated === true,
    }));
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
  const source = entry.source.toLowerCase();
  if (source === "code") return "code";
  if (source === "symbol") return "symbols";
  if (isSiteTarget(entry.targetLabel, entry)) return "site_docs";
  return entry.targetResolution?.served?.repoUrl ? "repository_docs" : "docs";
}

function contributorIdentity(
  entry: UnifiedSearchSourceStatusPayload,
  contributor: NonNullable<
    UnifiedSearchSourceStatusPayload["contributors"]
  >[number],
): SourceIdentity {
  const searchTarget = sourceTarget(entry);
  const target =
    contributor.kind === "REPOSITORY_DOCS"
      ? (contributor.repositoryUrl ?? searchTarget)
      : (contributor.siteUrl ?? contributor.siteKey ?? searchTarget);
  return {
    target,
    searchTarget,
    ...sourceTargetAliases(entry),
    ...(contributor.repositoryUrl
      ? { repositoryUrl: contributor.repositoryUrl }
      : {}),
    ...(contributor.commitSha ? { commitSha: contributor.commitSha } : {}),
    ...(contributor.siteKey ? { siteKey: contributor.siteKey } : {}),
    ...(contributor.siteUrl ? { siteUrl: contributor.siteUrl } : {}),
  };
}

function sourceIdentity(
  entry: UnifiedSearchSourceStatusPayload,
  kind: UnifiedSearchSourceKind,
): SourceIdentity {
  const target = sourceTarget(entry);
  const served = entry.targetResolution?.served;
  const identity =
    kind === "repository_docs"
      ? {
          ...(served?.repoUrl ? { repositoryUrl: served.repoUrl } : {}),
          ...(served?.commitSha ? { commitSha: served.commitSha } : {}),
        }
      : kind === "site_docs" && served?.site
        ? { siteKey: served.site }
        : {};
  return {
    target,
    searchTarget: target,
    ...sourceTargetAliases(entry),
    ...identity,
  };
}

function sourceTargetAliases(
  entry: UnifiedSearchSourceStatusPayload,
): Pick<
  UnifiedSearchSourceEntry,
  "targetAliases" | "requestedTarget" | "freshTarget" | "servedTarget"
> {
  const aliases = uniqueAliases([
    entry.targetLabel,
    entry.requestedTarget,
    entry.freshTarget,
    entry.servedTarget,
  ]);
  return {
    ...(aliases.length > 1 ? { targetAliases: aliases } : {}),
    ...(entry.requestedTarget
      ? { requestedTarget: entry.requestedTarget }
      : {}),
    ...(entry.freshTarget ? { freshTarget: entry.freshTarget } : {}),
    ...(entry.servedTarget ? { servedTarget: entry.servedTarget } : {}),
  };
}

function sourceTarget(entry: UnifiedSearchSourceStatusPayload): string {
  return entry.servedTarget ?? entry.targetLabel;
}

function sourceState(
  entry: UnifiedSearchSourceStatusPayload,
): UnifiedSearchSourceReadiness {
  const states = [entry.indexingStatus, entry.codeIndexState].filter(
    (state): state is string => Boolean(state),
  );
  if (states.length === 0) return "searched";
  if (states.some((state) => ["INDEXING", "PENDING"].includes(state))) {
    return "waiting";
  }
  return states.every((state) =>
    ["CURRENT", "INDEXED", "PROVISIONAL", "STALE"].includes(state),
  )
    ? "searched"
    : "unavailable";
}

function sourceTerminalReason(
  entry: UnifiedSearchSourceStatusPayload,
): UnifiedSearchTerminalReason | undefined {
  const kind = [entry.indexingStatus, entry.codeIndexState].find(
    (state): state is UnifiedSearchTerminalReasonKind =>
      state === "NOT_FOUND" || state === "UNRESOLVABLE",
  );
  if (!kind) return undefined;
  const family = classifyTargetFamily(entry);
  const requestedTarget = entry.requestedTarget ?? entry.targetLabel;
  const specificity = terminalSpecificity(family, requestedTarget);
  return {
    kind: kind.toLowerCase() as UnifiedSearchTerminalReasonKind,
    family,
    ...(specificity ? { specificity } : {}),
  };
}

function terminalSpecificity(
  family: UnifiedSearchTargetFamily,
  target: string,
): UnifiedSearchTerminalSpecificity | undefined {
  try {
    if (family === "package" && parsePackageSpec(target).version) {
      return "version";
    }
    if (family === "repository" && parseRepositoryTargetSpec(target).gitRef) {
      return "ref";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function contributorState(
  state: "SEARCHED" | "READY" | "PENDING" | "UNAVAILABLE",
): UnifiedSearchSourceReadiness {
  const readiness = {
    SEARCHED: "searched",
    READY: "available_not_searched",
    PENDING: "waiting",
    UNAVAILABLE: "unavailable",
  } satisfies Record<typeof state, UnifiedSearchSourceReadiness>;
  return readiness[state];
}

function projectTrustLimits(
  snapshot: SnapshotFacts | undefined,
  sources: UnifiedSearchSourceGroup[],
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): UnifiedSearchTrustLimit[] {
  const limits = new Map<string, UnifiedSearchTrustLimit>();
  const add = (limit: UnifiedSearchTrustLimit): void => {
    const key =
      limit.kind === "stale"
        ? `stale:${limit.requestedTarget ?? ""}:${limit.servedTarget ?? limit.target ?? ""}`
        : JSON.stringify(limit);
    const existing = limits.get(key);
    if (
      existing === undefined ||
      (limit.kind === "stale" &&
        existing.kind === "stale" &&
        staleSpecificity(limit) > staleSpecificity(existing))
    ) {
      limits.set(key, limit);
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
          ...(entry.requestedTarget
            ? { requestedTarget: entry.requestedTarget }
            : {}),
        });
      }
    }
  }

  for (const hit of snapshot?.results ?? []) {
    if (hit.freshness === "STALE" || hit.freshness === "INDEXING") {
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
      add({
        kind: "provisional",
        target,
        ...(entry.requestedTarget
          ? { requestedTarget: entry.requestedTarget }
          : {}),
      });
    }
    const kind = sourceKind(entry);
    addCoverage(add, kind, target, entry.requestedTarget, entry.coverage);
    for (const contributor of entry.contributors ?? []) {
      const contributorTargetValue = contributorIdentity(entry, contributor);
      if (contributor.freshness === "STALE") {
        add({
          kind: "stale",
          target: contributorTargetValue.target,
          ...(entry.requestedTarget
            ? { requestedTarget: entry.requestedTarget }
            : {}),
        });
      }
      addCoverage(
        add,
        contributor.kind === "DOCPACK" ? "site_docs" : "repository_docs",
        contributorTargetValue.target,
        entry.requestedTarget,
        contributor.coverage,
      );
    }
    addConstraints(add, entry);
  }

  if (snapshot?.evidenceNotice !== undefined) {
    add({ kind: "mutable_evidence" });
  }
  return [...limits.values()];
}

function staleSpecificity(
  limit: Extract<UnifiedSearchTrustLimit, { kind: "stale" }>,
): number {
  return [limit.requestedTarget, limit.freshTarget, limit.servedTarget].filter(
    Boolean,
  ).length;
}

function addCoverage(
  add: (limit: UnifiedSearchTrustLimit) => void,
  source: UnifiedSearchSourceKind,
  target: string,
  requestedTarget: string | undefined,
  coverage: Coverage | undefined,
): void {
  if (!coverage || !["PARTIAL", "CAPPED"].includes(coverage.coverageState)) {
    return;
  }
  add({
    kind: "coverage",
    source,
    state: coverage.coverageState.toLowerCase() as "partial" | "capped",
    target,
    ...(requestedTarget ? { requestedTarget } : {}),
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
  for (const [constraint, values] of sourceConstraints(entry)) {
    if (values?.length)
      add({
        kind: "constraint",
        constraint,
        source: normalizeSourceLane(entry.source),
        target: target || undefined,
        values,
      });
  }
}

function sourceConstraints(
  entry: UnifiedSearchSourceStatusPayload,
): Array<[UnifiedSearchConstraintKind, string[] | undefined]> {
  return [
    ["ignored_filter", entry.ignoredFilters],
    ["incompatible_filter", entry.incompatibleFilters],
    ["ignored_query_feature", entry.ignoredQueryFeatures],
    ["incompatible_query_feature", entry.incompatibleQueryFeatures],
  ];
}

function projectWarnings(
  query: UnifiedSearchQueryEcho | undefined,
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
  targetGroups: UnifiedSearchTargetGroup[],
): UnifiedSearchWarning[] {
  const warnings: UnifiedSearchWarning[] = [];
  for (const message of query?.warnings ?? []) {
    warnings.push({ kind: "query", message });
  }
  for (const entry of sourceStatus ?? []) {
    const source = normalizeSourceLane(entry.source);
    const target = entry.targetLabel || undefined;
    const aliases = uniqueAliases([
      entry.targetLabel,
      entry.requestedTarget,
      entry.freshTarget,
      entry.servedTarget,
    ]);
    const hasTargetOwner =
      findMatchingTargetGroup(targetGroups, aliases, entry.requestedTarget) !==
        undefined ||
      (targetGroups.length === 1 && target === undefined);
    for (const [kind, values] of sourceConstraints(entry)) {
      if (values?.length && !hasTargetOwner) {
        warnings.push({ kind, source, target, values });
      }
    }
  }
  return warnings;
}

function normalizeSourceLane(source: string | undefined): string | undefined {
  const normalized = source?.trim().toLowerCase();
  return normalized || undefined;
}

function projectAlternatives(
  progress: UnifiedSearchProgressPayload | undefined,
  sourceStatus: UnifiedSearchSourceStatusPayload[] | undefined,
): UnifiedSearchAlternativeFacts[] {
  const candidates: CandidateSet[] = [
    ...(progress?.targets ?? []).map((target) => ({
      target: target.requested ?? target.resolvedRequested ?? target.served,
      requestedTarget: target.requested,
      aliases: uniqueAliases([
        target.requested,
        target.resolvedRequested,
        target.served,
      ]),
      versions:
        target.targetResolution?.availableVersions ??
        target.availableVersions ??
        [],
      refs:
        target.targetResolution?.availableRefs ?? target.availableRefs ?? [],
      suggestedRefs:
        target.targetResolution?.suggestedRefs ?? target.suggestedRefs ?? [],
    })),
    ...(sourceStatus ?? []).flatMap((entry) => {
      const resolution = entry.targetResolution;
      return resolution
        ? [
            {
              target: entry.requestedTarget ?? sourceTarget(entry),
              requestedTarget: entry.requestedTarget,
              aliases: uniqueAliases([
                sourceTarget(entry),
                entry.targetLabel,
                entry.requestedTarget,
                entry.freshTarget,
                entry.servedTarget,
              ]),
              versions: resolution.availableVersions,
              refs: resolution.availableRefs,
              suggestedRefs: resolution.suggestedRefs ?? [],
            },
          ]
        : [];
    }),
  ];
  return mergeAlternativeCandidates(candidates)
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

interface TargetGroupInput {
  targets: UnifiedSearchTargetPresentation[];
  sources: UnifiedSearchSourceGroup[];
  alternatives: UnifiedSearchAlternativeFacts[];
  siteSuggestions: UnifiedSearchSiteSuggestionFacts[];
  trustLimits: UnifiedSearchTrustLimit[];
  lifecycle: UnifiedSearchLifecycle;
  availability: UnifiedSearchAvailability;
  snapshot: SnapshotFacts | undefined;
}

function projectTargetGroups(
  input: TargetGroupInput,
): UnifiedSearchTargetGroup[] {
  const groups: UnifiedSearchTargetGroup[] = [];
  for (const identity of input.targets) {
    const existing = groups.find((group) =>
      targetIdentitiesMatch(group.identity, identity),
    );
    if (existing) {
      existing.identity.requested ??= identity.requested;
      existing.identity.fresh ??= identity.fresh;
      existing.identity.served ??= identity.served;
      existing.identity.freshness ??= identity.freshness;
      existing.freshnessKind ??= classifyTargetFreshness(identity.freshness);
      continue;
    }
    groups.push({
      identity: { ...identity },
      freshnessKind: classifyTargetFreshness(identity.freshness),
      sources: [],
      siteSuggestions: [],
      trustLimits: [],
    });
  }

  const findOrCreate = (
    target: string | undefined,
  ): UnifiedSearchTargetGroup => {
    return findOrCreateForAliases(target ? [target] : [], target);
  };

  const findOrCreateForAliases = (
    aliases: string[],
    target: string | undefined,
    requestedTarget?: string,
  ): UnifiedSearchTargetGroup => {
    const existing = findMatchingTargetGroup(groups, aliases, requestedTarget);
    if (existing) return existing;
    const created: UnifiedSearchTargetGroup = {
      identity:
        requestedTarget || target
          ? { requested: requestedTarget ?? target }
          : {},
      sources: [],
      siteSuggestions: [],
      trustLimits: [],
    };
    groups.push(created);
    return created;
  };

  for (const limit of input.trustLimits) {
    if (
      limit.kind !== "stale" ||
      (!limit.requestedTarget && !limit.freshTarget && !limit.servedTarget)
    ) {
      continue;
    }
    const aliases = uniqueAliases([
      limit.requestedTarget,
      limit.freshTarget,
      limit.servedTarget,
      limit.target,
    ]);
    const group =
      findMatchingTargetGroup(groups, aliases, limit.requestedTarget) ??
      findOrCreateForAliases(aliases, aliases[0], limit.requestedTarget);
    if (limit.requestedTarget) group.identity.requested = limit.requestedTarget;
    if (limit.freshTarget) group.identity.fresh = limit.freshTarget;
    if (limit.servedTarget) group.identity.served = limit.servedTarget;
  }

  for (const sourceGroup of input.sources) {
    for (const entry of sourceGroup.entries) {
      const aliases = entry.targetAliases ?? [entry.searchTarget];
      const group =
        findMatchingTargetGroup(groups, aliases, entry.requestedTarget) ??
        findOrCreateForAliases(
          aliases,
          entry.searchTarget,
          entry.requestedTarget,
        );
      if (entry.requestedTarget) {
        group.identity.requested ??= entry.requestedTarget;
      }
      if (entry.freshTarget) group.identity.fresh ??= entry.freshTarget;
      if (entry.servedTarget) group.identity.served ??= entry.servedTarget;
      const existingSource = group.sources.find(
        (candidate) => candidate.kind === sourceGroup.kind,
      );
      if (existingSource) existingSource.entries.push(entry);
      else group.sources.push({ kind: sourceGroup.kind, entries: [entry] });
    }
  }

  for (const alternatives of input.alternatives) {
    const aliases = uniqueAliases([alternatives.target]);
    const group =
      findMatchingTargetGroup(groups, aliases, alternatives.target) ??
      findOrCreateForAliases(aliases, alternatives.target);
    group.alternatives = alternatives;
  }
  for (const suggestion of input.siteSuggestions) {
    findOrCreate(suggestion.target).siteSuggestions.push(suggestion);
  }
  for (const limit of input.trustLimits) {
    if (limit.kind === "mutable_evidence") {
      continue;
    }
    const target = "target" in limit ? limit.target : undefined;
    const requestedTarget =
      "requestedTarget" in limit ? limit.requestedTarget : undefined;
    const aliases =
      limit.kind === "stale"
        ? uniqueAliases([
            limit.requestedTarget,
            limit.freshTarget,
            limit.servedTarget,
            limit.target,
          ])
        : uniqueAliases([requestedTarget, target]);
    const sourceGroup = findMatchingTargetGroup(
      groups,
      aliases,
      requestedTarget,
    );
    const group =
      sourceGroup ??
      (groups.length === 1 ? groups[0] : undefined) ??
      findOrCreateForAliases(aliases, target, requestedTarget);
    if (limit.kind === "stale") {
      if (limit.requestedTarget)
        group.identity.requested = limit.requestedTarget;
      if (limit.freshTarget) group.identity.fresh = limit.freshTarget;
      if (limit.servedTarget) group.identity.served = limit.servedTarget;
    }
    group.trustLimits.push(limit);
  }
  for (const group of groups) {
    const recovery = projectTargetRecovery(
      group,
      input.lifecycle,
      input.availability,
      input.snapshot,
    );
    if (recovery) group.recovery = recovery;
  }
  return groups.filter(
    (group) =>
      targetIdentityValues(group.identity).length > 0 ||
      group.sources.length > 0 ||
      group.alternatives !== undefined ||
      group.siteSuggestions.length > 0 ||
      group.trustLimits.length > 0 ||
      group.recovery !== undefined,
  );
}

function targetIdentityValues(
  identity: UnifiedSearchTargetPresentation,
): string[] {
  return [identity.requested, identity.fresh, identity.served].filter(
    (value): value is string => Boolean(value),
  );
}

function targetGroupMatchesAliases(
  group: UnifiedSearchTargetGroup,
  aliases: string[],
): boolean {
  return (
    targetIdentityValues(group.identity).some((value) =>
      aliases.includes(value),
    ) ||
    group.sources.some((source) =>
      source.entries.some((entry) =>
        [...(entry.targetAliases ?? []), entry.target, entry.searchTarget].some(
          (value) => value !== undefined && aliases.includes(value),
        ),
      ),
    )
  );
}

function findMatchingTargetGroup(
  groups: UnifiedSearchTargetGroup[],
  aliases: string[],
  requestedTarget?: string,
): UnifiedSearchTargetGroup | undefined {
  if (requestedTarget) {
    const requestedMatch = groups.find(
      (group) => group.identity.requested === requestedTarget,
    );
    if (requestedMatch) return requestedMatch;
  }
  const directRequestedMatches = groups.filter(
    (group) =>
      group.identity.requested !== undefined &&
      aliases.includes(group.identity.requested),
  );
  if (directRequestedMatches.length === 1) return directRequestedMatches[0];
  const matches = groups.filter((group) =>
    targetGroupMatchesAliases(group, aliases),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function targetIdentitiesMatch(
  left: UnifiedSearchTargetPresentation,
  right: UnifiedSearchTargetPresentation,
): boolean {
  if (
    left.requested !== undefined &&
    right.requested !== undefined &&
    left.requested !== right.requested
  ) {
    return false;
  }
  return targetIdentityValues(left).some((target) =>
    targetIdentityValues(right).includes(target),
  );
}

function uniqueAliases(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export function targetDisplayFamilyKey(target: string | undefined): string {
  if (!target) return "";
  const normalized = target
    .trim()
    .replace(/\s+latest$/, "")
    .replace(/#[^#]+$/, "");
  return normalized.startsWith("npm:")
    ? normalized.replace(/@[^/@]+$/, "")
    : normalized.replace(/@[^#]+$/, "");
}

export function classifyTargetFreshness(
  freshness: string | undefined,
): UnifiedSearchFreshnessKind | undefined {
  switch (freshness?.toLowerCase()) {
    case "current":
    case "indexed":
      return "current";
    case "stale":
    case "fallback_recent":
      return "stale";
    case "indexing":
      return "indexing";
    case "pending":
      return "pending";
    case "provisional":
      return "provisional";
    default:
      return undefined;
  }
}

function mergeAlternativeCandidates(
  candidates: CandidateSet[],
): CandidateSet[] {
  const merged: CandidateSet[] = [];
  for (const candidate of candidates) {
    const existing = merged.find(
      (value) =>
        !(
          candidate.requestedTarget &&
          value.requestedTarget &&
          candidate.requestedTarget !== value.requestedTarget
        ) && candidate.aliases.some((alias) => value.aliases.includes(alias)),
    );
    if (existing) {
      existing.aliases = uniqueAliases([
        ...existing.aliases,
        ...candidate.aliases,
      ]);
      existing.versions.push(...candidate.versions);
      existing.refs.push(...candidate.refs);
      existing.suggestedRefs.push(...candidate.suggestedRefs);
      existing.requestedTarget ??= candidate.requestedTarget;
    } else {
      merged.push({
        target: candidate.target,
        requestedTarget: candidate.requestedTarget,
        aliases: [...candidate.aliases],
        versions: [...candidate.versions],
        refs: [...candidate.refs],
        suggestedRefs: [...candidate.suggestedRefs],
      });
    }
  }
  return merged;
}

function boundedAlternatives(
  versions: UnifiedSearchAlternative[],
  refs: UnifiedSearchAlternative[],
  suggestedRefs: UnifiedSearchAlternative[],
): Omit<UnifiedSearchAlternativeFacts, "target"> {
  const bounded = (
    values: UnifiedSearchAlternative[],
  ): {
    values: UnifiedSearchAlternative[];
    remaining: number;
  } => {
    const seen = new Set<string>();
    const display: UnifiedSearchAlternative[] = [];
    let remaining = 0;
    for (const value of values) {
      const key = `${value.version ?? ""}\u0000${value.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (display.length < MAX_ALTERNATIVES) display.push(value);
      else remaining++;
    }
    return { values: display, remaining };
  };
  const versionFacts = bounded(
    versions.filter((alternative) => alternative.version !== undefined),
  );
  const refFacts = bounded([
    ...refs,
    ...versions.filter((alternative) => alternative.version === undefined),
  ]);
  const suggestedRefFacts = bounded(suggestedRefs);
  return {
    versions: versionFacts.values,
    versionsRemaining: versionFacts.remaining,
    refs: refFacts.values,
    refsRemaining: refFacts.remaining,
    suggestedRefs: suggestedRefFacts.values,
    suggestedRefsRemaining: suggestedRefFacts.remaining,
  };
}

interface ActionInput {
  searchRef?: string;
  snapshot: SnapshotFacts | undefined;
  lifecycle: UnifiedSearchLifecycle;
  availability: UnifiedSearchAvailability;
  targetGroups: UnifiedSearchTargetGroup[];
}

function projectAction(input: ActionInput): UnifiedSearchAction {
  if (input.lifecycle.kind === "active") {
    return input.searchRef
      ? { kind: "poll", searchRef: input.searchRef }
      : { kind: "none" };
  }
  if (
    input.lifecycle.kind === "completed" &&
    input.snapshot?.evidenceNotice !== undefined &&
    input.searchRef
  ) {
    return { kind: "status", searchRef: input.searchRef };
  }

  const hasLocalRecovery = input.targetGroups.some(
    (group) => group.recovery !== undefined,
  );
  const hasBareTerminalReason = input.targetGroups.some(
    hasBareTerminalReasonForGroup,
  );
  if (
    (input.lifecycle.kind === "terminal" ||
      input.lifecycle.kind === "unknown") &&
    (hasLocalRecovery || hasBareTerminalReason)
  ) {
    return { kind: "none" };
  }
  if (
    input.lifecycle.kind === "terminal" ||
    input.lifecycle.kind === "unknown"
  ) {
    return { kind: "new_search" };
  }
  if (!input.snapshot || input.availability.kind !== "empty") {
    return { kind: "none" };
  }

  if (hasLocalRecovery) return { kind: "none" };
  if (hasBareTerminalReason) {
    return projectQueryRewrite(input.snapshot.query);
  }
  const hasIndexing = input.targetGroups.some((group) =>
    groupHasIndexing(group),
  );
  if (hasIndexing) return { kind: "new_search" };
  if (
    input.targetGroups.some((group) =>
      group.trustLimits.some(
        (limit) =>
          limit.kind === "source" ||
          limit.kind === "coverage" ||
          limit.kind === "mutable_evidence" ||
          limit.kind === "stale",
      ),
    )
  ) {
    return { kind: "new_search" };
  }

  if (
    input.snapshot.sourceStatus?.length &&
    input.snapshot.sourceStatus.every((entry) =>
      isSiteTarget(entry.targetLabel, entry),
    )
  ) {
    return {
      kind: "query_rewrite",
      rewrites: ["site_shorter_or_broader"],
    };
  }
  return projectQueryRewrite(input.snapshot.query);
}

function projectQueryRewrite(
  query: UnifiedSearchQueryEcho | undefined,
): Extract<UnifiedSearchAction, { kind: "query_rewrite" }> {
  const rewrites: UnifiedSearchRewriteKind[] = ["shorter_or_broader"];
  if (hasRestrictiveFilters(query)) rewrites.push("remove_filters");
  const symbolSource = query?.sources?.some(
    (source) => source.toLowerCase() === "symbol",
  );
  if (!symbolSource) rewrites.push("symbol");
  rewrites.push("code_grep");
  return { kind: "query_rewrite", rewrites };
}

function projectTargetRecovery(
  group: UnifiedSearchTargetGroup,
  lifecycle: UnifiedSearchLifecycle,
  availability: UnifiedSearchAvailability,
  snapshot: SnapshotFacts | undefined,
): UnifiedSearchTargetRecovery | undefined {
  const hasTerminalReason = groupHasTerminalReason(group);
  const hasBareTerminalReason = hasBareTerminalReasonForGroup(group);
  const alternative = projectAlternativeRecovery(group);
  const site = projectSiteRecovery(group);
  const candidate = site ?? alternative;

  if (lifecycle.kind === "active") {
    return hasTerminalReason && !hasBareTerminalReason
      ? (candidate ?? fixRecovery(group))
      : undefined;
  }
  if (lifecycle.kind === "terminal" || lifecycle.kind === "unknown") {
    if (candidate) return candidate;
    return hasTerminalReason && !hasBareTerminalReason
      ? fixRecovery(group)
      : undefined;
  }
  if (availability.kind !== "empty" || !snapshot) return undefined;

  if (hasTerminalReason) {
    if (hasBareTerminalReason) return undefined;
    return candidate ?? fixRecovery(group);
  }
  if (site) return site;
  return groupHasIndexing(group) ? alternative : undefined;
}

function projectAlternativeRecovery(
  group: UnifiedSearchTargetGroup,
): UnifiedSearchTargetRecovery | undefined {
  const alternatives = group.alternatives;
  if (!alternatives) return undefined;
  const identity = primaryTargetIdentity(group);
  if (!identity) return undefined;
  const family = groupTerminalFamily(group) ?? familyForTarget(identity);
  if (family === "package") {
    const versions = alternatives.versions
      .map((alternative) => composePackageTarget(identity, alternative.version))
      .filter((target): target is string => target !== undefined);
    const target = versions[0];
    if (!target) return undefined;
    return {
      kind: "try",
      category: "version",
      target,
      additionalTargets: versions.slice(1),
      truncated: alternatives.versionsRemaining > 0,
    };
  }
  if (family === "repository") {
    const refs = [...alternatives.refs, ...alternatives.suggestedRefs]
      .map((alternative) => composeRepositoryTarget(identity, alternative.ref))
      .filter((target): target is string => target !== undefined);
    const unique = [...new Set(refs)];
    const target = unique[0];
    if (!target) return undefined;
    return {
      kind: "try",
      category: "ref",
      target,
      additionalTargets: unique.slice(1),
      truncated:
        alternatives.refsRemaining > 0 ||
        alternatives.suggestedRefsRemaining > 0,
    };
  }
  return undefined;
}

function projectSiteRecovery(
  group: UnifiedSearchTargetGroup,
): UnifiedSearchTargetRecovery | undefined {
  const suggestions = [
    ...new Set(
      group.siteSuggestions.flatMap((suggestion) => suggestion.suggestions),
    ),
  ];
  const target = suggestions[0];
  if (!target) return undefined;
  return {
    kind: "try",
    category: "site",
    target,
    additionalTargets: suggestions.slice(1),
    truncated: group.siteSuggestions.some((suggestion) => suggestion.truncated),
  };
}

function fixRecovery(
  group: UnifiedSearchTargetGroup,
): UnifiedSearchTargetRecovery {
  return {
    kind: "fix",
    family:
      groupTerminalFamily(group) ??
      familyForTarget(primaryTargetIdentity(group)),
  };
}

function primaryTargetIdentity(
  group: UnifiedSearchTargetGroup,
): string | undefined {
  return (
    group.identity.requested ??
    group.identity.fresh ??
    group.identity.served ??
    group.alternatives?.target
  );
}

function groupTerminalReason(
  group: UnifiedSearchTargetGroup,
): UnifiedSearchTerminalReason | undefined {
  for (const source of group.sources) {
    for (const entry of source.entries) {
      if (entry.terminalReason) return entry.terminalReason;
    }
  }
  return undefined;
}

function groupTerminalFamily(
  group: UnifiedSearchTargetGroup,
): UnifiedSearchTargetFamily | undefined {
  return groupTerminalReason(group)?.family;
}

function groupHasTerminalReason(group: UnifiedSearchTargetGroup): boolean {
  return groupTerminalReason(group) !== undefined;
}

function groupHasIndexing(group: UnifiedSearchTargetGroup): boolean {
  return (
    group.freshnessKind === "indexing" ||
    group.freshnessKind === "pending" ||
    group.sources.some((source) =>
      source.entries.some((entry) => entry.state === "waiting"),
    )
  );
}

function hasBareTerminalReasonForGroup(
  group: UnifiedSearchTargetGroup,
): boolean {
  return (
    groupHasTerminalReason(group) &&
    group.sources.some((source) =>
      source.entries.some(
        (entry) => entry.state === "searched" || entry.state === "waiting",
      ),
    )
  );
}

function familyForTarget(
  target: string | undefined,
): UnifiedSearchTargetFamily {
  if (!target) return "unknown";
  if (isSiteTarget(target, { targetLabel: target, source: "docs" })) {
    return "site";
  }
  const packageSeparator = target.indexOf(":");
  if (
    packageSeparator > 0 &&
    isKnownRegistry(target.slice(0, packageSeparator))
  ) {
    return "package";
  }
  if (target.startsWith("github:")) return "repository";
  try {
    parseRepositoryTargetSpec(target);
    return "repository";
  } catch {
    return "unknown";
  }
}

function composePackageTarget(
  identity: string,
  version: string | undefined,
): string | undefined {
  if (!version) return undefined;
  try {
    const parsed = parsePackageSpec(identity);
    return `${parsed.registry}:${parsed.name}@${version}`;
  } catch {
    return undefined;
  }
}

function composeRepositoryTarget(
  identity: string,
  ref: string,
): string | undefined {
  try {
    const parsed = parseRepositoryTargetSpec(identity);
    if (!parsed.repoUrl) return undefined;
    return formatRepositoryTarget(parsed.repoUrl, ref);
  } catch {
    return undefined;
  }
}

function classifyTargetFamily(
  entry: UnifiedSearchSourceStatusPayload,
): UnifiedSearchTargetFamily {
  if (isSiteTarget(entry.targetLabel, entry)) return "site";
  const target = entry.targetLabel.trim().toLowerCase();
  const separator = target.indexOf(":");
  if (separator > 0 && isKnownRegistry(target.slice(0, separator))) {
    return "package";
  }
  if (
    target.startsWith("github:") ||
    entry.targetResolution?.requested?.repoUrl ||
    entry.targetResolution?.resolvedRequested?.repoUrl ||
    entry.targetResolution?.served?.repoUrl
  ) {
    return "repository";
  }
  return "unknown";
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
