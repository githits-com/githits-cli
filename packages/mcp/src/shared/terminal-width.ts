import measureStringWidth from "fast-string-width";

/** Measure the number of terminal cells occupied by text. */
export function terminalWidth(text: string): number {
  return measureStringWidth(text);
}

/** Pad text to a terminal-cell width without misaligning wide Unicode glyphs. */
export function padTerminalEnd(text: string, width: number): string {
  const currentWidth = terminalWidth(text);
  return currentWidth >= width
    ? text
    : `${text}${" ".repeat(width - currentWidth)}`;
}
