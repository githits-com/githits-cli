const MAX_KEYWORDS = 20;

/**
 * Raised when caller input cannot be normalised into a valid keyword
 * list. Classifier maps it to `INVALID_ARGUMENT`.
 */
export class InvalidKeywordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKeywordsError";
  }
}

/**
 * Combine comma-separated and repeated keyword inputs into a single,
 * de-duplicated, capped array.
 *
 * - `rawComma`: the value of a `--keywords "a,b,c"` option (CLI) or a
 *   single string passed via MCP (rare but accepted).
 * - `rawRepeated`: the collected values from a repeatable
 *   `--keyword <w>` CLI flag, or the array form of the MCP
 *   `keywords` argument.
 *
 * Both are trimmed, empty entries dropped, then merged with first-seen
 * order preserved. `InvalidKeywordsError` is thrown when the final
 * list exceeds 20 entries — the same cap the MCP schema enforces
 * (applied here *before* the service call so the error surfaces
 * client-side with a clear message).
 */
export function normaliseKeywords(
  rawComma?: string,
  rawRepeated?: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  if (rawComma !== undefined && rawComma !== "") {
    for (const piece of rawComma.split(",")) add(piece);
  }
  if (rawRepeated !== undefined) {
    for (const piece of rawRepeated) add(piece);
  }

  if (out.length > MAX_KEYWORDS) {
    throw new InvalidKeywordsError(
      `Too many keywords: got ${out.length}, maximum is ${MAX_KEYWORDS}.`,
    );
  }

  return out;
}
