import type { SourceSecurity } from "@githits/core-internal";
import { sanitizeTerminalText, wrapTerminalProse } from "./terminal-text.js";

/** Present upstream evidence without turning local coverage into a safety claim. */
export function formatSourceSecurity(
  source: SourceSecurity | null,
  verbose: boolean,
  width: number,
): string {
  const lines = ["Upstream Git evidence"];
  if (source === null) {
    lines.push("Upstream Git evidence unavailable.");
  } else {
    lines.push(
      `${source.scope}: ${source.state}${source.reason ? ` (${source.reason})` : ""}`,
    );
    lines.push(
      `${source.affectedVulnerabilityCount} affected ${source.affectedVulnerabilityCount === 1 ? "finding" : "findings"}, grouped by aliases; independent of native counts, may overlap - do not sum.`,
    );
    lines.push(
      `Local assertions: ${source.totalAssertions} active | ${source.evaluatedAssertions} evaluated | ${source.unknownAssertions} unknown | ${source.unevaluatedAssertions} unevaluated.`,
    );
    if (source.unknownAssertions > 0)
      lines.push(
        "Unknown ranges can coexist with confirmed affected findings.",
      );
    if (source.repositoryUrl) lines.push(`Repository: ${source.repositoryUrl}`);
    if (source.commitSha) lines.push(`Commit: ${source.commitSha}`);
    if (source.proofKind)
      lines.push(`Release correspondence: ${source.proofKind}`);
    if (source.retryAt) lines.push(`Retry at: ${source.retryAt}`);
    if (source.sourceStale)
      lines.push(
        "Source checks are stale; retained outcomes remain separate from source freshness.",
      );
    if (source.assertionsTruncated)
      lines.push(
        `Assertion list truncated by backend (${source.assertions.length} shown); counts cover the full local selection.`,
      );
    for (const assertion of source.assertions) {
      lines.push(
        `  - ${assertion.sourceId}: ${assertion.status}${assertion.status === "WITHDRAWN" ? " (inactive provenance)" : ""}${assertion.complete ? "" : "; incomplete"}${assertion.sourceStale ? "; source stale" : ""}`,
      );
      if (assertion.aliases.length)
        lines.push(`    Aliases: ${assertion.aliases.join(", ")}`);
      for (const reason of assertion.reasons)
        lines.push(`    Reason: ${reason}`);
      if (
        assertion.otherRepositoryRanges !== null &&
        assertion.otherRepositoryRanges > 0
      )
        lines.push(
          `    Other repository ranges: ${assertion.otherRepositoryRanges}`,
        );
      if (verbose) {
        lines.push(`    Current digest: ${assertion.contentDigest}`);
        lines.push(
          `    Assessed digest: ${assertion.assessedContentDigest ?? "unavailable"}`,
        );
        lines.push(`    Source modified ns: ${assertion.sourceModifiedNs}`);
        lines.push(
          `    Evaluated: ${assertion.evaluatedAt ?? "unavailable"}; checked: ${assertion.checkedAt ?? "unavailable"}`,
        );
      }
    }
  }
  lines.push(
    "Native severity, withdrawal and advisory-scope filters do not filter upstream Git evidence.",
  );
  lines.push(
    "Local upstream Git evidence does not establish global safety, private-source coverage, reachability or installed-build applicability.",
  );
  // Treat backend identity/reason values as one line before wrapping prose.
  return lines
    .flatMap((line) =>
      wrapTerminalProse(
        sanitizeTerminalText(line.replace(/[\r\n\t]+/g, " ")),
        width,
      ),
    )
    .join("\n");
}
