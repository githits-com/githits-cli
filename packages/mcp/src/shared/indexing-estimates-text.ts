import type {
  DiscoveryIndexingEstimate,
  IndexingDurationEstimate,
} from "@githits/core-internal";

/** Preserve backend Unicode while making timing/target prose safe on one line. */
function safe(value: string): string {
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
    const label = entry.targets.map(safe).join(", ");
    return `${label}: ${formatIndexingEstimate(entry)}`;
  });
}
