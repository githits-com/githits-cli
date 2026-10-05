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
): string | undefined {
  if (!estimate) return undefined;
  const parts: string[] = [];
  if (
    estimate.lowerSeconds !== undefined &&
    estimate.upperSeconds !== undefined
  )
    parts.push(
      `Estimated indexing time: ${estimate.lowerSeconds}-${estimate.upperSeconds}s total`,
    );
  if (estimate.elapsedSeconds !== undefined)
    parts.push(`Time spent indexing: ${estimate.elapsedSeconds}s`);
  return parts.length ? `${parts.join(". ")}.` : undefined;
}

/** Timing evidence stays advisory; entries never replace a tool's lifecycle/action. */
export function renderIndexingEstimates(
  entries: readonly DiscoveryIndexingEstimate[] | undefined,
): string[] {
  return (entries ?? []).map((entry) => {
    const label = entry.targets.map(safe).join(", ");
    const timing = formatIndexingDuration(entry.estimate);
    const missing =
      entry.unavailableReason === "NO_HISTORY"
        ? "Not enough history to estimate indexing time."
        : entry.unavailableReason === "UNSUPPORTED_WORK"
          ? "No time estimate is available for preparing documentation."
          : undefined;
    return `${label}: ${[timing, missing].filter(Boolean).join(" ") || "Indexing time estimate unavailable."}`;
  });
}
