import type {
  GrepHit,
  GrepLineSlice,
  GrepReadAction,
  GrepResult,
  GrepTargetStatus,
} from "@githits/core-internal";
import { colors } from "./colors.js";
import { shellQuoteExact } from "./shell-quote.js";
import { terminalWidth } from "./terminal-width.js";

export interface GrepTextOptions {
  useColors?: boolean;
  width?: number;
  syntax?: "cli" | "mcp";
}
interface RenderLine {
  number: number;
  slice: GrepLineSlice;
  match: boolean;
}

/** Render one page, retaining source order, exact reads and coverage signals. */
export function formatGrepText(
  result: GrepResult,
  options: GrepTextOptions = {},
): string {
  const lines: string[] = [];
  const prose = (value: string): void => {
    lines.push(...wrap(escapeText(value), options.width ?? 80));
  };
  const title = `${result.totalMatches} match${result.totalMatches === 1 ? "" : "es"} in this page | ${result.traversal}`;
  prose(title);
  if (options.useColors) lines[0] = `${colors.bold}${lines[0]}${colors.reset}`;
  for (const scope of result.targets) {
    prose(
      `[${scope.targetIndex}] ${scope.target} | inputs ${scope.requestedInputIndices.join(", ")} | ${scope.readiness} / ${scope.traversal}${scope.corpus ? ` | corpus ${scope.corpus}` : ""}`,
    );
    if (scope.commitSha)
      prose(
        `  Served commit ${scope.commitSha}${scope.requestedRef ? `; requested ref ${scope.requestedRef}` : ""}`,
      );
    if (scope.filesScanned !== null || scope.filesInScope !== null)
      prose(
        `  Files scanned ${scope.filesScanned ?? "unknown"} / in scope ${scope.filesInScope ?? "unknown"}`,
      );
    if (
      scope.readiness !== "CURRENT" ||
      scope.traversal !== "COMPLETE" ||
      scope.errorCode
    )
      prose(
        `  Coverage: ${scope.errorCode ?? (scope.readiness === "UNSPECIFIED" ? "not visited in this page" : scope.readiness === "CURRENT" ? scope.traversal : scope.readiness)}; retryable ${scope.retryable}${scope.publicMessage ? `; ${scope.publicMessage}` : ""}`,
      );
    if (scope.binaryFilesSkipped)
      prose(`  Skipped ${scope.binaryFilesSkipped} binary file(s).`);
    if (scope.filesTooLargeSkipped)
      prose(`  Skipped ${scope.filesTooLargeSkipped} oversized file(s).`);
    for (const issue of scope.fileIssues ?? [])
      prose(
        `  File issue: ${issue.filePath}${issue.line > 0 ? `:${issue.line}` : " (aggregate)"} | ${issue.code}${issue.contentSafety.filtered ? " | safety normalization applied" : ""}`,
      );
    if (scope.fileIssuesOmitted)
      prose(`  ${scope.fileIssuesOmitted} additional file issue(s) omitted.`);
  }
  for (const omitted of result.unavailableTargets) {
    prose(
      `Unavailable input ${omitted.inputIndex}: ${omitted.target} | ${omitted.reason} | retryable ${omitted.retryable}`,
    );
    if (omitted.progressRef) prose(`  Progress: ${omitted.progressRef}`);
    for (const target of omitted.suggestedSiteTargets ?? [])
      prose(`  Suggested site: ${target}`);
  }
  if (result.hits.length === 0)
    prose(
      isExhaustive(result)
        ? "No matches."
        : "Zero returned matches; coverage is incomplete (see scope and omission details).",
    );
  for (const group of consecutiveGroups(result.hits)) {
    const first = group[0];
    if (!first) continue;
    lines.push("", `[${first.targetIndex}] ${escapeText(locator(first))}`);
    const rendered = new Map<number, RenderLine>();
    for (const hit of group) {
      hit.contextBeforeSlices.forEach((slice, index) => {
        addLine(
          rendered,
          hit.line - hit.contextBeforeSlices.length + index,
          slice,
          false,
        );
      });
      addLine(rendered, hit.line, hit.lineSlice, true);
      hit.contextAfterSlices.forEach((slice, index) => {
        addLine(rendered, hit.line + index + 1, slice, false);
      });
    }
    let previous: number | undefined;
    for (const line of [...rendered.values()].sort(
      (a, b) => a.number - b.number,
    )) {
      if (previous !== undefined && line.number > previous + 1)
        lines.push("  --");
      lines.push(
        `  ${line.number}${line.match ? ":" : "-"} ${renderSlice(line.slice)}`,
      );
      previous = line.number;
    }
    const actions = new Set(
      group.map((hit) => formatReadAction(hit.read, options.syntax ?? "cli")),
    );
    for (const action of actions) lines.push(`  Read: ${action}`);
    if (group.some((hit) => hit.contentSafety.filtered))
      prose(
        "  Safety normalization applied; physical source coordinates are retained in JSON.",
      );
  }
  if (result.nextCursor) {
    lines.push("");
    prose(
      "Continue with the same ordered targets and controls, using this cursor:",
    );
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
  if (result.targets.some((scope) => scope.kind === "SITE"))
    prose(
      "Hosted page reads use the latest active content; pages can change after this search.",
    );
  return lines.join("\n");
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
function consecutiveGroups(hits: GrepHit[]): GrepHit[][] {
  const groups: GrepHit[][] = [];
  let previousKey: string | undefined;
  let slices = new Map<number, GrepLineSlice>();
  for (const hit of hits) {
    const key = JSON.stringify([
      hit.targetIndex,
      hit.__typename,
      locator(hit),
      hit.read.target,
      hit.read.path,
    ]);
    const previousSlice = slices.get(hit.line);
    const differentWindow =
      previousSlice !== undefined &&
      (previousSlice.startByte !== hit.lineSlice.startByte ||
        previousSlice.endByte !== hit.lineSlice.endByte ||
        previousSlice.content !== hit.lineSlice.content);
    if (key !== previousKey || differentWindow) {
      groups.push([]);
      slices = new Map();
    }
    groups[groups.length - 1]?.push(hit);
    slices.set(hit.line, hit.lineSlice);
    previousKey = key;
  }
  return groups;
}
function addLine(
  lines: Map<number, RenderLine>,
  number: number,
  slice: GrepLineSlice,
  match: boolean,
): void {
  if (match || !lines.has(number)) lines.set(number, { number, slice, match });
}
function renderSlice(slice: GrepLineSlice): string {
  return `${slice.startByte > 0 ? "[...] " : ""}${escapeControls(slice.content)}${slice.endByte < slice.originalLineBytes ? " [...]" : ""}`;
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
function escapeControls(value: string): string {
  return value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Escape terminal controls deliberately.
    /[\u0000-\u001f\u007f-\u009f]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
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
