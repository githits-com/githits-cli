import { describe, expect, it, mock } from "bun:test";
import { startSpinner } from "./spinner.js";

describe("startSpinner", () => {
  function createRuntime(stdoutIsTTY = true, stderrIsTTY = true) {
    const writes: string[] = [];
    const writeStderr = mock((chunk: string) => {
      writes.push(String(chunk));
    });
    return { runtime: { stdoutIsTTY, stderrIsTTY, writeStderr }, writes };
  }

  it("is a no-op when disabled", () => {
    const { runtime, writes } = createRuntime();

    startSpinner("Loading...", false, runtime).stop();

    expect(writes).toHaveLength(0);
  });

  it("is a no-op when stderr is not a TTY", () => {
    const { runtime, writes } = createRuntime(true, false);

    startSpinner("Loading...", true, runtime).stop();

    expect(writes).toHaveLength(0);
  });

  it("is a no-op when stdout is not a TTY", () => {
    const { runtime, writes } = createRuntime(false, true);

    startSpinner("Loading...", true, runtime).stop();

    expect(writes).toHaveLength(0);
  });

  it("renders a frame on stderr and clears the line on stop", () => {
    const { runtime, writes } = createRuntime();

    const spinner = startSpinner("Loading...", true, runtime);
    expect(writes.some((w) => w.includes("Loading..."))).toBe(true);

    spinner.stop();
    expect(writes[writes.length - 1]).toBe("\r\x1b[2K");
  });

  it("accepts a rotating message list and shows the first label", () => {
    const { runtime, writes } = createRuntime();

    startSpinner(["First label...", "Second label..."], true, runtime).stop();

    expect(writes.some((w) => w.includes("First label..."))).toBe(true);
  });
});
