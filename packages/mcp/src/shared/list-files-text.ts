/**
 * Line-oriented text renderer for `code_files` MCP responses.
 *
 * Paths-only listing (one file per line) — the most compact useful
 * shape for an agent that will follow up with `code_read`. This is
 * the tool's default response format; programmatic / parity callers
 * opt into the structured JSON envelope via `format: "json"`.
 *
 * ASCII-only output. Format is a public contract — locked with
 * snapshot-style tests in `list-files-text.test.ts`.
 */

import type { LeanListFilesEnvelope } from "./list-files-response.js";
import { formatRepositoryTarget } from "./repository-target.js";
import { buildTargetResolutionNotes } from "./target-resolution.js";

const SEP = " | ";

export function renderListFilesText(envelope: LeanListFilesEnvelope): string {
  const lines: string[] = [];
  lines.push(buildHeader(envelope));
  lines.push("");

  if (envelope.files.length === 0) {
    lines.push(envelope.hint ?? "No files match the requested filter.");
    appendTargetResolutionNotes(lines, envelope);
    return lines.join("\n");
  }

  for (const entry of envelope.files) {
    lines.push(entry.path);
  }

  if (envelope.hasMore) {
    lines.push("");
    lines.push("More files available. Pass limit=N or refine the filter.");
  }

  if (envelope.hint) {
    lines.push("");
    lines.push(envelope.hint);
  }

  appendTargetResolutionNotes(lines, envelope);

  return lines.join("\n");
}

function appendTargetResolutionNotes(
  lines: string[],
  envelope: LeanListFilesEnvelope,
): void {
  const notes = buildTargetResolutionNotes(envelope.targetResolution);
  if (notes.length === 0) return;
  lines.push("");
  for (const note of notes) lines.push(note);
}

function buildHeader(envelope: LeanListFilesEnvelope): string {
  const identity = buildIdentity(envelope);
  const countValue = envelope.hasMore
    ? `${envelope.files.length}+`
    : String(envelope.total);
  const parts = [
    `code_files${SEP}${countValue} path${countValue === "1" ? "" : "s"}`,
  ];
  if (identity) parts.push(identity);
  const filter = buildFilterEcho(envelope);
  if (filter) parts.push(filter);
  return parts.join(SEP);
}

function buildIdentity(envelope: LeanListFilesEnvelope): string {
  if (envelope.registry && envelope.name) {
    const version = envelope.indexedVersion ?? envelope.resolution?.resolvedRef;
    return version
      ? `${envelope.registry}:${envelope.name}@${version}`
      : `${envelope.registry}:${envelope.name}`;
  }
  if (envelope.repoUrl) {
    return formatRepositoryTarget(envelope.repoUrl, envelope.gitRef);
  }
  return "";
}

function buildFilterEcho(envelope: LeanListFilesEnvelope): string {
  const parts: string[] = [];
  if (envelope.filter?.path) {
    parts.push(`path=${quote(envelope.filter.path)}`);
  }
  if (envelope.filter?.pathPrefix) {
    parts.push(`path_prefix=${quote(envelope.filter.pathPrefix)}`);
  }
  if (envelope.filter?.globs?.length) {
    parts.push(`globs=${envelope.filter.globs.join(",")}`);
  }
  if (envelope.filter?.extensions?.length) {
    parts.push(`exts=${envelope.filter.extensions.join(",")}`);
  }
  if (envelope.filter?.fileTypes?.length) {
    parts.push(`file_types=${envelope.filter.fileTypes.join(",")}`);
  }
  if (envelope.filter?.languages?.length) {
    parts.push(`languages=${envelope.filter.languages.join(",")}`);
  }
  if (envelope.filter?.fileIntent) {
    parts.push(`file_intent=${envelope.filter.fileIntent}`);
  }
  if (envelope.filter?.fileIntents?.length) {
    parts.push(`file_intents=${envelope.filter.fileIntents.join(",")}`);
  }
  if (envelope.filter?.excludeFileIntents?.length) {
    parts.push(
      `exclude_file_intents=${envelope.filter.excludeFileIntents.join(",")}`,
    );
  }
  if (envelope.filter?.excludeDocFiles !== undefined) {
    parts.push(`exclude_doc_files=${String(envelope.filter.excludeDocFiles)}`);
  }
  if (envelope.filter?.excludeTestFiles !== undefined) {
    parts.push(
      `exclude_test_files=${String(envelope.filter.excludeTestFiles)}`,
    );
  }
  if (envelope.filter?.includeHidden !== undefined) {
    parts.push(`include_hidden=${String(envelope.filter.includeHidden)}`);
  }
  if (envelope.filter?.limit !== undefined) {
    parts.push(`limit=${envelope.filter.limit}`);
  }
  return parts.join(" ");
}

function quote(value: string): string {
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}
