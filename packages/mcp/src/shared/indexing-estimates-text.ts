import type {
  DiscoveryIndexingEstimate,
  IndexingDurationEstimate,
} from "@githits/core-internal";

import { wrapTerminalProse } from "./terminal-text.js";

/** Preserve backend Unicode while making timing/target prose safe on one line. */
export function escapePreparationTarget(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** Shared total-duration wording for uniform entries and legacy singular evidence. */
export function formatIndexingDuration(
  estimate: IndexingDurationEstimate | undefined,
  style: "full" | "compact" = "full",
): string | undefined {
  if (!estimate) return undefined;
  const parts: string[] = [];
  if (
    estimate.lowerSeconds !== undefined &&
    estimate.upperSeconds !== undefined
  )
    parts.push(
      style === "compact"
        ? `estimated total: ${estimate.lowerSeconds}-${estimate.upperSeconds}s`
        : `Estimated indexing time: ${estimate.lowerSeconds}-${estimate.upperSeconds}s total`,
    );
  if (estimate.elapsedSeconds !== undefined)
    parts.push(
      style === "compact"
        ? `time spent indexing: ${estimate.elapsedSeconds}s`
        : `Time spent indexing: ${estimate.elapsedSeconds}s`,
    );
  return parts.length
    ? style === "compact"
      ? parts.join(", ")
      : `${parts.join(". ")}.`
    : undefined;
}

/** Timing evidence stays advisory; entries never replace a tool's lifecycle/action. */
export function formatIndexingEstimate(
  entry: DiscoveryIndexingEstimate,
  style: "full" | "compact" = "full",
): string {
  const timing = formatIndexingDuration(entry.estimate, style);
  if (style === "compact") {
    const missing =
      entry.unavailableReason === "NO_HISTORY"
        ? "not enough history for an estimate"
        : entry.unavailableReason === "UNSUPPORTED_WORK"
          ? "no estimate available"
          : undefined;
    return (
      [timing, missing].filter(Boolean).join(", ") || "estimate unavailable"
    );
  }
  const missing =
    entry.unavailableReason === "NO_HISTORY"
      ? "Not enough history to estimate indexing time."
      : entry.unavailableReason === "UNSUPPORTED_WORK"
        ? "No time estimate is available for preparing documentation."
        : undefined;
  return (
    [timing, missing].filter(Boolean).join(" ") ||
    "Indexing time estimate unavailable."
  );
}

/** Add requested target labels to shared timing evidence. */
export function renderIndexingEstimates(
  entries: readonly DiscoveryIndexingEstimate[] | undefined,
): string[] {
  return (entries ?? []).map((entry) => {
    const label = entry.targets.map(escapePreparationTarget).join(", ");
    return `${label}: ${formatIndexingEstimate(entry)}`;
  });
}

/** Compact preparation evidence; the caller retains lifecycle and next-action ownership. */
export function renderPreparationEstimates(
  entries: readonly DiscoveryIndexingEstimate[] | undefined,
  repositoryState: string = "indexing",
): string[] {
  return (entries ?? []).map((entry) => {
    const state =
      entry.kind === "DOCUMENTATION"
        ? "preparing documentation"
        : repositoryState;
    return `  - ${entry.targets.map(escapePreparationTarget).join(", ")} (${state}, ${formatIndexingEstimate(entry, "compact")})`;
  });
}

export interface PreparationSectionOptions {
  repositoryState?: string;
  width?: number;
}

/** Keep preparation metadata separate from served content in every annotated tool. */
export function renderPreparationSection(
  entries: readonly DiscoveryIndexingEstimate[] | undefined,
  options: PreparationSectionOptions = {},
): string[] {
  const rows = renderPreparationEstimates(entries, options.repositoryState);
  return rows.length
    ? [
        "",
        "Preparing:",
        ...rows.flatMap((row) => wrapTerminalProse(row, options.width)),
      ]
    : [];
}

export interface PreparationRetryOptions {
  operation: string;
  syntax: "cli" | "mcp";
  waitMs: number;
  hasAfter?: boolean;
  cliUnit?: "milliseconds" | "seconds";
}

/** Native retry copy shared by successful preparation notices and mapped errors. */
export function formatPreparationRetry(
  options: PreparationRetryOptions,
): string {
  const argument =
    options.syntax === "mcp"
      ? `wait_timeout_ms=${options.waitMs}`
      : `--wait ${options.cliUnit === "seconds" ? options.waitMs / 1000 : options.waitMs}`;
  const cursor = options.hasAfter
    ? options.syntax === "mcp"
      ? " Leave out the after argument."
      : " Leave out --after."
    : "";
  return `Retry this ${options.operation} with ${argument}.${cursor}`;
}
