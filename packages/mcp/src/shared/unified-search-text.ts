/**
 * Line-oriented text renderer for unified `search` MCP responses.
 *
 * Designed for agent context efficiency: roughly 3-5 lines per hit
 * and no JSON scaffolding. This is the tool's default response
 * format — programmatic / parity callers opt into the structured
 * JSON envelope by passing `format: "json"`.
 *
 * Compact punctuation and line-oriented output keep the response easy to scan
 * across terminal and agent clients.
 *
 * `text-v1` names the compact representation, not an exact-prose compatibility
 * boundary. Its lifecycle, ordering, action, and hit-anatomy invariants are
 * covered by structural tests in `unified-search-text.test.ts`; JSON remains
 * the stable structured boundary for programmatic callers.
 */

import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { colors, dim, highlight, highlightRanges } from "./colors.js";
import { formatRepositoryTarget } from "./repository-target.js";
import {
  projectUnifiedSearchPresentation,
  targetDisplayFamilyKey,
  type UnifiedSearchAction,
  type UnifiedSearchLifecycle,
  type UnifiedSearchPresentation,
  type UnifiedSearchSourceEntry,
  type UnifiedSearchSourceGroup,
  type UnifiedSearchSourceKind,
  type UnifiedSearchTargetGroup,
  type UnifiedSearchTargetRecovery,
  type UnifiedSearchTerminalReason,
  type UnifiedSearchTrustLimit,
  type UnifiedSearchWarning,
} from "./unified-search-presentation.js";
import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchErrorPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
} from "./unified-search-response.js";

const DEFAULT_TEXT_WIDTH = 80;
const SEP = " | ";

type SearchSuccessPayload =
  | UnifiedSearchCompletedPayload
  | UnifiedSearchIncompletePayload;

/** Render a successful unified-search payload as line-oriented text. */
export function renderUnifiedSearchSuccess(
  payload: SearchSuccessPayload,
  options: UnifiedSearchTextOptions = {},
): string {
  return renderUnifiedSearchPresentationText(
    projectUnifiedSearchPresentation(payload),
    payload,
    options,
  );
}

export interface UnifiedSearchTextOptions {
  /** Apply terminal emphasis; false keeps the MCP/CLI wording plain. */
  useColors?: boolean;
  /** Surface-native syntax for the continuation action. */
  actionSyntax?: "mcp" | "cli";
  /** Full output width, including indentation. Defaults to 80 columns. */
  width?: number;
}

export interface UnifiedSearchTextResult {
  results: UnifiedSearchHitPayload[];
  nextOffset?: number;
}

/** Render the shared semantic projection while callers supply only result anatomy. */
export function renderUnifiedSearchPresentationText(
  presentation: UnifiedSearchPresentation,
  result: UnifiedSearchTextResult,
  options: UnifiedSearchTextOptions = {},
): string {
  const settings = normalizeTextOptions(options);
  const lines: string[] = [
    formatPresentationOutcome(
      presentation,
      result.results,
      result.nextOffset,
      settings,
    ),
  ];
  appendPresentationContext(lines, presentation, settings);

  if (result.results.length > 0) {
    lines.push("");
    appendUnifiedSearchHits(lines, result.results, settings);
  }

  appendPresentationAction(lines, presentation, settings);
  return lines.join("\n");
}

interface NormalizedTextOptions {
  useColors: boolean;
  actionSyntax: "mcp" | "cli";
  width: number;
}

function normalizeTextOptions(
  options: UnifiedSearchTextOptions,
): NormalizedTextOptions {
  return {
    useColors: options.useColors ?? false,
    actionSyntax: options.actionSyntax ?? "mcp",
    width:
      typeof options.width === "number" && Number.isFinite(options.width)
        ? Math.max(20, Math.floor(options.width))
        : DEFAULT_TEXT_WIDTH,
  };
}

function formatPresentationOutcome(
  presentation: UnifiedSearchPresentation,
  results: UnifiedSearchHitPayload[],
  nextOffset: number | undefined,
  options: NormalizedTextOptions,
): string {
  const count = presentation.availability.resultCount;
  const countLabel = `${count} result${count === 1 ? "" : "s"}`;
  const finish = (value: string): string =>
    styleOutcome(
      appendPagination(value, presentation.hasMore, nextOffset),
      presentation,
      options.useColors,
    );

  if (presentation.lifecycle.kind === "active") {
    const label = activeLifecycleLabel(presentation.lifecycle);
    const readiness = presentation.progress
      ? `${presentation.progress.targetsReady}/${presentation.progress.targetsTotal} ready`
      : undefined;
    if (presentation.availability.kind === "no_snapshot") {
      return finish(
        ["No result snapshot yet", label, readiness].filter(Boolean).join(SEP),
      );
    }
    if (presentation.availability.kind === "empty") {
      return finish(
        ["No results yet", label, readiness].filter(Boolean).join(SEP),
      );
    }
    const resultKind =
      presentation.availability.kind === "partial" ? "partial" : "interim";
    return finish(
      [
        countLabel.replace("result", `${resultKind} result`),
        formatResultBreakdown(results),
        label,
        readiness,
      ]
        .filter(Boolean)
        .join(SEP),
    );
  }

  if (presentation.lifecycle.kind === "completed") {
    return finish(
      count > 0
        ? formatCompletedResultsHeadline(results, countLabel)
        : "No results",
    );
  }

  const status = formatLifecycleSummary(presentation.lifecycle);
  const readiness = presentation.progress
    ? `${presentation.progress.targetsReady}/${presentation.progress.targetsTotal} ready`
    : undefined;
  if (count > 0) {
    return finish(
      [countLabel, formatResultBreakdown(results), status, readiness]
        .filter(Boolean)
        .join(SEP),
    );
  }
  if (presentation.availability.kind === "no_snapshot") {
    return finish(
      ["No result snapshot", status, readiness].filter(Boolean).join(SEP),
    );
  }
  return finish(["No results", status, readiness].filter(Boolean).join(SEP));
}

function formatCompletedResultsHeadline(
  results: UnifiedSearchHitPayload[],
  countLabel: string,
): string {
  const parts = [countLabel];
  const breakdown = formatResultBreakdown(results);
  if (breakdown) parts.push(breakdown);
  return parts.join(SEP);
}

function appendPagination(
  value: string,
  hasMore: boolean,
  nextOffset: number | undefined,
): string {
  if (!hasMore) return value;
  const field =
    typeof nextOffset === "number"
      ? `next_offset=${nextOffset}`
      : "more available";
  return `${value}${SEP}${field}`;
}

function formatResultBreakdown(results: UnifiedSearchHitPayload[]): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    const label = resultBreakdownLabel(result.type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => `${count} ${resultCountLabel(label, count)}`)
    .join(", ");
}

function resultCountLabel(label: string, count: number): string {
  if (count !== 1) return label;
  if (label === "repo docs") return "repo doc";
  if (label === "docs pages") return "docs page";
  if (label === "repo code hits") return "repo code hit";
  if (label === "repo symbols") return "repo symbol";
  return label;
}

function resultBreakdownLabel(type: string): string {
  switch (type) {
    case "repository_doc":
      return "repo docs";
    case "documentation_page":
      return "docs pages";
    case "repository_symbol":
      return "repo symbols";
    case "repository_code":
      return "repo code hits";
    default:
      return type;
  }
}

function styleOutcome(
  value: string,
  presentation: UnifiedSearchPresentation,
  useColors: boolean,
): string {
  if (!useColors) return value;
  if (
    presentation.lifecycle.kind === "active" ||
    (presentation.lifecycle.kind === "terminal" &&
      presentation.lifecycle.status !== "FAILED")
  ) {
    return `${colors.bold}${colors.yellow}${value}${colors.reset}`;
  }
  if (
    presentation.lifecycle.kind === "terminal" &&
    presentation.lifecycle.status === "FAILED"
  ) {
    return `${colors.bold}${colors.red}${value}${colors.reset}`;
  }
  return `${colors.bold}${value}${colors.reset}`;
}

function activeLifecycleLabel(
  lifecycle: Extract<UnifiedSearchLifecycle, { kind: "active" }>,
): string {
  switch (lifecycle.status) {
    case "PENDING":
      return "preparing";
    case "INDEXING":
      return "indexing";
    case "SEARCHING":
      return "searching";
  }
}

function appendPresentationContext(
  lines: string[],
  presentation: UnifiedSearchPresentation,
  options: NormalizedTextOptions,
): void {
  if (shouldRenderCompactSources(presentation)) {
    lines.push("");
    appendCompactSources(lines, presentation.targetGroups, options);
  } else if (presentation.targetGroups.length > 0) {
    lines.push("");
    presentation.targetGroups.forEach((group, index) => {
      if (index > 0) lines.push("");
      appendPresentationTargetGroup(lines, group, options);
    });
  }
  appendPresentationWarnings(lines, presentation.warnings, options);
}

function shouldRenderCompactSources(
  presentation: UnifiedSearchPresentation,
): boolean {
  if (
    presentation.lifecycle.kind !== "completed" ||
    presentation.availability.resultCount === 0 ||
    presentation.targetGroups.length === 0
  ) {
    return false;
  }
  return presentation.targetGroups.every(
    (group) =>
      group.alternatives === undefined &&
      group.siteSuggestions.length === 0 &&
      group.trustLimits.length === 0 &&
      group.recovery === undefined &&
      (group.freshnessKind === undefined ||
        group.freshnessKind === "current") &&
      group.sources.every((source) =>
        source.entries.every(
          (entry) =>
            entry.state === "searched" &&
            formatCompactSource(source.kind, entry) !== undefined,
        ),
      ),
  );
}

function appendCompactSources(
  lines: string[],
  groups: UnifiedSearchTargetGroup[],
  options: NormalizedTextOptions,
): void {
  const values = groups.flatMap((group) => {
    const identity =
      group.identity.served ?? group.identity.fresh ?? group.identity.requested;
    if (!identity) return [];
    const sources = group.sources
      .flatMap((source) =>
        source.entries
          .filter((entry) => entry.state === "searched")
          .flatMap((entry) => {
            const value = formatCompactSource(source.kind, entry);
            return value
              ? [{ rank: compactSourceRank(source.kind), value }]
              : [];
          }),
      )
      .sort((left, right) => left.rank - right.rank)
      .map((source) => source.value);
    const uniqueSources = [...new Set(sources)];
    const distinctSources = uniqueSources.filter(
      (source) => source !== identity,
    );
    if (distinctSources.length === 0) return [identity];
    if (
      uniqueSources.length === 1 &&
      !identity.includes("#") &&
      targetDisplayFamilyKey(distinctSources[0]) ===
        targetDisplayFamilyKey(identity)
    ) {
      return distinctSources;
    }
    return [`${identity} - ${distinctSources.join(", ")}`];
  });
  const unique = [...new Set(values)];
  if (unique.length === 0) return;
  const wrapped = wrapText(
    unique.join("; "),
    Math.max(1, options.width - "Sources: ".length),
  );
  lines.push(
    `Sources: ${wrapped[0] ?? ""}`,
    ...wrapped.slice(1).map((line) => `  ${line}`),
  );
}

function compactSourceRank(kind: UnifiedSearchSourceKind): number {
  switch (kind) {
    case "code":
      return 0;
    case "symbols":
      return 1;
    case "site_docs":
      return 2;
    case "repository_docs":
      return 3;
    case "docs":
      return 4;
  }
}

function formatCompactSource(
  kind: UnifiedSearchSourceKind,
  entry: UnifiedSearchSourceEntry,
): string | undefined {
  if (kind === "code") return "code";
  if (kind === "symbols") return "symbols";
  if (kind === "repository_docs" && entry.repositoryUrl && entry.commitSha) {
    return formatRepositoryTarget(
      entry.repositoryUrl,
      entry.commitSha.slice(0, 8),
    );
  }
  if (kind === "site_docs") {
    const siteIdentity = formatDocumentationSiteIdentity(entry.siteUrl);
    if (siteIdentity) return `site:${siteIdentity}`;
    if (entry.target.startsWith("site:")) return entry.target;
  }
  return undefined;
}

function sourceKindRank(kind: UnifiedSearchSourceKind): number {
  switch (kind) {
    case "code":
      return 0;
    case "symbols":
      return 1;
    case "repository_docs":
      return 2;
    case "site_docs":
      return 3;
    case "docs":
      return 4;
  }
}

function appendPresentationTargetGroup(
  lines: string[],
  group: UnifiedSearchTargetGroup,
  options: NormalizedTextOptions,
): void {
  const identity = `- ${formatTargetGroupIdentity(group)}`;
  lines.push(options.useColors ? highlight(identity, true) : identity);

  const details: string[] = [];
  const using = formatUsingSegment(group);
  if (using) details.push(using);

  const searched = formatSourceStateSegment(group, "searched");
  if (searched) details.push(`searched: ${searched}`);
  const indexing = formatSourceStateSegment(group, "waiting");
  if (indexing) details.push(`indexing: ${indexing}`);

  const unavailable = formatUnavailableSegment(group);
  if (unavailable) details.push(unavailable);

  const available = formatAvailableSegment(group);
  if (available) details.push(`available: ${available}`);

  if (group.recovery === undefined) {
    const indexed = formatTargetAlternatives(group.alternatives);
    if (indexed) details.push(`indexed: ${indexed}`);
  }

  const constraints = formatTargetConstraints(group);
  if (constraints) details.push(constraints);

  if (details.length === 0 && group.freshnessKind !== undefined) {
    details.push(formatTargetStatus(group.freshnessKind));
  }

  if (details.length > 0) {
    lines.push(...wrapHangingText(details.join("; "), "  ", options.width));
  }
  if (group.recovery) {
    const recovery = formatTargetRecovery(group.recovery, group);
    lines.push(
      ...wrapHangingText(recovery, "  ", options.width).map((line) =>
        options.useColors ? `${colors.yellow}${line}${colors.reset}` : line,
      ),
    );
  }
}

function formatTargetStatus(
  freshness: NonNullable<UnifiedSearchTargetGroup["freshnessKind"]>,
): string {
  switch (freshness) {
    case "current":
      return "ready";
    case "pending":
      return "pending";
    case "provisional":
      return "provisional";
    case "stale":
      return "older snapshot";
    case "indexing":
      return "indexing";
  }
}

function formatUsingSegment(
  group: UnifiedSearchTargetGroup,
): string | undefined {
  const stale = group.trustLimits
    .filter(
      (limit): limit is Extract<UnifiedSearchTrustLimit, { kind: "stale" }> =>
        limit.kind === "stale",
    )
    .sort(
      (left, right) =>
        Number(Boolean(right.servedTarget)) +
        Number(Boolean(right.freshTarget)) -
        Number(Boolean(left.servedTarget)) -
        Number(Boolean(left.freshTarget)),
    )[0];
  const identityIsStale =
    !stale &&
    Boolean(group.identity.served) &&
    (group.freshnessKind === "stale" || group.freshnessKind === "indexing") &&
    group.identity.served !==
      (group.identity.fresh ?? group.identity.requested);
  if (!stale && !identityIsStale) {
    return group.trustLimits.some((limit) => limit.kind === "provisional")
      ? "using: provisional snapshot"
      : undefined;
  }
  const served = stale?.servedTarget ?? stale?.target ?? group.identity.served;
  const fresh = stale?.freshTarget ?? group.identity.fresh;
  return `using: ${compactRelatedTarget(group.identity.requested, served ?? "older snapshot")}${fresh ? ` while ${compactRelatedTarget(group.identity.requested, fresh)} indexes` : " (older snapshot)"}`;
}

function formatSourceStateSegment(
  group: UnifiedSearchTargetGroup,
  state: UnifiedSearchSourceEntry["state"],
): string | undefined {
  const values = group.sources
    .flatMap((source) =>
      source.entries
        .filter((entry) => entry.state === state)
        .map((entry) => ({
          rank: sourceKindRank(source.kind),
          value: formatGroupedSource(source, entry, group.trustLimits),
        })),
    )
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.value);
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique.join(", ") : undefined;
}

function formatUnavailableSegment(
  group: UnifiedSearchTargetGroup,
): string | undefined {
  const entries = group.sources.flatMap((source) =>
    source.entries
      .filter((entry) => entry.state === "unavailable")
      .map((entry) => ({ source, entry })),
  );
  if (entries.length === 0) return undefined;
  const mixed = group.sources.some((source) =>
    source.entries.some(
      (entry) => entry.state === "searched" || entry.state === "waiting",
    ),
  );
  const values = entries
    .map(({ source, entry }) => {
      const lane = formatGroupedSource(source, entry, group.trustLimits);
      const reason = entry.terminalReason;
      const value = reason
        ? `${formatTerminalReason(reason, mixed)}: ${lane}`
        : `unavailable: ${lane}`;
      return { rank: sourceKindRank(source.kind), value };
    })
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.value);
  return [...new Set(values)].join("; ");
}

function formatAvailableSegment(
  group: UnifiedSearchTargetGroup,
): string | undefined {
  const values = group.sources
    .flatMap((source) =>
      source.entries
        .filter((entry) => entry.state === "available_not_searched")
        .map((entry) => ({
          rank: sourceKindRank(source.kind),
          value: formatGroupedSource(source, entry, group.trustLimits),
        })),
    )
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.value);
  if (group.recovery === undefined) {
    values.push(
      ...group.siteSuggestions.flatMap((suggestion) => suggestion.suggestions),
    );
    if (group.siteSuggestions.some((suggestion) => suggestion.truncated)) {
      values.push("+more");
    }
  }
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique.join(", ") : undefined;
}

function formatTerminalReason(
  reason: UnifiedSearchTerminalReason,
  mixed: boolean,
): string {
  const family = reason.family === "unknown" ? "target" : reason.family;
  if (reason.kind === "not_found") {
    return mixed ? "not found" : `${family} not found`;
  }
  if (mixed) return "unresolved";
  if (reason.specificity === "version") return "version unavailable";
  if (reason.specificity === "ref") return "repository ref unresolved";
  return `${family} unresolved`;
}

function formatTargetConstraints(
  group: UnifiedSearchTargetGroup,
): string | undefined {
  const values = group.trustLimits.flatMap((limit) => {
    if (limit.kind !== "constraint") return [];
    const label = limit.constraint.replaceAll("_", " ");
    const source = limit.source ? ` (${limit.source})` : "";
    return [`${label}${source}: ${limit.values.join(", ")}`];
  });
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique.join("; ") : undefined;
}

function formatTargetRecovery(
  recovery: UnifiedSearchTargetRecovery,
  group: UnifiedSearchTargetGroup,
): string {
  if (recovery.kind === "fix") {
    switch (recovery.family) {
      case "package":
        return "Fix: verify registry coordinate/version; use its public GitHub repo for repo-wide search.";
      case "repository":
        return "Fix: verify public GitHub repository/ref.";
      case "site":
        return "Fix: verify site host/path.";
      case "unknown":
        return "Fix: verify or replace target.";
    }
  }
  if (recovery.additionalTargets.length === 0 && !recovery.truncated) {
    return `Try: ${recovery.target}`;
  }
  const additional = recovery.additionalTargets.map((target) =>
    compactRelatedTarget(group.identity.requested, target),
  );
  const remaining =
    recovery.category === "version"
      ? (group.alternatives?.versionsRemaining ?? 0)
      : recovery.category === "ref"
        ? (group.alternatives?.refsRemaining ?? 0) +
          (group.alternatives?.suggestedRefsRemaining ?? 0)
        : 0;
  const label =
    recovery.category === "site" ? "also suggested" : "also indexed";
  const suffix = [
    ...additional,
    ...(remaining > 0
      ? [`+${remaining}`]
      : recovery.truncated
        ? ["+more"]
        : []),
  ];
  return `Try: ${recovery.target} (${label}: ${suffix.join(", ")})`;
}

function formatGroupedSource(
  source: UnifiedSearchSourceGroup,
  entry: UnifiedSearchSourceEntry,
  trustLimits: UnifiedSearchTrustLimit[],
): string {
  const coverage = trustLimits.find(
    (limit): limit is Extract<UnifiedSearchTrustLimit, { kind: "coverage" }> =>
      limit.kind === "coverage" &&
      limit.source === source.kind &&
      limit.target === entry.target,
  );
  const coverageDetails = coverage ? formatCoverageLimit(coverage) : undefined;
  const identity =
    source.kind === "code"
      ? "code"
      : source.kind === "symbols"
        ? "symbols"
        : source.kind === "repository_docs"
          ? "repository docs"
          : source.kind === "site_docs"
            ? `${formatDocumentationSourceIdentity(source, entry)} docs`
            : "docs";
  const qualifiers: string[] = [];
  if (coverageDetails) qualifiers.push(coverageDetails);
  if (entry.state === "searched" && hasProvisionalTrust(entry, trustLimits)) {
    qualifiers.push("provisional");
  }
  return `${identity}${qualifiers.length > 0 ? ` (${qualifiers.join("; ")})` : ""}`;
}

function hasProvisionalTrust(
  entry: UnifiedSearchSourceEntry,
  trustLimits: UnifiedSearchTrustLimit[],
): boolean {
  return trustLimits.some(
    (limit) =>
      limit.kind === "provisional" &&
      (!limit.target ||
        limit.target === entry.target ||
        limit.target === entry.searchTarget),
  );
}

function formatDocumentationSourceIdentity(
  group: UnifiedSearchSourceGroup,
  entry: UnifiedSearchSourceEntry,
): string {
  if (group.kind === "repository_docs") {
    return `${entry.repositoryUrl ?? entry.target}${entry.commitSha ? ` @ ${entry.commitSha}` : ""}`;
  }
  if (group.kind === "docs") return entry.target;
  const siteIdentity = formatDocumentationSiteIdentity(entry.siteUrl);
  return siteIdentity ?? entry.siteKey ?? entry.target;
}

function formatCoverageLimit(
  limit: Extract<UnifiedSearchTrustLimit, { kind: "coverage" }>,
): string {
  const details: string[] = [limit.state];
  if (typeof limit.pagesCrawled === "number") {
    details.unshift(`${limit.pagesCrawled.toLocaleString("en-US")} pages`);
  }
  return details.join("; ");
}

function formatTargetGroupIdentity(group: UnifiedSearchTargetGroup): string {
  const primary =
    group.identity.requested ??
    group.identity.fresh ??
    group.identity.served ??
    "target";
  if (formatUsingSegment(group)) return primary;
  const resolved = group.identity.fresh ?? group.identity.served;
  if (resolved && resolved !== primary) {
    return `${primary} -> ${compactRelatedTarget(primary, resolved)}`;
  }
  return primary;
}

function compactRelatedTarget(base: string | undefined, value: string): string {
  if (!base) return value;
  if (targetDisplayFamilyKey(base) !== targetDisplayFamilyKey(value)) {
    return value;
  }
  const version = value.match(/@([^/@]+)$/)?.[1];
  if (version) return version;
  const ref = value.match(/#([^#]+)$/)?.[1];
  return ref ?? value;
}

function formatTargetAlternatives(
  alternatives: UnifiedSearchTargetGroup["alternatives"],
): string | undefined {
  if (!alternatives) return undefined;
  const categories: string[] = [];
  if (alternatives.versions.length > 0) {
    categories.push(
      `versions ${alternatives.versions.map((entry) => entry.version ?? entry.ref).join(", ")}${formatRemaining(alternatives.versionsRemaining)}`,
    );
  }
  if (alternatives.refs.length > 0) {
    categories.push(
      `refs ${alternatives.refs.map((entry) => entry.ref).join(", ")}${formatRemaining(alternatives.refsRemaining)}`,
    );
  }
  if (alternatives.suggestedRefs.length > 0) {
    categories.push(
      `suggested refs ${alternatives.suggestedRefs.map((entry) => entry.ref).join(", ")}${formatRemaining(alternatives.suggestedRefsRemaining)}`,
    );
  }
  return categories.length > 0 ? categories.join(", ") : undefined;
}

function wrapHangingText(
  text: string,
  prefix: string,
  width: number,
): string[] {
  return wrapText(text, Math.max(1, width - prefix.length)).map(
    (line) => `${prefix}${line}`,
  );
}

function appendPresentationWarnings(
  lines: string[],
  warnings: UnifiedSearchWarning[],
  options: NormalizedTextOptions,
): void {
  if (warnings.length === 0) return;
  lines.push(
    options.useColors
      ? `${colors.bold}${colors.yellow}Warnings:${colors.reset}`
      : "Warnings:",
  );
  for (const warning of warnings) {
    if (warning.kind === "query")
      lines.push(
        options.useColors
          ? `  - ${colors.yellow}${warning.message}${colors.reset}`
          : `  - ${warning.message}`,
      );
    else {
      const label = warning.kind.replaceAll("_", " ");
      const attribution = [warning.source, warning.target]
        .filter((value): value is string => Boolean(value))
        .join(" on ");
      const source = attribution ? ` (${attribution})` : "";
      const value = `  - ${capitalize(label)}${source}: ${warning.values.join(", ")}`;
      lines.push(
        options.useColors ? `${colors.yellow}${value}${colors.reset}` : value,
      );
    }
  }
}

function formatLifecycleSummary(lifecycle: UnifiedSearchLifecycle): string {
  if (lifecycle.kind === "completed") return "completed";
  if (lifecycle.kind === "active") return lifecycle.status.toLowerCase();
  if (lifecycle.kind === "terminal") return lifecycle.status.toLowerCase();
  return "status unknown";
}

function formatRemaining(count: number): string {
  return count > 0 ? ` +${count}` : "";
}

function appendPresentationAction(
  lines: string[],
  presentation: UnifiedSearchPresentation,
  options: NormalizedTextOptions,
): void {
  const action = presentation.action;
  if (action.kind === "none") return;
  if (lines[lines.length - 1] !== "") {
    lines.push("");
  }
  if (action.kind === "poll" || action.kind === "status") {
    const next =
      options.actionSyntax === "cli"
        ? `Next: githits search-status ${action.searchRef} --wait ${DEFAULT_WAIT_TIMEOUT_MS / 1000}`
        : `Next: search_status search_ref=${JSON.stringify(action.searchRef)} wait_timeout_ms=${DEFAULT_WAIT_TIMEOUT_MS}`;
    lines.push(highlight(next, options.useColors));
    return;
  }
  if (action.kind === "new_search") {
    lines.push("Next: rerun search later.");
    return;
  }
  if (action.kind === "query_rewrite") {
    lines.push(
      `Next: ${action.rewrites
        .map((rewrite) => formatRewrite(rewrite, options.actionSyntax))
        .join("; ")}.`,
    );
  }
}

function formatRewrite(
  rewrite: NonNullable<
    Extract<UnifiedSearchAction, { kind: "query_rewrite" }>
  >["rewrites"][number],
  syntax: "mcp" | "cli",
): string {
  switch (rewrite) {
    case "shorter_or_broader":
      return "shorten or broaden query";
    case "remove_filters":
      return "remove restrictive filters";
    case "symbol":
      return syntax === "cli" ? "use --source symbol" : 'use source="symbol"';
    case "code_grep":
      return syntax === "cli" ? "use githits code grep" : "use code_grep";
    case "site_shorter_or_broader":
      return "shorten or broaden site query";
  }
}

function capitalize(value: string): string {
  return value.length > 0
    ? `${value[0]?.toUpperCase()}${value.slice(1)}`
    : value;
}

/** Render an error envelope as compact text. */
export function renderUnifiedSearchError(
  payload: UnifiedSearchErrorPayload,
): string {
  const lines: string[] = [];
  const header = `search${SEP}ERROR${SEP}code=${payload.code}${
    payload.retryable ? `${SEP}retryable` : ""
  }`;
  lines.push(header);
  lines.push(payload.error);

  if (payload.details && Object.keys(payload.details).length > 0) {
    lines.push("");
    lines.push("details:");
    for (const [key, value] of Object.entries(payload.details)) {
      lines.push(`  ${key}: ${formatDetailValue(value)}`);
    }
  }
  return lines.join("\n");
}

function appendUnifiedSearchHits(
  lines: string[],
  hits: UnifiedSearchHitPayload[],
  options: NormalizedTextOptions,
): void {
  hits.forEach((hit, idx) => {
    if (idx > 0) lines.push("");
    appendHit(lines, idx + 1, hit, options);
  });
}

function appendHit(
  lines: string[],
  index: number,
  hit: UnifiedSearchHitPayload,
  options: NormalizedTextOptions,
): void {
  const header = formatHitHeader(hit);
  const rank = `[${index}] `;
  const prefix = renderHitHeaderPrefix(header, options.useColors);
  const title = header.title;
  const titleFits =
    title === undefined ||
    (!title.includes("\n") &&
      rank.length + header.prefix.length + 3 + title.length <= options.width);
  if (titleFits) {
    lines.push(
      `${rank}${prefix}${title === undefined ? "" : ` - ${highlightRanges(title, header.titleHighlights, options.useColors)}`}`,
    );
  } else {
    lines.push(`${rank}${prefix} -`);
    lines.push(
      ...wrapHighlightedText(
        title,
        header.titleHighlights,
        Math.max(1, options.width - 2),
        options.useColors,
      ).map((line) => (line.length === 0 ? "" : `  ${line}`)),
    );
  }

  const summary = prepareSummary(hit.summary, hit.title);
  if (summary) {
    lines.push(
      ...wrapHighlightedText(
        summary.text,
        shiftHighlightRanges(hit.highlights?.summary, summary.offset),
        Math.max(1, options.width - 2),
        options.useColors,
      ).map((line) => (line.length === 0 ? "" : `  ${line}`)),
    );
  }
}

function wrapHighlightedText(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]> | undefined,
  width: number,
  useColors: boolean,
): string[] {
  const output: string[] = [];
  let lineOffset = 0;
  for (const sourceLine of text.split("\n")) {
    const leading = sourceLine.match(/^\s*/)?.[0] ?? "";
    const content = sourceLine.slice(leading.length);
    if (content.length === 0) {
      output.push(leading);
      lineOffset += sourceLine.length + 1;
      continue;
    }

    const available = Math.max(1, width - leading.length);
    let consumed = 0;
    while (content.length - consumed > available) {
      let breakAt = content.lastIndexOf(" ", consumed + available);
      if (breakAt <= consumed) {
        breakAt = content.indexOf(" ", consumed + available);
        if (breakAt < 0) break;
      }
      const chunk = content.slice(consumed, breakAt).trimEnd();
      output.push(
        highlightWrappedSegment(
          leading,
          chunk,
          lineOffset + leading.length + consumed,
          ranges,
          useColors,
        ),
      );
      consumed = breakAt;
      while (content[consumed] === " ") consumed += 1;
    }
    output.push(
      highlightWrappedSegment(
        leading,
        content.slice(consumed),
        lineOffset + leading.length + consumed,
        ranges,
        useColors,
      ),
    );
    lineOffset += sourceLine.length + 1;
  }
  return output;
}

function highlightWrappedSegment(
  leading: string,
  content: string,
  contentOffset: number,
  ranges: ReadonlyArray<readonly [number, number]> | undefined,
  useColors: boolean,
): string {
  const value = `${leading}${content}`;
  if (!useColors || !ranges || ranges.length === 0) return value;
  const localRanges = ranges.flatMap(([from, to]) => {
    const segmentStart = contentOffset;
    const segmentEnd = contentOffset + content.length;
    const overlapStart = Math.max(from, segmentStart);
    const overlapEnd = Math.min(to, segmentEnd);
    return overlapStart < overlapEnd
      ? [
          [
            leading.length + overlapStart - segmentStart,
            leading.length + overlapEnd - segmentStart,
          ] as const,
        ]
      : [];
  });
  return highlightRanges(value, localRanges, true);
}

interface HitHeaderSegment {
  text: string;
  style: "plain" | "locator" | "secondary";
}

interface FormattedHitHeader {
  prefix: string;
  segments: HitHeaderSegment[];
  title?: string;
  titleHighlights?: ReadonlyArray<readonly [number, number]>;
}

function formatHitHeader(hit: UnifiedSearchHitPayload): FormattedHitHeader {
  const loc = hit.locator;
  if (hit.type === "documentation_page") {
    const pageId = loc.pageId ?? "page ID unavailable";
    const type = "[docs page]";
    const target = formatDocumentationTarget(hit);
    const sourceUrl = formatDocumentationSourceUrl(loc.sourceUrl);
    return {
      prefix: `${pageId} ${type} ${target} - ${sourceUrl}`,
      segments: [
        { text: pageId, style: "locator" },
        { text: " ", style: "plain" },
        { text: type, style: "secondary" },
        { text: " ", style: "plain" },
        { text: target, style: "secondary" },
        { text: " - ", style: "plain" },
        { text: sourceUrl, style: "secondary" },
      ],
      title: hit.title || "title unavailable",
      titleHighlights: hit.highlights?.title,
    };
  }
  const location = loc.filePath
    ? `${loc.filePath}${formatLineRange(loc.startLine, loc.endLine)}`
    : "location unavailable";
  const type = `[${shortType(hit.type)}]`;
  return {
    prefix: `${hit.target} ${location} ${type}`,
    segments: [
      { text: hit.target, style: "locator" },
      { text: " ", style: "plain" },
      { text: location, style: "locator" },
      { text: " ", style: "plain" },
      { text: type, style: "secondary" },
    ],
    title: hit.title || undefined,
    titleHighlights: hit.highlights?.title,
  };
}

function renderHitHeaderPrefix(
  header: FormattedHitHeader,
  useColors: boolean,
): string {
  return header.segments
    .map((segment) => {
      if (!useColors || segment.style === "plain") return segment.text;
      return segment.style === "locator"
        ? highlight(segment.text, true)
        : dim(segment.text, true);
    })
    .join("");
}

function formatDocumentationTarget(hit: UnifiedSearchHitPayload): string {
  const { registry, packageName } = hit.locator;
  if (registry && packageName) {
    return `${registry.toLowerCase()}:${packageName}`;
  }
  return (
    stripVersionFromTarget(hit.requestedTarget ?? hit.target) ||
    "target unavailable"
  );
}

function formatDocumentationSourceUrl(value: string | undefined): string {
  if (!value) return "source URL unavailable";
  return value.replace(/^https?:\/\//, "");
}

function stripVersionFromTarget(value: string | undefined): string {
  if (!value) return "";
  const atIndex = value.lastIndexOf("@");
  return atIndex > 0 ? value.slice(0, atIndex) : value;
}

function shortType(type: string): string {
  switch (type) {
    case "repository_code":
      return "repo code";
    case "repository_symbol":
      return "repo symbol";
    case "repository_doc":
      return "repo doc";
    default:
      return type;
  }
}

interface PreparedSummary {
  text: string;
  offset: number;
}

function prepareSummary(
  summary: string | undefined,
  title: string | undefined,
): PreparedSummary | undefined {
  if (!summary) return undefined;
  const lines = summary.split("\n");
  let offset = 0;
  if (title && normalizeHeading(lines[0]) === normalizeHeading(title)) {
    offset += (lines[0]?.length ?? 0) + 1;
    lines.shift();
    if (lines[0] !== undefined && isSetextUnderline(lines[0])) {
      offset += lines[0].length + 1;
      lines.shift();
    }
  }
  const remaining = lines.join("\n");
  const leadingNewline = remaining.match(/^\n+/)?.[0].length ?? 0;
  const text = remaining.replace(/^\n+|\n+$/g, "");
  if (text.trim().length === 0) return undefined;
  return { text, offset: offset + leadingNewline };
}

function shiftHighlightRanges(
  ranges: ReadonlyArray<readonly [number, number]> | undefined,
  offset: number,
): ReadonlyArray<readonly [number, number]> | undefined {
  if (!ranges || offset === 0) return ranges;
  return ranges.flatMap(([from, to]) => {
    const shiftedFrom = from - offset;
    const shiftedTo = to - offset;
    return shiftedTo > 0
      ? [[Math.max(0, shiftedFrom), shiftedTo] as const]
      : [];
  });
}

function normalizeHeading(value: string | undefined): string {
  return (value ?? "").trim().replace(/^#{1,6}\s+/, "");
}

function isSetextUnderline(value: string): boolean {
  return /^\s*(?:=+|-+)\s*$/.test(value);
}

function formatLineRange(start?: number, end?: number): string {
  if (typeof start !== "number") return "";
  if (typeof end !== "number" || end === start) return `:${start}`;
  return `:${start}-${end}`;
}

function formatDocumentationSiteIdentity(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!url.host) return undefined;
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.host}${path}`;
  } catch {
    return undefined;
  }
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function wrapText(text: string, width = DEFAULT_TEXT_WIDTH): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let remaining = paragraph.trim();
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(" ", width);
      if (breakAt <= 0) breakAt = remaining.indexOf(" ", width);
      if (breakAt < 0) breakAt = remaining.length;
      lines.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining.length > 0) lines.push(remaining);
  }
  return lines;
}
