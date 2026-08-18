import type {
  LeanCodeDiffEnvelope,
  LeanCodeDiffFile,
  LeanCodeDiffPatchFile,
  LeanCodeDiffStatFile,
} from "./code-diff-response.js";
import { sanitizeTerminalText } from "./resolve-target-response.js";

const MAX_FILE_ROWS = 20;
const MAX_PATCH_PREVIEW_BYTES = 320;
const UTF8_ENCODER = new TextEncoder();

/** Render bounded CodeDiff evidence with MCP-native follow-up guidance. */
export function formatCodeDiffMcpText(envelope: LeanCodeDiffEnvelope): string {
  const lines = [
    `Code diff: ${formatTarget(envelope)}`,
    `Requested endpoints: ${safe(envelope.from.requested)} -> ${safe(envelope.to.requested)}`,
    `Resolved endpoints: ${formatResolution(envelope.from)} -> ${formatResolution(envelope.to)}`,
    `Scope: ${formatScope(envelope)}`,
    `Summary: ${formatSummary(envelope)}`,
    `Content: ${safe(envelope.contentCoverage)}`,
  ];

  appendWarnings(lines, envelope);
  appendFiles(lines, envelope);
  lines.push(nextAction(envelope));
  return `${lines.join("\n")}\n`;
}

function appendWarnings(lines: string[], envelope: LeanCodeDiffEnvelope): void {
  if (envelope.scope.status === "unknown") {
    lines.push(
      "Warning: package scope was not identified; unrelated repository files may be included.",
    );
  }
  if (!envelope.summary.inventoryComplete) {
    lines.push("Warning: the authoritative file inventory is incomplete.");
  }
  if (envelope.summary.unprojectableFiles > 0) {
    lines.push(
      `Warning: ${envelope.summary.unprojectableFiles} matching path(s) could not be projected safely.`,
    );
  }
  if (envelope.hasMoreFiles) {
    lines.push(
      `Warning: more matching files exist than the ${envelope.files.length} returned.`,
    );
  }
  if (envelope.contentCoverage === "partial") {
    lines.push("Warning: requested content is partial.");
  } else if (envelope.contentCoverage === "failed") {
    const failure = envelope.contentFailure;
    const detail = failure
      ? ` (${[failure.code, failure.stage, failure.limitKind]
          .filter((value): value is string => Boolean(value))
          .map(safe)
          .join(", ")})`
      : "";
    lines.push(
      `Warning: requested content failed after inventory completed${detail}.`,
    );
  }

  const byteEscaped = envelope.files.filter(
    (file) => file.pathEncoding === "byte_escaped",
  ).length;
  if (byteEscaped > 0) {
    lines.push(
      `Warning: ${byteEscaped} path(s) are display-only byte escapes and cannot be reused as exact identities.`,
    );
  }

  const filtered = envelope.files.filter(
    (file) => "contentSafety" in file && file.contentSafety.filtered,
  ).length;
  if (filtered > 0) {
    lines.push(
      `Warning: ${filtered} patch(es) were modified for content safety.`,
    );
  }

  if (envelope.view === "patch" && patchIsNotAuthoritative(envelope)) {
    lines.push(
      "Warning: patch content is not presented as authoritative or safely applicable; use inventory/stat evidence or JSON details.",
    );
  }
}

function appendFiles(lines: string[], envelope: LeanCodeDiffEnvelope): void {
  if (envelope.files.length === 0) {
    lines.push(
      envelope.summary.filesChanged === 0
        ? "No changes between the requested endpoints."
        : "No file rows were returned; inspect the structured JSON evidence.",
    );
    return;
  }

  lines.push("Files:");
  const shown = envelope.files.slice(0, MAX_FILE_ROWS);
  for (const file of shown) appendFile(lines, file, envelope.view);
  if (envelope.files.length > shown.length) {
    lines.push(
      `  ... ${envelope.files.length - shown.length} additional file(s) omitted from compact text; use format=json for the complete list.`,
    );
  }
}

function appendFile(
  lines: string[],
  file: LeanCodeDiffFile,
  view: LeanCodeDiffEnvelope["view"],
): void {
  const path = safe(file.path);
  if (view === "name-only") {
    lines.push(`  ${path}`);
    return;
  }

  const status = "status" in file ? safe(file.status) : "unknown";
  let detail = `status=${status}`;
  if (view === "stat" || view === "patch") {
    const stat = file as LeanCodeDiffStatFile;
    detail += `, content=${safe(stat.contentStatus)}`;
    if (stat.additions !== undefined || stat.deletions !== undefined) {
      detail += `, +${stat.additions ?? 0}/-${stat.deletions ?? 0}`;
    }
  }
  lines.push(`  ${path} [${detail}]`);

  if (view === "patch") {
    const patch = file as LeanCodeDiffPatchFile;
    if (canShowPatch(patch)) {
      const previewLines = formatPatchPreview(
        patch.patch ?? "",
        MAX_PATCH_PREVIEW_BYTES,
      );
      if (previewLines.length > 0) {
        lines.push(`    patch preview: ${previewLines[0]}`);
        lines.push(...previewLines.slice(1).map((line) => `      ${line}`));
      }
    } else if (patch.contentOmissionReason) {
      lines.push(`    patch omitted: ${safe(patch.contentOmissionReason)}`);
    }
  }
}

function formatTarget(envelope: LeanCodeDiffEnvelope): string {
  if (envelope.target.kind === "package") {
    return `${safe(envelope.target.registry)}:${safe(envelope.target.name)}`;
  }
  return safe(envelope.target.repoUrl);
}

function formatResolution(resolution: LeanCodeDiffEnvelope["from"]): string {
  const resolved = resolution.resolvedVersion
    ? `, version ${safe(resolution.resolvedVersion)}`
    : "";
  return `${safe(resolution.ref)} (${safe(resolution.commitSha)}${resolved})`;
}

function formatScope(envelope: LeanCodeDiffEnvelope): string {
  const scope = envelope.scope;
  const roots =
    scope.fromSubpath !== undefined || scope.toSubpath !== undefined
      ? `, roots ${safe(scope.fromSubpath ?? "?")} -> ${safe(scope.toSubpath ?? "?")}`
      : "";
  const glob = scope.pathGlob ? `, glob ${safe(scope.pathGlob)}` : "";
  return `${safe(scope.status)}${roots}${glob}`;
}

function formatSummary(envelope: LeanCodeDiffEnvelope): string {
  const summary = envelope.summary;
  return `${summary.filesChanged} changed, ${summary.added} added, ${summary.deleted} deleted, ${summary.modified} modified`;
}

function nextAction(envelope: LeanCodeDiffEnvelope): string {
  const target = formatTarget(envelope);
  const from = safe(envelope.from.requested);
  const to = safe(envelope.to.requested);
  const needsScopeRecovery =
    envelope.scope.status === "unknown" ||
    !envelope.summary.inventoryComplete ||
    envelope.summary.unprojectableFiles > 0 ||
    envelope.hasMoreFiles;
  const needsContentRecovery =
    envelope.contentCoverage === "partial" ||
    envelope.contentCoverage === "failed" ||
    (envelope.view === "patch" && patchIsNotAuthoritative(envelope));
  if (needsScopeRecovery || needsContentRecovery) {
    const recovery: string[] = [];
    if (needsScopeRecovery) {
      recovery.push("narrow `path_glob` or set `max_files` to a larger bound");
    }
    if (needsContentRecovery) {
      recovery.push('use view "stat" or format "json" for structured evidence');
    }
    return `Next: call code_diff again with target ${target}, from "${from}", to "${to}"; ${recovery.join("; ")}. Raw diffs do not prove compatibility or upgrade safety.`;
  }
  const nextView =
    envelope.view === "name-only" || envelope.view === "name-status"
      ? "stat"
      : envelope.view === "stat"
        ? "patch"
        : "stat";
  return `Next: call code_diff again with target ${target}, from "${from}", to "${to}", and view "${nextView}" as needed; raw diffs do not prove compatibility or upgrade safety.`;
}

function patchIsNotAuthoritative(envelope: LeanCodeDiffEnvelope): boolean {
  if (
    !envelope.summary.inventoryComplete ||
    envelope.summary.unprojectableFiles > 0 ||
    envelope.hasMoreFiles ||
    envelope.contentCoverage !== "complete"
  ) {
    return true;
  }
  return envelope.files.some((file) => {
    if (!("contentSafety" in file)) return true;
    return (
      file.pathEncoding === "byte_escaped" ||
      file.contentSafety.filtered ||
      file.patch === undefined
    );
  });
}

function canShowPatch(file: LeanCodeDiffPatchFile): boolean {
  return (
    file.pathEncoding === "utf8" &&
    file.contentSafety.filtered === false &&
    file.contentStatus === "patch" &&
    file.patch !== undefined
  );
}

function safe(value: string): string {
  return sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
}

function formatPatchPreview(value: string, maxBytes: number): string[] {
  const sanitizedLines = value
    .split(/\r?\n/)
    .map((line) => sanitizeTerminalText(line));
  const retained: string[] = [];
  let byteLength = 0;
  for (const line of sanitizedLines) {
    const separatorBytes = retained.length > 0 ? 1 : 0;
    const lineBytes = UTF8_ENCODER.encode(line).byteLength;
    const available = maxBytes - byteLength - separatorBytes;
    if (available < lineBytes) {
      const truncated = truncateUtf8(line, Math.max(available, 0));
      if (truncated) retained.push(truncated);
      break;
    }
    retained.push(line);
    byteLength += separatorBytes + lineBytes;
  }
  return retained;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = UTF8_ENCODER.encode(character).byteLength;
    if (byteLength + characterBytes > maxBytes) break;
    result += character;
    byteLength += characterBytes;
  }
  return result;
}
