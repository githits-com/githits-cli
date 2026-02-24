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
 * Dim less important text
 */
export function dim(text: string, useColors: boolean): string {
  if (!useColors) return text;
  return `${colors.dim}${text}${colors.reset}`;
}
