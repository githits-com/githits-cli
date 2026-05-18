/**
 * Response envelope for `read_file`. Shared across CLI `--json` and
 * MCP `content[0].text`; terminal formatter is CLI-only.
 *
 * Binary file handling: backend returns `isBinary: true` +
 * `content: null`. The envelope keeps `isBinary: true` and omits
 * `content` entirely — agents discriminate on the flag rather than
 * checking a null content field.
 */

import type { ReadFileResult } from "../services/index.js";
import { colorize, dim } from "./colors.js";
import {
  buildTargetResolutionNotes,
  type LeanTargetResolution,
  projectTargetResolution,
} from "./target-resolution.js";

export interface LeanReadFileEnvelope {
  registry?: string;
  name?: string;
  repoUrl?: string;
  gitRef?: string;
  /**
   * File path. Named `path` (not `filePath`) so the envelope key
   * matches `list_files.files[].path` and `grep_repo`'s exact-file
   * `path` input — keeps the `list_files` → `read_file` / `grep_repo`
   * chain free of rename friction.
   */
  path: string;
  language?: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
  content?: string;
  /** Present and `true` when the file is binary; absent otherwise. */
  isBinary?: boolean;
  targetResolution?: LeanTargetResolution;
  /**
   * Optional one-line guidance for the agent. Set by the MCP tool
   * handler when it caps the returned span (see
   * `src/tools/read-file.ts`). Not auto-populated by this builder —
   * the policy of when to nudge an agent belongs to the surface, not
   * the response shape.
   */
  hint?: string;
}

export interface BuildReadFilePayloadOptions {
  registry?: string;
  name?: string;
  repoUrl?: string;
  gitRef?: string;
  /** The file_path the caller asked for; used as envelope fallback
   *  when the backend didn't echo it (rare). */
  requestedFilePath: string;
}

export function buildReadFileSuccessPayload(
  result: ReadFileResult,
  options: BuildReadFilePayloadOptions,
): LeanReadFileEnvelope {
  const envelope: LeanReadFileEnvelope = {
    path: result.filePath ?? options.requestedFilePath,
  };
  if (options.registry) envelope.registry = options.registry;
  if (options.name) envelope.name = options.name;
  if (options.repoUrl) envelope.repoUrl = options.repoUrl;
  if (options.gitRef) envelope.gitRef = options.gitRef;
  if (result.language != null) envelope.language = result.language;
  if (result.totalLines != null) envelope.totalLines = result.totalLines;
  if (result.startLine != null) envelope.startLine = result.startLine;
  if (result.endLine != null) envelope.endLine = result.endLine;
  if (result.isBinary) {
    envelope.isBinary = true;
  } else if (result.content != null) {
    envelope.content = result.content;
  }
  const targetResolution = projectTargetResolution(result.targetResolution);
  if (targetResolution) envelope.targetResolution = targetResolution;
  return envelope;
}

// --------------------------------------------------------------------
// Terminal formatter (CLI-only).
// --------------------------------------------------------------------

export interface FormatReadFileTerminalOptions {
  useColors: boolean;
  /**
   * When `true`, render the contextual header and a line-number
   * gutter. When `false` (default), emit the raw file content so the
   * output is pipe-friendly (`code read … | grep …`, `| wc -l`, etc).
   */
  verbose?: boolean;
}

/**
 * Render a `read_file` envelope for human terminal output.
 *
 * Default (plain) mode emits file content verbatim — no header,
 * no gutter. Verbose mode adds a contextual header and a
 * right-aligned line-number gutter. Binary files render a one-line
 * sentinel in both modes (to stderr-ish stdout) instead of bytes.
 */
export function formatReadFileTerminal(
  envelope: LeanReadFileEnvelope,
  options: FormatReadFileTerminalOptions,
): string {
  const verbose = options.verbose ?? false;

  if (envelope.isBinary) {
    return formatBinary(envelope, options, verbose);
  }

  if (envelope.content == null) {
    return formatNoContent(envelope, options, verbose);
  }

  if (!verbose) {
    // Emit content verbatim — preserves trailing newline if the
    // backend included one, so `code read … > file` round-trips.
    return envelope.content;
  }

  return formatVerboseBody(envelope, options);
}

function formatBinary(
  envelope: LeanReadFileEnvelope,
  options: FormatReadFileTerminalOptions,
  verbose: boolean,
): string {
  const sentinel = dim(
    "Binary file — cannot display as text.",
    options.useColors,
  );
  if (verbose) {
    return `${buildHeader(envelope, options)}\n\n${sentinel}\n`;
  }
  return `${sentinel}\n`;
}

function formatNoContent(
  envelope: LeanReadFileEnvelope,
  options: FormatReadFileTerminalOptions,
  verbose: boolean,
): string {
  const sentinel = dim("(no content returned)", options.useColors);
  if (verbose) {
    return `${buildHeader(envelope, options)}\n\n${sentinel}\n`;
  }
  return `${sentinel}\n`;
}

function formatVerboseBody(
  envelope: LeanReadFileEnvelope,
  options: FormatReadFileTerminalOptions,
): string {
  const lines: string[] = [];
  lines.push(buildHeader(envelope, options));
  lines.push("");

  const bodyLines = splitReadFileContentLines(envelope);
  const startLine = envelope.startLine ?? 1;
  const endLine = startLine + bodyLines.length - 1;
  const gutterWidth = String(endLine).length;
  for (let i = 0; i < bodyLines.length; i++) {
    const lineNumber = startLine + i;
    const gutter = dim(
      String(lineNumber).padStart(gutterWidth, " "),
      options.useColors,
    );
    lines.push(`${gutter}  ${bodyLines[i]}`);
  }
  if (envelope.hint) {
    lines.push("");
    lines.push(dim(envelope.hint, options.useColors));
  }
  appendTargetResolutionNotes(lines, envelope, options);
  lines.push("");
  return lines.join("\n");
}

function appendTargetResolutionNotes(
  lines: string[],
  envelope: LeanReadFileEnvelope,
  options: FormatReadFileTerminalOptions,
): void {
  const notes = buildTargetResolutionNotes(envelope.targetResolution);
  if (notes.length === 0) return;
  lines.push("");
  for (const note of notes) lines.push(dim(note, options.useColors));
}

export function splitReadFileContentLines(
  envelope: Pick<LeanReadFileEnvelope, "content" | "startLine" | "endLine">,
): string[] {
  if (!envelope.content) return [];

  const bodyLines = envelope.content.split("\n");
  const expectedCount = expectedLineCount(envelope);
  if (expectedCount === undefined) {
    if (bodyLines[bodyLines.length - 1] === "") bodyLines.pop();
    return bodyLines;
  }

  while (
    bodyLines.length > 0 &&
    bodyLines[bodyLines.length - 1] === "" &&
    bodyLines.length > expectedCount
  ) {
    bodyLines.pop();
  }
  return bodyLines;
}

function expectedLineCount(
  envelope: Pick<LeanReadFileEnvelope, "startLine" | "endLine">,
): number | undefined {
  if (envelope.startLine === undefined || envelope.endLine === undefined) {
    return undefined;
  }
  if (envelope.endLine < envelope.startLine) return undefined;
  return envelope.endLine - envelope.startLine + 1;
}

function buildHeader(
  envelope: LeanReadFileEnvelope,
  options: FormatReadFileTerminalOptions,
): string {
  const parts: string[] = [envelope.path];
  if (envelope.language) parts.push(envelope.language);
  const rangeLabel = buildRangeLabel(envelope);
  if (rangeLabel) parts.push(rangeLabel);
  return colorize(parts.join(" · "), "bold", options.useColors);
}

function buildRangeLabel(envelope: LeanReadFileEnvelope): string | undefined {
  const { startLine, endLine, totalLines } = envelope;
  if (startLine != null && endLine != null) {
    return totalLines != null
      ? `lines ${startLine}-${endLine} of ${totalLines}`
      : `lines ${startLine}-${endLine}`;
  }
  if (totalLines != null) {
    return `${totalLines} lines`;
  }
  return undefined;
}
