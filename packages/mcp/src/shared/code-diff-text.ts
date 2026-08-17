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
  const lines: string[] = [];
  let additions = 0;
  let deletions = 0;

  for (const file of envelope.files) {
    const stat = requireStat(file);
    const path = safe(stat.path);
    if (stat.additions !== undefined && stat.deletions !== undefined) {
      lines.push(`${path} | +${stat.additions} -${stat.deletions}`);
      additions += stat.additions;
      deletions += stat.deletions;
      continue;
    }
    lines.push(`${path} | ${contentLabel(stat.contentStatus)}`);
  }

  if (lines.length > 0) {
    const noun = lines.length === 1 ? "file" : "files";
    lines.push(`${lines.length} returned ${noun}, +${additions} -${deletions}`);
  }
  return formatLines(lines);
}

function formatPatches(files: LeanCodeDiffFile[]): string {
  let output = "";
  for (const file of files) {
    const patchFile = requirePatch(file);
    if (patchFile.patch !== undefined) {
      output += patchFile.patch;
      if (!patchFile.patch.endsWith("\n")) output += "\n";
      continue;
    }
    output += `${patchFallback(patchFile)}\n`;
  }
  return output;
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
