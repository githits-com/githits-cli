import { describe, expect, it } from "bun:test";
import { AuthStorageLockTimeoutError } from "../services/index.js";
import { AuthRequiredError } from "../shared/require-auth.js";
import { handleCliError } from "./errors.js";

describe("handleCliError", () => {
  it("exits without writing a stack trace for AuthRequiredError", () => {
    const stderrWrites: string[] = [];
    const exit = ((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as (code: number) => never;

    expect(() =>
      handleCliError(new AuthRequiredError("Authentication required"), {
        stderr: {
          write: (chunk: string | Uint8Array) => {
            stderrWrites.push(String(chunk));
            return true;
          },
        },
        exit,
      }),
    ).toThrow("process.exit:1");

    expect(stderrWrites.join("")).not.toContain("AuthRequiredError");
    expect(stderrWrites.join("")).not.toContain("at ");
  });

  it("prints lock timeout errors without an uncaught stack trace", () => {
    const stderrWrites: string[] = [];
    const exit = ((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as (code: number) => never;

    expect(() =>
      handleCliError(new AuthStorageLockTimeoutError("lock timed out"), {
        stderr: {
          write: (chunk: string | Uint8Array) => {
            stderrWrites.push(String(chunk));
            return true;
          },
        },
        exit,
      }),
    ).toThrow("process.exit:1");

    const output = stderrWrites.join("");
    expect(output).toContain("lock timed out");
    expect(output).not.toContain("AuthStorageLockTimeoutError");
    expect(output).not.toContain("at ");
  });
});
