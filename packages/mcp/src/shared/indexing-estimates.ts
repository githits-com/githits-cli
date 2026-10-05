import type { DiscoveryIndexingEstimate } from "@githits/core-internal";

/** Copy the public uniform envelope without retaining provider-owned arrays or extras. */
export function projectIndexingEstimates(
  entries: readonly DiscoveryIndexingEstimate[],
): DiscoveryIndexingEstimate[] {
  return entries.map((entry) => ({
    kind: entry.kind,
    targets: [...entry.targets],
    repositoryUrl: entry.repositoryUrl,
    commitSha: entry.commitSha,
    unavailableReason: entry.unavailableReason,
    estimate: entry.estimate
      ? {
          lowerSeconds: entry.estimate.lowerSeconds,
          upperSeconds: entry.estimate.upperSeconds,
          elapsedSeconds: entry.estimate.elapsedSeconds,
          sampleCount: entry.estimate.sampleCount,
          source: entry.estimate.source,
        }
      : undefined,
  }));
}
