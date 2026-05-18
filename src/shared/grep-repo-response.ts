import type { GrepRepoMatch, GrepRepoResult } from "../services/index.js";
import { colorize, dim, highlightRanges } from "./colors.js";
import { shellQuote } from "./shell-quote.js";
import {
  buildTargetResolutionNotes,
  type LeanTargetResolution,
  projectTargetResolution,
} from "./target-resolution.js";

const UTF8_ENCODER = new TextEncoder();

export interface LeanGrepRepoMatch {
  filePath: string;
  line: number;
  matchStartByte: number;
  matchEndByte: number;
  lineContent: string;
  contextBefore?: string[];
  contextAfter?: string[];
  fileContentHash?: string;
  fileIntent?: string;
  symbol?: {
    symbolRef?: string;
    name?: string;
    qualifiedPath?: string;
    kind?: string;
    category?: string;
    arity?: number;
    isPublic?: boolean;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    code?: string;
    callerCount?: number;
    contentHash?: string;
    parentSymbolRef?: string;
    parentPath?: string;
  };
}

export interface LeanGrepRepoResolution {
  requestedVersion?: string;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
}

export interface LeanGrepRepoFilter {
  path?: string;
  pathPrefix?: string;
  globs?: string[];
  extensions?: string[];
  patternType?: "literal" | "regex";
  caseSensitive?: boolean;
  excludeDocFiles?: boolean;
  excludeTestFiles?: boolean;
  contextLines?: number;
  contextLinesBefore?: number;
  contextLinesAfter?: number;
  maxMatches?: number;
  maxMatchesPerFile?: number;
  cursor?: string;
  symbolFields?: string[];
}

export interface LeanGrepRepoEnvelope {
  registry?: string;
  name?: string;
  repoUrl?: string;
  gitRef?: string;
  pattern: string;
  patternType?: "literal" | "regex";
  caseSensitive?: boolean;
  matches: LeanGrepRepoMatch[];
  nextCursor?: string;
  hasMore: boolean;
  truncatedReason?: string;
  filesScanned: number;
  filesInScope: number;
  binaryFilesSkipped?: number;
  filesTooLargeSkipped?: number;
  totalMatches: number;
  uniqueFilesMatched: number;
  indexedVersion?: string;
  resolution?: LeanGrepRepoResolution;
  targetResolution?: LeanTargetResolution;
  filter?: LeanGrepRepoFilter;
}

export interface BuildGrepRepoPayloadOptions {
  registry?: string;
  name?: string;
  repoUrl?: string;
  gitRef?: string;
  pattern: string;
  patternType: "literal" | "regex";
  caseSensitive: boolean;
  path?: string;
  pathPrefix?: string;
  globs?: string[];
  extensions?: string[];
  contextLines?: number;
  contextLinesBefore: number;
  contextLinesAfter: number;
  maxMatches: number;
  maxMatchesPerFile?: number;
  cursor?: string;
  symbolFields?: string[];
  excludeDocFiles?: boolean;
  excludeTestFiles?: boolean;
  explicit: {
    path: boolean;
    pathPrefix: boolean;
    globs: boolean;
    extensions: boolean;
    patternType: boolean;
    caseSensitive: boolean;
    excludeDocFiles: boolean;
    excludeTestFiles: boolean;
    contextLines: boolean;
    contextLinesBefore: boolean;
    contextLinesAfter: boolean;
    maxMatches: boolean;
    maxMatchesPerFile: boolean;
    cursor: boolean;
    symbolFields: boolean;
  };
}

export function buildGrepRepoSuccessPayload(
  result: GrepRepoResult,
  options: BuildGrepRepoPayloadOptions,
): LeanGrepRepoEnvelope {
  const envelope: LeanGrepRepoEnvelope = {
    pattern: options.pattern,
    matches: result.matches.map(projectMatch),
    hasMore: result.hasMore,
    filesScanned: result.filesScanned,
    filesInScope: result.filesInScope,
    totalMatches: result.totalMatches,
    uniqueFilesMatched: result.uniqueFilesMatched,
  };

  if (options.patternType !== "literal") {
    envelope.patternType = options.patternType;
  }
  if (options.caseSensitive) envelope.caseSensitive = true;
  if (result.binaryFilesSkipped > 0) {
    envelope.binaryFilesSkipped = result.binaryFilesSkipped;
  }
  if (result.filesTooLargeSkipped > 0) {
    envelope.filesTooLargeSkipped = result.filesTooLargeSkipped;
  }
  if (result.truncatedReason && result.truncatedReason !== "NONE") {
    envelope.truncatedReason = result.truncatedReason.toLowerCase();
  }

  if (options.registry) envelope.registry = options.registry;
  if (options.name) envelope.name = options.name;
  if (options.repoUrl) envelope.repoUrl = options.repoUrl;
  if (options.gitRef) envelope.gitRef = options.gitRef;
  if (result.nextCursor) envelope.nextCursor = result.nextCursor;
  if (result.indexedVersion) envelope.indexedVersion = result.indexedVersion;
  if (result.resolution) {
    envelope.resolution = projectResolution(result.resolution);
  }
  const targetResolution = projectTargetResolution(result.targetResolution);
  if (targetResolution) envelope.targetResolution = targetResolution;

  const filter = buildFilterBlock(options);
  if (filter) envelope.filter = filter;
  return envelope;
}

function projectMatch(match: GrepRepoMatch): LeanGrepRepoMatch {
  const projected: LeanGrepRepoMatch = {
    filePath: match.filePath,
    line: match.line,
    matchStartByte: match.matchStartByte,
    matchEndByte: match.matchEndByte,
    lineContent: match.lineContent,
  };
  if (match.contextBefore && match.contextBefore.length > 0) {
    projected.contextBefore = match.contextBefore;
  }
  if (match.contextAfter && match.contextAfter.length > 0) {
    projected.contextAfter = match.contextAfter;
  }
  if (match.fileContentHash) projected.fileContentHash = match.fileContentHash;
  if (match.fileIntent) projected.fileIntent = match.fileIntent;
  if (match.symbol) projected.symbol = match.symbol;
  return projected;
}

function projectResolution(
  resolution: GrepRepoResult["resolution"],
): LeanGrepRepoResolution | undefined {
  if (!resolution) return undefined;
  const out: LeanGrepRepoResolution = {};
  if (resolution.requestedVersion)
    out.requestedVersion = resolution.requestedVersion;
  if (resolution.requestedRef) out.requestedRef = resolution.requestedRef;
  if (resolution.resolvedRef) out.resolvedRef = resolution.resolvedRef;
  if (resolution.commitSha) out.commitSha = resolution.commitSha;
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildFilterBlock(
  options: BuildGrepRepoPayloadOptions,
): LeanGrepRepoFilter | undefined {
  const filter: LeanGrepRepoFilter = {};
  if (options.explicit.path && options.path) filter.path = options.path;
  if (options.explicit.pathPrefix && options.pathPrefix) {
    filter.pathPrefix = options.pathPrefix;
  }
  if (options.explicit.globs && options.globs && options.globs.length > 0) {
    filter.globs = options.globs;
  }
  if (
    options.explicit.extensions &&
    options.extensions &&
    options.extensions.length > 0
  ) {
    filter.extensions = options.extensions;
  }
  if (options.explicit.patternType) filter.patternType = options.patternType;
  if (options.explicit.caseSensitive) {
    filter.caseSensitive = options.caseSensitive;
  }
  if (options.explicit.excludeDocFiles) {
    filter.excludeDocFiles = options.excludeDocFiles;
  }
  if (options.explicit.excludeTestFiles) {
    filter.excludeTestFiles = options.excludeTestFiles;
  }
  if (options.explicit.contextLines && options.contextLines !== undefined) {
    filter.contextLines = options.contextLines;
  }
  if (options.explicit.contextLinesBefore) {
    filter.contextLinesBefore = options.contextLinesBefore;
  }
  if (options.explicit.contextLinesAfter) {
    filter.contextLinesAfter = options.contextLinesAfter;
  }
  if (options.explicit.maxMatches) filter.maxMatches = options.maxMatches;
  if (
    options.explicit.maxMatchesPerFile &&
    options.maxMatchesPerFile !== undefined
  ) {
    filter.maxMatchesPerFile = options.maxMatchesPerFile;
  }
  if (options.explicit.cursor && options.cursor) filter.cursor = options.cursor;
  if (
    options.explicit.symbolFields &&
    options.symbolFields &&
    options.symbolFields.length > 0
  ) {
    filter.symbolFields = options.symbolFields;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export interface FormatGrepRepoTerminalOptions {
  useColors: boolean;
  verbose?: boolean;
  withContext?: boolean;
  headingStyle?: boolean;
}

export interface FormattedGrepRepoTerminal {
  stdout: string;
  stderr?: string;
}

interface RenderLine {
  lineNumber: number;
  content: string;
  isMatch: boolean;
  highlightRanges?: Array<readonly [number, number]>;
  symbolHint?: string;
}

interface RenderBlock {
  filePath: string;
  lines: RenderLine[];
}

export function formatGrepRepoTerminal(
  envelope: LeanGrepRepoEnvelope,
  options: FormatGrepRepoTerminalOptions,
): FormattedGrepRepoTerminal {
  if (envelope.matches.length === 0 && !options.verbose) {
    return {
      stdout: "",
      stderr: formatTerminalNotes(envelope, options.useColors),
    };
  }

  const blocks = buildRenderBlocks(envelope.matches);
  return options.verbose
    ? formatVerbose(envelope, blocks, options)
    : formatPlain(envelope, blocks, options);
}

function formatPlain(
  envelope: LeanGrepRepoEnvelope,
  blocks: RenderBlock[],
  options: FormatGrepRepoTerminalOptions,
): FormattedGrepRepoTerminal {
  if (options.headingStyle || options.withContext) {
    return formatHeadingPlain(envelope, blocks, options);
  }

  const stdoutLines: string[] = [];
  blocks.forEach((block) => {
    for (const line of block.lines) {
      if (!line.isMatch) continue;
      stdoutLines.push(
        renderPlainLine(block.filePath, line, options.useColors, false),
      );
    }
  });
  stdoutLines.push("");

  return {
    stdout: stdoutLines.join("\n"),
    stderr: formatTerminalNotes(envelope, options.useColors),
  };
}

function formatHeadingPlain(
  envelope: LeanGrepRepoEnvelope,
  blocks: RenderBlock[],
  options: FormatGrepRepoTerminalOptions,
): FormattedGrepRepoTerminal {
  const lines: string[] = [];
  const blocksByFile = groupBlocksByFile(blocks);
  const withContext = options.withContext ?? false;

  for (const [filePath, fileBlocks] of blocksByFile) {
    if (lines.length > 0) lines.push("");
    lines.push(filePath);
    fileBlocks.forEach((block, index) => {
      if (withContext && index > 0) lines.push("--");
      for (const line of block.lines) {
        if (!withContext && !line.isMatch) continue;
        lines.push(renderHeadingLine(line, withContext, options.useColors));
      }
    });
  }
  lines.push("");

  return {
    stdout: `${lines.join("\n")}`,
    stderr: formatTerminalNotes(envelope, options.useColors),
  };
}

function formatVerbose(
  envelope: LeanGrepRepoEnvelope,
  blocks: RenderBlock[],
  options: FormatGrepRepoTerminalOptions,
): FormattedGrepRepoTerminal {
  const lines: string[] = [];
  lines.push(
    colorize(
      `${formatCount(envelope.totalMatches, "match", "matches")} in ${formatCount(envelope.uniqueFilesMatched, "file")}`,
      "bold",
      options.useColors,
    ),
  );
  if (envelope.indexedVersion) {
    lines.push(dim(`Indexed ${envelope.indexedVersion}`, options.useColors));
  }
  lines.push("");

  const blocksByFile = groupBlocksByFile(blocks);
  if (blocksByFile.size === 0) {
    lines.push("No matches.");
    lines.push("");
  }

  for (const [filePath, fileBlocks] of blocksByFile) {
    lines.push(colorize(filePath, "bold", options.useColors));
    const gutterWidth = widestLineNumberInBlocks(fileBlocks);
    fileBlocks.forEach((block, index) => {
      if (index > 0) lines.push(dim("--", options.useColors));
      for (const line of block.lines) {
        lines.push(renderVerboseLine(line, gutterWidth, options.useColors));
      }
    });
    lines.push("");
  }

  return {
    stdout: `${lines.join("\n").trimEnd()}\n`,
    stderr: formatTerminalNotes(envelope, options.useColors),
  };
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

    const contextBefore = match.contextBefore ?? [];
    const beforeStart = match.line - contextBefore.length;
    for (let index = 0; index < contextBefore.length; index += 1) {
      const lineNumber = beforeStart + index;
      if (!lineMap.has(lineNumber)) {
        lineMap.set(lineNumber, {
          lineNumber,
          content: contextBefore[index] ?? "",
          isMatch: false,
        });
      }
    }

    const existingMatch = lineMap.get(match.line);
    if (existingMatch?.isMatch) {
      existingMatch.highlightRanges = mergeRanges(
        existingMatch.highlightRanges,
        [
          [
            clampCharacterOffset(match.lineContent, match.matchStartByte),
            clampCharacterOffset(match.lineContent, match.matchEndByte),
          ] as const,
        ],
      );
    } else {
      lineMap.set(match.line, {
        lineNumber: match.line,
        content: match.lineContent,
        isMatch: true,
        highlightRanges: [
          [
            clampCharacterOffset(match.lineContent, match.matchStartByte),
            clampCharacterOffset(match.lineContent, match.matchEndByte),
          ],
        ],
        symbolHint: formatSymbolHint(match.symbol),
      });
    }

    const contextAfter = match.contextAfter ?? [];
    for (let index = 0; index < contextAfter.length; index += 1) {
      const lineNumber = match.line + index + 1;
      if (!lineMap.has(lineNumber)) {
        lineMap.set(lineNumber, {
          lineNumber,
          content: contextAfter[index] ?? "",
          isMatch: false,
        });
      }
    }
  }

  const blocks: RenderBlock[] = [];
  for (const [filePath, lineMap] of linesByFile) {
    const sortedLines = [...lineMap.values()].sort(
      (left, right) => left.lineNumber - right.lineNumber,
    );

    let current: RenderLine[] = [];
    for (const line of sortedLines) {
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

function renderPlainLine(
  filePath: string,
  line: RenderLine,
  useColors: boolean,
  withContext = false,
): string {
  const content = line.isMatch
    ? highlightRanges(line.content, line.highlightRanges, useColors)
    : line.content;
  if (!withContext || line.isMatch) {
    return withContext
      ? `${line.lineNumber}:${content}`
      : `${filePath}:${line.lineNumber}:${content}`;
  }

  return `${line.lineNumber}-${content}`;
}

function renderHeadingLine(
  line: RenderLine,
  withContext: boolean,
  useColors: boolean,
): string {
  const content = line.isMatch
    ? highlightRanges(line.content, line.highlightRanges, useColors)
    : line.content;
  if (!withContext || line.isMatch) {
    return `${line.lineNumber}:${content}`;
  }

  return `${line.lineNumber}-${content}`;
}

function groupBlocksByFile(blocks: RenderBlock[]): Map<string, RenderBlock[]> {
  const grouped = new Map<string, RenderBlock[]>();
  for (const block of blocks) {
    const existing = grouped.get(block.filePath);
    if (existing) {
      existing.push(block);
      continue;
    }
    grouped.set(block.filePath, [block]);
  }
  return grouped;
}

function renderVerboseLine(
  line: RenderLine,
  gutterWidth: number,
  useColors: boolean,
): string {
  const gutter = padLeft(String(line.lineNumber), gutterWidth);
  if (line.isMatch) {
    const matchRow = `${colorize(">", "bold", useColors)} ${gutter}  ${highlightRanges(line.content, line.highlightRanges, useColors)}`;
    if (line.symbolHint) {
      const hintIndent = " ".repeat(2 + gutterWidth + 2);
      return `${matchRow}\n${hintIndent}${dim(`in: ${line.symbolHint}`, useColors)}`;
    }
    return matchRow;
  }

  return `  ${dim(gutter, useColors)}  ${dim(line.content, useColors)}`;
}

function formatSymbolHint(
  symbol: LeanGrepRepoMatch["symbol"],
): string | undefined {
  if (!symbol) return undefined;
  const primary = symbol.qualifiedPath ?? symbol.name;
  const parts: string[] = [];
  if (primary) parts.push(primary);
  if (symbol.kind) parts.push(`(${symbol.kind})`);
  if (symbol.isPublic === true) parts.push("public");
  if (symbol.arity !== undefined) parts.push(`arity=${symbol.arity}`);
  if (symbol.callerCount !== undefined) {
    parts.push(`callers=${symbol.callerCount}`);
  }
  if (symbol.startLine !== undefined && symbol.endLine !== undefined) {
    parts.push(`L${symbol.startLine}-${symbol.endLine}`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function widestLineNumberInBlocks(blocks: RenderBlock[]): number {
  let maxWidth = 1;
  for (const block of blocks) {
    for (const line of block.lines) {
      maxWidth = Math.max(maxWidth, String(line.lineNumber).length);
    }
  }
  return maxWidth;
}

function formatTerminalNotes(
  envelope: LeanGrepRepoEnvelope,
  useColors: boolean,
): string | undefined {
  const lines: string[] = [];

  if (shouldSuggestNarrowingScope(envelope)) {
    lines.push(
      dim(
        "Broad results — consider narrowing with a path prefix, --path, --glob, --ext, --exclude-docs, or --exclude-tests.",
        useColors,
      ),
    );
  }

  if (envelope.hasMore && envelope.nextCursor) {
    lines.push(
      dim(
        `More grep results available — rerun with --cursor ${shellQuote(envelope.nextCursor)}`,
        useColors,
      ),
    );
  }

  for (const note of buildTargetResolutionNotes(envelope.targetResolution)) {
    lines.push(dim(note, useColors));
  }

  if (lines.length === 0) return undefined;

  return `${lines.join("\n")}\n`;
}

function shouldSuggestNarrowingScope(envelope: LeanGrepRepoEnvelope): boolean {
  const filter = envelope.filter;
  const hasScopeFilter = Boolean(
    filter?.path ||
      filter?.pathPrefix ||
      (filter?.globs && filter.globs.length > 0) ||
      (filter?.extensions && filter.extensions.length > 0) ||
      filter?.excludeDocFiles ||
      filter?.excludeTestFiles,
  );

  return (
    !hasScopeFilter &&
    envelope.uniqueFilesMatched >= 5 &&
    envelope.matches.length >= 5
  );
}

function formatCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function padLeft(text: string, width: number): string {
  return text.length >= width
    ? text
    : `${" ".repeat(width - text.length)}${text}`;
}

function mergeRanges(
  existing: Array<readonly [number, number]> | undefined,
  incoming: Array<readonly [number, number]>,
): Array<readonly [number, number]> {
  const sorted = [...(existing ?? []), ...incoming]
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const merged: Array<readonly [number, number]> = [];
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || current[0] > previous[1]) {
      merged.push(current);
      continue;
    }
    merged[merged.length - 1] = [
      previous[0],
      Math.max(previous[1], current[1]),
    ];
  }

  return merged;
}

function clampCharacterOffset(text: string, offset: number): number {
  if (offset <= 0) return 0;

  let byteOffset = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const nextByteOffset = byteOffset + UTF8_ENCODER.encode(char).length;
    if (nextByteOffset > offset) return index;
    byteOffset = nextByteOffset;
    index += char.length;
  }

  return text.length;
}
