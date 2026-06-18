import { colorizeBrand } from "@githits/mcp/internal";

const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;
const FRAME_INTERVAL_MS = 80;
const MESSAGE_INTERVAL_MS = 2000;

/** Handle for an active spinner. */
export interface Spinner {
  /** Stop the animation and clear the spinner line. */
  stop(): void;
}

interface SpinnerRuntime {
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  writeStderr?: (chunk: string) => void;
  useColors?: boolean;
}

/**
 * Start an animated progress spinner on stderr.
 *
 * Renders only when stdout and stderr are interactive TTYs, so piped output,
 * `--json` consumers, and agent/MCP callers never see spinner frames.
 * Writing to stderr keeps stdout (the command result) clean when interactive.
 *
 * Pass an array of labels to rotate them every ~2s while the glyph
 * keeps spinning; a single string stays fixed.
 */
export function startSpinner(
  message: string | readonly string[],
  enabled = true,
  runtime: SpinnerRuntime = {},
): Spinner {
  const stdoutIsTTY = runtime.stdoutIsTTY ?? process.stdout.isTTY;
  const stderrIsTTY = runtime.stderrIsTTY ?? process.stderr.isTTY;
  const writeStderr =
    runtime.writeStderr ?? ((chunk) => process.stderr.write(chunk));

  if (!enabled || !stdoutIsTTY || !stderrIsTTY) {
    return { stop: () => {} };
  }

  const messages = typeof message === "string" ? [message] : message;
  const framesPerMessage = Math.round(MESSAGE_INTERVAL_MS / FRAME_INTERVAL_MS);
  const useColors = runtime.useColors ?? process.env.NO_COLOR === undefined;
  let frame = 0;
  const render = (): void => {
    const glyph = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "|";
    const label =
      messages[Math.floor(frame / framesPerMessage) % messages.length] ?? "";
    frame += 1;
    writeStderr(
      `\r\x1b[2K${colorizeBrand(glyph, "primary", useColors)} ${label}`,
    );
  };

  render();
  const interval = setInterval(render, FRAME_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(interval);
      writeStderr("\r\x1b[2K");
    },
  };
}
