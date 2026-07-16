const MAX_ERROR_DETAIL_LENGTH = 500;

/**
 * Extract a bounded, single-line error detail from explicitly allowed JSON
 * fields. Plain-text and HTML response bodies are never returned.
 */
export function parseHttpErrorDetail(
  body: string,
  fields: readonly string[],
): string | undefined {
  if (!body) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;
  for (const field of fields) {
    const value = parsed[field];
    if (typeof value !== "string") continue;
    const normalized = normalizeSingleLineText(value);
    if (!normalized) continue;
    if (normalized.length <= MAX_ERROR_DETAIL_LENGTH) return normalized;
    return `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH - 3)}...`;
  }

  return undefined;
}

export function normalizeSingleLineText(value: string): string {
  const withoutControlCharacters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
  return withoutControlCharacters.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
