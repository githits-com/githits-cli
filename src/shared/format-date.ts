/**
 * Date utilities for user-facing surfaces.
 *
 * - `toIsoDate` emits a `YYYY-MM-DD` slice of the UTC ISO. We commit
 *   to UTC rather than local time so the same backend timestamp
 *   renders identically across machines, CI, and test runs; it also
 *   protects against locale-dependent test flakes.
 * - `toRelativeDate` emits a coarse human-readable distance (`2 days
 *   ago`, `3 months ago`). Takes an optional `now` so tests can pin
 *   the clock.
 *
 * Both functions accept nullable input and return `null` on
 * missing/invalid dates rather than throwing — the response builder
 * treats them as omission sources, not exceptions.
 */

export function toIsoDate(iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function toRelativeDate(
  iso?: string | null,
  now: Date = new Date(),
): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;

  const deltaSeconds = Math.floor((now.getTime() - parsed.getTime()) / 1000);
  if (deltaSeconds < 0) {
    // Future date — degrade to absolute form rather than emit
    // nonsense like "in the future". Matches how agents render
    // malformed data.
    return toIsoDate(iso);
  }

  if (deltaSeconds < MINUTE) return "just now";
  if (deltaSeconds < HOUR) return formatUnit(deltaSeconds, MINUTE, "minute");
  if (deltaSeconds < DAY) return formatUnit(deltaSeconds, HOUR, "hour");
  if (deltaSeconds < MONTH) return formatUnit(deltaSeconds, DAY, "day");
  if (deltaSeconds < YEAR) return formatUnit(deltaSeconds, MONTH, "month");
  return formatUnit(deltaSeconds, YEAR, "year");
}

function formatUnit(deltaSeconds: number, unit: number, label: string): string {
  const n = Math.floor(deltaSeconds / unit);
  return `${n} ${label}${n === 1 ? "" : "s"} ago`;
}
