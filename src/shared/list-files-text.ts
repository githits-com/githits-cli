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

const SEP = " | ";

export function renderListFilesText(envelope: LeanListFilesEnvelope): string {
  const lines: string[] = [];
  lines.push(buildHeader(envelope));
  lines.push("");

  if (envelope.files.length === 0) {
    lines.push(envelope.hint ?? "No files match the requested filter.");
    return lines.join("\n");
  }

  for (const entry of envelope.files) {
    lines.push(entry.path);
  }

  if (envelope.hasMore) {
    lines.push("");
    lines.push(
      "More files available. Pass limit=N to widen or refine path_prefix.",
    );
  }

  if (envelope.hint) {
    lines.push("");
    lines.push(envelope.hint);
  }

  return lines.join("\n");
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
    return envelope.gitRef
      ? `${envelope.repoUrl}@${envelope.gitRef}`
      : envelope.repoUrl;
  }
  return "";
}

function buildFilterEcho(envelope: LeanListFilesEnvelope): string {
  const parts: string[] = [];
  if (envelope.filter?.pathPrefix) {
    parts.push(`path_prefix=${quote(envelope.filter.pathPrefix)}`);
  }
  if (envelope.filter?.limit !== undefined) {
    parts.push(`limit=${envelope.filter.limit}`);
  }
  return parts.join(" ");
}

function quote(value: string): string {
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}
