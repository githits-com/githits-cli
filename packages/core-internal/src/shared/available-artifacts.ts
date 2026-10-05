import type { AvailableVersion } from "../services/code-navigation-service.js";

/** Preserve valid ref/version alternatives from backend error extensions. */
export function parseAvailableArtifacts(
  raw: unknown,
): AvailableVersion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: AvailableVersion[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "ref" in item) {
      const entry = item as { ref?: unknown; version?: unknown };
      if (typeof entry.ref === "string") {
        parsed.push({
          ref: entry.ref,
          version:
            typeof entry.version === "string" ? entry.version : undefined,
        });
      }
    }
  }
  return parsed.length > 0 ? parsed : undefined;
}
