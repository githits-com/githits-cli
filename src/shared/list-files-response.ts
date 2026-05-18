/**
 * Response envelope for the `list_files` tool. Shared across CLI
 * `--json` output and MCP `content[0].text`. Terminal formatter is
 * CLI-only; both surfaces read the same envelope shape.
 *
 * Design commitments (match the shipped pkg-intel envelope playbook):
 *
 * - **Data-first.** `files` is always present (possibly empty);
 *   `resolution` appears whenever the backend returned one; `hint`
 *   appears when empty results carry a backend diagnostic.
 * - **No indexing metadata in the success envelope.** The service
 *   layer promotes `codeIndexState: INDEXING` to a typed error
 *   before the envelope builder runs, so agents never branch on a
 *   data-path indexing flag.
 * - **`filter.*` echoes only caller-supplied inputs.** The default
 *   limit (200) is not echoed; explicit selectors / filters are.
 */

import type { ListFilesResult, RepoFileEntry } from "../services/index.js";
import { colorize, dim } from "./colors.js";
import {
  buildTargetResolutionNotes,
  type LeanTargetResolution,
  projectTargetResolution,
} from "./target-resolution.js";

export interface LeanRepoFileEntry {
  path: string;
  name?: string;
  language?: string;
  fileType?: string;
  byteSize?: number;
}

export interface LeanListFilesResolution {
  requestedVersion?: string;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
}

export interface LeanListFilesFilter {
  path?: string;
  pathPrefix?: string;
  globs?: string[];
  extensions?: string[];
  fileTypes?: string[];
  languages?: string[];
  fileIntent?: string;
  fileIntents?: string[];
  excludeFileIntents?: string[];
  excludeDocFiles?: boolean;
  excludeTestFiles?: boolean;
  includeHidden?: boolean;
  limit?: number;
}

export interface LeanListFilesEnvelope {
  /** Present for spec addressing. */
  registry?: string;
  /** Present for spec addressing. */
  name?: string;
  /** Present for repo-URL addressing. */
  repoUrl?: string;
  gitRef?: string;
  /** Resolved backend version tag / commit. Always present when the
   *  backend returned a resolution block. */
  indexedVersion?: string;
  resolution?: LeanListFilesResolution;
  targetResolution?: LeanTargetResolution;
  total: number;
  hasMore: boolean;
  files: LeanRepoFileEntry[];
  /** Backend diagnostic (e.g. "No files match this path prefix.")
   *  when the result set is empty. */
  hint?: string;
  /** Caller's explicit filter inputs; default values never echo. */
  filter?: LeanListFilesFilter;
}

export interface BuildListFilesPayloadOptions {
  /** Caller's addressing echo. */
  registry?: string;
  name?: string;
  repoUrl?: string;
  gitRef?: string;
  /** Caller's raw inputs, echoed under `filter.*` when explicit. */
  path?: string;
  pathPrefix?: string;
  globs?: string[];
  extensions?: string[];
  fileTypes?: string[];
  languages?: string[];
  fileIntent?: string;
  fileIntents?: string[];
  excludeFileIntents?: string[];
  excludeDocFiles?: boolean;
  excludeTestFiles?: boolean;
  includeHidden?: boolean;
  limit?: number;
  explicit: {
    path: boolean;
    pathPrefix: boolean;
    globs: boolean;
    extensions: boolean;
    fileTypes: boolean;
    languages: boolean;
    fileIntent: boolean;
    fileIntents: boolean;
    excludeFileIntents: boolean;
    excludeDocFiles: boolean;
    excludeTestFiles: boolean;
    includeHidden: boolean;
    limit: boolean;
  };
}

export function buildListFilesSuccessPayload(
  result: ListFilesResult,
  options: BuildListFilesPayloadOptions,
): LeanListFilesEnvelope {
  const files: LeanRepoFileEntry[] = result.files.map((entry) =>
    projectEntry(entry),
  );

  const envelope: LeanListFilesEnvelope = {
    total: result.total,
    hasMore: result.hasMore,
    files,
  };

  if (options.registry) envelope.registry = options.registry;
  if (options.name) envelope.name = options.name;
  if (options.repoUrl) envelope.repoUrl = options.repoUrl;
  if (options.gitRef) envelope.gitRef = options.gitRef;
  if (result.indexedVersion) envelope.indexedVersion = result.indexedVersion;
  if (result.resolution)
    envelope.resolution = projectResolution(result.resolution);
  const targetResolution = projectTargetResolution(result.targetResolution);
  if (targetResolution) envelope.targetResolution = targetResolution;
  if (result.hint) envelope.hint = result.hint;

  const filter = buildFilterBlock(options);
  if (filter) envelope.filter = filter;

  return envelope;
}

function projectEntry(entry: RepoFileEntry): LeanRepoFileEntry {
  const lean: LeanRepoFileEntry = { path: entry.path };
  if (entry.name != null) lean.name = entry.name;
  if (entry.language != null) lean.language = entry.language;
  if (entry.fileType != null) lean.fileType = entry.fileType;
  if (entry.byteSize != null) lean.byteSize = entry.byteSize;
  return lean;
}

function projectResolution(
  resolution: ListFilesResult["resolution"],
): LeanListFilesResolution | undefined {
  if (!resolution) return undefined;
  const lean: LeanListFilesResolution = {};
  if (resolution.requestedVersion)
    lean.requestedVersion = resolution.requestedVersion;
  if (resolution.requestedRef) lean.requestedRef = resolution.requestedRef;
  if (resolution.resolvedRef) lean.resolvedRef = resolution.resolvedRef;
  if (resolution.commitSha) lean.commitSha = resolution.commitSha;
  return Object.keys(lean).length > 0 ? lean : undefined;
}

function buildFilterBlock(
  options: BuildListFilesPayloadOptions,
): LeanListFilesFilter | undefined {
  const filter: LeanListFilesFilter = {};
  if (options.explicit.path && options.path) {
    filter.path = options.path;
  }
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
  if (
    options.explicit.fileTypes &&
    options.fileTypes &&
    options.fileTypes.length > 0
  ) {
    filter.fileTypes = options.fileTypes;
  }
  if (
    options.explicit.languages &&
    options.languages &&
    options.languages.length > 0
  ) {
    filter.languages = options.languages;
  }
  if (options.explicit.fileIntent && options.fileIntent) {
    filter.fileIntent = options.fileIntent;
  }
  if (
    options.explicit.fileIntents &&
    options.fileIntents &&
    options.fileIntents.length > 0
  ) {
    filter.fileIntents = options.fileIntents;
  }
  if (
    options.explicit.excludeFileIntents &&
    options.excludeFileIntents &&
    options.excludeFileIntents.length > 0
  ) {
    filter.excludeFileIntents = options.excludeFileIntents;
  }
  if (options.explicit.excludeDocFiles) {
    filter.excludeDocFiles = options.excludeDocFiles;
  }
  if (options.explicit.excludeTestFiles) {
    filter.excludeTestFiles = options.excludeTestFiles;
  }
  if (options.explicit.includeHidden) {
    filter.includeHidden = options.includeHidden;
  }
  if (options.explicit.limit && options.limit !== undefined) {
    filter.limit = options.limit;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// --------------------------------------------------------------------
// Terminal formatter (CLI-only).
// --------------------------------------------------------------------

export interface FormatListFilesTerminalOptions {
  verbose?: boolean;
  useColors: boolean;
}

/**
 * Render result split into stdout (clean, pipeable payload) and
 * stderr (human-facing hints — truncation warnings, diagnostics).
 * Callers write each stream independently so plain-mode pipes
 * stay uncorrupted by informational text.
 */
export interface FormattedListFilesTerminal {
  stdout: string;
  stderr?: string;
}

export function formatListFilesTerminal(
  envelope: LeanListFilesEnvelope,
  options: FormatListFilesTerminalOptions,
): FormattedListFilesTerminal {
  const verbose = options.verbose ?? false;

  if (envelope.files.length === 0) {
    return formatEmpty(envelope, options, verbose);
  }

  if (verbose) {
    return formatVerbose(envelope, options);
  }
  return formatPlain(envelope, options);
}

function formatPlain(
  envelope: LeanListFilesEnvelope,
  options: FormatListFilesTerminalOptions,
): FormattedListFilesTerminal {
  const stdoutLines: string[] = [];
  for (const file of envelope.files) {
    stdoutLines.push(file.path);
  }
  stdoutLines.push("");

  const stderrLines: string[] = [];
  if (envelope.hasMore) {
    stderrLines.push(
      dim(
        "More files available — pass --limit higher to fetch more.",
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
  envelope: LeanListFilesEnvelope,
  options: FormatListFilesTerminalOptions,
): FormattedListFilesTerminal {
  const lines: string[] = [];
  lines.push(buildSummaryHeader(envelope, options));
  if (envelope.resolution || envelope.indexedVersion) {
    lines.push(buildResolutionLine(envelope, options));
  }
  appendTargetResolutionNotes(lines, envelope, options);
  lines.push("");

  const pathWidth = longestPathLength(envelope.files);
  for (const file of envelope.files) {
    lines.push(formatVerboseFileRow(file, pathWidth, options));
  }

  if (envelope.hasMore) {
    lines.push("");
    lines.push(
      dim(
        "More files available — pass --limit higher to fetch more.",
        options.useColors,
      ),
    );
  }

  if (envelope.hint) {
    lines.push("");
    lines.push(dim(envelope.hint, options.useColors));
  }

  lines.push("");
  return { stdout: lines.join("\n") };
}

function formatEmpty(
  envelope: LeanListFilesEnvelope,
  options: FormatListFilesTerminalOptions,
  verbose: boolean,
): FormattedListFilesTerminal {
  const hint = envelope.hint ?? "No files match the requested path prefix.";
  if (!verbose) {
    // Plain-mode stdout stays empty so pipes don't see hint text.
    // The hint goes to stderr — humans still see it, downstream
    // tools don't.
    return { stdout: "", stderr: `${dim(hint, options.useColors)}\n` };
  }
  const lines: string[] = [];
  lines.push(buildSummaryHeader(envelope, options));
  if (envelope.resolution || envelope.indexedVersion) {
    lines.push(buildResolutionLine(envelope, options));
  }
  appendTargetResolutionNotes(lines, envelope, options);
  lines.push("");
  lines.push(dim(hint, options.useColors));
  lines.push("");
  return { stdout: lines.join("\n") };
}

function buildSummaryHeader(
  envelope: LeanListFilesEnvelope,
  options: FormatListFilesTerminalOptions,
): string {
  const identity = buildIdentityLabel(envelope);
  // Backend reports `total` as the count actually returned (capped
  // by `limit`), not the true matching count. When `hasMore: true`
  // we can't surface a real total, so render as `N+ files` to make
  // the truncation obvious.
  const countValue = envelope.hasMore
    ? `${envelope.files.length}+`
    : String(envelope.total);
  const counts = `${countValue} ${plural("file", "files", envelope.files.length)}`;
  return colorize(`${identity} · ${counts}`, "bold", options.useColors);
}

function buildResolutionLine(
  envelope: LeanListFilesEnvelope,
  options: FormatListFilesTerminalOptions,
): string {
  const parts: string[] = [];
  const ref = envelope.resolution?.resolvedRef ?? envelope.indexedVersion;
  if (ref) parts.push(`indexed at ${ref}`);
  const commit = envelope.resolution?.commitSha;
  if (commit) parts.push(`commit ${commit.slice(0, 7)}`);
  return dim(parts.join(" · "), options.useColors);
}

function appendTargetResolutionNotes(
  lines: string[],
  envelope: LeanListFilesEnvelope,
  options: FormatListFilesTerminalOptions,
): void {
  const notes = buildTargetResolutionNotes(envelope.targetResolution);
  for (const note of notes) lines.push(dim(note, options.useColors));
}

function buildIdentityLabel(envelope: LeanListFilesEnvelope): string {
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

function formatVerboseFileRow(
  file: LeanRepoFileEntry,
  pathWidth: number,
  options: FormatListFilesTerminalOptions,
): string {
  const annotations: string[] = [];
  if (file.language) annotations.push(file.language);
  if (file.fileType) annotations.push(file.fileType);
  if (file.byteSize != null) annotations.push(humanBytes(file.byteSize));
  const annotation = annotations.length
    ? dim(`· ${annotations.join(" · ")}`, options.useColors)
    : "";
  const paddedPath = padRight(file.path, pathWidth);
  return `${paddedPath}  ${annotation}`.trimEnd();
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(singular: string, pluralForm: string, count: number): string {
  return count === 1 ? singular : pluralForm;
}

function longestPathLength(entries: LeanRepoFileEntry[]): number {
  let max = 0;
  for (const entry of entries) {
    if (entry.path.length > max) max = entry.path.length;
  }
  return max;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}
