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

/** Shared new OSV metadata for package explanations and advisory-wide detail. */
export function formatOsvSourceMetadata(
  source: Partial<OsvSourceMetadata>,
  width: number = 80,
): string[] {
  const lines: string[] = [];
  const add = (value: string): void => {
    lines.push(
      ...wrapTerminalProse(
        sanitizeTerminalText(value.replace(/[\t\r\n]+/g, " ")),
        width,
      ),
    );
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
): string[] {
  const lines: string[] = [];
  const add = (value: string): void => {
    lines.push(
      ...wrapTerminalProse(
        sanitizeTerminalText(value.replace(/[\t\r\n]+/g, " ")),
        width,
      ),
    );
  };
  add(`${source.osvId}${source.withdrawnAt !== null ? " [WITHDRAWN]" : ""}`);
  add(`  ${source.sourceUrl}`);
  if (source.summary) add(`  ${source.summary}`);
  if (source.publishedAt !== null) add(`  Published: ${source.publishedAt}`);
  add(`  Modified: ${source.modifiedAt}`);
  if (source.withdrawnAt !== null) add(`  Withdrawn: ${source.withdrawnAt}`);
  if (source.aliases.length) add(`  Aliases: ${source.aliases.join(", ")}`);
  lines.push(...formatOsvSourceMetadata(source, width));
  if (source.details) {
    add("  Explanation:");
    lines.push(...literalMarkdownLines(source.details));
  } else add("  No explanation supplied by source.");
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

/** Each original representative row keeps its own current-source outcome. */
export function formatPackageSourceDetails(
  entries: VulnerabilitySourceEntry[],
  width: number = 80,
): string {
  if (!entries.length) return "";
  const blocks = [
    wrapTerminalProse(
      "Current OSV source evidence (does not recompute the assessment):",
      width,
    ).join("\n"),
  ];
  for (const entry of entries) {
    if (entry.source)
      blocks.push(formatOsvSourceDetails(entry.source, width).join("\n"));
    else {
      const id = sanitizeTerminalText(entry.advisoryId ?? "(no source ID)");
      const message = entry.error?.message ?? "Current OSV source unavailable.";
      const retry = entry.error
        ? ` ${entry.error.retryable ? "Retryable." : "Not retryable."}${entry.error.retryAfterSeconds !== undefined ? ` Retry after ${entry.error.retryAfterSeconds}s.` : ""}`
        : "";
      blocks.push(
        wrapTerminalProse(`${id}: ${message}${retry}`, width).join("\n"),
      );
    }
  }
  return blocks.join("\n\n");
}
