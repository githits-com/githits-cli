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
      `Estimated total indexing time: ${estimate.lowerSeconds}-${estimate.upperSeconds}s`,
    );
  if (estimate.elapsedSeconds !== undefined)
    parts.push(`Active indexing elapsed: ${estimate.elapsedSeconds}s`);
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
        ? "No indexing duration history is available."
        : entry.unavailableReason === "UNSUPPORTED_WORK"
          ? "No duration estimate is available for documentation preparation."
          : undefined;
    return `${label}: ${[timing, missing].filter(Boolean).join(" ") || "No indexing duration estimate is available."}`;
  });
}
