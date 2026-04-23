import type { GrepRepoMatch, GrepRepoResult } from "../services/index.js";
import { colorize, dim } from "./colors.js";

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
}

export interface LeanGrepRepoEnvelope {
  registry?: string;
  name?: string;
  repoUrl?: string;
  gitRef?: string;
  pattern: string;
  patternType: "literal" | "regex";
  caseSensitive: boolean;
  matches: LeanGrepRepoMatch[];
  nextCursor?: string;
  hasMore: boolean;
  truncatedReason: string;
  routeTaken?: string;
  filesScanned: number;
  filesInScope: number;
  binaryFilesSkipped: number;
  filesTooLargeSkipped: number;
  totalMatches: number;
  uniqueFilesMatched: number;
  indexedVersion?: string;
  resolution?: LeanGrepRepoResolution;
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
  };
}

export function buildGrepRepoSuccessPayload(
  result: GrepRepoResult,
  options: BuildGrepRepoPayloadOptions,
): LeanGrepRepoEnvelope {
  const envelope: LeanGrepRepoEnvelope = {
    pattern: options.pattern,
    patternType: options.patternType,
    caseSensitive: options.caseSensitive,
    matches: result.matches.map(projectMatch),
    hasMore: result.hasMore,
    truncatedReason: result.truncatedReason.toLowerCase(),
    routeTaken: result.routeTaken?.toLowerCase(),
    filesScanned: result.filesScanned,
    filesInScope: result.filesInScope,
    binaryFilesSkipped: result.binaryFilesSkipped,
    filesTooLargeSkipped: result.filesTooLargeSkipped,
    totalMatches: result.totalMatches,
    uniqueFilesMatched: result.uniqueFilesMatched,
  };

  if (options.registry) envelope.registry = options.registry;
  if (options.name) envelope.name = options.name;
  if (options.repoUrl) envelope.repoUrl = options.repoUrl;
  if (options.gitRef) envelope.gitRef = options.gitRef;
  if (result.nextCursor) envelope.nextCursor = result.nextCursor;
  if (result.indexedVersion) envelope.indexedVersion = result.indexedVersion;
  if (result.resolution) {
    envelope.resolution = projectResolution(result.resolution);
  }

  const filter = buildFilterBlock(options);
  if (filter) envelope.filter = filter;
  return envelope;
}

function projectMatch(match: GrepRepoMatch): LeanGrepRepoMatch {
  return {
    filePath: match.filePath,
    line: match.line,
    matchStartByte: match.matchStartByte,
    matchEndByte: match.matchEndByte,
    lineContent: match.lineContent,
    contextBefore: match.contextBefore,
    contextAfter: match.contextAfter,
    fileContentHash: match.fileContentHash,
    fileIntent: match.fileIntent,
  };
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
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export interface FormatGrepRepoTerminalOptions {
  useColors: boolean;
  verbose?: boolean;
  withContext?: boolean;
}

export interface FormattedGrepRepoTerminal {
  stdout: string;
  stderr?: string;
}

interface RenderLine {
  lineNumber: number;
  content: string;
  isMatch: boolean;
}

interface RenderBlock {
  filePath: string;
  lines: RenderLine[];
}

export function formatGrepRepoTerminal(
  envelope: LeanGrepRepoEnvelope,
  options: FormatGrepRepoTerminalOptions,
): FormattedGrepRepoTerminal {
  if (envelope.matches.length === 0) {
    return { stdout: "" };
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
  const stdoutLines: string[] = [];
  const hasContext = blocks.some((block) =>
    block.lines.some((line) => !line.isMatch),
  );

  blocks.forEach((block, index) => {
    if (options.withContext && index > 0 && hasContext) {
      stdoutLines.push("--");
    }
    if (options.withContext) {
      stdoutLines.push(block.filePath);
    }
    for (const line of block.lines) {
      if (!options.withContext && !line.isMatch) continue;
      stdoutLines.push(
        renderPlainLine(block.filePath, line, options.withContext),
      );
    }
  });
  stdoutLines.push("");

  return {
    stdout: stdoutLines.join("\n"),
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

    lineMap.set(match.line, {
      lineNumber: match.line,
      content: match.lineContent,
      isMatch: true,
    });

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
  withContext = false,
): string {
  if (!withContext || line.isMatch) {
    return withContext
      ? `${line.lineNumber}:${line.content}`
      : `${filePath}:${line.lineNumber}:${line.content}`;
  }

  return `${line.lineNumber}-${line.content}`;
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
    return `${colorize(">", "bold", useColors)} ${gutter}  ${colorize(line.content, "bold", useColors)}`;
  }

  return `  ${dim(gutter, useColors)}  ${dim(line.content, useColors)}`;
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function padLeft(text: string, width: number): string {
  return text.length >= width
    ? text
    : `${" ".repeat(width - text.length)}${text}`;
}
