import type {
  DiscoveryIndexingEstimate,
  GrepHit,
  GrepLineSlice,
  GrepResult,
  GrepTargetStatus,
} from "@githits/core-internal";
import { colors, dim, highlightMatch } from "./colors.js";
import { grepPreparationReason } from "./grep-preparation-text.js";
import {
  formatIndexingEstimate,
  renderIndexingEstimates,
} from "./indexing-estimates-text.js";
import { indexingWaitMs } from "./indexing-wait.js";
import { formatRepositoryTarget } from "./repository-target.js";
import { shellQuoteExact } from "./shell-quote.js";
import { terminalWidth } from "./terminal-width.js";

export interface GrepTextOptions {
  useColors?: boolean;
  width?: number;
  syntax?: "cli" | "mcp";
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
    result.targets.every((scope) => !hasCoverageGap(scope)) &&
    result.traversal !== "FAILED" &&
    result.traversal !== "CURSOR_EXPIRED";
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
    result.hits.length === 0
      ? isExhaustive(result)
        ? "No matches."
        : retryableOmissionsOnly
          ? "No matches yet."
          : "Zero returned matches; coverage is incomplete."
      : `${result.totalMatches} match${result.totalMatches === 1 ? "" : "es"} in ${matchingLines} line${matchingLines === 1 ? "" : "s"} across ${groups.length} ${noun}${result.nextCursor ? "; more available" : ""}`,
  );
  if (options.useColors) lines[0] = `${colors.bold}${lines[0]}${colors.reset}`;
  if (groups.length) {
    lines.push("");
    const matchedScopes = new Set(result.hits.map((hit) => hit.targetIndex));
    prose(
      `Sources: ${formatSources(result.targets.filter((scope) => matchedScopes.has(scope.targetIndex)))}`,
    );
  }
  const combinedEstimates = new Set<DiscoveryIndexingEstimate>();
  for (const omitted of result.unavailableTargets) {
    const kind =
      omitted.reason === "repository_indexing"
        ? "REPOSITORY"
        : omitted.reason === "documentation_publishing"
          ? "DOCUMENTATION"
          : undefined;
    const estimates = (result.indexingEstimates ?? []).filter(
      (entry) => entry.kind === kind && entry.targets.includes(omitted.target),
    );
    for (const entry of estimates) combinedEstimates.add(entry);
    prose(
      `Omitted: ${omitted.target}${result.unavailableTargets.filter((target) => target.target === omitted.target).length > 1 ? ` (input ${omitted.inputIndex})` : ""} (${kind === "REPOSITORY" ? "indexing" : grepPreparationReason(omitted.reason)}${estimates.length ? `, ${estimates.map((entry) => formatIndexingEstimate(entry, "compact")).join("; ")}` : ""})`,
    );
    for (const target of omitted.suggestedSiteTargets ?? [])
      prose(`  Suggested site: ${target}`);
  }
  for (const estimate of renderIndexingEstimates(
    result.indexingEstimates?.filter((entry) => !combinedEstimates.has(entry)),
  ))
    prose(estimate);
  for (const scope of result.targets) renderCoverage(scope, prose);

  if (groups.length) {
    if (kinds.has("GrepRepositoryHit"))
      lines.push(
        dim(
          options.syntax === "mcp"
            ? "# Read files: read target=$target path=$path start_line=$start end_line=$end"
            : "# Read files: read --lines $start-$end -- $target $path",
          options.useColors === true,
        ),
      );
    if (kinds.has("GrepSiteHit"))
      lines.push(
        dim(
          options.syntax === "mcp"
            ? "# Read pages: read target=$url start_line=$start end_line=$end"
            : "# Read pages: read --lines $start-$end -- $url",
          options.useColors === true,
        ),
      );
  }
  if (result.traversal === "CURSOR_EXPIRED")
    prose(
      "Cursor expired. Restart explicitly without the cursor; retained matches and omissions are included.",
    );
  else if (
    result.traversal !== "COMPLETE" &&
    !result.nextCursor &&
    !omissionsOnly
  )
    prose("Traversal is incomplete and has no continuation cursor.");
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
  if (result.nextCursor) {
    const footerLines = [
      ...wrap(
        escapeText("More matches: repeat this grep, adding:"),
        options.width ?? 80,
      ),
      options.syntax === "mcp"
        ? `  cursor=${JSON.stringify(result.nextCursor)}`
        : `  --cursor ${shellQuoteExact(result.nextCursor)}`,
    ];
    lines.push(
      "",
      ...footerLines.map((line) => dim(line, options.useColors === true)),
    );
  }
  if (result.unavailableTargets.some((target) => target.retryable)) {
    const wait = indexingWaitMs(result.indexingEstimates);
    lines.push("");
    prose(
      `To retry omitted targets, rerun the original query with ${options.syntax === "mcp" ? `wait_timeout_ms=${wait}` : `--wait ${wait}`}.`,
    );
  }
  return lines.join("\n");
}

function renderCoverage(
  scope: GrepTargetStatus,
  prose: (value: string) => void,
): void {
  const prefix = `${scope.kind === "REPOSITORY" ? "Repository" : "Hosted docs"} ${scope.target} (inputs ${scope.requestedInputIndices.join(", ")})`;
  const notes: string[] = [];
  if (scope.readiness === "UNSPECIFIED") notes.push("not visited in this page");
  else if (scope.readiness !== "CURRENT") notes.push(readinessNote(scope));
  if (scope.traversal !== "COMPLETE" && scope.traversal !== "RESUMABLE_LIMIT")
    notes.push(traversalNote(scope));
  if (scope.errorCode) notes.push(scope.errorCode);
  if (scope.publicMessage) notes.push(scope.publicMessage);
  const details: string[] = [];
  if (notes.length) {
    if (scope.retryable) notes.push("retryable");
    if (scope.readiness === "STALE" && scope.commitSha)
      details.push(
        `Served ${scope.commitSha}${scope.requestedRef ? `; requested ${scope.requestedRef}` : ""}.`,
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
    prose(`${prefix}:${notes.length ? ` ${notes.join("; ")}.` : ""}`);
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
function hasCoverageGap(scope: GrepTargetStatus): boolean {
  return (
    scope.readiness !== "CURRENT" ||
    scope.traversal !== "COMPLETE" ||
    scope.errorCode !== null ||
    Boolean(
      scope.binaryFilesSkipped ||
        scope.filesTooLargeSkipped ||
        scope.fileIssues?.length ||
        scope.fileIssuesOmitted,
    )
  );
}
function formatSources(scopes: GrepTargetStatus[]): string {
  const sources = new Set<string>();
  for (const scope of scopes) {
    if (scope.kind === "SITE" && scope.canonicalSite)
      sources.add(
        `site:${scope.canonicalSite.replace(/^https?:\/\//i, "").replace(/\/$/, "")} (hosted documentation)`,
      );
    if (scope.kind === "REPOSITORY" && scope.repoUrl && scope.commitSha) {
      const corpus =
        scope.corpus === "SOURCE"
          ? " (source files)"
          : scope.corpus === "DOCUMENTATION"
            ? " (repository docs)"
            : "";
      // A named ref and a SHA can identify the same snapshot. Compare commit IDs.
      const requested =
        scope.requestedRef &&
        /^[a-f0-9]{40}$/i.test(scope.requestedRef) &&
        scope.requestedRef.toLowerCase() !== scope.commitSha.toLowerCase()
          ? ` (requested: ${scope.target})`
          : "";
      sources.add(
        `${formatRepositoryTarget(scope.repoUrl, scope.commitSha.slice(0, 8))}${corpus}${requested}`,
      );
    }
    if (
      (scope.kind === "SITE" && !scope.canonicalSite) ||
      (scope.kind === "REPOSITORY" && (!scope.repoUrl || !scope.commitSha))
    )
      sources.add(scope.target);
  }
  return [...sources]
    .sort(
      (a, b) => Number(b.startsWith("site:")) - Number(a.startsWith("site:")),
    )
    .join(", ");
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
  const indent = text.match(/^ */)?.[0] ?? "";
  let current = indent;
  for (const word of text.trimStart().split(" ")) {
    const hasWord = current.length > indent.length;
    if (hasWord && terminalWidth(`${current} ${word}`) > width) {
      lines.push(current);
      current = `${indent}${word}`;
    } else current = hasWord ? `${current} ${word}` : `${indent}${word}`;
  }
  if (current) lines.push(current);
  return lines;
}
