import type { Language } from "@githits/core-internal";

export interface LanguageMatch {
  name: string;
  display_name: string;
  aliases: string[];
}

const DEFAULT_LIMIT = 5;

/**
 * Filter languages by case-insensitive substring match on name, display_name, or aliases.
 * Returns up to `limit` matches (default 5) with fields needed to choose
 * the exact `get_example` language input.
 *
 * Optimized to perform single-pass filtering and mapping with early exit once the limit is met,
 * and maintains strict short-circuiting of match conditions to maximize execution speed.
 */
export function filterLanguages(
  languages: Language[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): LanguageMatch[] {
  const lowerQuery = query.toLowerCase();
  const results: LanguageMatch[] = [];

  for (const lang of languages) {
    if (results.length >= limit) {
      break;
    }

    if (
      lang.name.toLowerCase().includes(lowerQuery) ||
      (lang.display_name?.toLowerCase().includes(lowerQuery) ?? false) ||
      (lang.aliases?.some((a) => a.toLowerCase().includes(lowerQuery)) ?? false)
    ) {
      results.push({
        name: lang.name,
        display_name: lang.display_name,
        aliases: lang.aliases,
      });
    }
  }

  return results;
}
