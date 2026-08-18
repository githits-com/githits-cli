import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthRequiredError } from "@githits/mcp/internal";
import { AuthConfigError } from "../services/auth-config.js";
import { ExperimentalToolsDisabledError } from "../services/experimental-cli-policy.js";
import { ExperimentalConfigError } from "../services/experimental-config.js";
import { AuthStorageLockTimeoutError } from "../services/locked-auth-storage.js";
import { handleCliError, runCliMain } from "./errors.js";

describe("handleCliError", () => {
  const originalDebug = process.env.GITHITS_DEBUG;

  afterEach(() => {
    if (originalDebug === undefined) delete process.env.GITHITS_DEBUG;
    else process.env.GITHITS_DEBUG = originalDebug;
  });

  it("exits without writing a stack trace for AuthRequiredError", () => {
    const stderrWrites: string[] = [];
    const exit = ((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as (code: number) => never;

    expect(() =>
      handleCliError(
        new AuthRequiredError(
          "Authentication required.",
          "https://mcp.githits.com",
        ),
        {
          stderr: {
            write: (chunk: string | Uint8Array) => {
              stderrWrites.push(String(chunk));
              return true;
            },
          },
          exit,
        },
      ),
    ).toThrow("process.exit:1");

    const output = stderrWrites.join("");
    expect(output).toContain("Authentication required.");
    expect(output).toContain("githits login");
    expect(output).not.toContain("AuthRequiredError");
    expect(output).not.toContain("at ");
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

  it("prints experimental policy errors as concise user-facing failures", () => {
    const disabled = captureCliError(
      new ExperimentalToolsDisabledError("resolve", "/tmp/config.toml"),
    );
    expect(disabled.output).toContain("[experimental]\ntools = true");
    expect(disabled.output).not.toContain("githits doctor");

    const malformed = captureCliError(
      new ExperimentalConfigError(
        "Cannot parse GitHits config at /tmp/config.toml: invalid TOML",
      ),
    );
    expect(malformed.output).toContain("/tmp/config.toml");
    expect(malformed.output).not.toContain("githits doctor");
  });

  it("renders experimental policy errors as clean JSON when requested", () => {
    const disabled = captureCliError(
      new ExperimentalToolsDisabledError("code diff", "/tmp/config.toml"),
      true,
    );
    expect(disabled.output.trim()).toBe(
      JSON.stringify({
        error:
          'Experimental CLI command "code diff" is disabled. Enable it in /tmp/config.toml by adding:\n[experimental]\ntools = true',
        code: "INVALID_ARGUMENT",
        retryable: false,
      }),
    );

    const malformed = captureCliError(
      new ExperimentalConfigError(
        "Cannot parse GitHits config at /tmp/config.toml: invalid TOML",
      ),
      true,
    );
    expect(JSON.parse(malformed.output)).toEqual({
      error: "Cannot parse GitHits config at /tmp/config.toml: invalid TOML",
      code: "INVALID_ARGUMENT",
      retryable: false,
    });

    const authConfig = captureCliError(
      new AuthConfigError(
        "Cannot parse GitHits config at /tmp/config.toml: invalid TOML",
      ),
      true,
    );
    expect(JSON.parse(authConfig.output)).toEqual({
      error: "Cannot parse GitHits config at /tmp/config.toml: invalid TOML",
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
  });

  for (const error of [
    new Error("plain failure"),
    new TypeError("fetch failed"),
  ]) {
    it(`prints ${error.name} without rethrowing or exposing its stack`, () => {
      const { output, exitCodes } = captureCliError(error);

      expect(output).toContain(error.message);
      expect(output).toContain("githits doctor");
      expect(output).toContain("githits-cli/issues");
      expect(output).not.toContain(`${error.name}:`);
      expect(output).not.toContain("\n    at ");
      expect(exitCodes).toEqual([1]);
    });
  }

  it("normalizes multiline messages and handles non-Error throws", () => {
    const multiline = captureCliError(new Error("first line\nsecond line"));
    const nonError = captureCliError({ secret: "do not serialize" });

    expect(multiline.output).toContain("first line second line\n");
    expect(multiline.output).not.toContain("first line\nsecond line");
    expect(nonError.output).toContain("Unexpected error.");
    expect(nonError.output).not.toContain("secret");
    expect(nonError.exitCodes).toEqual([1]);
  });

  for (const debugScope of ["cli", "*"]) {
    it(`includes the original stack for GITHITS_DEBUG=${debugScope}`, () => {
      process.env.GITHITS_DEBUG = debugScope;
      const error = new Error("debug failure");
      const { output } = captureCliError(error);

      expect(output).toContain(error.stack ?? "Error: debug failure");
    });
  }

  it("does not include stacks for unrelated debug scopes", () => {
    process.env.GITHITS_DEBUG = "auth";
    const error = new Error("hidden stack");

    expect(captureCliError(error).output).not.toContain(error.stack ?? "at ");
  });

  it("routes asynchronous startup failures through the handler exactly once", async () => {
    const stderrWrites: string[] = [];
    const exitCodes: number[] = [];

    await expect(
      runCliMain(
        async () => {
          throw new Error("registration failed");
        },
        {
          stderr: {
            write: (chunk: string | Uint8Array) => {
              stderrWrites.push(String(chunk));
              return true;
            },
          },
          exit: ((code: number) => {
            exitCodes.push(code);
            throw new Error(`process.exit:${code}`);
          }) as (code: number) => never,
        },
      ),
    ).rejects.toThrow("process.exit:1");

    const output = stderrWrites.join("");
    expect(output.match(/registration failed/g)).toHaveLength(1);
    expect(output).not.toContain("\n    at ");
    expect(exitCodes).toEqual([1]);
  });

  it("renders unexpected action failures once in a real CLI process", async () => {
    const xdgConfigHome = mkdtempSync(join(tmpdir(), "githits-cli-errors-"));
    mkdirSync(join(xdgConfigHome, "githits"), { recursive: true });
    writeFileSync(
      join(xdgConfigHome, "githits", "config.toml"),
      "[experimental]\ntools = false\n",
    );
    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", "languages", "--json"],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          GITHITS_API_TOKEN: "test-token",
          GITHITS_API_URL: "http://attacker.test",
          GITHITS_MCP_URL: "https://mcp.githits.com",
          GITHITS_CODE_NAV_URL: "https://pkgseer.dev",
          GITHITS_DISABLE_UPDATE_CHECK: "1",
          XDG_CONFIG_HOME: xdgConfigHome,
          GITHITS_DEBUG: "",
          NO_COLOR: "1",
        },
      },
    );
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr.match(/Invalid GITHITS_API_URL/g)).toHaveLength(1);
      expect(stderr).toContain("githits doctor");
      expect(stderr).not.toContain("\n    at ");
    } finally {
      rmSync(xdgConfigHome, { recursive: true, force: true });
    }
  });

  it("renders malformed auth config as a clean JSON error in a real CLI process", async () => {
    const xdgConfigHome = mkdtempSync(
      join(tmpdir(), "githits-cli-auth-config-"),
    );
    mkdirSync(join(xdgConfigHome, "githits"), { recursive: true });
    const configPath = join(xdgConfigHome, "githits", "config.toml");
    writeFileSync(configPath, "[auth\n");
    const proc = Bun.spawn(
      ["bun", "run", "src/cli.ts", "languages", "--json"],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          GITHITS_AUTH_STORAGE: "",
          GITHITS_DISABLE_UPDATE_CHECK: "1",
          XDG_CONFIG_HOME: xdgConfigHome,
          GITHITS_DEBUG: "",
          NO_COLOR: "1",
        },
      },
    );
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      const payload = JSON.parse(stderr);
      expect(payload).toMatchObject({
        code: "INVALID_ARGUMENT",
        retryable: false,
      });
      expect(payload.error).toContain(
        `Cannot parse GitHits config at ${configPath}:`,
      );
    } finally {
      rmSync(xdgConfigHome, { recursive: true, force: true });
    }
  });
});

function captureCliError(
  error: unknown,
  json = false,
): {
  output: string;
  exitCodes: number[];
} {
  const stderrWrites: string[] = [];
  const exitCodes: number[] = [];
  const exit = ((code: number) => {
    exitCodes.push(code);
    throw new Error(`process.exit:${code}`);
  }) as (code: number) => never;

  expect(() =>
    handleCliError(error, {
      stderr: {
        write: (chunk: string | Uint8Array) => {
          stderrWrites.push(String(chunk));
          return true;
        },
      },
      exit,
      json,
    }),
  ).toThrow("process.exit:1");

  return { output: stderrWrites.join(""), exitCodes };
}
