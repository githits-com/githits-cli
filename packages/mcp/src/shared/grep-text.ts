import type {
  GrepHit,
  GrepLineSlice,
  GrepReadAction,
  GrepResult,
  GrepTargetStatus,
} from "@githits/core-internal";
import { colors, highlightMatch } from "./colors.js";
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
        : "Zero returned matches; coverage is incomplete."
      : `${result.totalMatches} match${result.totalMatches === 1 ? "" : "es"} in ${matchingLines} line${matchingLines === 1 ? "" : "s"} across ${groups.length} ${noun}${result.nextCursor ? "; more available" : ""}`,
  );
  if (options.useColors) lines[0] = `${colors.bold}${lines[0]}${colors.reset}`;
  for (const scope of result.targets) renderCoverage(scope, prose);
  for (const omitted of result.unavailableTargets) {
    prose(
      `Unavailable input ${omitted.inputIndex}: ${omitted.target}; ${omitted.reason}${omitted.retryable ? "; retryable" : ""}`,
    );
    if (omitted.progressRef) prose(`  Progress: ${omitted.progressRef}`);
    for (const target of omitted.suggestedSiteTargets ?? [])
      prose(`  Suggested site: ${target}`);
  }

  const scopes = new Map(
    result.targets.map((scope) => [scope.targetIndex, scope]),
  );
  const groupedScopes = new Map<number, FileGroup[]>();
  for (const group of groups) {
    const scopeGroups = groupedScopes.get(group.first.targetIndex) ?? [];
    scopeGroups.push(group);
    groupedScopes.set(group.first.targetIndex, scopeGroups);
  }
  const recipes = new Map<string, GrepReadAction>();
  for (const [index, files] of groupedScopes) {
    // biome-ignore lint/style/noNonNullAssertion: Core validates every hit's physical scope.
    const scope = scopes.get(index)!;
    const corpus =
      scope.corpus === "SOURCE"
        ? " (source files)"
        : scope.corpus === "DOCUMENTATION"
          ? " (repository docs)"
          : "";
    lines.push("");
    prose(
      `${scope.kind === "REPOSITORY" ? "Repository" : "Hosted docs"}: ${scope.target}${corpus}`,
    );
    for (const group of files) {
      const first = group.first;
      lines.push("", escapeText(locator(first)));
      if (
        first.__typename === "GrepRepositoryHit" &&
        first.filePath !== first.read.path
      )
        lines.push(`Read path: ${escapeText(first.read.path)}`);
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
      const key = JSON.stringify([first.read.target, first.read.path !== null]);
      recipes.set(key, first.read);
      if (group.hits.some((hit) => hit.contentSafety.filtered))
        prose(
          "Safety normalization applied; physical source coordinates remain in JSON.",
        );
    }
  }
  if (recipes.size) {
    lines.push("");
    prose("Read recipes (replace placeholders):");
    for (const action of recipes.values())
      lines.push(`  ${formatReadRecipe(action, options.syntax ?? "cli")}`);
  }
  if (result.nextCursor) {
    lines.push("");
    prose("More matches: reuse the same ordered targets and controls with:");
    lines.push(
      options.syntax === "mcp"
        ? `  cursor=${JSON.stringify(result.nextCursor)}`
        : `  --cursor ${shellQuoteExact(result.nextCursor)}`,
    );
  }
  if (result.traversal === "CURSOR_EXPIRED")
    prose(
      "Cursor expired. Restart explicitly without the cursor; retained matches and omissions are shown above.",
    );
  else if (result.traversal !== "COMPLETE" && !result.nextCursor)
    prose("Traversal is incomplete and has no continuation cursor.");
  if (result.hits.some((hit) => hit.__typename === "GrepSiteHit"))
    prose(
      "Hosted page reads use current content; pages can change after this search.",
    );
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
function locator(hit: GrepHit): string {
  return hit.__typename === "GrepRepositoryHit" ? hit.filePath : hit.pageUrl;
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
function formatReadRecipe(
  action: GrepReadAction,
  syntax: "cli" | "mcp",
): string {
  if (syntax === "mcp")
    return `read target=${JSON.stringify(action.target)}${action.path !== null ? ' path="<read-path>"' : ""} start_line=<start> end_line=<end>`;
  return `githits read --lines '<start>-<end>' -- ${shellQuoteExact(action.target)}${action.path !== null ? " '<read-path>'" : ""}`;
}
/** Replay the backend action verbatim, using the caller's argument syntax. */
export function formatReadAction(
  action: GrepReadAction,
  syntax: "cli" | "mcp",
): string {
  if (syntax === "mcp")
    return `read target=${JSON.stringify(action.target)}${action.path !== null ? ` path=${JSON.stringify(action.path)}` : ""} start_line=${action.startLine} end_line=${action.endLine}`;
  if (action.target.startsWith("-") || action.path?.startsWith("-"))
    return `githits read --lines ${action.startLine}-${action.endLine} -- ${shellQuoteExact(action.target)}${action.path !== null ? ` ${shellQuoteExact(action.path)}` : ""}`;
  return `githits read ${shellQuoteExact(action.target)}${action.path !== null ? ` ${shellQuoteExact(action.path)}` : ""} --lines ${action.startLine}-${action.endLine}`;
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
