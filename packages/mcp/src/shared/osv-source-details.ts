import type {
  OsvSourceDetails,
  OsvSourceMetadata,
  VulnerabilitySourceEntry,
} from "@githits/core-internal";
import {
  literalMarkdownLines,
  sanitizeTerminalText,
  wrapTerminalProse,
} from "./terminal-text.js";

/** Metadata whitespace separates words; source Markdown uses its literal emitter. */
function sourceProseLines(value: string, width: number): string[] {
  return wrapTerminalProse(
    sanitizeTerminalText(value.replace(/[\t\r\n]+/g, " ")),
    width,
  );
}

/** Shared new OSV metadata for package explanations and advisory-wide detail. */
export function formatOsvSourceMetadata(
  source: Partial<OsvSourceMetadata>,
  width: number = 80,
): string[] {
  const lines: string[] = [];
  const add = (value: string): void => {
    lines.push(...sourceProseLines(value, width));
  };
  if (source.schemaVersion) add(`  OSV schema: ${source.schemaVersion}`);
  if (source.relatedIds?.length)
    add(`  Related IDs: ${source.relatedIds.join(", ")}`);
  if (source.upstreamIds?.length)
    add(`  Upstream IDs: ${source.upstreamIds.join(", ")}`);
  if (source.credits?.length) {
    add("  Credits:");
    for (const credit of source.credits) {
      add(
        `    ${credit.name}${credit.type !== null ? ` [${credit.type}]` : ""}`,
      );
      for (const contact of credit.contact)
        if (contact) add(`      ${contact}`);
    }
  }
  return lines;
}

/** Full explicit source output has no body cap and never evaluates affectedness. */
export function formatOsvSourceDetails(
  source: OsvSourceDetails,
  width: number = 80,
  heading: string = source.osvId,
): string[] {
  const lines: string[] = [];
  const add = (value: string): void => {
    lines.push(...sourceProseLines(value, width));
  };
  add(`${heading}${source.withdrawnAt !== null ? " [WITHDRAWN]" : ""}`);
  add(`  ${source.sourceUrl}`);
  if (source.summary) add(`  ${source.summary}`);
  if (source.publishedAt !== null) add(`  Published: ${source.publishedAt}`);
  add(`  Modified: ${source.modifiedAt}`);
  if (source.withdrawnAt !== null) add(`  Withdrawn: ${source.withdrawnAt}`);
  if (source.aliases.length) add(`  Aliases: ${source.aliases.join(", ")}`);
  lines.push(...formatOsvSourceMetadata(source, width));
  if (source.details) {
    add("  Advisory text:");
    lines.push(...literalMarkdownLines(source.details));
  } else add("  No advisory text supplied by source.");
  for (const severity of source.severity)
    add(
      `  Source severity ${severity.type}: ${severity.score}${severity.source !== null ? ` (${severity.source})` : ""}`,
    );
  if (source.references.length) {
    add("  References:");
    for (const reference of source.references)
      add(`    ${reference.type}: ${reference.url || "URL unavailable"}`);
  }
  if (
    source.contentSafety.filtered ||
    source.contentSafety.modifications.length
  ) {
    add(
      `  Content normalization: ${source.contentSafety.filtered ? "modified" : "unchanged"}${source.contentSafety.modifications.length ? ` (${source.contentSafety.modifications.join(", ")})` : ""}`,
    );
  }
  return lines;
}

/** Display-only context owned by the package assessment formatter. */
export interface PackageSourceDetailDisplay extends VulnerabilitySourceEntry {
  assessmentLabel?: string;
  unlinked: boolean;
}

/** Every original source outcome survives text ordering, including unavailable records. */
export function formatPackageSourceDetails(
  entries: PackageSourceDetailDisplay[],
  width: number = 80,
): string {
  if (!entries.length) return "";
  const blocks = [
    wrapTerminalProse(
      "Current advisory reports from OSV (assessment above is not recomputed):",
      width,
    ).join("\n"),
  ];
  let unlinkedHeadingShown = false;
  entries.forEach((entry, index) => {
    if (entry.unlinked && !unlinkedHeadingShown) {
      blocks.push("Unlinked source records:");
      unlinkedHeadingShown = true;
    }
    const id = entry.source?.osvId ?? entry.advisoryId ?? "(no source ID)";
    const heading = `[${index + 1}/${entries.length}] ${id}${entry.assessmentLabel ? ` | Assessment: ${entry.assessmentLabel}` : ""}`;
    if (entry.source)
      blocks.push(
        formatOsvSourceDetails(entry.source, width, heading).join("\n"),
      );
    else {
      const message = entry.error?.message ?? "Current OSV source unavailable.";
      const retry = entry.error
        ? ` ${entry.error.retryable ? "Retryable." : "Not retryable."}${entry.error.retryAfterSeconds !== undefined ? ` Retry after ${entry.error.retryAfterSeconds}s.` : ""}`
        : "";
      blocks.push(
        [
          ...sourceProseLines(heading, width),
          ...sourceProseLines(`  ${message}${retry}`, width),
        ].join("\n"),
      );
    }
  });
  return blocks.join("\n\n");
}
