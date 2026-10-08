import { MAX_DISCOVERY_WAIT_TIMEOUT_MS } from "./code-navigation-defaults.js";
import {
  escapePreparationTarget,
  formatIndexedAlternatives,
  formatIndexingDuration,
  formatPreparationRetry,
  renderPreparationSection,
} from "./indexing-estimates-text.js";
import { indexingWaitMs } from "./indexing-wait.js";
import type { MappedError } from "./mapped-error.js";
import { sanitizeTerminalText, wrapTerminalProse } from "./terminal-text.js";

export interface MappedErrorTextOptions {
  width?: number;
  indexingTarget?: string;
  indexingOutcome?: string;
}

export interface IndexingRetryOptions {
  maxWaitMs?: number;
  hasAfter?: boolean;
}

/** Tool boundaries supply native retry syntax; classification retains backend facts. */
export function withIndexingRetryAction(
  mapped: MappedError,
  operation: string,
  syntax: "cli" | "mcp",
  options: IndexingRetryOptions = {},
): MappedError {
  if (mapped.code !== "INDEXING") return mapped;
  const details = mapped.details ?? {};
  return {
    ...mapped,
    details: {
      ...details,
      action:
        details.action ??
        formatPreparationRetry({
          operation,
          syntax,
          hasAfter: options.hasAfter,
          waitMs: indexingWaitMs(
            details.indexingEstimates,
            options.maxWaitMs ?? MAX_DISCOVERY_WAIT_TIMEOUT_MS,
            details.indexingEstimate,
          ),
        }),
    },
  };
}

/** Human error content shared by CLI and MCP; JSON remains the complete evidence surface. */
export function formatMappedErrorText(
  mapped: MappedError,
  options: MappedErrorTextOptions = {},
): string {
  const details = mapped.details ?? {};
  const target = options.indexingTarget ?? details.package ?? details.repoUrl;
  const preparingDocumentation = target?.startsWith("site:") === true;
  const lines: string[] = [
    mapped.code === "INDEXING"
      ? (options.indexingOutcome ??
        (preparingDocumentation
          ? "Documentation is being prepared."
          : "Source is being indexed."))
      : mapped.message,
  ];
  const versions = details.availableVersions
    ?.filter(
      (entry) =>
        entry.version !== undefined ||
        !details.availableRefs?.some(
          (candidate) => candidate.ref === entry.ref,
        ),
    )
    .map((entry) =>
      mapped.code === "INDEXING"
        ? (entry.version ?? entry.ref)
        : entry.version
          ? `${entry.version} (ref: ${entry.ref})`
          : entry.ref,
    );
  const refs = details.availableRefs?.map((entry) => entry.ref);
  const indexedSummary = [
    versions?.length
      ? `versions/refs ${versions.slice(0, 5).join(", ")}${versions.length > 5 ? ` (+${versions.length - 5} more)` : ""}`
      : undefined,
    refs?.length
      ? `refs ${refs.slice(0, 5).join(", ")}${refs.length > 5 ? ` (+${refs.length - 5} more)` : ""}`
      : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  if (mapped.code === "INDEXING") {
    const rows = renderPreparationSection(details.indexingEstimates, {
      width: options.width,
      indexedAlternatives:
        target && indexedSummary
          ? [{ target, summary: indexedSummary }]
          : undefined,
    });
    if (rows.length) lines.push(...rows);
    else {
      const timing =
        formatIndexingDuration(details.indexingEstimate, "compact") ??
        "no estimate available";
      lines.push(
        "",
        "Preparing:",
        target
          ? `  - ${escapePreparationTarget(target)} (${preparingDocumentation ? "preparing documentation" : "indexing"}, ${timing})`
          : `  - Source (indexing, ${timing})`,
      );
    }
    if (
      indexedSummary &&
      !details.indexingEstimates?.some((entry) =>
        entry.targets.includes(target ?? ""),
      )
    )
      lines.push(
        formatIndexedAlternatives(
          indexedSummary,
          rows.length ? target : undefined,
        ),
      );
  }
  if (
    (mapped.code !== "INDEXING" && (versions?.length || refs?.length)) ||
    details.latestIndexed ||
    details.publishedVersions?.length
  )
    lines.push("");
  if (mapped.code !== "INDEXING" && versions?.length)
    lines.push(
      `Available versions/refs: ${versions.slice(0, 5).join(", ")}${versions.length > 5 ? ` (+${versions.length - 5} more)` : ""}`,
    );
  if (mapped.code !== "INDEXING" && refs?.length)
    lines.push(
      `Available refs: ${refs.slice(0, 5).join(", ")}${refs.length > 5 ? ` (+${refs.length - 5} more)` : ""}`,
    );
  if (details.latestIndexed)
    lines.push(`Latest indexed version: ${details.latestIndexed}`);
  if (details.publishedVersions?.length)
    lines.push(`Published versions: ${details.publishedVersions.join(", ")}`);
  if (details.refKinds?.length)
    lines.push(`Matching ref types: ${details.refKinds.join(", ")}`);
  if (details.side) lines.push(`Comparison side: ${details.side}`);
  if (details.codeDiffResolution)
    lines.push(
      `Compared commits: ${details.codeDiffResolution.from.commitSha} -> ${details.codeDiffResolution.to.commitSha}`,
    );
  if (details.updateCommand)
    lines.push("", `Update with: ${details.updateCommand}`);
  const retryAfterSeconds =
    details.retryAfterSeconds ??
    (details.retryAfterMs === undefined
      ? undefined
      : details.retryAfterMs / 1000);
  const rateLimitAdvice =
    mapped.code === "RATE_LIMITED" && retryAfterSeconds !== undefined;
  if (
    details.hint &&
    !lines.join("\n").includes(details.hint) &&
    details.hint !== details.action
  )
    lines.push("", details.hint);
  const width = options.width ?? 80;
  const output = lines.flatMap((line) => wrapTerminalProse(line, width));
  // Keep callable/copyable action operands intact, and avoid repeating host remediation.
  if (details.action && !lines.join("\n").includes(details.action))
    output.push("", ...details.action.split("\n").map(sanitizeTerminalText));
  if (
    !details.action &&
    mapped.retryable &&
    !hasRetryGuidance(lines.join("\n"))
  )
    output.push(
      "",
      rateLimitAdvice
        ? `Try again in ${Math.ceil(retryAfterSeconds)} seconds.`
        : "Try again.",
    );
  return output.join("\n");
}

/** Preserve existing retry advice instead of appending a second instruction. */
export function hasRetryGuidance(message: string): boolean {
  return /\b(?:retry|try again)\b/i.test(message);
}
