import type { Language } from "../services/githits-service.js";

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
 */
export function filterLanguages(
  languages: Language[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): LanguageMatch[] {
  const lowerQuery = query.toLowerCase();

  return languages
    .filter(
      (lang) =>
        lang.name.toLowerCase().includes(lowerQuery) ||
        lang.display_name.toLowerCase().includes(lowerQuery) ||
        lang.aliases.some((a) => a.toLowerCase().includes(lowerQuery)),
    )
    .slice(0, limit)
    .map(({ name, display_name, aliases }) => ({
      name,
      display_name,
      aliases,
    }));
}
