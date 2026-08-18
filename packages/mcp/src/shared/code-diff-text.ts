import { quoteGitPath } from "./code-diff-path.js";
import type {
  LeanCodeDiffEnvelope,
  LeanCodeDiffFile,
  LeanCodeDiffPatchFile,
  LeanCodeDiffStatFile,
} from "./code-diff-response.js";
import { colorize, warning } from "./colors.js";
import { sanitizeTerminalText } from "./resolve-target-response.js";
import { padTerminalEnd, terminalWidth } from "./terminal-width.js";

export interface FormatCodeDiffTerminalOptions {
  useColors: boolean;
  verbose?: boolean;
  explicitMaxFiles?: boolean;
  explicitMaxPatchBytes?: boolean;
}

export interface FormattedCodeDiffTerminal {
  stdout: string;
  stderr?: string;
  exitCode?: 1;
}

const EXPLICIT_PATCH_BUDGET_OMISSION_REASONS = new Set([
  "content_budget",
  "total_patch_bytes",
]);

/** Render a Git-like primary stream plus truthful bounded-evidence diagnostics. */
export function formatCodeDiffTerminal(
  envelope: LeanCodeDiffEnvelope,
  options: FormatCodeDiffTerminalOptions,
): FormattedCodeDiffTerminal {
  const diagnostics = buildDiagnostics(envelope, options);
  const suppressPatch = shouldSuppressPatch(envelope, options);
  if (suppressPatch) {
    diagnostics.push(
      warn(
        "Patch output was suppressed because the result is not safely applicable. Use --stat or --name-status to inspect changes, or --json for structured partial evidence.",
        options,
      ),
    );
  }
  return {
    stdout: suppressPatch ? "" : formatPrimaryOutput(envelope, options),
    stderr: diagnostics.length > 0 ? `${diagnostics.join("\n")}\n` : undefined,
    ...(suppressPatch ? { exitCode: 1 as const } : {}),
  };
}

function formatPrimaryOutput(
  envelope: LeanCodeDiffEnvelope,
  options: FormatCodeDiffTerminalOptions,
): string {
  switch (envelope.view) {
    case "name-only":
      return formatLines(envelope.files.map((file) => quoteGitPath(file.path)));
    case "name-status":
      return formatLines(
        envelope.files.map(
          (file) =>
            `${formatStatus(requireStatus(file), options.useColors)}\t${quoteGitPath(file.path)}`,
        ),
      );
    case "stat":
      return formatStat(envelope, options.useColors);
    case "patch":
      return formatPatches(envelope.files, options.useColors);
  }
}

function formatStat(
  envelope: LeanCodeDiffEnvelope,
  useColors: boolean,
): string {
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
    const path = quoteGitPath(stat.path);
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
  const pathWidth = Math.max(...rows.map(({ path }) => terminalWidth(path)));
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
        ? formatStatCounts(additions, deletions, countWidth, useColors)
        : contentLabel(contentStatus);
    return ` ${padTerminalEnd(path, pathWidth)} | ${detail}`;
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
    const marker = colorize("+", "green", useColors);
    totals.push(
      `${additions} ${additions === 1 ? "insertion" : "insertions"}(${marker})`,
    );
  }
  if (deletions > 0) {
    const marker = colorize("-", "red", useColors);
    totals.push(
      `${deletions} ${deletions === 1 ? "deletion" : "deletions"}(${marker})`,
    );
  }
  lines.push(` ${totals.join(", ")}`);
  return formatLines(lines);
}

function formatStatCounts(
  additions: number,
  deletions: number,
  countWidth: number,
  useColors: boolean,
): string {
  const total = additions + deletions;
  if (total === 0) return "0".padStart(countWidth);
  const barWidth = Math.min(total, 40);
  let pluses = Math.round((additions / total) * barWidth);
  if (additions > 0) pluses = Math.max(1, pluses);
  if (deletions > 0) pluses = Math.min(barWidth - 1, pluses);
  const plusBar =
    pluses > 0 ? colorize("+".repeat(pluses), "green", useColors) : "";
  const minuses = barWidth - pluses;
  const minusBar =
    minuses > 0 ? colorize("-".repeat(minuses), "red", useColors) : "";
  return `${String(total).padStart(countWidth)} ${plusBar}${minusBar}`;
}

function formatPatches(files: LeanCodeDiffFile[], useColors: boolean): string {
  let output = "";
  for (const file of files) {
    const patchFile = requirePatch(file);
    if (patchFile.patch !== undefined) {
      const patch = patchFile.patch;
      output += colorizePatch(patch, useColors);
      if (!patch.endsWith("\n")) output += "\n";
      continue;
    }
    output += `${colorizePatchFallback(patchFallback(patchFile), patchFile, useColors)}\n`;
  }
  return output;
}

function colorizePatch(patch: string, useColors: boolean): string {
  if (!useColors) return patch;
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("@@")) return colorize(line, "cyan", useColors);
      if (line.startsWith("+")) return colorize(line, "green", useColors);
      if (line.startsWith("-")) return colorize(line, "red", useColors);
      return line;
    })
    .join("\n");
}

function colorizePatchFallback(
  text: string,
  file: LeanCodeDiffPatchFile,
  useColors: boolean,
): string {
  return colorize(
    text,
    file.contentStatus === "unavailable" ? "red" : "yellow",
    useColors,
  );
}

function patchFallback(file: LeanCodeDiffPatchFile): string {
  const path = quoteGitPath(file.path);
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

function shouldSuppressPatch(
  envelope: LeanCodeDiffEnvelope,
  options: FormatCodeDiffTerminalOptions,
): boolean {
  if (envelope.view !== "patch") return false;
  if (
    !envelope.summary.inventoryComplete ||
    envelope.summary.unprojectableFiles > 0 ||
    (envelope.hasMoreFiles && !options.explicitMaxFiles) ||
    envelope.contentCoverage === "failed" ||
    (envelope.contentCoverage === "partial" && !options.explicitMaxPatchBytes)
  ) {
    return true;
  }
  if (envelope.files.length === 0) return false;

  return envelope.files.some((file) => {
    const patchFile = requirePatch(file);
    if (
      patchFile.pathEncoding === "byte_escaped" ||
      patchFile.contentSafety.filtered
    ) {
      return true;
    }
    if (patchFile.patch !== undefined) return false;
    return !(
      options.explicitMaxPatchBytes &&
      patchFile.contentStatus === "omitted" &&
      patchFile.contentOmissionReason !== undefined &&
      EXPLICIT_PATCH_BUDGET_OMISSION_REASONS.has(
        patchFile.contentOmissionReason,
      )
    );
  });
}

function buildDiagnostics(
  envelope: LeanCodeDiffEnvelope,
  options: FormatCodeDiffTerminalOptions,
): string[] {
  const lines: string[] = [];
  if (options.verbose) appendVerboseContext(lines, envelope);

  if (envelope.scope.status === "unknown") {
    let message =
      "Showing changes for the entire repository because GitHits could not identify this package's directory. Unrelated files may be included.";
    if (envelope.scope.pathGlob) {
      message =
        "GitHits could not identify this package's directory, so the path glob was applied across the entire repository. Matching files from other packages may be included; narrow the path glob if needed.";
    } else if (!envelope.hasMoreFiles) {
      message += " Add a path glob after `--` to narrow the diff.";
    }
    lines.push(warn(message, options));
  }
  if (!envelope.summary.inventoryComplete) {
    lines.push(
      warn("The authoritative file inventory is incomplete.", options),
    );
  }
  if (envelope.hasMoreFiles) {
    const recovery = envelope.scope.pathGlob
      ? "Narrow the path glob or raise --max-files (up to 300)."
      : "Add a path glob after `--` or raise --max-files (up to 300).";
    lines.push(
      warn(
        `More matching files exist than the ${envelope.files.length} returned. ${recovery}`,
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
      warn(
        envelope.view === "patch"
          ? "Requested content is partial; inspect per-file status with --stat or --json."
          : "Requested content is partial; inspect the returned rows or use --json.",
        options,
      ),
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
  if (envelope.view === "patch") {
    const binary = envelope.files.filter(
      (file) => "contentStatus" in file && file.contentStatus === "binary",
    ).length;
    if (binary > 0) {
      lines.push(
        warn(
          `${binary} binary ${binary === 1 ? "change" : "changes"} cannot be represented as an applicable text patch.`,
          options,
        ),
      );
    }
    const metadataOnly = envelope.files.filter(
      (file) =>
        "contentStatus" in file && file.contentStatus === "metadata_only",
    ).length;
    if (metadataOnly > 0) {
      lines.push(
        warn(
          `${metadataOnly} metadata-only ${metadataOnly === 1 ? "change" : "changes"} cannot be represented as an applicable text patch.`,
          options,
        ),
      );
    }
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

function formatStatus(
  status: "added" | "deleted" | "modified",
  useColors: boolean,
): string {
  if (status === "added") return colorize("A", "green", useColors);
  if (status === "deleted") return colorize("D", "red", useColors);
  return colorize("M", "yellow", useColors);
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
