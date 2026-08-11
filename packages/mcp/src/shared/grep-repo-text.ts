/**
 * Line-oriented text renderer for `code_grep` MCP responses.
 *
 * Designed for agent context efficiency: matches grouped by file,
 * `<line>: <content>` for matches and `<line>- <content>` for context
 * (standard grep -A/-B convention), no per-match scaffolding bytes.
 * Programmatic / parity callers stay on the JSON envelope by passing
 * `format: "json"`.
 *
 * ASCII-only output. Format is a public contract — locked with
 * snapshot-style tests in `grep-repo-text.test.ts`.
 */

import type {
  LeanGrepRepoEnvelope,
  LeanGrepRepoMatch,
} from "./grep-repo-response.js";
import { shellQuote } from "./shell-quote.js";
import {
  buildTargetResolutionNotes,
  formatTargetResolutionIdentity,
} from "./target-resolution.js";

const SEP = " | ";

interface RenderLine {
  lineNumber: number;
  content: string;
  isMatch: boolean;
}

interface RenderBlock {
  filePath: string;
  lines: RenderLine[];
}

export function renderGrepRepoText(envelope: LeanGrepRepoEnvelope): string {
  const lines: string[] = [];
  lines.push(buildHeader(envelope));
  lines.push("");

  if (envelope.matches.length === 0) {
    lines.push("No matches.");
    for (const note of buildEmptyGrepGuidance(envelope)) lines.push(note);
    return lines.join("\n");
  }

  const blocks = buildRenderBlocks(envelope.matches);
  const blocksByFile = groupBlocksByFile(blocks);
  const useContext = blocksHaveContext(blocks);
  const matchCountsByFile = countMatchesByFile(envelope.matches);

  let firstFile = true;
  for (const [filePath, fileBlocks] of blocksByFile) {
    if (!firstFile) lines.push("");
    firstFile = false;
    const matchCount = matchCountsByFile.get(filePath) ?? 0;
    lines.push(`${filePath} (${matchCount})`);
    fileBlocks.forEach((block, idx) => {
      if (useContext && idx > 0) lines.push("  --");
      const gutterWidth = widestLineNumberInBlock(block);
      for (const ln of block.lines) {
        lines.push(renderLine(ln, gutterWidth, useContext));
      }
    });
  }

  const trailer = buildTrailer(envelope);
  if (trailer.length > 0) {
    lines.push("");
    for (const t of trailer) lines.push(t);
  }

  return lines.join("\n");
}

/** Shared empty-result context used by MCP text and CLI terminal output. */
export function buildEmptyGrepGuidance(
  envelope: LeanGrepRepoEnvelope,
  surface: "mcp" | "cli" = "mcp",
): string[] {
  const lines = [formatEmptyGrepFileCounts(envelope)];
  const served = formatGrepServedTarget(envelope);
  if (served) lines.push(served);
  for (const note of buildTargetResolutionNotes(envelope.targetResolution)) {
    lines.push(note);
  }
  const skipNotes: string[] = [];
  if (envelope.binaryFilesSkipped) {
    skipNotes.push(`${envelope.binaryFilesSkipped} binary file(s) skipped`);
  }
  if (envelope.filesTooLargeSkipped) {
    skipNotes.push(
      `${envelope.filesTooLargeSkipped} oversized file(s) skipped`,
    );
  }
  if (skipNotes.length > 0) lines.push(`Note: ${skipNotes.join(", ")}.`);

  if (envelope.truncatedReason) {
    lines.push(
      surface === "cli"
        ? `Truncated: ${envelope.truncatedReason}. Narrow the file selectors or increase --limit.`
        : `Truncated: ${envelope.truncatedReason}. Pass narrower path/path_prefix/globs or increase max_matches.`,
    );
  }
  if (envelope.hasMore && envelope.nextCursor) {
    lines.push(
      surface === "cli"
        ? `More grep results available — rerun with --cursor ${shellQuote(envelope.nextCursor)}`
        : `More matches available. Pass cursor=${envelope.nextCursor} for the next page.`,
    );
  } else if (envelope.hasMore) {
    lines.push("More matches available.");
  }
  if (envelope.truncatedReason || envelope.hasMore) return lines;

  lines.push("Do not repeat this grep unchanged.");
  lines.push(
    envelope.filesInScope === 0
      ? "next: loosen path, path_prefix, globs, extensions, or exclusion filters."
      : "next: shorten or change the pattern, check casing, or use search for conceptual intent.",
  );
  return lines;
}

function formatEmptyGrepFileCounts(envelope: LeanGrepRepoEnvelope): string {
  if (envelope.filesScanned < envelope.filesInScope) {
    return `files: ${envelope.filesInScope} in scope | ${envelope.filesScanned} content-scanned after index pruning`;
  }
  return `files: ${envelope.filesScanned} scanned | ${envelope.filesInScope} in scope`;
}

function formatGrepServedTarget(
  envelope: LeanGrepRepoEnvelope,
): string | undefined {
  const resolved = formatTargetResolutionIdentity(
    envelope.targetResolution?.served,
  );
  if (resolved) {
    const state = envelope.targetResolution?.freshness;
    return `target: served=${resolved}${state ? ` | state=${state}` : ""}`;
  }
  const servedRef =
    envelope.indexedVersion ??
    envelope.resolution?.resolvedRef ??
    envelope.gitRef;
  return servedRef ? `target: served=${servedRef}` : undefined;
}

function buildHeader(envelope: LeanGrepRepoEnvelope): string {
  const parts = [
    `code_grep${SEP}${envelope.totalMatches} match${
      envelope.totalMatches === 1 ? "" : "es"
    } in ${envelope.uniqueFilesMatched} file${
      envelope.uniqueFilesMatched === 1 ? "" : "s"
    }`,
  ];
  parts.push(`pattern=${quote(envelope.pattern)}`);

  const flags: string[] = [];
  if (envelope.patternType === "regex") flags.push("regex");
  if (envelope.caseSensitive) flags.push("case-sensitive");
  if (flags.length > 0) parts.push(flags.join(","));

  return parts.join(SEP);
}

function buildTrailer(envelope: LeanGrepRepoEnvelope): string[] {
  const lines: string[] = [];

  if (envelope.truncatedReason) {
    lines.push(
      `Truncated: ${envelope.truncatedReason}. Pass narrower path/path_prefix/globs or increase max_matches.`,
    );
  }

  if (envelope.hasMore && envelope.nextCursor) {
    lines.push(
      `More matches available. Pass cursor=${envelope.nextCursor} for the next page.`,
    );
  } else if (envelope.hasMore) {
    lines.push("More matches available.");
  }

  // Skip-count notes are useful when something was excluded silently.
  const skipNotes: string[] = [];
  if (envelope.binaryFilesSkipped) {
    skipNotes.push(`${envelope.binaryFilesSkipped} binary file(s) skipped`);
  }
  if (envelope.filesTooLargeSkipped) {
    skipNotes.push(
      `${envelope.filesTooLargeSkipped} oversized file(s) skipped`,
    );
  }
  if (skipNotes.length > 0) {
    lines.push(`Note: ${skipNotes.join(", ")}.`);
  }

  for (const note of buildTargetResolutionNotes(envelope.targetResolution)) {
    lines.push(note);
  }

  return lines;
}

function buildRenderBlocks(matches: LeanGrepRepoMatch[]): RenderBlock[] {
  if (matches.length === 0) return [];

  const linesByFile = new Map<string, Map<number, RenderLine>>();
  for (const match of matches) {
    let lineMap = linesByFile.get(match.filePath);
    if (!lineMap) {
      lineMap = new Map<number, RenderLine>();
      linesByFile.set(match.filePath, lineMap);
    }

    const before = match.contextBefore ?? [];
    const beforeStart = match.line - before.length;
    for (let i = 0; i < before.length; i += 1) {
      const lineNumber = beforeStart + i;
      if (!lineMap.has(lineNumber)) {
        lineMap.set(lineNumber, {
          lineNumber,
          content: before[i] ?? "",
          isMatch: false,
        });
      }
    }

    // Match line: overwrite a previous context line at the same number
    // with a match (matches win over context).
    lineMap.set(match.line, {
      lineNumber: match.line,
      content: match.lineContent,
      isMatch: true,
    });

    const after = match.contextAfter ?? [];
    for (let i = 0; i < after.length; i += 1) {
      const lineNumber = match.line + i + 1;
      if (!lineMap.has(lineNumber)) {
        lineMap.set(lineNumber, {
          lineNumber,
          content: after[i] ?? "",
          isMatch: false,
        });
      }
    }
  }

  const blocks: RenderBlock[] = [];
  for (const [filePath, lineMap] of linesByFile) {
    const sorted = [...lineMap.values()].sort(
      (a, b) => a.lineNumber - b.lineNumber,
    );
    let current: RenderLine[] = [];
    for (const line of sorted) {
      const previous = current[current.length - 1];
      if (!previous || line.lineNumber === previous.lineNumber + 1) {
        current.push(line);
        continue;
      }
      blocks.push({ filePath, lines: current });
      current = [line];
    }
    if (current.length > 0) {
      blocks.push({ filePath, lines: current });
    }
  }
  return blocks;
}

function groupBlocksByFile(blocks: RenderBlock[]): Map<string, RenderBlock[]> {
  const map = new Map<string, RenderBlock[]>();
  for (const block of blocks) {
    const list = map.get(block.filePath) ?? [];
    list.push(block);
    map.set(block.filePath, list);
  }
  return map;
}

function blocksHaveContext(blocks: RenderBlock[]): boolean {
  for (const block of blocks) {
    for (const line of block.lines) {
      if (!line.isMatch) return true;
    }
  }
  return false;
}

function widestLineNumberInBlock(block: RenderBlock): number {
  let max = 0;
  for (const line of block.lines) {
    const len = String(line.lineNumber).length;
    if (len > max) max = len;
  }
  return max;
}

function countMatchesByFile(matches: LeanGrepRepoMatch[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of matches) {
    counts.set(match.filePath, (counts.get(match.filePath) ?? 0) + 1);
  }
  return counts;
}

function renderLine(
  line: RenderLine,
  gutterWidth: number,
  useContext: boolean,
): string {
  const gutter = String(line.lineNumber).padStart(gutterWidth, " ");
  // Standard grep -A/-B notation: `:` separator on match lines,
  // `-` on context lines. When there is no context anywhere in the
  // response, every line is a match — we still keep the colon so
  // the format is uniform.
  const sep = !useContext || line.isMatch ? ":" : "-";
  return `  ${gutter}${sep} ${line.content}`;
}

function quote(value: string): string {
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}
