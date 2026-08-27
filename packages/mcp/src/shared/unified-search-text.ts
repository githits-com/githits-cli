/**
 * Line-oriented text renderer for unified `search` MCP responses.
 *
 * Designed for agent context efficiency: roughly 3-5 lines per hit
 * and no JSON scaffolding. This is the tool's default response
 * format — programmatic / parity callers opt into the structured
 * JSON envelope by passing `format: "json"`.
 *
 * ASCII-only output — separators tokenize cleanly across BPE
 * variants, and there are no Unicode characters that require
 * client-side escaping.
 *
 * `text-v1` names the compact representation, not an exact-prose compatibility
 * boundary. Its lifecycle, ordering, action, and hit-anatomy invariants are
 * covered by structural tests in `unified-search-text.test.ts`; JSON remains
 * the stable structured boundary for programmatic callers.
 */

import { DEFAULT_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import { colors, dim, highlight, highlightRanges } from "./colors.js";
import { buildSearchHitFollowUpCommand } from "./follow-up-command-text.js";
import {
  projectUnifiedSearchPresentation,
  type UnifiedSearchAction,
  type UnifiedSearchLifecycle,
  type UnifiedSearchPresentation,
  type UnifiedSearchSourceEntry,
  type UnifiedSearchSourceGroup,
  type UnifiedSearchTrustLimit,
  type UnifiedSearchWarning,
} from "./unified-search-presentation.js";
import type {
  UnifiedSearchCompletedPayload,
  UnifiedSearchErrorPayload,
  UnifiedSearchHitPayload,
  UnifiedSearchIncompletePayload,
} from "./unified-search-response.js";

const SUMMARY_WRAP_WIDTH = 76;
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
    formatPresentationOutcome(presentation, result.results, settings),
  ];
  appendPresentationContext(lines, presentation, settings);

  if (result.results.length > 0) {
    lines.push("");
    appendUnifiedSearchHits(lines, result.results, settings);
  }

  const hasPostResultBlock =
    presentation.hasMore ||
    presentation.alternatives.length > 0 ||
    presentation.siteSuggestions.length > 0 ||
    presentation.action.kind !== "none";
  if (
    result.results.length > 0 &&
    hasPostResultBlock &&
    lines[lines.length - 1] !== ""
  ) {
    lines.push("");
  }

  if (presentation.hasMore) {
    if (lines[lines.length - 1] !== "") lines.push("");
    const nextOffsetHint = formatPaginationHint(
      result.nextOffset,
      settings.actionSyntax,
    );
    lines.push(nextOffsetHint);
  }

  appendPresentationAlternatives(lines, presentation, settings);
  appendPresentationSiteSuggestions(lines, presentation, settings);
  appendPresentationAction(lines, presentation, settings);
  return lines.join("\n");
}

function formatPaginationHint(
  nextOffset: number | undefined,
  actionSyntax: "mcp" | "cli",
): string {
  if (actionSyntax === "cli") {
    return typeof nextOffset === "number"
      ? `More hits available. Pass --offset ${nextOffset} or --limit N to widen.`
      : "More hits available. Pass --limit N to widen.";
  }
  return typeof nextOffset === "number"
    ? `More hits available. Pass offset=${nextOffset} or limit=N to widen.`
    : "More hits available. Pass limit=N to widen.";
}

interface NormalizedTextOptions {
  useColors: boolean;
  actionSyntax: "mcp" | "cli";
}

function normalizeTextOptions(
  options: UnifiedSearchTextOptions,
): NormalizedTextOptions {
  return {
    useColors: options.useColors ?? false,
    actionSyntax: options.actionSyntax ?? "mcp",
  };
}

function formatPresentationOutcome(
  presentation: UnifiedSearchPresentation,
  results: UnifiedSearchHitPayload[],
  options: NormalizedTextOptions,
): string {
  const target = presentationTarget(presentation, results);
  const targetSuffix = target ? ` ${target}` : "";
  const count = presentation.availability.resultCount;
  const countLabel = `${count} result${count === 1 ? "" : "s"}`;

  if (presentation.lifecycle.kind === "active") {
    const label = activeLifecycleLabel(presentation.lifecycle);
    if (presentation.availability.kind === "no_snapshot") {
      return styleOutcome(
        `${label}${targetSuffix} - no result snapshot returned yet`,
        presentation,
        options.useColors,
      );
    }
    if (presentation.availability.kind === "empty") {
      return styleOutcome(
        `${label}${targetSuffix} - no results returned yet`,
        presentation,
        options.useColors,
      );
    }
    const resultKind =
      presentation.availability.kind === "partial" ? "partial" : "interim";
    return styleOutcome(
      `${label} continues - ${countLabel.replace("result", `${resultKind} result`)} returned`,
      presentation,
      options.useColors,
    );
  }

  if (presentation.lifecycle.kind === "completed") {
    return styleOutcome(
      count > 0
        ? `${countLabel}${target ? ` from ${target}` : ""}`
        : `No results returned${target ? ` from ${target}` : ""}`,
      presentation,
      options.useColors,
    );
  }

  const status = presentation.lifecycle.status ?? "UNKNOWN";
  if (count > 0)
    return styleOutcome(
      `${status} - ${countLabel} returned`,
      presentation,
      options.useColors,
    );
  if (presentation.availability.kind === "no_snapshot") {
    return styleOutcome(
      `${status} - no result snapshot returned`,
      presentation,
      options.useColors,
    );
  }
  return styleOutcome(
    `${status} - no results returned`,
    presentation,
    options.useColors,
  );
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
      return "Preparing";
    case "INDEXING":
      return "Indexing";
    case "SEARCHING":
      return "Searching";
  }
}

function presentationTarget(
  presentation: UnifiedSearchPresentation,
  results: UnifiedSearchHitPayload[],
): string | undefined {
  if (presentation.targets.length > 1) return undefined;
  if (results.length > 0) {
    const sourceTargets = presentation.sources.flatMap((group) =>
      group.entries.map((entry) => entry.searchTarget),
    );
    const identities = [
      ...results.map((result) => result.target),
      ...sourceTargets,
    ];
    if (new Set(identities).size > 1) return undefined;
    return results[0]?.target;
  }
  if (presentation.targets.length === 1) {
    const target = presentation.targets[0];
    return target?.served ?? target?.fresh ?? target?.requested;
  }
  const sourceTargets = presentation.sources.flatMap((group) =>
    group.entries.map((entry) => entry.searchTarget),
  );
  if (new Set(sourceTargets).size > 1) return undefined;
  const source = presentation.sources[0]?.entries[0];
  return source?.searchTarget ?? source?.target;
}

function appendPresentationContext(
  lines: string[],
  presentation: UnifiedSearchPresentation,
  options: NormalizedTextOptions,
): void {
  if (presentation.progress) {
    lines.push(
      `Ready: ${presentation.progress.targetsReady}/${presentation.progress.targetsTotal} targets`,
    );
  }
  appendPresentationTargetDivergence(lines, presentation);
  appendPresentationSources(
    lines,
    presentation.sources,
    presentation.trustLimits,
  );
  appendPresentationTrust(lines, presentation.trustLimits, options);
  appendPresentationWarnings(lines, presentation.warnings, options);
}

function appendPresentationTargetDivergence(
  lines: string[],
  presentation: UnifiedSearchPresentation,
): void {
  for (const target of presentation.targets) {
    const identities = [target.requested, target.fresh, target.served].filter(
      (value): value is string => Boolean(value),
    );
    if (new Set(identities).size < 2) continue;
    const parts: string[] = [];
    if (target.requested) parts.push(`requested ${target.requested}`);
    if (target.fresh) parts.push(`fresh ${target.fresh}`);
    if (target.served) parts.push(`served ${target.served}`);
    if (parts.length > 0) lines.push(`Target: ${parts.join("; ")}`);
  }
}

function appendPresentationSources(
  lines: string[],
  groups: UnifiedSearchSourceGroup[],
  trustLimits: UnifiedSearchTrustLimit[],
): void {
  const states: Array<{
    state: UnifiedSearchSourceEntry["state"];
    label: string;
  }> = [
    { state: "waiting", label: "Waiting" },
    { state: "searched", label: "Searched" },
    { state: "available_not_searched", label: "Available but not searched" },
    { state: "unavailable", label: "Unavailable" },
  ];
  const contextTargets = new Set(
    groups.flatMap((group) => group.entries.map((entry) => entry.searchTarget)),
  );
  const showTargetContext = contextTargets.size > 1;
  for (const { state, label } of states) {
    const entries = groups.flatMap((group) =>
      group.entries
        .filter((entry) => entry.state === state)
        .map((entry) => ({ group, entry })),
    );
    if (entries.length === 0) continue;
    const values = entries.map(({ group, entry }) =>
      formatSourceReadiness(group, entry, trustLimits, showTargetContext),
    );
    const unique = [...new Set(values)];
    lines.push(...wrapText(`${label}: ${unique.join(", ")}`));
  }
}

function formatSourceReadiness(
  group: UnifiedSearchSourceGroup,
  entry: UnifiedSearchSourceEntry,
  trustLimits: UnifiedSearchTrustLimit[],
  showTargetContext: boolean,
): string {
  const sourceLabel = sourceGroupLabel(group.kind);
  const contextSuffix = (identity?: string): string =>
    showTargetContext && identity !== entry.searchTarget
      ? ` for ${entry.searchTarget}`
      : "";
  if (entry.state === "unavailable") {
    return `${sourceLabel} (${entry.target})${contextSuffix(entry.target)}`;
  }
  const coverage = trustLimits.find(
    (limit): limit is Extract<UnifiedSearchTrustLimit, { kind: "coverage" }> =>
      limit.kind === "coverage" &&
      limit.source === group.kind &&
      limit.target === entry.target,
  );
  const coverageDetails = coverage ? formatCoverageLimit(coverage) : undefined;
  if (entry.state === "searched") {
    const identity =
      group.kind === "code"
        ? undefined
        : formatDocumentationSourceIdentity(group, entry);
    const details = [identity, coverageDetails].filter(
      (value): value is string => Boolean(value),
    );
    return `${sourceLabel}${details.length > 0 ? ` (${details.join("; ")})` : ""}${contextSuffix(identity)}`;
  }
  if (entry.state === "waiting") {
    const identity =
      showTargetContext && group.kind !== "code"
        ? formatDocumentationSourceIdentity(group, entry)
        : undefined;
    return `${sourceLabel}${identity ? ` (${identity})` : ""}${contextSuffix(identity)}`;
  }
  const baseIdentity =
    group.kind === "site_docs"
      ? formatDocumentationSourceIdentity(group, entry)
      : entry.target;
  const identity =
    group.kind === "site_docs"
      ? `${baseIdentity} docs`
      : `${sourceLabel} (${baseIdentity})`;
  return `${identity}${coverageDetails ? ` (${coverageDetails})` : ""}${contextSuffix(baseIdentity)}`;
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

function sourceGroupLabel(kind: UnifiedSearchSourceGroup["kind"]): string {
  switch (kind) {
    case "docs":
      return "docs";
    case "repository_docs":
      return "repository docs";
    case "site_docs":
      return "site docs";
    case "code":
      return "code";
  }
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

function appendPresentationTrust(
  lines: string[],
  trustLimits: UnifiedSearchTrustLimit[],
  options: NormalizedTextOptions,
): void {
  const trust = trustLimits.filter((limit) => limit.kind !== "source");
  for (const limit of trust) {
    switch (limit.kind) {
      case "stale":
        lines.push(
          dim(
            `Evidence: ${limit.requestedTarget ? `requested ${limit.requestedTarget}; ` : ""}served older snapshot ${limit.servedTarget ?? limit.target ?? "unknown target"}${limit.freshTarget ? ` while ${limit.freshTarget} indexes` : ""}.`,
            options.useColors,
          ),
        );
        break;
      case "provisional":
        lines.push(
          dim(
            "Evidence: provisional snapshot; indexing continues.",
            options.useColors,
          ),
        );
        break;
      case "coverage":
        break;
      case "constraint":
      case "mutable_evidence":
        if (limit.kind === "mutable_evidence")
          lines.push(dim("Evidence may change.", options.useColors));
        break;
    }
  }
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
      const source = warning.source ? ` (${warning.source})` : "";
      const value = `  - ${capitalize(label)}${source}: ${warning.values.join(", ")}`;
      lines.push(
        options.useColors ? `${colors.yellow}${value}${colors.reset}` : value,
      );
    }
  }
}

function appendPresentationAlternatives(
  lines: string[],
  presentation: UnifiedSearchPresentation,
  options: NormalizedTextOptions,
): void {
  for (const alternative of presentation.alternatives) {
    const categories: string[] = [];
    if (alternative.versions.length > 0) {
      categories.push(
        `versions ${alternative.versions.map((entry) => entry.version ?? entry.ref).join(", ")}${formatRemaining(alternative.versionsRemaining)}`,
      );
    }
    if (alternative.refs.length > 0) {
      categories.push(
        `refs ${alternative.refs.map((entry) => entry.ref).join(", ")}${formatRemaining(alternative.refsRemaining)}`,
      );
    }
    if (alternative.suggestedRefs.length > 0) {
      categories.push(
        `suggested refs ${alternative.suggestedRefs.map((entry) => entry.ref).join(", ")}${formatRemaining(alternative.suggestedRefsRemaining)}`,
      );
    }
    if (categories.length > 0) {
      lines.push(
        ...wrapText(
          `Indexed alternatives${presentation.alternatives.length > 1 && alternative.target ? ` for ${alternative.target}` : ""}: ${categories.join("; ")}`,
          SUMMARY_WRAP_WIDTH,
        ).map((line) => dim(line, options.useColors)),
      );
    }
  }
}

function appendPresentationSiteSuggestions(
  lines: string[],
  presentation: UnifiedSearchPresentation,
  options: NormalizedTextOptions,
): void {
  const seen = new Set<string>();
  const rendered = presentation.siteSuggestions.flatMap((facts) => {
    const suggestions = facts.suggestions.filter((suggestion) => {
      if (seen.has(suggestion)) return false;
      seen.add(suggestion);
      return true;
    });
    return suggestions.length > 0 ? [{ facts, suggestions }] : [];
  });
  for (const { facts, suggestions } of rendered) {
    const targetSuffix = rendered.length > 1 ? ` for ${facts.target}` : "";
    lines.push(
      ...wrapText(
        `Suggested site targets${targetSuffix}: ${suggestions.join(", ")}`,
        SUMMARY_WRAP_WIDTH,
      ).map((line) => dim(line, options.useColors)),
    );
  }
  if (presentation.siteSuggestions.some((facts) => facts.truncated)) {
    lines.push(dim("Additional site targets were omitted.", options.useColors));
  }
}

function formatRemaining(count: number): string {
  return count > 0 ? ` +${count} more` : "";
}

function appendPresentationAction(
  lines: string[],
  presentation: UnifiedSearchPresentation,
  options: NormalizedTextOptions,
): void {
  const action = presentation.action;
  if (action.kind === "none") {
    if (presentation.availability.kind === "empty") {
      lines.push(
        hasEvidenceLimit(presentation.trustLimits)
          ? "Do not repeat immediately."
          : "Do not repeat this search unchanged.",
      );
    }
    return;
  }
  if (action.kind === "poll" || action.kind === "status") {
    lines.push(
      action.kind === "status"
        ? "Do not repeat immediately."
        : "Do not repeat search.",
    );
    const next =
      options.actionSyntax === "cli"
        ? `Next: githits search-status ${action.searchRef} --wait ${DEFAULT_WAIT_TIMEOUT_MS / 1000}`
        : `Next: search_status search_ref=${JSON.stringify(action.searchRef)} wait_timeout_ms=${DEFAULT_WAIT_TIMEOUT_MS}`;
    lines.push(highlight(next, options.useColors));
    return;
  }
  if (action.kind === "new_search") {
    if (
      presentation.lifecycle.kind === "terminal" ||
      presentation.lifecycle.kind === "unknown"
    ) {
      lines.push("Do not poll this session again.");
    } else if (presentation.availability.kind === "empty") {
      lines.push("Do not repeat immediately.");
    }
    lines.push("Next: rerun search later.");
    return;
  }
  if (action.kind === "indexed_alternative") {
    if (presentation.availability.kind === "empty") {
      lines.push("Do not repeat immediately.");
    }
    lines.push(
      `Next: search indexed ${action.category} ${action.value}${action.target ? ` for ${action.target}` : ""}.`,
    );
    return;
  }
  if (action.kind === "site_retry") {
    lines.push(
      presentation.lifecycle.kind === "terminal" ||
        presentation.lifecycle.kind === "unknown"
        ? "Do not poll this session again."
        : "Do not repeat immediately.",
    );
    lines.push("Next: retry one suggested site target explicitly.");
    return;
  }
  if (action.kind === "query_rewrite") {
    lines.push(
      hasEvidenceLimit(presentation.trustLimits)
        ? "Do not repeat immediately."
        : "Do not repeat this search unchanged.",
    );
    lines.push(
      `Next: ${action.rewrites
        .map((rewrite) => formatRewrite(rewrite, options.actionSyntax))
        .join("; ")}.`,
    );
  }
}

function hasEvidenceLimit(trustLimits: UnifiedSearchTrustLimit[]): boolean {
  return trustLimits.some(
    (limit) =>
      limit.kind === "mutable_evidence" ||
      limit.kind === "stale" ||
      limit.kind === "provisional" ||
      limit.kind === "coverage" ||
      limit.kind === "source",
  );
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
  const headerParts: string[] = [
    highlight(formatHitPrimary(hit), options.useColors),
    shortType(hit.type),
  ];
  lines.push(`[${index}] ${headerParts.join("  ")}`);

  const locator = buildLocatorLine(hit, options.actionSyntax);
  if (locator) lines.push(`    ${locator}`);

  // Title is suppressed when it's literally the locator we just
  // printed; the response builder already drops `qualifiedPath` when
  // it equals `title`, so we don't double-check that here.
  if (hit.title && hit.title !== hit.locator.filePath) {
    lines.push(
      `    ${highlightRanges(hit.title, hit.highlights?.title, options.useColors)}`,
    );
  }

  if (hit.summary) {
    for (const wrapped of wrapHighlightedText(
      hit.summary,
      hit.highlights?.summary,
      SUMMARY_WRAP_WIDTH,
      options.useColors,
    )) {
      lines.push(`    ${wrapped}`);
    }
  }
}

function wrapHighlightedText(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]> | undefined,
  width: number,
  useColors: boolean,
): string[] {
  const wrapped = wrapText(text, width);
  if (!useColors || !ranges || ranges.length === 0) return wrapped;
  const highlighted: string[] = [];
  let cursor = 0;
  for (const line of wrapped) {
    const start = text.indexOf(line, cursor);
    const offset = start >= 0 ? start : cursor;
    const localRanges = ranges.map(
      ([from, to]) => [from - offset, to - offset] as const,
    );
    highlighted.push(highlightRanges(line, localRanges, true));
    cursor = offset + line.length;
  }
  return highlighted;
}

function formatHitPrimary(hit: UnifiedSearchHitPayload): string {
  const loc = hit.locator;
  if (hit.type === "documentation_page" && loc.pageId) {
    const target = formatDocsPageTarget(loc, hit.target);
    return target ? `${loc.pageId} ${target}` : loc.pageId;
  }
  if (hit.type === "repository_doc" && loc.filePath) {
    return `${hit.target} ${loc.filePath}${formatLineRange(loc.startLine, loc.endLine)}`;
  }
  return hit.target;
}

function formatDocsPageTarget(
  locator: {
    registry?: string;
    packageName?: string;
  },
  fallbackTarget?: string,
): string {
  return locator.registry && locator.packageName
    ? `${locator.registry}:${locator.packageName}`
    : stripVersionFromTarget(fallbackTarget);
}

function stripVersionFromTarget(value: string | undefined): string {
  if (!value) return "";
  const atIndex = value.lastIndexOf("@");
  return atIndex > 0 ? value.slice(0, atIndex) : value;
}

/**
 * Compact, agent-friendly type label.
 *
 * Backend types are uppercase enum-style; the JSON envelope already
 * lowercases them. Text mode further compacts to a single token so a
 * reader can scan the third column quickly.
 */
function shortType(type: string): string {
  switch (type) {
    case "repository_code":
      return "code";
    case "repository_symbol":
      return "symbol";
    case "documentation_page":
      return "docs";
    case "repository_doc":
      return "repo-docs";
    default:
      return type;
  }
}

function buildLocatorLine(
  hit: UnifiedSearchHitPayload,
  actionSyntax: "mcp" | "cli",
): string {
  const loc = hit.locator;
  const followUp = buildSearchHitFollowUpCommand(hit, actionSyntax);
  if (followUp) {
    const tail: string[] = [];
    if (loc.qualifiedPath) tail.push(loc.qualifiedPath);
    if (loc.kind) tail.push(loc.kind);
    return tail.length > 0 ? `${followUp}  ${tail.join(SEP)}` : followUp;
  }
  if (loc.filePath) {
    let line = `${loc.filePath}${formatLineRange(loc.startLine, loc.endLine)}`;
    const tail: string[] = [];
    if (loc.qualifiedPath) tail.push(loc.qualifiedPath);
    if (loc.kind) tail.push(loc.kind);
    if (tail.length > 0) line += `  ${tail.join(SEP)}`;
    return line;
  }
  if (loc.pageId) return `pageId: ${loc.pageId}`;
  if (loc.sourceUrl) return loc.sourceUrl;
  return "";
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

function wrapText(text: string, width = SUMMARY_WRAP_WIDTH): string[] {
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
