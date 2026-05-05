/**
 * Shared color utilities for CLI output
 */

// ANSI color codes
export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

/**
 * Check if we should use colors (TTY and not disabled)
 */
export function shouldUseColors(noColor?: boolean): boolean {
  if (noColor) return false;
  // Check NO_COLOR env var (standard)
  if (process.env.NO_COLOR !== undefined) return false;
  // Check if stdout is a TTY
  return process.stdout.isTTY ?? false;
}

/**
 * Colorize text if colors are enabled
 */
export function colorize(
  text: string,
  color: keyof typeof colors,
  useColors: boolean,
): string {
  if (!useColors) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Format success message with green checkmark
 */
export function success(text: string, useColors: boolean): string {
  const checkmark = useColors ? `${colors.green}✓${colors.reset}` : "✓";
  return `${checkmark} ${text}`;
}

/**
 * Format error message with red cross
 */
export function error(text: string, useColors: boolean): string {
  const cross = useColors ? `${colors.red}✗${colors.reset}` : "✗";
  return `${cross} ${text}`;
}

/**
 * Format warning message with yellow warning
 */
export function warning(text: string, useColors: boolean): string {
  const warn = useColors ? `${colors.yellow}⚠${colors.reset}` : "⚠";
  return `${warn} ${text}`;
}

/**
 * Highlight important text (project names, file paths, etc.)
 */
export function highlight(text: string, useColors: boolean): string {
  if (!useColors) return text;
  return `${colors.bold}${colors.cyan}${text}${colors.reset}`;
}

/**
 * Highlight matched search terms.
 */
export function highlightMatch(text: string, useColors: boolean): string {
  if (!useColors) return text;
  return `${colors.bold}${colors.yellow}${text}${colors.reset}`;
}

/**
 * Apply half-open character spans to a string.
 * Invalid or overlapping spans are ignored/merged conservatively.
 */
export function highlightRanges(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]> | undefined,
  useColors: boolean,
): string {
  if (!useColors || !text || !ranges || ranges.length === 0) return text;

  const normalised = ranges
    .filter(
      (range): range is readonly [number, number] =>
        Array.isArray(range) &&
        range.length === 2 &&
        Number.isInteger(range[0]) &&
        Number.isInteger(range[1]),
    )
    .map(([start, end]) => {
      const safeStart = Math.max(0, Math.min(text.length, start));
      const safeEnd = Math.max(safeStart, Math.min(text.length, end));
      return [safeStart, safeEnd] as const;
    })
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  if (normalised.length === 0) return text;

  const merged: Array<readonly [number, number]> = [];
  for (const current of normalised) {
    const previous = merged[merged.length - 1];
    if (!previous || current[0] > previous[1]) {
      merged.push(current);
      continue;
    }

    merged[merged.length - 1] = [
      previous[0],
      Math.max(previous[1], current[1]),
    ];
  }

  let result = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    if (cursor < start) result += text.slice(cursor, start);
    result += highlightMatch(text.slice(start, end), useColors);
    cursor = end;
  }
  if (cursor < text.length) result += text.slice(cursor);
  return result;
}

/**
 * Dim less important text
 */
export function dim(text: string, useColors: boolean): string {
  if (!useColors) return text;
  return `${colors.dim}${text}${colors.reset}`;
}
