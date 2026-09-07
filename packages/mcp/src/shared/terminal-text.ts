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
