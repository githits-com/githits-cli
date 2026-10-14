import { InvalidPackageSpecError } from "./package-spec.js";

export type ChangelogChangesView = "actionable" | "important" | "all";

/** Normalize the shared public changelog filter values. */
export function normaliseChangelogChanges(
  raw: string | undefined,
): ChangelogChangesView {
  const value = raw?.trim().toLowerCase() || "all";
  if (value !== "actionable" && value !== "important" && value !== "all") {
    throw new InvalidPackageSpecError(
      "changes must be actionable, important (actionable + should know), or all.",
    );
  }
  return value;
}
