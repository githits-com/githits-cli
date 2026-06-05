/**
 * Compact human-readable formatting for counts (stars, forks,
 * downloads). Uses K / M / B suffixes with floor semantics — we never
 * round past a magnitude boundary, so `10000` renders as `"10k"`, not
 * `"10.0k"` or `"10.1k"`.
 *
 * Rule set:
 * - `|n| < 1000` → the integer itself, no suffix.
 * - `1000 ≤ |n| < 1_000_000` → `"X.Yk"` for single-digit mantissas
 *   (under 10), otherwise `"Xk"` / `"XYk"` / `"XYZk"` for ≥10.
 * - `1_000_000 ≤ |n| < 1_000_000_000` → `M` suffix, same shape.
 * - `|n| ≥ 1_000_000_000` → `B` suffix, same shape.
 * - Negatives: `-` prefix with absolute-value formatting (magnitude-
 *   floor, i.e. `-1599` → `"-1.5k"`, `-1600` → `"-1.6k"`).
 * - Non-finite (`NaN`, `±Infinity`) throws `RangeError` — backend
 *   fields are `Int` so this is defence in depth against schema drift.
 */

export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new RangeError(
      `formatCompactNumber: non-finite input (${String(n)})`,
    );
  }

  if (n === 0) return "0";

  const negative = n < 0;
  const abs = Math.abs(n);
  const formatted = formatAbs(abs);
  return negative ? `-${formatted}` : formatted;
}

function formatAbs(abs: number): string {
  if (abs < 1_000) {
    // Floor to integer — guards against the vanishingly rare
    // non-integer input (schema says Int, but be defensive).
    return String(Math.trunc(abs));
  }
  if (abs < 1_000_000) {
    return withSuffix(abs, 1_000, "k");
  }
  if (abs < 1_000_000_000) {
    return withSuffix(abs, 1_000_000, "M");
  }
  return withSuffix(abs, 1_000_000_000, "B");
}

function withSuffix(abs: number, divisor: number, suffix: string): string {
  const scaled = abs / divisor;
  // Floor at one decimal to avoid rounding *up* across magnitude
  // boundaries (e.g. `9999` scaled is 9.999 → floor-1dp → 9.9, not
  // 10.0 — which would be wrong twice, both the decimal and the
  // suffix).
  if (scaled < 10) {
    const oneDp = Math.floor(scaled * 10) / 10;
    return `${oneDp.toFixed(1)}${suffix}`;
  }
  return `${Math.floor(scaled)}${suffix}`;
}
