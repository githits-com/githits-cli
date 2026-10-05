import { terminalWidth } from "./terminal-width.js";

const ESC = String.fromCharCode(0x1b);

// Whole ANSI CSI/OSC/two-byte escape sequences, then any remaining C0/C1/DEL
// control characters that could re-style or spoof the caller's terminal.
const TERMINAL_CONTROL_PATTERN = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)?|[@-_])|[\\u0000-\\u001f\\u007f-\\u009f]`,
  "g",
);

/** Strip terminal-control sequences while preserving printable text exactly. */
export function sanitizeTerminalText(value: string): string {
  return value.replace(TERMINAL_CONTROL_PATTERN, "");
}

/** Wrap human prose while retaining bullet and continuation indentation. */
export function wrapTerminalProse(text: string, width: number = 80): string[] {
  return text.split("\n").flatMap((line) => {
    const safe = sanitizeTerminalText(line);
    if (!safe) return [""];
    const bullet = safe.startsWith("  - ");
    const prefix = safe.match(/^\s*/)?.[0] ?? "";
    const continuation = bullet ? "    " : prefix;
    const words = safe.trim().split(/\s+/);
    let current = bullet ? "  -" : prefix;
    if (bullet) words.shift();
    const lines: string[] = [];
    for (const word of words) {
      const next = current.trim() ? `${current} ${word}` : `${current}${word}`;
      if (current.trim() && terminalWidth(next) > width) {
        lines.push(current);
        current = `${continuation}${word}`;
      } else current = next;
    }
    if (current.trim()) lines.push(current);
    return lines;
  });
}
