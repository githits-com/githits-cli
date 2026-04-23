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

export function formatGrepRepoTerminal(
  envelope: LeanGrepRepoEnvelope,
  options: FormatGrepRepoTerminalOptions,
): FormattedGrepRepoTerminal {
  if (envelope.matches.length === 0) {
    return { stdout: "" };
  }

  return options.verbose
    ? formatVerbose(envelope, options)
    : formatPlain(envelope, options);
}

function formatPlain(
  envelope: LeanGrepRepoEnvelope,
  options: FormatGrepRepoTerminalOptions,
): FormattedGrepRepoTerminal {
  const stdoutLines: string[] = [];
  for (const match of envelope.matches) {
    if (options.withContext) {
      for (const line of match.contextBefore ?? [])
        stdoutLines.push(`-${line}`);
      stdoutLines.push(`${match.filePath}:${match.line}:${match.lineContent}`);
      for (const line of match.contextAfter ?? []) stdoutLines.push(`+${line}`);
      stdoutLines.push("--");
      continue;
    }
    stdoutLines.push(`${match.filePath}:${match.line}:${match.lineContent}`);
  }
  if (stdoutLines[stdoutLines.length - 1] === "--") stdoutLines.pop();
  stdoutLines.push("");

  const stderrLines: string[] = [];
  if (envelope.hasMore && envelope.nextCursor) {
    stderrLines.push(
      dim(
        "More grep results available — pass --cursor with the returned nextCursor to continue.",
        options.useColors,
      ),
    );
  }

  return {
    stdout: stdoutLines.join("\n"),
    stderr: stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : undefined,
  };
}

function formatVerbose(
  envelope: LeanGrepRepoEnvelope,
  options: FormatGrepRepoTerminalOptions,
): FormattedGrepRepoTerminal {
  const lines: string[] = [];
  lines.push(
    colorize(
      `${envelope.totalMatches} match(es) in ${envelope.uniqueFilesMatched} file(s)`,
      "bold",
      options.useColors,
    ),
  );
  if (envelope.indexedVersion) {
    lines.push(dim(`indexed ${envelope.indexedVersion}`, options.useColors));
  }
  lines.push("");
  for (const match of envelope.matches) {
    lines.push(
      colorize(`${match.filePath}:${match.line}`, "bold", options.useColors),
    );
    for (const line of match.contextBefore ?? []) lines.push(`  ${line}`);
    lines.push(`> ${match.lineContent}`);
    for (const line of match.contextAfter ?? []) lines.push(`  ${line}`);
    lines.push("");
  }

  const stderrLines: string[] = [];
  if (envelope.hasMore && envelope.nextCursor) {
    stderrLines.push(
      dim(
        "More grep results available — pass --cursor with the returned nextCursor to continue.",
        options.useColors,
      ),
    );
  }
  return {
    stdout: `${lines.join("\n").trimEnd()}\n`,
    stderr: stderrLines.length > 0 ? `${stderrLines.join("\n")}\n` : undefined,
  };
}
