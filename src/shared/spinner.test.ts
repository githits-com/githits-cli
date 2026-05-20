import { afterEach, describe, expect, it, mock } from "bun:test";
import { startSpinner } from "./spinner.js";

describe("startSpinner", () => {
  const origIsTTY = process.stderr.isTTY;
  const origWrite = process.stderr.write;

  afterEach(() => {
    process.stderr.isTTY = origIsTTY;
    process.stderr.write = origWrite;
  });

  function captureStderr(): string[] {
    const writes: string[] = [];
    process.stderr.write = mock((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    return writes;
  }

  it("is a no-op when disabled", () => {
    process.stderr.isTTY = true;
    const writes = captureStderr();

    startSpinner("Loading...", false).stop();

    expect(writes).toHaveLength(0);
  });

  it("is a no-op when stderr is not a TTY", () => {
    process.stderr.isTTY = false;
    const writes = captureStderr();

    startSpinner("Loading...").stop();

    expect(writes).toHaveLength(0);
  });

  it("renders a frame on stderr and clears the line on stop", () => {
    process.stderr.isTTY = true;
    const writes = captureStderr();

    const spinner = startSpinner("Loading...");
    expect(writes.some((w) => w.includes("Loading..."))).toBe(true);

    spinner.stop();
    expect(writes[writes.length - 1]).toBe("\r\x1b[2K");
  });

  it("accepts a rotating message list and shows the first label", () => {
    process.stderr.isTTY = true;
    const writes = captureStderr();

    startSpinner(["First label...", "Second label..."]).stop();

    expect(writes.some((w) => w.includes("First label..."))).toBe(true);
  });
});
