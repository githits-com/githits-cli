import { type GrepResult, parseGrepResult } from "@githits/core-internal";

/** Preserve the selected wire payload without aliasing caller-owned arrays. */
export function projectGrepResult(result: GrepResult): GrepResult {
  return parseGrepResult(result);
}
