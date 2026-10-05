import { type GrepResult, parseGrepResult } from "@githits/core-internal";

/** Preserve the selected wire payload without aliasing caller-owned arrays. */
export function projectGrepResult(result: GrepResult): GrepResult {
  // The wire contract requires the array; injected providers may predate it.
  const projected = parseGrepResult({
    ...result,
    indexingEstimates: result.indexingEstimates ?? [],
  });
  if (result.indexingEstimates === undefined)
    delete projected.indexingEstimates;
  return projected;
}
