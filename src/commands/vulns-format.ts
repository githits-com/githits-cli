import {
  type AdvisoryLookup,
  type LookupPackage,
  parsePkgseerRegistryArg,
  toPkgseerRegistry,
} from "@githits/core-internal";
import {
  sanitizeTerminalText,
  supportsVulnerabilitiesRegistry,
  wrapTerminalProse,
} from "@githits/mcp/internal";

export interface VulnsError {
  error: string;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
export interface VulnsResult {
  inputId: string;
  status: "success" | "partial" | "error";
  lookup?: AdvisoryLookup;
  packagePagination?: { complete: boolean; pagesRead: number };
  error?: VulnsError;
}

/** Human presentation only: identities, ranges and evidence order are already backend-owned. */
export function formatVulns(
  results: VulnsResult[],
  options: { verbose?: boolean; width?: number } = {},
): string {
  const lines: string[] = [];
  const width = options.width && options.width > 0 ? options.width : 80;
  const add = (line = ""): void => {
    lines.push(...wrapTerminalProse(line, width));
  };
  for (const result of results) {
    if (lines.length) add();
    const lookup = result.lookup;
    const advisory = lookup?.advisory;
    add(`${result.inputId.trim() || "(empty ID)"} | ${result.status}`);
    const connection = lookup?.affectedPackages;
    if (connection?.entries.length) {
      for (const group of connection.entries) {
        const pkg = group.package;
        add(
          `  ${pkg.registry ? pkg.registry.toLowerCase() : `${pkg.ecosystem ?? "unknown ecosystem"} (unmapped registry)`}:${pkg.name}`,
        );
        if (group.sourceEvidence)
          renderEvidence(
            group.sourceEvidence,
            "live source",
            add,
            options.verbose,
          );
        for (const local of group.advisories) {
          renderEvidence(local, "local corpus", add, options.verbose);
          if (local.summary) add(`      ${local.summary}`);
          if (local.severityScore !== null)
            add(
              `      Severity evidence: ${local.severityScore} (${local.severityType ?? "unknown type"}${local.severityType === "SEVERITY_LABEL" ? "; label approximation, not calculated CVSS" : ""})`,
            );
          if (options.verbose) {
            if (local.aliases?.length)
              add(`      Aliases: ${local.aliases.join(", ")}`);
            if (local.isMalicious !== null && local.isMalicious !== undefined)
              add(`      Malicious source marker: ${local.isMalicious}`);
            if (local.registry !== undefined)
              add(
                `      Source package: ${local.registry ?? "unknown registry"}:${local.packageName ?? "unknown name"}`,
              );
          }
        }
        if (options.verbose && group.sourceEvidence)
          renderAffected(group.sourceEvidence.affected ?? [], add, "      ");
        const registry = pkg.registry
          ? parsePkgseerRegistryArg(pkg.registry)
          : undefined;
        if (
          registry &&
          supportsVulnerabilitiesRegistry(toPkgseerRegistry(registry))
        ) {
          add("    Assess installed version:");
          lines.push(
            sanitizeTerminalText(
              `      githits pkg vulns ${shellArg(`${registry}:${pkg.name}@<installed-version>`)}`,
            ),
          );
        }
      }
    } else
      add(
        connection
          ? "  No named package mappings in the available evidence. This does not establish non-affectedness. Use --verbose for original source/Git evidence."
          : "  Package mappings unavailable; inspect diagnostics.",
      );
    if (connection) {
      add(
        `  Coverage: live source ${connection.coverage.sourceStatus}; local corpus ${connection.coverage.localStatus}`,
      );
      add(
        `  Packages: ${connection.entries.length} of ${connection.pageInfo.totalCount}; ${result.packagePagination?.complete ? "all available pages read" : "INCOMPLETE pagination"}`,
      );
    }
    if (advisory && lookup) {
      add(
        `  Source advisory: ${advisory.osvId}${advisory.withdrawnAt !== null ? " [WITHDRAWN]" : ""}`,
      );
      if (lookup.requestedId !== advisory.osvId)
        add(`    Requested: ${lookup.requestedId}; served: ${advisory.osvId}`);
      if (advisory.summary) add(`    ${advisory.summary}`);
      add(`    ${advisory.sourceUrl}`);
      if (advisory.withdrawnAt !== null)
        add(`    Withdrawn: ${advisory.withdrawnAt}`);
      if (options.verbose) {
        if (advisory.aliases?.length)
          add(`    Aliases: ${advisory.aliases.join(", ")}`);
        if (advisory.publishedAt !== undefined)
          add(`    Published: ${advisory.publishedAt ?? "unknown"}`);
        add(`    Source revision: ${advisory.modifiedAt ?? "unknown"}`);
        if (!advisory.severity?.length) add("    Source severity: unknown");
        for (const severity of advisory.severity ?? [])
          add(
            `    Source severity: ${severity.type} ${severity.score}${severity.source ? ` (${severity.source})` : ""}`,
          );
        if (advisory.details) {
          add("    Source explanation:");
          for (const line of advisory.details.split("\n"))
            add(line.trim() ? `      ${line}` : "");
        }
        renderAffected(advisory.affected ?? [], add, "    ");
        for (const reference of advisory.references ?? [])
          add(
            `    Reference ${reference.type}: ${reference.url || "URL unavailable"}`,
          );
        safety(advisory.contentSafety, add, "    ");
      } else
        add(
          "    Original source ranges, Git evidence, vectors and references: use --verbose or --json.",
        );
    }
    for (const detail of lookup?.unknownDetails ?? []) {
      add(
        `  Unknown ${detail.section} [${detail.code}; retryable=${detail.retryable}]: ${detail.message}`,
      );
      if (detail.candidateIds !== null)
        add(
          `    Candidates${detail.candidateIdsTruncated ? " (truncated)" : ""}: ${detail.candidateIds.join(", ") || "none supplied"}`,
        );
      if (detail.path) add(`    Field: ${detail.path.join(".")}`);
    }
    if (
      result.error &&
      !lookup?.unknownDetails.some(
        (detail) =>
          detail.code === result.error?.code &&
          detail.message === result.error?.error,
      )
    ) {
      add(
        `  Error [${result.error.code}; retryable=${result.error.retryable}]: ${result.error.error}`,
      );
    }
    if (result.error?.code === "NOT_FOUND" && !connection?.entries.length)
      add(
        "  For package/version assessment, use githits pkg vulns <registry>:<name>@<installed-version>.",
      );
    if (result.error?.details?.notAttempted)
      add(
        lookup
          ? "  Remaining package pages not read after an earlier access failure."
          : "  Not attempted after an earlier access failure.",
      );
  }
  add();
  add(
    "Source-reported fixes are evidence, not verified safe upgrades. Missing evidence does not establish safety.",
  );
  return `${lines.map(sanitizeTerminalText).join("\n")}\n`;
}

function renderEvidence(
  evidence:
    | NonNullable<LookupPackage["sourceEvidence"]>
    | LookupPackage["advisories"][number],
  origin: string,
  add: (line?: string) => void,
  verbose?: boolean,
): void {
  add(
    `    ${evidence.osvId ?? "unknown advisory ID"} [${origin}]${evidence.withdrawnAt !== null ? " [WITHDRAWN]" : ""}`,
  );
  const display = evidence.affectedVersionDisplay;
  add(
    `      Affected: ${display ? display.ranges.join("; ") || "no displayable ranges; affectedness unknown" : evidence.affectedVersionRanges?.join("; ") || "unknown"}`,
  );
  if (display?.truncated)
    add(
      `      Display truncated: ${display.ranges.length} of ${display.totalCount} spans. Use --verbose/--json for raw range evidence.`,
    );
  add(
    `      Source fixes: ${evidence.fixedInVersions?.join(", ") || "unknown"}`,
  );
  add(`      ${evidence.sourceUrl}`);
  if (evidence.withdrawnAt !== null)
    add(`      Withdrawn: ${evidence.withdrawnAt}`);
  if (evidence.modifiedAt !== undefined)
    add(`      Revision: ${evidence.modifiedAt ?? "unknown"}`);
  if (verbose) {
    add(
      `      Raw affected evidence: ${evidence.affectedVersionRanges?.join("; ") || "unknown"}`,
    );
    if ("publishedAt" in evidence)
      add(`      Published: ${evidence.publishedAt ?? "unknown"}`);
    safety(evidence.contentSafety, add, "      ");
  }
}
function renderAffected(
  entries: NonNullable<NonNullable<AdvisoryLookup["advisory"]>["affected"]>,
  add: (line?: string) => void,
  indent: string,
): void {
  if (!entries.length) add(`${indent}Original affected evidence: unknown`);
  for (const entry of entries) {
    add(
      `${indent}Original affected: ${entry.package ? `${entry.package.ecosystem}:${entry.package.name}` : "package-less repository/commit evidence"}`,
    );
    if (entry.package?.purl) add(`${indent}  Purl: ${entry.package.purl}`);
    for (const severity of entry.severity)
      add(
        `${indent}  Entry severity: ${severity.type} ${severity.score}${severity.source ? ` (${severity.source})` : ""}`,
      );
    if (entry.versions.length)
      add(
        `${indent}  Explicit affected versions: ${entry.versions.join(", ")}`,
      );
    for (const range of entry.ranges) {
      add(`${indent}  ${range.type}${range.repo ? ` ${range.repo}` : ""}`);
      for (const event of range.events) {
        for (const [key, value] of Object.entries(event))
          if (value !== null)
            add(
              `${indent}    ${key}: ${value}${key === "fixed" ? " (source fix event)" : key === "limit" || key === "lastAffected" ? " (boundary, not a fix)" : ""}`,
            );
      }
    }
    if (!entry.ranges.length && !entry.versions.length)
      add(`${indent}  Affected versions/ranges: unknown`);
  }
}
function safety(
  report: { filtered: boolean; modifications: string[] } | undefined,
  add: (line?: string) => void,
  indent: string,
): void {
  if (report)
    add(
      `${indent}Content normalization: ${report.filtered ? "modified" : "unchanged"}${report.modifications.length ? ` (${report.modifications.join(", ")})` : ""}; may include unselected fields.`,
    );
}
function shellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
