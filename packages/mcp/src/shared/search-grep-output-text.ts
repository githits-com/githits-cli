import { colors, dim } from "./colors.js";
import { wrapTerminalProse } from "./terminal-text.js";

export interface SearchGrepFooter {
  read?: readonly string[];
  more?: readonly string[];
  followUp?: readonly string[];
}

/** Shared fixed footer anatomy; tools own the meaning and exact action operands. */
export function appendSearchGrepFooter(
  lines: string[],
  footer: SearchGrepFooter,
  useColors: boolean,
): void {
  for (const [label, body] of [
    ["Read:", footer.read],
    ["More results:", footer.more],
    ["Follow-up:", footer.followUp],
  ] as const) {
    if (!body?.length) continue;
    lines.push(
      "",
      useColors ? `${colors.bold}${label}${colors.reset}` : label,
      ...body.map((line) => `  ${line}`),
    );
  }
}

/** Fixed operands bypass prose wrapping and retain identical plain text. */
export function footerAction(value: string, useColors: boolean): string {
  return dim(value, useColors);
}

/** Reserve the footer's two-column indent while wrapping only authored prose. */
export function footerProse(value: string, width: number): string[] {
  return wrapTerminalProse(value, Math.max(20, width) - 2);
}
