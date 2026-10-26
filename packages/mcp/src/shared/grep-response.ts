import {
  type GrepPathWarning,
  type GrepResult,
  parseGrepResult,
} from "@githits/core-internal";

/** Frontend pages retain result data and expose only compact warning strings. */
export interface GrepResponse extends Omit<GrepResult, "pathWarnings"> {
  pathWarnings: string[];
}

/** Summarize backend evidence once per distinct correction, without guessing paths. */
export function summarizeGrepPathWarnings(
  warnings: GrepPathWarning[],
): string[] {
  return [
    ...new Set(
      warnings.map((warning) => {
        const suggestion = warning.suggestions.find(
          (entry) => entry.target === warning.target,
        );
        return `Path is prefixed with package path ${JSON.stringify(warning.repositorySubpath)}.${suggestion ? ` Did you mean ${JSON.stringify(suggestion.path)}?` : ""}`.replace(
          // JSON leaves DEL/C1 literal; keep both output formats terminal-safe.
          /[\u007f-\u009f]/g,
          (character) =>
            `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
        );
      }),
    ),
  ];
}

/** Validate and copy the page, compacting only advisory presentation. */
export function projectGrepResult(result: GrepResult): GrepResponse {
  // The wire contract requires the array; injected providers may predate it.
  const projected = parseGrepResult({
    ...result,
    indexingEstimates: result.indexingEstimates ?? [],
    targetResolutions:
      result.targetResolutions === undefined ? [] : result.targetResolutions,
  });
  if (result.indexingEstimates === undefined)
    delete projected.indexingEstimates;
  if (result.targetResolutions === undefined)
    delete projected.targetResolutions;
  return {
    ...projected,
    pathWarnings: summarizeGrepPathWarnings(projected.pathWarnings),
  };
}
