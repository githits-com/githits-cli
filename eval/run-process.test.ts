import { describe, expect, it } from "bun:test";
import { isCommandAvailable, type RunProcessOptions } from "./run-process.js";

describe("isCommandAvailable", () => {
  it("uses which on POSIX platforms", async () => {
    const calls: RunProcessOptions[] = [];

    const available = await isCommandAvailable("codex", {
      platform: "linux",
      run: async (opts) => {
        calls.push(opts);
        return { exitCode: 0, stdout: "/usr/bin/codex\n", stderr: "" };
      },
    });

    expect(available).toBe(true);
    expect(calls).toEqual([{ cmd: ["which", "codex"], timeoutMs: 2000 }]);
  });

  it("uses where on Windows", async () => {
    const calls: RunProcessOptions[] = [];

    const available = await isCommandAvailable("codex", {
      platform: "win32",
      run: async (opts) => {
        calls.push(opts);
        return {
          exitCode: 0,
          stdout: "C:\\Users\\test\\bin\\codex.cmd\r\n",
          stderr: "",
        };
      },
    });

    expect(available).toBe(true);
    expect(calls).toEqual([{ cmd: ["where", "codex"], timeoutMs: 2000 }]);
  });

  it("returns false when the lookup command fails", async () => {
    const available = await isCommandAvailable("missing", {
      platform: "win32",
      run: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
    });

    expect(available).toBe(false);
  });
});
