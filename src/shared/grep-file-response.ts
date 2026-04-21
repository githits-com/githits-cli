/**
 * Response envelope for `grep_file`. Shared across CLI `--json`
 * output and MCP `content[0].text`; terminal formatter is CLI-only.
 *
 * Key rules:
 * - **Data-first.** `matches` always present (possibly empty);
 *   `resolution` when backend returned one; `hint` when empty
 *   results carry a backend diagnostic.
 * - **No indexing metadata in the success envelope.** Service
 *   promotes `indexingStatus: INDEXING` to a typed error first.
 * - **`filter.*` echoes only caller-supplied inputs.**
 * - **Regex-char heuristic on empty results (terminal-only).** If
 *   the pattern looks like unambiguous regex AND zero matches,
 *   the terminal appends a nudge. JSON never carries this hint.
 */

import type { GrepFileResult, GrepMatch } from "../services/index.js";
import { colorize, dim } from "./colors.js";
import { looksLikeRegexAttempt } from "./grep-file-request.js";

export interface LeanGrepMatch {
  lineNumber: number;
  lineContent: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface LeanGrepResolution {
  requestedVersion?: string;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
}

export interface LeanGrepFilter {
  contextLines?: number;
  maxMatches?: number;
}

export interface LeanGrepFileEnvelope {
  registry?: string;
  name?: string;
  repoUrl?: string;
  gitRef?: string;
  pattern: string;
  /**
   * Resolved file path. Uses the backend's echoed path when
   * available, falling back to the caller's input. Single `path`
   * field (no `filePath` alongside) so the `list_files.files[].path`
   * → `grep_file({path})` / `read_file({path})` chain stays
   * mechanically consistent.
   */
  path: string;
  totalMatches: number;
  hasMore: boolean;
  language?: string;
  totalLines?: number;
  indexedVersion?: string;
  resolution?: LeanGrepResolution;
  matches: LeanGrepMatch[];
  hint?: string;
  filter?: LeanGrepFilter;
}

export interface BuildGrepFilePayloadOptions {
  registry?: string;
  name?: string;
  repoUrl?: string;
  gitRef?: string;
  pattern: string;
  path: string;
  contextLinesExplicit: boolean;
  maxMatchesExplicit: boolean;
  contextLines: number;
  maxMatches: number;
}

export function buildGrepFileSuccessPayload(
  result: GrepFileResult,
  options: BuildGrepFilePayloadOptions,
): LeanGrepFileEnvelope {
  const matches: LeanGrepMatch[] = result.matches.map((m) => projectMatch(m));

  const envelope: LeanGrepFileEnvelope = {
    pattern: options.pattern,
    // Prefer the backend's echoed path (may be normalised); fall
    // back to the caller's input so `path` is always present.
    path: result.filePath ?? options.path,
    totalMatches: result.totalMatches,
    hasMore: result.hasMore,
    matches,
  };

  if (options.registry) envelope.registry = options.registry;
  if (options.name) envelope.name = options.name;
  if (options.repoUrl) envelope.repoUrl = options.repoUrl;
  if (options.gitRef) envelope.gitRef = options.gitRef;
  if (result.language) envelope.language = result.language;
  if (result.totalLines != null) envelope.totalLines = result.totalLines;
  if (result.indexedVersion) envelope.indexedVersion = result.indexedVersion;
  if (result.resolution)
    envelope.resolution = projectResolution(result.resolution);
  if (result.hint) envelope.hint = result.hint;

  const filter = buildFilterBlock(options);
  if (filter) envelope.filter = filter;

  return envelope;
}

function projectMatch(match: GrepMatch): LeanGrepMatch {
  const lean: LeanGrepMatch = {
    lineNumber: match.lineNumber,
    lineContent: match.lineContent,
  };
  if (match.contextBefore && match.contextBefore.length > 0) {
    lean.contextBefore = match.contextBefore;
  }
  if (match.contextAfter && match.contextAfter.length > 0) {
    lean.contextAfter = match.contextAfter;
  }
  return lean;
}

function projectResolution(
  resolution: GrepFileResult["resolution"],
): LeanGrepResolution | undefined {
  if (!resolution) return undefined;
  const lean: LeanGrepResolution = {};
  if (resolution.requestedVersion)
    lean.requestedVersion = resolution.requestedVersion;
  if (resolution.requestedRef) lean.requestedRef = resolution.requestedRef;
  if (resolution.resolvedRef) lean.resolvedRef = resolution.resolvedRef;
  if (resolution.commitSha) lean.commitSha = resolution.commitSha;
  return Object.keys(lean).length > 0 ? lean : undefined;
}

function buildFilterBlock(
  options: BuildGrepFilePayloadOptions,
): LeanGrepFilter | undefined {
  const filter: LeanGrepFilter = {};
  if (options.contextLinesExplicit) filter.contextLines = options.contextLines;
  if (options.maxMatchesExplicit) filter.maxMatches = options.maxMatches;
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// --------------------------------------------------------------------
// Terminal formatter (CLI-only).
// --------------------------------------------------------------------

export interface FormatGrepFileTerminalOptions {
  useColors: boolean;
  /**
   * When `true`, render a contextual header plus a line-number gutter
   * (`>` marker on match lines). When `false` (default), emit matching
   * lines only, no header, no line numbers — pipe-friendly like
   * `grep` default output.
   */
  verbose?: boolean;
}

/**
 * Render result split into stdout (clean, pipeable payload) and
 * stderr (human-facing hints — truncation warnings, diagnostics).
 * Callers write each stream independently so plain-mode pipes
 * stay uncorrupted by informational text.
 */
export interface FormattedGrepFileTerminal {
  stdout: string;
  stderr?: string;
}

/**
 * Terminal rendering for `code grep`.
 *
 * Plain (default) mode mirrors `grep`'s default output: matching
 * lines printed as raw content, one per line, no header, no line
 * numbers. When `--context` is non-zero, context lines are included
 * in-line (still no line numbers) and distinct blocks are separated
 * by `--` in grep's convention.
 *
 * Verbose mode adds a contextual header, a right-aligned
 * line-number gutter, and a `>` marker on match lines to
 * distinguish them from context at a glance.
 *
 * Overlapping context blocks — two nearby matches whose contexts
 * touch or overlap — are merged into a single block so no line is
 * printed twice. This matches `grep -C` / `rg -C` behaviour.
 */
export function formatGrepFileTerminal(
  envelope: LeanGrepFileEnvelope,
  options: FormatGrepFileTerminalOptions,
): FormattedGrepFileTerminal {
  const verbose = options.verbose ?? false;

  if (envelope.matches.length === 0) {
    return formatNoMatches(envelope, options, verbose);
  }

  const blocks = mergeMatchBlocks(envelope.matches);

  if (!verbose) {
    return formatPlain(envelope, blocks, options);
  }
  return formatVerbose(envelope, blocks, options);
}

// --------------------------------------------------------------------
// Block merging.
// --------------------------------------------------------------------

interface RenderLine {
  lineNumber: number;
  content: string;
  isMatch: boolean;
}

/**
 * Flatten the per-match `{lineContent, contextBefore, contextAfter}`
 * shape into ordered, deduplicated blocks of lines. When two matches
 * sit close enough that their contexts overlap or touch, the
 * resulting lines merge into one block without duplicates — what
 * `grep -C` calls "merging adjacent context lines".
 */
export function mergeMatchBlocks(matches: LeanGrepMatch[]): RenderLine[][] {
  if (matches.length === 0) return [];

  const lineMap = new Map<number, RenderLine>();
  for (const match of matches) {
    const contextBefore = match.contextBefore ?? [];
    const beforeStart = match.lineNumber - contextBefore.length;
    for (let i = 0; i < contextBefore.length; i++) {
      const ln = beforeStart + i;
      if (!lineMap.has(ln)) {
        lineMap.set(ln, {
          lineNumber: ln,
          content: contextBefore[i] ?? "",
          isMatch: false,
        });
      }
    }
    // The match line always wins over a context entry at the same
    // line number (another match's contextBefore/contextAfter).
    lineMap.set(match.lineNumber, {
      lineNumber: match.lineNumber,
      content: match.lineContent,
      isMatch: true,
    });
    const contextAfter = match.contextAfter ?? [];
    for (let i = 0; i < contextAfter.length; i++) {
      const ln = match.lineNumber + 1 + i;
      if (!lineMap.has(ln)) {
        lineMap.set(ln, {
          lineNumber: ln,
          content: contextAfter[i] ?? "",
          isMatch: false,
        });
      }
    }
  }

  const sorted = [...lineMap.values()].sort(
    (a, b) => a.lineNumber - b.lineNumber,
  );

  const blocks: RenderLine[][] = [];
  let current: RenderLine[] = [];
  for (const line of sorted) {
    const last = current[current.length - 1];
    if (!last || line.lineNumber === last.lineNumber + 1) {
      current.push(line);
    } else {
      blocks.push(current);
      current = [line];
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

// --------------------------------------------------------------------
// Plain mode: matches only, optional merged context, no line numbers.
// --------------------------------------------------------------------

function formatPlain(
  envelope: LeanGrepFileEnvelope,
  blocks: RenderLine[][],
  options: FormatGrepFileTerminalOptions,
): FormattedGrepFileTerminal {
  const hasContext = blocks.some((block) =>
    block.some((line) => !line.isMatch),
  );

  const out: string[] = [];
  blocks.forEach((block, i) => {
    if (i > 0 && hasContext) {
      // `grep -C` separator between distinct blocks. Without context,
      // consecutive matches are printed as-is with no separator.
      out.push(dim("--", options.useColors));
    }
    for (const line of block) {
      out.push(line.content);
    }
  });

  // Trailing newline so output composes nicely in pipes / files.
  out.push("");

  const stderr: string[] = [];
  if (envelope.hasMore) {
    stderr.push(
      dim(
        "More matches available — pass --limit higher to fetch more.",
        options.useColors,
      ),
    );
  }

  return {
    stdout: out.join("\n"),
    stderr: stderr.length > 0 ? `${stderr.join("\n")}\n` : undefined,
  };
}

// --------------------------------------------------------------------
// Verbose mode: header + gutter + block separators.
// --------------------------------------------------------------------

function formatVerbose(
  envelope: LeanGrepFileEnvelope,
  blocks: RenderLine[][],
  options: FormatGrepFileTerminalOptions,
): FormattedGrepFileTerminal {
  const lines: string[] = [];
  lines.push(buildHeader(envelope, options));
  if (envelope.resolution || envelope.indexedVersion) {
    lines.push(buildResolutionLine(envelope, options));
  }
  lines.push("");

  const gutterWidth = widestLineNumberInBlocks(blocks);
  blocks.forEach((block, i) => {
    if (i > 0) lines.push(dim("--", options.useColors));
    for (const line of block) {
      lines.push(renderVerboseLine(line, gutterWidth, options));
    }
  });

  if (envelope.hasMore) {
    lines.push("");
    lines.push(
      dim(
        "More matches available — pass --limit higher to fetch more.",
        options.useColors,
      ),
    );
  }

  lines.push("");
  return { stdout: lines.join("\n") };
}

function renderVerboseLine(
  line: RenderLine,
  gutterWidth: number,
  options: FormatGrepFileTerminalOptions,
): string {
  const gutter = padLeft(String(line.lineNumber), gutterWidth);
  if (line.isMatch) {
    const marker = colorize(">", "bold", options.useColors);
    return `${marker} ${gutter}  ${colorize(line.content, "bold", options.useColors)}`;
  }
  return `  ${dim(gutter, options.useColors)}  ${dim(line.content, options.useColors)}`;
}

// --------------------------------------------------------------------
// Zero-match path.
// --------------------------------------------------------------------

function formatNoMatches(
  envelope: LeanGrepFileEnvelope,
  options: FormatGrepFileTerminalOptions,
  verbose: boolean,
): FormattedGrepFileTerminal {
  // Plain mode: match `grep`'s behaviour — silent on stdout, exit
  // code carries the "no match" signal. If the pattern looks like
  // a regex, write a single-line nudge to stderr so humans piping
  // see it without polluting the pipe.
  if (!verbose) {
    if (looksLikeRegexAttempt(envelope.pattern)) {
      return {
        stdout: "",
        stderr: `${dim("Note: pattern matched literally — this tool does case-insensitive substring search, not regex.", options.useColors)}\n`,
      };
    }
    return { stdout: "" };
  }

  const lines: string[] = [];
  lines.push(buildHeader(envelope, options));
  if (envelope.resolution || envelope.indexedVersion) {
    lines.push(buildResolutionLine(envelope, options));
  }
  lines.push("");

  if (envelope.hint) {
    lines.push(dim(envelope.hint, options.useColors));
  } else {
    lines.push(
      dim(
        `No matches for '${envelope.pattern}' in ${envelope.path}.`,
        options.useColors,
      ),
    );
  }
  if (looksLikeRegexAttempt(envelope.pattern)) {
    lines.push(
      dim(
        "If you intended regex syntax, note: this tool does literal substring matching.",
        options.useColors,
      ),
    );
  }
  lines.push("");
  return { stdout: lines.join("\n") };
}

// --------------------------------------------------------------------
// Header / identity helpers.
// --------------------------------------------------------------------

function buildHeader(
  envelope: LeanGrepFileEnvelope,
  options: FormatGrepFileTerminalOptions,
): string {
  const identity = buildIdentityLabel(envelope);
  const countLabel = envelope.hasMore
    ? `${envelope.matches.length}+ matches`
    : `${envelope.totalMatches} ${plural("match", "matches", envelope.totalMatches)}`;
  return colorize(
    `${identity} · ${countLabel} in ${envelope.path}`,
    "bold",
    options.useColors,
  );
}

function buildIdentityLabel(envelope: LeanGrepFileEnvelope): string {
  if (envelope.registry && envelope.name) {
    return `${envelope.name} · ${envelope.registry}`;
  }
  if (envelope.repoUrl) {
    return envelope.gitRef
      ? `${envelope.repoUrl} @ ${envelope.gitRef}`
      : envelope.repoUrl;
  }
  return "(unknown)";
}

function buildResolutionLine(
  envelope: LeanGrepFileEnvelope,
  options: FormatGrepFileTerminalOptions,
): string {
  const parts: string[] = [];
  const ref = envelope.resolution?.resolvedRef ?? envelope.indexedVersion;
  if (ref) parts.push(`indexed at ${ref}`);
  const commit = envelope.resolution?.commitSha;
  if (commit) parts.push(`commit ${commit.slice(0, 7)}`);
  return dim(parts.join(" · "), options.useColors);
}

function widestLineNumberInBlocks(blocks: RenderLine[][]): number {
  let max = 0;
  for (const block of blocks) {
    for (const line of block) {
      const w = String(line.lineNumber).length;
      if (w > max) max = w;
    }
  }
  return max;
}

function plural(singular: string, pluralForm: string, count: number): string {
  return count === 1 ? singular : pluralForm;
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}
