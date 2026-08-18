import type {
  LeanCodeDiffEnvelope,
  LeanCodeDiffFile,
  LeanCodeDiffPatchFile,
  LeanCodeDiffStatFile,
} from "./code-diff-response.js";
import { warning } from "./colors.js";
import { sanitizeTerminalText } from "./resolve-target-response.js";

export interface FormatCodeDiffTerminalOptions {
  useColors: boolean;
  verbose?: boolean;
}

export interface FormattedCodeDiffTerminal {
  stdout: string;
  stderr?: string;
}

/** Render a Git-like primary stream plus truthful bounded-evidence diagnostics. */
export function formatCodeDiffTerminal(
  envelope: LeanCodeDiffEnvelope,
  options: FormatCodeDiffTerminalOptions,
): FormattedCodeDiffTerminal {
  const stdout = formatPrimaryOutput(envelope);
  const diagnostics = buildDiagnostics(envelope, options);
  return {
    stdout,
    stderr: diagnostics.length > 0 ? `${diagnostics.join("\n")}\n` : undefined,
  };
}

function formatPrimaryOutput(envelope: LeanCodeDiffEnvelope): string {
  switch (envelope.view) {
    case "name-only":
      return formatLines(envelope.files.map((file) => safe(file.path)));
    case "name-status":
      return formatLines(
        envelope.files.map(
          (file) => `${statusLetter(requireStatus(file))}\t${safe(file.path)}`,
        ),
      );
    case "stat":
      return formatStat(envelope);
    case "patch":
      return formatPatches(envelope.files);
  }
}

function formatStat(envelope: LeanCodeDiffEnvelope): string {
  const rows: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    contentStatus: LeanCodeDiffStatFile["contentStatus"];
  }> = [];
  let additions = 0;
  let deletions = 0;

  for (const file of envelope.files) {
    const stat = requireStat(file);
    const path = safe(stat.path);
    if (stat.additions !== undefined && stat.deletions !== undefined) {
      rows.push({
        path,
        additions: stat.additions,
        deletions: stat.deletions,
        contentStatus: stat.contentStatus,
      });
      additions += stat.additions;
      deletions += stat.deletions;
      continue;
    }
    rows.push({ path, contentStatus: stat.contentStatus });
  }

  if (rows.length === 0) return "";
  const pathWidth = Math.max(...rows.map(({ path }) => path.length));
  const countWidth = Math.max(
    1,
    ...rows.map(({ additions, deletions }) =>
      additions !== undefined && deletions !== undefined
        ? String(additions + deletions).length
        : 0,
    ),
  );
  const lines = rows.map(({ path, additions, deletions, contentStatus }) => {
    const detail =
      additions !== undefined && deletions !== undefined
        ? formatStatCounts(additions, deletions, countWidth)
        : contentLabel(contentStatus);
    return ` ${path.padEnd(pathWidth)} | ${detail}`;
  });
  const noun = rows.length === 1 ? "file" : "files";
  const inventoryFullyRepresented =
    envelope.summary.inventoryComplete &&
    envelope.summary.unprojectableFiles === 0 &&
    !envelope.hasMoreFiles &&
    rows.length === envelope.summary.filesChanged;
  const qualifier = inventoryFullyRepresented ? "" : "returned ";
  const totals = [`${rows.length} ${qualifier}${noun} changed`];
  if (additions > 0) {
    totals.push(
      `${additions} ${additions === 1 ? "insertion" : "insertions"}(+)`,
    );
  }
  if (deletions > 0) {
    totals.push(
      `${deletions} ${deletions === 1 ? "deletion" : "deletions"}(-)`,
    );
  }
  lines.push(` ${totals.join(", ")}`);
  return formatLines(lines);
}

function formatStatCounts(
  additions: number,
  deletions: number,
  countWidth: number,
): string {
  const total = additions + deletions;
  if (total === 0) return "0".padStart(countWidth);
  const barWidth = Math.min(total, 40);
  let pluses = Math.round((additions / total) * barWidth);
  if (additions > 0) pluses = Math.max(1, pluses);
  if (deletions > 0) pluses = Math.min(barWidth - 1, pluses);
  return `${String(total).padStart(countWidth)} ${"+".repeat(pluses)}${"-".repeat(barWidth - pluses)}`;
}

function formatPatches(files: LeanCodeDiffFile[]): string {
  let output = "";
  for (const file of files) {
    const patchFile = requirePatch(file);
    if (patchFile.patch !== undefined) {
      const patch = bindPatchHeaders(patchFile);
      output += patch;
      if (!patch.endsWith("\n")) output += "\n";
      continue;
    }
    output += `${patchFallback(patchFile)}\n`;
  }
  return output;
}

const RAW_DIFF_PLACEHOLDER_HEADERS = "--- a/file\n+++ b/file\n";

/** Bind the raw diff service's content-only placeholders to its owning file. */
function bindPatchHeaders(file: LeanCodeDiffPatchFile): string {
  const patch = file.patch;
  if (patch === undefined || !patch.startsWith(RAW_DIFF_PLACEHOLDER_HEADERS)) {
    return patch ?? "";
  }

  const path = safe(file.path);
  const fromPath = file.status === "added" ? "/dev/null" : `a/${path}`;
  const toPath = file.status === "deleted" ? "/dev/null" : `b/${path}`;
  return `--- ${fromPath}\n+++ ${toPath}\n${patch.slice(RAW_DIFF_PLACEHOLDER_HEADERS.length)}`;
}

function patchFallback(file: LeanCodeDiffPatchFile): string {
  const path = safe(file.path);
  switch (file.contentStatus) {
    case "binary":
      return `Binary file ${path} differs`;
    case "metadata_only":
      return `Metadata changed: ${path}`;
    case "omitted": {
      const reason = file.contentOmissionReason
        ? ` (${safe(file.contentOmissionReason)})`
        : "";
      return `Patch omitted: ${path}${reason}`;
    }
    case "unavailable":
      return `Patch unavailable: ${path}`;
    default:
      return `No textual patch: ${path}`;
  }
}

function buildDiagnostics(
  envelope: LeanCodeDiffEnvelope,
  options: FormatCodeDiffTerminalOptions,
): string[] {
  const lines: string[] = [];
  if (options.verbose) appendVerboseContext(lines, envelope);

  if (envelope.scope.status === "unknown") {
    lines.push(
      warn(
        "Package ownership could not be proved; this evidence is repository-wide.",
        options,
      ),
    );
  }
  if (!envelope.summary.inventoryComplete) {
    lines.push(
      warn("The authoritative file inventory is incomplete.", options),
    );
  }
  if (envelope.hasMoreFiles) {
    lines.push(
      warn(
        `More matching files exist than the ${envelope.files.length} returned. Narrow the glob or raise --max-files.`,
        options,
      ),
    );
  }
  if (envelope.summary.unprojectableFiles > 0) {
    lines.push(
      warn(
        `${envelope.summary.unprojectableFiles} matching path(s) could not be projected safely.`,
        options,
      ),
    );
  }
  if (envelope.contentCoverage === "partial") {
    lines.push(
      warn("Requested content is partial; inspect per-file status.", options),
    );
  } else if (envelope.contentCoverage === "failed") {
    const failure = envelope.contentFailure;
    const detail = failure
      ? ` (${[failure.code, failure.stage, failure.limitKind]
          .filter((value): value is string => Boolean(value))
          .map(safe)
          .join(", ")})`
      : "";
    lines.push(
      warn(
        `Requested content failed after the file inventory completed${detail}.`,
        options,
      ),
    );
  }

  const byteEscaped = envelope.files.filter(
    (file) => file.pathEncoding === "byte_escaped",
  ).length;
  if (byteEscaped > 0) {
    lines.push(
      warn(
        `${byteEscaped} path(s) are display-only byte escapes and cannot be reused as exact identities.`,
        options,
      ),
    );
  }
  const filtered = envelope.files.filter(
    (file) => "contentSafety" in file && file.contentSafety.filtered,
  ).length;
  if (filtered > 0) {
    lines.push(
      warn(`${filtered} patch(es) were modified for content safety.`, options),
    );
  }
  return lines;
}

function appendVerboseContext(
  lines: string[],
  envelope: LeanCodeDiffEnvelope,
): void {
  const target =
    envelope.target.kind === "package"
      ? `${envelope.target.registry}:${safe(envelope.target.name)}`
      : safe(envelope.target.repoUrl);
  lines.push(`target: ${target}`);
  lines.push(
    `range: ${safe(envelope.from.requested)} (${envelope.from.commitSha}) -> ${safe(envelope.to.requested)} (${envelope.to.commitSha})`,
  );
  lines.push(
    `summary: ${envelope.summary.filesChanged} changed, ${envelope.summary.added} added, ${envelope.summary.deleted} deleted, ${envelope.summary.modified} modified`,
  );
  const roots =
    envelope.scope.fromSubpath !== undefined ||
    envelope.scope.toSubpath !== undefined
      ? `, roots ${JSON.stringify(envelope.scope.fromSubpath ?? "?")} -> ${JSON.stringify(envelope.scope.toSubpath ?? "?")}`
      : "";
  const filter = envelope.scope.pathGlob
    ? `, glob ${JSON.stringify(safe(envelope.scope.pathGlob))}`
    : "";
  lines.push(`scope: ${envelope.scope.status}${roots}${filter}`);
  lines.push(
    `returned: ${envelope.files.length}, content: ${envelope.contentCoverage}`,
  );
}

function requireStatus(
  file: LeanCodeDiffFile,
): "added" | "deleted" | "modified" {
  if (!("status" in file))
    throw new Error("CodeDiff status view lacks status.");
  return file.status;
}

function requireStat(file: LeanCodeDiffFile): LeanCodeDiffStatFile {
  if (!("contentStatus" in file)) {
    throw new Error("CodeDiff stat view lacks content status.");
  }
  return file;
}

function requirePatch(file: LeanCodeDiffFile): LeanCodeDiffPatchFile {
  if (!("contentSafety" in file)) {
    throw new Error("CodeDiff patch view lacks content safety.");
  }
  return file;
}

function statusLetter(status: "added" | "deleted" | "modified"): string {
  return status === "added" ? "A" : status === "deleted" ? "D" : "M";
}

function contentLabel(status: LeanCodeDiffStatFile["contentStatus"]): string {
  switch (status) {
    case "binary":
      return "binary content differs";
    case "metadata_only":
      return "metadata differs";
    case "omitted":
      return "content omitted";
    case "unavailable":
      return "content unavailable";
    default:
      return "line statistics unavailable";
  }
}

function formatLines(lines: string[]): string {
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function warn(text: string, options: FormatCodeDiffTerminalOptions): string {
  return warning(text, options.useColors);
}

function safe(value: string): string {
  return sanitizeTerminalText(value);
}
