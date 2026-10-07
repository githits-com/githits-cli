import type {
  GrepHit,
  GrepLineSlice,
  GrepResult,
  GrepTargetStatus,
} from "@githits/core-internal";
import { colors, highlightMatch } from "./colors.js";
import { grepPreparationReason } from "./grep-preparation-text.js";
import { formatPreparationRow } from "./indexing-estimates-text.js";
import { indexingWaitMs } from "./indexing-wait.js";
import {
  appendSearchGrepFooter,
  footerAction,
  footerProse,
} from "./search-grep-output-text.js";
import { shellQuoteExact } from "./shell-quote.js";
import {
  formatProvenanceRow,
  formatSourceRow,
  type SourceRowFacts,
} from "./source-provenance-text.js";
import { terminalWidth } from "./terminal-width.js";

export interface GrepTextOptions {
  useColors?: boolean;
  width?: number;
  syntax?: "cli" | "mcp";
}
interface SourceSummary {
  facts: SourceRowFacts;
  requested: Set<string>;
  matched: boolean;
  hostedDocumentation: boolean;
}
interface MatchSpan {
  start: number;
  end: number;
}
interface RenderLine {
  number: number;
  slice: GrepLineSlice;
  match: boolean;
  spans: MatchSpan[];
}
interface FileGroup {
  first: GrepHit;
  hits: GrepHit[];
}

/** Group one returned page for reading; JSON retains backend occurrence order. */
export function formatGrepText(
  result: GrepResult,
  options: GrepTextOptions = {},
): string {
  const lines: string[] = [];
  const prose = (value: string): void => {
    lines.push(...wrap(escapeText(value), options.width ?? 80));
  };
  const groups = groupFiles(result.hits);
  const omissionsOnly =
    result.unavailableTargets.length > 0 &&
    result.targets.every((scope) => !hasPageCoverageGap(scope)) &&
    !["FAILED", "CURSOR_EXPIRED"].includes(result.traversal);
  const retryableOmissionsOnly =
    omissionsOnly &&
    result.unavailableTargets.every((target) => target.retryable);
  const matchingLines = new Set(
    result.hits.map((hit) => JSON.stringify([...fileIdentity(hit), hit.line])),
  ).size;
  const kinds = new Set(result.hits.map((hit) => hit.__typename));
  const noun =
    kinds.size > 1
      ? "files/pages"
      : kinds.has("GrepSiteHit")
        ? `page${groups.length === 1 ? "" : "s"}`
        : `file${groups.length === 1 ? "" : "s"}`;
  prose(
    result.hits.length
      ? `Found ${result.totalMatches} match${result.totalMatches === 1 ? "" : "es"} on ${matchingLines} line${matchingLines === 1 ? "" : "s"} in ${groups.length} ${noun}.`
      : result.nextCursor
        ? retryableOmissionsOnly
          ? "No matches available yet on this page."
          : "No matches on this page."
        : retryableOmissionsOnly
          ? "No matches available yet."
          : "No matches found.",
  );
  if (options.useColors) lines[0] = `${colors.bold}${lines[0]}${colors.reset}`;
  if (result.targets.length) {
    lines.push("", "Sources:");
    const matchedScopes = new Set(result.hits.map((hit) => hit.targetIndex));
    for (const source of formatSources(
      result.targets,
      matchedScopes,
      isExhaustive(result),
    ))
      prose(`  - ${source}`);
  }
  const isPreparing = (reason: string): boolean =>
    ["repository_indexing", "documentation_publishing"].includes(reason);
  const pending = result.unavailableTargets.filter((entry) =>
    isPreparing(entry.reason),
  );
  const attached = new Set<(typeof pending)[number]>();
  if (pending.length || result.indexingEstimates?.length)
    lines.push("", "Preparing:");
  for (const entry of result.indexingEstimates ?? []) {
    prose(`  - ${formatPreparationRow(entry)}`);
    const inputs = pending.filter(
      (omitted) =>
        entry.targets.includes(omitted.target) &&
        entry.kind ===
          (omitted.reason === "repository_indexing"
            ? "REPOSITORY"
            : "DOCUMENTATION"),
    );
    for (const omitted of inputs) attached.add(omitted);
    for (const target of new Set(inputs.map((omitted) => omitted.target))) {
      const targetInputs = inputs.filter(
        (omitted) => omitted.target === target,
      );
      const needsAlias =
        inputs.length > 1 ||
        entry.targets.length > 1 ||
        Boolean(entry.repositoryUrl && entry.commitSha) ||
        targetInputs.some((omitted) =>
          Boolean(omitted.suggestedSiteTargets?.length),
        );
      if (needsAlias) prose(`    Requested: ${target}`);
      for (const omitted of targetInputs)
        for (const suggested of omitted.suggestedSiteTargets ?? [])
          prose(`      Suggested site: ${suggested}`);
    }
    if (entry.repositoryUrl && entry.commitSha) {
      const remaining = entry.targets.filter(
        (target) => !inputs.some((input) => input.target === target),
      );
      if (remaining.length) prose(`    Requested: ${remaining.join(", ")}`);
    }
  }
  for (const omitted of pending.filter((entry) => !attached.has(entry))) {
    prose(
      `  - ${formatProvenanceRow(omitted.target, [omitted.reason === "repository_indexing" ? "indexing" : "preparing documentation"])}`,
    );
    for (const target of omitted.suggestedSiteTargets ?? [])
      prose(`    Suggested site: ${target}`);
  }
  const otherOmissions = result.unavailableTargets.filter(
    (entry) => !isPreparing(entry.reason),
  );
  if (otherOmissions.length) lines.push("Omitted:");
  for (const omitted of otherOmissions) {
    prose(`  - ${omitted.target} (${grepPreparationReason(omitted.reason)})`);
    for (const target of omitted.suggestedSiteTargets ?? [])
      prose(`    Suggested site: ${target}`);
  }
  for (const scope of result.targets) renderCoverage(scope, prose);

  if (result.traversal === "CURSOR_EXPIRED")
    prose(
      "Cursor expired. Restart explicitly without the cursor; retained matches and omissions are included.",
    );
  else if (
    result.traversal !== "COMPLETE" &&
    (!result.nextCursor || result.traversal !== "RESUMABLE_LIMIT") &&
    !omissionsOnly
  )
    prose(
      result.nextCursor
        ? "Some requested content could not be searched."
        : "Traversal is incomplete and has no continuation cursor.",
    );
  for (const [index, group] of groups.entries()) {
    const first = group.first;
    const target = first.read.target;
    const path =
      first.read.path !== null
        ? ` ${quoteLocator(first.read.path, options.syntax)}`
        : "";
    const display =
      first.__typename === "GrepSiteHit" && first.pageUrl !== first.read.target
        ? ` [page: ${escapeText(first.pageUrl)}]`
        : "";
    lines.push(
      "",
      `[${index + 1}] ${quoteLocator(target, options.syntax)}${path}${display}`,
    );
    const rows = groupRows(group.hits);
    const gutter = Math.max(...rows.map((row) => String(row.number).length));
    const hasContext = rows.some((row) => !row.match);
    let previous: number | undefined;
    for (const row of rows) {
      if (hasContext && previous !== undefined && row.number > previous + 1)
        lines.push("--");
      lines.push(
        `${String(row.number).padStart(gutter)}${row.match ? ":" : "-"} ${renderSlice(row, options.useColors ?? false)}`,
      );
      previous = row.number;
    }
    if (group.hits.some((hit) => hit.contentSafety.filtered))
      prose(
        "Safety normalization applied; physical source coordinates remain in JSON.",
      );
  }
  const read: string[] = [];
  const more: string[] = [];
  const followUp: string[] = [];
  const proseLines = (value: string): string[] =>
    footerProse(escapeText(value), options.width ?? 80);
  const operand = (value: string): string =>
    footerAction(value, options.useColors === true);
  if (groups.length) {
    if (kinds.has("GrepRepositoryHit"))
      read.push(
        operand(
          options.syntax === "mcp"
            ? "Files: read target=$target path=$path start_line=$start end_line=$end"
            : "Files: githits read --lines $start-$end -- $target $path",
        ),
      );
    if (kinds.has("GrepSiteHit"))
      read.push(
        operand(
          options.syntax === "mcp"
            ? "Pages: read target=$url start_line=$start end_line=$end"
            : "Pages: githits read --lines $start-$end -- $url",
        ),
      );
  }
  if (result.nextCursor)
    more.push(
      ...proseLines("Repeat the original grep, adding:"),
      operand(
        options.syntax === "mcp"
          ? `cursor=${JSON.stringify(result.nextCursor)}`
          : `--cursor ${shellQuoteExact(result.nextCursor)}`,
      ),
    );
  if (result.unavailableTargets.some((target) => target.retryable)) {
    const wait = indexingWaitMs(result.indexingEstimates);
    followUp.push(
      ...proseLines(
        `To retry omitted targets, rerun the original query with ${options.syntax === "mcp" ? `wait_timeout_ms=${wait}` : `--wait ${wait}`}.`,
      ),
    );
  }
  appendSearchGrepFooter(
    lines,
    { read, more, followUp },
    options.useColors === true,
  );
  return lines.join("\n");
}

function renderCoverage(
  scope: GrepTargetStatus,
  prose: (value: string) => void,
): void {
  const prefix = `${scope.kind === "REPOSITORY" ? "Repository" : "Hosted docs"} ${scope.target}`;
  const notes: string[] = [];
  if (
    scope.readiness === "UNSPECIFIED" &&
    scope.traversal !== "RESUMABLE_LIMIT"
  )
    notes.push("source readiness unknown");
  else if (scope.readiness !== "UNSPECIFIED" && scope.readiness !== "CURRENT")
    notes.push(readinessNote(scope));
  if (scope.traversal !== "COMPLETE" && scope.traversal !== "RESUMABLE_LIMIT")
    notes.push(traversalNote(scope));
  if (scope.errorCode) notes.push(scope.errorCode);
  if (scope.publicMessage) notes.push(scope.publicMessage);
  const details: string[] = [];
  if (notes.length) {
    if (scope.retryable) notes.push("retryable");
    if (scope.readiness === "STALE" && scope.commitSha)
      details.push(
        ...(scope.repoUrl
          ? scope.requestedRef
            ? [`Requested ref: ${scope.requestedRef}.`]
            : []
          : [
              `Served ${scope.commitSha}${scope.requestedRef ? `; requested ${scope.requestedRef}` : ""}.`,
            ]),
      );
    if (
      scope.filesScanned !== null &&
      scope.filesInScope !== null &&
      scope.filesScanned !== scope.filesInScope
    )
      details.push(
        `Searched ${scope.filesScanned} of ${scope.filesInScope} files.`,
      );
  }
  if (scope.binaryFilesSkipped)
    details.push(`Skipped ${scope.binaryFilesSkipped} binary file(s).`);
  if (scope.filesTooLargeSkipped)
    details.push(`Skipped ${scope.filesTooLargeSkipped} oversized file(s).`);
  for (const issue of scope.fileIssues ?? [])
    details.push(
      `File issue ${issue.filePath}${issue.line > 0 ? `:${issue.line}` : " (aggregate)"}; ${issue.code}${issue.contentSafety.filtered ? "; safety normalization applied" : ""}.`,
    );
  if (scope.fileIssuesOmitted)
    details.push(
      `${scope.fileIssuesOmitted} additional file issue(s) omitted.`,
    );
  if (notes.length || details.length) {
    const note = notes.join("; ");
    prose(
      `${prefix}:${note ? ` ${note}${/[.!?]$/.test(note) ? "" : "."}` : ""}`,
    );
    for (const detail of details) prose(`  ${detail}`);
  }
}
function readinessNote(scope: GrepTargetStatus): string {
  switch (scope.readiness) {
    case "STALE":
      return "stale snapshot";
    case "NOT_AVAILABLE":
      return "unavailable";
    case "MISSING_REF":
      return "requested ref missing";
    case "READER_OPEN_FAILED":
      return "could not open repository reader";
    case "INCOMPLETE":
      return "incomplete index";
    case "RESOURCE_LIMIT":
      return "resource limit reached";
    case "VERSION_UNSUPPORTED":
      return "unsupported documentation version";
    case "READ_FAILED":
      return "could not read documentation";
    default:
      return scope.readiness;
  }
}
function traversalNote(scope: GrepTargetStatus): string {
  switch (scope.traversal) {
    case "FAILED":
      return "search failed";
    case "CURSOR_EXPIRED":
      return "cursor expired";
    default:
      return "incomplete search";
  }
}
function isExhaustive(result: GrepResult): boolean {
  return (
    result.traversal === "COMPLETE" &&
    result.unavailableTargets.length === 0 &&
    result.targets.every((scope) => !hasCoverageGap(scope))
  );
}
/** Resumable, unvisited scopes are pagination; errors and skips remain gaps. */
function hasPageCoverageGap(scope: GrepTargetStatus): boolean {
  return (
    (scope.readiness !== "CURRENT" &&
      !(
        scope.readiness === "UNSPECIFIED" &&
        scope.traversal === "RESUMABLE_LIMIT"
      )) ||
    !["COMPLETE", "RESUMABLE_LIMIT"].includes(scope.traversal) ||
    scope.errorCode !== null ||
    Boolean(
      scope.binaryFilesSkipped ||
        scope.filesTooLargeSkipped ||
        scope.fileIssues?.length ||
        scope.fileIssuesOmitted,
    )
  );
}
function hasCoverageGap(scope: GrepTargetStatus): boolean {
  return (
    scope.readiness !== "CURRENT" ||
    scope.traversal !== "COMPLETE" ||
    hasPageCoverageGap(scope)
  );
}

function formatSources(
  scopes: GrepTargetStatus[],
  matchedScopes: Set<number>,
  exhaustive: boolean,
): string[] {
  const sources = new Map<string, SourceSummary>();
  for (const scope of scopes) {
    let target = scope.target;
    let identity = JSON.stringify([scope.kind, scope.target]);
    const hostedDocumentation =
      scope.kind === "SITE" && Boolean(scope.canonicalSite);
    if (scope.kind === "SITE" && scope.canonicalSite) {
      target = `site:${scope.canonicalSite.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`;
      identity = JSON.stringify([scope.kind, scope.canonicalSite]);
    }
    const qualifiers: string[] = [];
    if (scope.kind === "REPOSITORY" && scope.repoUrl && scope.commitSha) {
      if (scope.corpus === "SOURCE") qualifiers.push("source files");
      if (scope.corpus === "DOCUMENTATION") qualifiers.push("repository docs");
      identity = JSON.stringify([
        scope.kind,
        scope.repoUrl,
        scope.commitSha,
        scope.corpus,
      ]);
    }
    if (scope.readiness === "STALE") qualifiers.push("older snapshot");
    const unsearched =
      !matchedScopes.has(scope.targetIndex) &&
      scope.filesScanned === 0 &&
      !["CURRENT", "STALE", "UNSPECIFIED"].includes(scope.readiness);
    if (unsearched) qualifiers.push("not searched");
    identity = JSON.stringify([
      identity,
      scope.readiness,
      scope.traversal,
      scope.filesScanned,
      scope.filesInScope,
      scope.errorCode,
      scope.binaryFilesSkipped,
      scope.filesTooLargeSkipped,
      scope.fileIssues,
      scope.fileIssuesOmitted,
      scope.urlPrefixes,
    ]);
    const source = sources.get(identity) ?? {
      facts: {
        target,
        identity:
          scope.kind === "REPOSITORY"
            ? { repoUrl: scope.repoUrl, commitSha: scope.commitSha }
            : undefined,
        qualifiers,
      },
      requested: new Set<string>(),
      matched: false,
      hostedDocumentation,
    };
    // A named ref and a SHA can identify the same snapshot. Compare commit IDs.
    if (
      scope.kind === "REPOSITORY" &&
      scope.commitSha &&
      scope.requestedRef &&
      /^[a-f0-9]{40}$/i.test(scope.requestedRef) &&
      scope.requestedRef.toLowerCase() !== scope.commitSha.toLowerCase()
    )
      source.requested.add(scope.target);
    source.matched ||= matchedScopes.has(scope.targetIndex);
    sources.set(identity, source);
  }
  return [...sources.values()].map((source) =>
    formatSourceRow({
      ...source.facts,
      qualifiers: [
        ...(source.facts.qualifiers ?? []),
        ...(source.requested.size
          ? [`requested: ${[...source.requested].join(", ")}`]
          : []),
        ...(!source.matched &&
        !source.facts.qualifiers?.includes("not searched")
          ? [exhaustive ? "no results" : "no results on this page"]
          : []),
        ...(source.hostedDocumentation ? ["hosted documentation"] : []),
      ],
    }),
  );
}

/** Keep ordinary locators readable and unsafe operands copyable without shell expansion. */
function quoteLocator(
  value: string,
  syntax: GrepTextOptions["syntax"],
): string {
  if (/^[A-Za-z0-9_./:@%+=-][A-Za-z0-9_./:@%#+=-]*$/.test(value)) return value;
  return syntax === "mcp" ? JSON.stringify(value) : shellQuoteExact(value);
}
function fileIdentity(hit: GrepHit): (string | number | null)[] {
  return [hit.targetIndex, hit.__typename, hit.read.target, hit.read.path];
}
function groupFiles(hits: GrepHit[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const hit of hits) {
    const key = JSON.stringify(fileIdentity(hit));
    const group = groups.get(key);
    if (group) group.hits.push(hit);
    else groups.set(key, { first: hit, hits: [hit] });
  }
  return [...groups.values()];
}
function groupRows(hits: GrepHit[]): RenderLine[] {
  const rows = new Map<string, RenderLine>();
  const add = (
    number: number,
    slice: GrepLineSlice,
    span?: MatchSpan,
  ): void => {
    const key = JSON.stringify([
      number,
      slice.startByte,
      slice.endByte,
      slice.content,
    ]);
    const row = rows.get(key);
    if (row) {
      if (span) {
        row.match = true;
        row.spans.push(span);
      }
    } else
      rows.set(key, {
        number,
        slice,
        match: span !== undefined,
        spans: span ? [span] : [],
      });
  };
  for (const hit of hits) {
    hit.contextBeforeSlices.forEach((slice, index) => {
      add(hit.line - hit.contextBeforeSlices.length + index, slice);
    });
    add(hit.line, hit.lineSlice, {
      start: hit.matchStartByte,
      end: hit.matchEndByte,
    });
    hit.contextAfterSlices.forEach((slice, index) => {
      add(hit.line + index + 1, slice);
    });
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.number - b.number ||
      a.slice.startByte - b.slice.startByte ||
      a.slice.endByte - b.slice.endByte,
  );
}
function renderSlice(row: RenderLine, useColors: boolean): string {
  const { slice } = row;
  let content: string;
  if (!useColors) content = escapeSource(slice.content);
  else {
    const bytes = new TextEncoder().encode(slice.content);
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    const merged: MatchSpan[] = [];
    for (const span of [...row.spans].sort(
      (a, b) => a.start - b.start || a.end - b.end,
    )) {
      if (span.start === span.end) continue;
      const previous = merged[merged.length - 1];
      if (previous && span.start <= previous.end)
        previous.end = Math.max(previous.end, span.end);
      else merged.push({ ...span });
    }
    let cursor = 0;
    content = "";
    for (const span of merged) {
      content += escapeSource(
        decoder.decode(bytes.subarray(cursor, span.start)),
      );
      content += highlightMatch(
        escapeSource(decoder.decode(bytes.subarray(span.start, span.end))),
        true,
      );
      cursor = span.end;
    }
    content += escapeSource(decoder.decode(bytes.subarray(cursor)));
  }
  return `${slice.startByte > 0 ? "[...] " : ""}${content}${slice.endByte < slice.originalLineBytes ? " [...]" : ""}`;
}
function escapeText(value: string): string {
  return escapeControls(value.replace(/\\/g, "\\\\"));
}
function escapeSource(value: string): string {
  return escapeControls(value, true);
}
function escapeControls(value: string, preserveTabs = false): string {
  return value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Escape terminal controls deliberately.
    /[\u0000-\u001f\u007f-\u009f]/g,
    (character) =>
      preserveTabs && character === "\t"
        ? character
        : `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  const prefix = text.match(/^ *(?:- )?/)?.[0] ?? "";
  const indent = " ".repeat(prefix.length);
  let current = prefix;
  for (const word of text.slice(prefix.length).split(" ")) {
    const hasWord = current.length > indent.length;
    if (hasWord && terminalWidth(`${current} ${word}`) > width) {
      lines.push(current);
      current = `${indent}${word}`;
    } else current = hasWord ? `${current} ${word}` : `${current}${word}`;
  }
  if (current) lines.push(current);
  return lines;
}
