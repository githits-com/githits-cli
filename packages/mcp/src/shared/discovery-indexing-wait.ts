import type { DiscoveryIndexingEstimate } from "@githits/core-internal";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
} from "./code-navigation-defaults.js";

/**
 * Choose a bounded follow-up window from total execution evidence, not an ETA.
 * Jobs may overlap: use the largest upper bound without subtracting elapsed time.
 * Uncovered work retains the default floor; no ranges retain the default exactly.
 */
export function discoveryIndexingWaitMs(
  entries: readonly DiscoveryIndexingEstimate[] | undefined,
): number {
  let largestUpperSeconds: number | undefined;
  let hasUncoveredWork = false;
  for (const entry of entries ?? []) {
    const upperSeconds = entry.estimate?.upperSeconds;
    if (typeof upperSeconds === "number") {
      largestUpperSeconds = Math.max(
        largestUpperSeconds ?? upperSeconds,
        upperSeconds,
      );
    } else {
      hasUncoveredWork = true;
    }
  }
  if (largestUpperSeconds === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  const roundedMs = Math.ceil((largestUpperSeconds + 10) / 10) * 10_000;
  return Math.min(
    MAX_WAIT_TIMEOUT_MS,
    Math.max(roundedMs, hasUncoveredWork ? DEFAULT_WAIT_TIMEOUT_MS : 0),
  );
}
