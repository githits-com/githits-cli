import {
  formatOsvSourceMetadata,
  literalMarkdownLines,
  sanitizeTerminalText,
  terminalWidth,
  wrapTerminalProse,
} from "@githits/mcp/internal";
import {
  buildVulnsResponse,
  type VulnsOriginalAffected,
  type VulnsResult,
  type VulnsSource,
  type VulnsSourceDetail,
} from "./vulns-response.js";

export type { VulnsError, VulnsResult } from "./vulns-response.js";

const versionLabelOrder = new Intl.Collator("en", { numeric: true });

/** Presentation order only; never use for ecosystem precedence or vulnerability assessment. */
function orderedVersionLabels(values: readonly string[]): string[] {
  return [...values].sort(versionLabelOrder.compare);
}

function originalSeverity(type: string, score: string): string {
  const label = type.replace(/^CVSS_V([234])$/, "CVSS v$1");
  return `${label}${score.startsWith("CVSS:") ? " vector" : ""}: ${score}`;
}

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
    const identifiedIds = new Set(
      advisory
        ? [
            report.inputId.trim(),
            advisory.id,
            ...(report.sources
              ?.filter(isEquivalentSource)
              .flatMap((source) => (source.id ? [source.id] : [])) ?? []),
          ]
        : [],
    );
    const singleSource =
      report.sources?.length === 1 ? report.sources[0] : undefined;
    const equivalentSource = isEquivalentSource(singleSource);
    const numberedSources = !equivalentSource || options.verbose;
    const sharedSummary = report.sources?.[0]?.summary;
    const summary =
      advisory?.summary ??
      (sharedSummary &&
      report.sources?.every(
        (source) =>
          isEquivalentSource(source) && source.summary === sharedSummary,
      )
        ? sharedSummary
        : undefined);
    const renderSource = (
      source: NonNullable<typeof singleSource>,
      index: number,
    ): void => {
      const indent = numberedSources ? "    " : "  ";
      const sameIdentity = report.sources?.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.id === source.id &&
          other.url === source.url,
      );
      if (
        !numberedSources &&
        source.relationship === "advisory" &&
        source.url === advisory?.url &&
        (!source.summary || source.summary === summary) &&
        !source.malicious &&
        (!source.withdrawnAt || source.withdrawnAt === advisory?.withdrawnAt)
      )
        return;
      const relationship =
        source.relationship === "alias"
          ? "Alias"
          : source.relationship === "advisory"
            ? "Advisory"
            : source.relationship === "related"
              ? "Related advisory"
              : "Source";
      const identity =
        options.verbose && isEquivalentSource(source)
          ? `${source.id ?? "ID unavailable"}${source.relationship === "alias" ? " (same vulnerability)" : ""}`
          : `${relationship}: ${source.id ?? "ID unavailable"}`;
      add(
        `${numberedSources ? `  [${index + 1}] ` : ""}${identity}${sameIdentity ? ` | ${source.origin === "live" ? "live source" : "indexed record"}` : ""}${source.severity && !isEquivalentSource(source) ? ` | ${source.severity.type.replace("CVSS_V", "CVSS v")}: ${source.severity.score}` : ""}${source.malicious ? " [MALICIOUS]" : ""}${source.withdrawnAt ? " [WITHDRAWN]" : ""}`,
      );
      if (source.summary && source.summary !== summary)
        add(`${indent}${source.summary}`);
      if (source.url !== advisory?.url) add(`${indent}${source.url}`);
      if (source.withdrawnAt && source.withdrawnAt !== advisory?.withdrawnAt)
        add(`${indent}Withdrawn: ${source.withdrawnAt}`);
      if (options.verbose) {
        const metadata =
          source.relationship === "advisory"
            ? {
                ...source,
                aliases: source.aliases?.filter(
                  (id) => !advisory?.aliases?.includes(id),
                ),
                publishedAt:
                  source.publishedAt === advisory?.publishedAt
                    ? undefined
                    : source.publishedAt,
                modifiedAt:
                  source.modifiedAt === advisory?.modifiedAt
                    ? undefined
                    : source.modifiedAt,
              }
            : source;
        renderDetail(
          metadata,
          add,
          indent,
          isEquivalentSource(source) ? identifiedIds : undefined,
        );
      }
    };
    const input = report.inputId.trim() || "(empty ID)";
    const count = report.coverage
      ? ` | ${report.coverage.returned} package${report.coverage.returned === 1 ? "" : "s"}`
      : "";
    add(
      `${input}${report.status === "success" ? "" : ` | ${report.status}`}${count}${advisory?.withdrawnAt ? " [WITHDRAWN]" : ""}`,
    );
    const scores = new Map<string, number[]>();
    report.sources?.forEach((source, index) => {
      if (!source.severity || !isEquivalentSource(source)) return;
      const label = `${source.severity.type.replace("CVSS_V", "CVSS v")}: ${source.severity.score}`;
      const refs = scores.get(label) ?? [];
      refs.push(index + 1);
      scores.set(label, refs);
    });
    for (const [label, refs] of scores)
      add(`${label}${numberedSources ? ` [${refs.join(", ")}]` : ""}`);
    if (advisory && advisory.id !== input)
      add(`Resolved advisory: ${advisory.id}`);
    if (summary) {
      const attribution = advisory?.summary
        ? ""
        : numberedSources
          ? `Summary [${report.sources?.map((_, index) => index + 1).join(", ")}]: `
          : `${singleSource?.relationship === "alias" ? "Alias" : "Source"} summary: `;
      add(`${attribution}${summary}`);
    }
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
    if (report.coverage) {
      const coverage = report.coverage;
      if (!coverage.complete)
        add(
          `  Package coverage: ${coverage.returned}/${coverage.total} (INCOMPLETE).`,
        );
      const liveStatusExplained =
        (coverage.live === "AMBIGUOUS" &&
          report.diagnostics?.some(
            (d) => d.code === "AMBIGUOUS_VULNERABILITY_ID",
          )) ||
        (coverage.live === "NOT_FOUND" &&
          report.status === "error" &&
          report.diagnostics?.some((d) => d.code === "NOT_FOUND"));
      const unavailable = [
        ...(coverage.live !== "AVAILABLE" && !liveStatusExplained
          ? [`live source ${status(coverage.live)}`]
          : []),
        ...(coverage.local !== "AVAILABLE"
          ? [`indexed records ${status(coverage.local)}`]
          : []),
      ];
      if (unavailable.length)
        add(`  Missing evidence: ${unavailable.join("; ")}.`);
    }
    if (advisory) {
      add(advisory.url);
      if (advisory.withdrawnAt) add(`Withdrawn: ${advisory.withdrawnAt}`);
    }
    if (singleSource && !numberedSources) renderSource(singleSource, 0);
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
        const markers = singleSource
          ? [
              singleSource.withdrawnAt ? "WITHDRAWN" : "",
              singleSource.malicious ? "MALICIOUS" : "",
            ]
              .filter(Boolean)
              .join(" ")
          : "";
        const attribution = numberedSources
          ? ` [${refs}]`
          : markers
            ? ` [${markers}]`
            : "";
        const ranges =
          evidence.affectedRanges ?? evidence.affectedDisplay?.ranges;
        const affected =
          evidence.affectedRanges === null ? "unknown" : "none reported";
        if (ranges?.length)
          addItems(
            `    Affected${attribution}: `,
            (options.verbose ? orderedVersionLabels(ranges) : ranges).map(
              (range) =>
                range.startsWith("osv-invalid:")
                  ? "(unevaluable source range)"
                  : range,
            ),
            ";",
          );
        else add(`    Affected${attribution}: ${affected}`);
        if (evidence.affectedTruncated)
          add(
            `    Showing ${evidence.affectedRanges?.length} of ${evidence.affectedTotal} spans; ${options.verbose ? "raw evidence follows." : "add --verbose for raw evidence."}`,
          );
        if (evidence.affectedDisplay?.truncated)
          add(
            `    Display: ${evidence.affectedDisplay.ranges.length} of ${evidence.affectedDisplay.totalCount} spans; truncated display-only evidence.`,
          );
        if (evidence.sourceFixVersions?.length)
          addItems(
            "    Source fixes: ",
            options.verbose
              ? orderedVersionLabels(evidence.sourceFixVersions)
              : evidence.sourceFixVersions,
            ",",
          );
        else
          add(
            `    Source fixes: ${evidence.sourceFixVersions === null ? "unknown" : "none reported"}`,
          );
        for (const detail of evidence.details ?? []) {
          const sharedOriginal = detail.advisoryAffectedIndexes !== undefined;
          if (
            sharedOriginal &&
            !detail.reportedPackage &&
            detail.rawAffected === undefined &&
            !detail.normalization
          )
            continue;
          add(`    Original package evidence [${detail.sourceIndex + 1}]:`);
          if (detail.reportedPackage)
            add(
              `      Source package: ${detail.reportedPackage.registry ?? "unknown registry"}:${detail.reportedPackage.name ?? "unknown name"}`,
            );
          if (detail.rawAffected?.length)
            addItems(
              "      Raw affected: ",
              orderedVersionLabels(detail.rawAffected),
              ";",
            );
          else if (detail.rawAffected !== undefined)
            add(
              `      Raw affected: ${detail.rawAffected === null ? "unknown" : "none reported"}`,
            );
          renderDetail(detail, add, "      ");
        }
      }
    }
    if (report.sources?.length && numberedSources) {
      add();
      if (options.verbose) add("Package evidence sources:");
      else if (report.sources.length > 1) add("Advisory records:");
      report.sources.forEach(renderSource);
    }
    if (advisory && options.verbose) {
      add();
      add(`Details: ${advisory.id}`);
      lines.push(...formatOsvSourceMetadata(advisory, width));
      if (advisory.explanation) {
        add("  Advisory text:");
        lines.push(...literalMarkdownLines(advisory.explanation));
      } else add("  No advisory text supplied by source.");
      for (const severity of advisory.severity ?? [])
        add(
          `  ${originalSeverity(
            severity.type,
            "vector" in severity ? severity.vector : severity.value,
          )}${severity.source ? ` (${severity.source})` : ""}`,
        );
      renderDetail(advisory, add, "  ", identifiedIds);
      const references = new Map<string, Set<string | null>>();
      for (const reference of advisory.references ?? []) {
        const urls = references.get(reference.type) ?? new Set<string | null>();
        urls.add(reference.url);
        references.set(reference.type, urls);
      }
      if (references.size) add("  References:");
      for (const [type, urls] of references) {
        add(`    ${type}:`);
        for (const url of urls) add(`      ${url || "URL unavailable"}`);
      }
    }
  }
  if (!options.verbose && reports.some((report) => report.advisory)) {
    add();
    add("Full advisory report: add --verbose.");
  }
  return `${lines.map(sanitizeTerminalText).join("\n")}\n`;
}

/** The formatter uses one identity rule for heading facts and source-scoped facts. */
function isEquivalentSource(source: VulnsSource | undefined): boolean {
  return (
    source?.relationship === "advisory" || source?.relationship === "alias"
  );
}

function status(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}
function renderDetail(
  detail: VulnsSourceDetail,
  add: (line?: string) => void,
  indent: string,
  identifiedIds?: ReadonlySet<string>,
): void {
  const aliases = detail.aliases?.filter((id) => !identifiedIds?.has(id));
  if (aliases?.length) add(`${indent}Aliases: ${aliases.join(", ")}`);
  if (detail.publishedAt) add(`${indent}Published: ${detail.publishedAt}`);
  if (detail.modifiedAt && detail.modifiedAt !== detail.publishedAt)
    add(`${indent}Updated: ${detail.modifiedAt}`);
  let previousPackage: string | undefined;
  const shownEntries = new Set<string>();
  for (const entry of detail.originalAffected ?? []) {
    const key = JSON.stringify(entry);
    if (shownEntries.has(key)) continue;
    shownEntries.add(key);
    const identity = JSON.stringify(entry.package ?? null);
    renderAffected(
      entry,
      add,
      indent,
      !entry.package || identity !== previousPackage,
    );
    previousPackage = identity;
  }
  if (detail.normalization)
    add(
      `${indent}Content normalization: ${detail.normalization.filtered ? "modified" : "unchanged"}${detail.normalization.modifications.length ? ` (${detail.normalization.modifications.join(", ")})` : ""}`,
    );
}
function renderAffected(
  entry: VulnsOriginalAffected,
  add: (line?: string) => void,
  indent: string,
  showHeading: boolean,
): void {
  if (showHeading) {
    add(
      `${indent}Original affected: ${entry.package ? `${entry.package.ecosystem}:${entry.package.name}` : entry.ranges?.some((range) => range.type === "GIT") ? "Repository evidence" : "Unmapped evidence"}`,
    );
    if (entry.package?.purl) add(`${indent}  Purl: ${entry.package.purl}`);
  }
  for (const severity of entry.severity ?? [])
    add(
      `${indent}  ${originalSeverity(
        severity.type,
        "vector" in severity ? severity.vector : severity.value,
      )}${severity.source ? ` (${severity.source})` : ""}`,
    );
  if (entry.versions?.length)
    add(
      `${indent}  Affected versions/tags: ${orderedVersionLabels(entry.versions).join(", ")}`,
    );
  for (const range of entry.ranges ?? []) {
    if (range.type !== "GIT") {
      const events = range.events
        .flatMap((event) =>
          Object.entries(event).map(
            ([key, value]) =>
              `${key === "lastAffected" ? "last affected" : key}: ${value}`,
          ),
        )
        .join("; ");
      add(
        `${indent}  ${range.type}${range.repo ? ` ${range.repo}` : ""}${events ? `: ${events}` : ""}`,
      );
      continue;
    }
    add(`${indent}  ${range.type}${range.repo ? ` ${range.repo}` : ""}`);
    for (const event of range.events)
      for (const [key, value] of Object.entries(event))
        add(
          `${indent}    ${key === "lastAffected" ? "last affected" : key}: ${value}`,
        );
  }
  if (!entry.ranges?.length && !entry.versions?.length)
    add(`${indent}  Affected versions/ranges: unknown`);
}
