import type { DiscoveryIndexingEstimate } from "@githits/core-internal";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_DISCOVERY_WAIT_TIMEOUT_MS,
} from "./code-navigation-defaults.js";

/** Use total execution evidence to suggest a wait, never a remaining-time ETA. */
export function indexingWaitMs(
  entries: readonly DiscoveryIndexingEstimate[] | undefined,
  maxWaitMs: number = MAX_DISCOVERY_WAIT_TIMEOUT_MS,
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
    } else hasUncoveredWork = true;
  }
  if (largestUpperSeconds === undefined)
    return Math.min(maxWaitMs, DEFAULT_WAIT_TIMEOUT_MS);
  const roundedMs = Math.ceil((largestUpperSeconds + 10) / 10) * 10_000;
  return Math.min(
    maxWaitMs,
    Math.max(roundedMs, hasUncoveredWork ? DEFAULT_WAIT_TIMEOUT_MS : 0),
  );
}
