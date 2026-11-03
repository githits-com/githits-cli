import {
  sanitizeTerminalText,
  terminalWidth,
  wrapTerminalProse,
} from "@githits/mcp/internal";
import {
  buildVulnsResponse,
  type VulnsOriginalAffected,
  type VulnsResult,
  type VulnsSourceDetail,
} from "./vulns-response.js";

export type { VulnsError, VulnsResult } from "./vulns-response.js";

/** One projected contract for human text and JSON; source metadata is printed once. */
export function formatVulns(
  results: VulnsResult[],
  options: { verbose?: boolean; width?: number } = {},
): string {
  const lines: string[] = [];
  const width = options.width && options.width > 0 ? options.width : 80;
  const add = (line = "", continuationIndent?: string): void => {
    const indent = continuationIndent ?? `${line.match(/^\s*/)?.[0] ?? ""}  `;
    lines.push(...wrapTerminalProse(line, width, indent));
  };
  // Ranges are indivisible evidence items; never imply an open bound by splitting a span.
  const addItems = (
    prefix: string,
    items: string[],
    separator: string,
  ): void => {
    const indent = `${prefix.match(/^\s*/)?.[0] ?? ""}  `;
    let line = sanitizeTerminalText(prefix);
    let hasItem = false;
    items.forEach((item, index) => {
      const atom =
        sanitizeTerminalText(item) +
        (index < items.length - 1 ? separator : "");
      const next = line + (hasItem ? " " : "") + atom;
      if (terminalWidth(next) > width) {
        lines.push(line.trimEnd());
        line = indent + atom;
      } else line = next;
      hasItem = true;
    });
    lines.push(line.trimEnd());
  };
  const reports = buildVulnsResponse(results, options).results;
  for (const report of reports) {
    if (lines.length) add();
    const advisory = report.advisory;
    const input = report.inputId.trim() || "(empty ID)";
    const id =
      advisory && advisory.id !== input ? `${input} -> ${advisory.id}` : input;
    const count = report.coverage
      ? ` | ${report.coverage.returned} package${report.coverage.returned === 1 ? "" : "s"}`
      : "";
    add(
      `${id}${report.status === "success" ? "" : ` | ${report.status}`}${count}${advisory?.withdrawnAt ? " [WITHDRAWN]" : ""}`,
    );
    if (advisory?.summary) add(advisory.summary);
    for (const diagnostic of report.diagnostics ?? []) {
      const location =
        diagnostic.packageIndex !== undefined
          ? ` (package ${diagnostic.packageIndex + 1})`
          : "";
      add(`  ${diagnostic.code}${location}: ${diagnostic.message}`);
      if (diagnostic.candidateIds) {
        add(
          `  Candidates${diagnostic.candidateIdsTruncated ? " (more omitted)" : ""}: ${diagnostic.candidateIds.join(", ") || "none supplied"}`,
        );
        if (diagnostic.candidateIds.length)
          add("  Choose an ID: githits vulns <candidate-id>");
      }
      if (diagnostic.action && !diagnostic.message.includes(diagnostic.action))
        add(`  ${diagnostic.action}`);
      if (diagnostic.hint && !diagnostic.message.includes(diagnostic.hint))
        add(`  ${diagnostic.hint}`);
      if (diagnostic.retryable && !/try again|retry/i.test(diagnostic.message))
        add(
          diagnostic.retryAfterSeconds !== undefined
            ? `  Retry in ${Math.ceil(diagnostic.retryAfterSeconds)} seconds.`
            : "  Retry this lookup.",
        );
      if (diagnostic.notAttempted)
        add("  Not attempted after an earlier access failure.");
    }
    if (advisory) {
      add(advisory.url);
      if (advisory.withdrawnAt) add(`Withdrawn: ${advisory.withdrawnAt}`);
    }
    for (const pkg of report.packages ?? []) {
      add();
      add(
        `  ${pkg.target ?? `${pkg.ecosystem ?? pkg.registry ?? "unknown ecosystem"}:${pkg.name}`} ${pkg.assessment === "unsupported_registry" && !pkg.target ? "(unmapped registry)" : ""}`.trimEnd(),
      );
      if (pkg.url) add(`  ${pkg.url}`);
      for (const evidence of pkg.evidence) {
        const refs = evidence.sourceIndexes
          .map(
            (index) =>
              `${index + 1}${report.sources?.[index]?.withdrawnAt ? " WITHDRAWN" : ""}${report.sources?.[index]?.malicious ? " MALICIOUS" : ""}`,
          )
          .join(", ");
        const ranges = evidence.affected ?? evidence.affectedDisplay?.ranges;
        const affected =
          evidence.affected === null ? "unknown" : "none reported";
        if (ranges?.length)
          addItems(
            `    Affected [${refs}]: `,
            ranges.map((range) =>
              range.startsWith("osv-invalid:")
                ? "(unevaluable source range)"
                : range,
            ),
            ";",
          );
        else add(`    Affected [${refs}]: ${affected}`);
        if (evidence.affectedTruncated)
          add(
            `    Showing ${evidence.affected?.length} of ${evidence.affectedTotal} spans; ${options.verbose ? "raw evidence follows." : "add --verbose for raw evidence."}`,
          );
        if (evidence.affectedDisplay?.truncated)
          add(
            `    Display: ${evidence.affectedDisplay.ranges.length} of ${evidence.affectedDisplay.totalCount} spans; truncated display-only evidence.`,
          );
        if (evidence.fixed?.length)
          addItems("    Source fixes: ", evidence.fixed, ",");
        else
          add(
            `    Source fixes: ${evidence.fixed === null ? "unknown" : "none reported"}`,
          );
        for (const detail of evidence.details ?? []) {
          add(`    Original package evidence [${detail.sourceIndex + 1}]:`);
          if (detail.reportedPackage)
            add(
              `      Source package: ${detail.reportedPackage.registry ?? "unknown registry"}:${detail.reportedPackage.name ?? "unknown name"}`,
            );
          if (detail.rawAffected?.length)
            addItems("      Raw affected: ", detail.rawAffected, ";");
          else if (detail.rawAffected !== undefined)
            add(
              `      Raw affected: ${detail.rawAffected === null ? "unknown" : "none reported"}`,
            );
          renderDetail(detail, add, "      ");
        }
      }
    }
    if (report.coverage && !report.packages?.length && advisory)
      add(
        "  No named package mappings; source evidence may identify repository versions.",
      );
    if (report.sources?.length) {
      add();
      add("Sources:");
      report.sources.forEach((source, index) => {
        const severity = source.severity
          ? source.severity.type === "SEVERITY_LABEL"
            ? `${source.severity.score} (label approximation, not calculated CVSS)`
            : `${source.severity.score}${source.severity.type ? ` (${source.severity.type.replace("CVSS_V", "CVSS v")})` : " (unknown severity type)"}`
          : undefined;
        add(
          `  [${index + 1}] ${source.id ?? "ID unavailable"} | ${source.origin === "live" ? "live source" : "local corpus"}${severity ? ` | ${severity}` : ""}${source.malicious ? " [MALICIOUS]" : ""}${source.withdrawnAt ? " [WITHDRAWN]" : ""}`,
        );
        if (source.summary) add(`    ${source.summary}`);
        if (source.url !== advisory?.url) add(`    ${source.url}`);
        if (source.withdrawnAt && source.withdrawnAt !== advisory?.withdrawnAt)
          add(`    Withdrawn: ${source.withdrawnAt}`);
        if (options.verbose) renderDetail(source, add, "    ");
      });
    }
    if (advisory && options.verbose) {
      add();
      add("Original source:");
      if (advisory.explanation)
        for (const line of advisory.explanation.split("\n"))
          add(line.trim() ? `  ${line}` : "");
      for (const severity of advisory.severity ?? [])
        add(
          `  Severity: ${severity.type} ${severity.score}${severity.source ? ` (${severity.source})` : ""}`,
        );
      renderDetail(advisory, add, "  ");
      for (const reference of advisory.references ?? [])
        add(
          `  Reference ${reference.type}: ${reference.url || "URL unavailable"}`,
        );
    }
    if (report.coverage) {
      const coverage = report.coverage;
      add();
      add(
        `Evidence: live source ${status(coverage.live)}; local corpus ${status(coverage.local)}. Packages: ${coverage.returned}/${coverage.total}${coverage.complete ? "." : " (INCOMPLETE)."}`,
      );
    }
  }
  const packages = reports.flatMap((report) => report.packages ?? []);
  if (packages.some((pkg) => pkg.target && !pkg.assessment)) {
    add();
    add(
      "Assess an installed version: githits pkg vulns '<target>@<installed-version>'",
    );
  }
  if (packages.some((pkg) => pkg.target?.startsWith("go:")))
    add(
      "Go entries may identify import paths or the standard library; use their links to identify the module or Go release.",
    );
  if (reports.some((report) => report.advisory)) {
    if (!options.verbose) add("Original source detail: add --verbose.");
  }
  if (packages.length || reports.some((report) => report.advisory)) {
    add(
      "Source fixes are unverified; missing evidence does not establish safety.",
    );
  }
  return `${lines.map(sanitizeTerminalText).join("\n")}\n`;
}

function status(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}
function renderDetail(
  detail: VulnsSourceDetail,
  add: (line?: string) => void,
  indent: string,
): void {
  if (detail.aliases?.length)
    add(`${indent}Aliases: ${detail.aliases.join(", ")}`);
  if (detail.publishedAt) add(`${indent}Published: ${detail.publishedAt}`);
  if (detail.modifiedAt) add(`${indent}Revision: ${detail.modifiedAt}`);
  for (const entry of detail.originalAffected ?? [])
    renderAffected(entry, add, indent);
  if (detail.normalization)
    add(
      `${indent}Content normalization: ${detail.normalization.filtered ? "modified" : "unchanged"}${detail.normalization.modifications.length ? ` (${detail.normalization.modifications.join(", ")})` : ""}`,
    );
}
function renderAffected(
  entry: VulnsOriginalAffected,
  add: (line?: string) => void,
  indent: string,
): void {
  add(
    `${indent}Original affected: ${entry.package ? `${entry.package.ecosystem}:${entry.package.name}` : "package-less repository/commit evidence"}`,
  );
  if (entry.package?.purl) add(`${indent}  Purl: ${entry.package.purl}`);
  for (const severity of entry.severity ?? [])
    add(
      `${indent}  Entry severity: ${severity.type} ${severity.score}${severity.source ? ` (${severity.source})` : ""}`,
    );
  if (entry.versions?.length)
    add(`${indent}  Explicit affected versions: ${entry.versions.join(", ")}`);
  for (const range of entry.ranges ?? []) {
    add(`${indent}  ${range.type}${range.repo ? ` ${range.repo}` : ""}`);
    for (const event of range.events)
      for (const [key, value] of Object.entries(event))
        add(
          `${indent}    ${key}: ${value}${key === "fixed" ? " (source fix event)" : key === "limit" || key === "lastAffected" ? " (boundary, not a fix)" : ""}`,
        );
  }
  if (!entry.ranges?.length && !entry.versions?.length)
    add(`${indent}  Affected versions/ranges: unknown`);
}
