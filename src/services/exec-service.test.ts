import { describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExecServiceImpl,
  ExecTimeoutError,
  normalizeSpawnCommand,
} from "./exec-service.js";

describe("ExecServiceImpl", () => {
  it("passes child-only environment overrides without changing the parent", async () => {
    const previous = process.env.GITHITS_EXEC_TEST_VALUE;
    const result = await new ExecServiceImpl().exec(
      "node",
      ["-e", "process.stdout.write(process.env.GITHITS_EXEC_TEST_VALUE)"],
      { env: { GITHITS_EXEC_TEST_VALUE: "fixture-child-value" } },
    );
    expect(result.stdout).toBe("fixture-child-value");
    expect(process.env.GITHITS_EXEC_TEST_VALUE === previous).toBe(true);
  });
  it("executes a command and returns stdout", async () => {
    const service = new ExecServiceImpl();
    const result = await service.exec("node", ["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v\d+/);
  });

  it("returns non-zero exit code for failing command", async () => {
    const service = new ExecServiceImpl();
    const result = await service.exec("node", ["-e", "process.exit(42)"]);
    expect(result.exitCode).toBe(42);
  });

  it("rejects with error for non-existent command", async () => {
    const service = new ExecServiceImpl();
    await expect(
      service.exec("nonexistent-command-xyz-12345", []),
    ).rejects.toThrow();
  });

  it("captures stderr output", async () => {
    const service = new ExecServiceImpl();
    const result = await service.exec("node", [
      "-e",
      "process.stderr.write('err-msg')",
    ]);
    expect(result.stderr).toContain("err-msg");
  });

  it("runs commands from the requested working directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "githits-exec-cwd-"));
    try {
      const result = await new ExecServiceImpl().exec(
        "node",
        ["-e", "process.stdout.write(process.cwd())"],
        { cwd },
      );
      expect((await realpath(result.stdout)).toLowerCase()).toBe(
        (await realpath(cwd)).toLowerCase(),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects with timeout error when command exceeds timeout", async () => {
    const service = new ExecServiceImpl();
    await expect(
      service.exec("node", ["-e", "setTimeout(() => {}, 1000)"], {
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(ExecTimeoutError);
  });

  it("does not reject after timed-out process later closes", async () => {
    const service = new ExecServiceImpl();
    for (let i = 0; i < 3; i += 1) {
      await expect(
        service.exec("node", ["-e", "setTimeout(() => {}, 1000)"], {
          timeoutMs: 20,
        }),
      ).rejects.toBeInstanceOf(ExecTimeoutError);
    }
  });

  it("quotes Windows absolute command paths with spaces for shell execution", () => {
    const result = normalizeSpawnCommand(
      "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\pi.cmd",
      ["list"],
      "win32",
    );
    expect(result.command).toBe(process.env.ComSpec ?? "cmd.exe");
    expect(result.args).toEqual([
      "/d",
      "/s",
      "/c",
      `"C:\\Users\\Jane^ Doe\\AppData\\Roaming\\npm\\pi.cmd ^"list^""`,
    ]);
    expect(result.windowsVerbatimArguments).toBe(true);
    expect(result.shell).toBeUndefined();
  });

  it("passes Windows shell commands as one command line", () => {
    const result = normalizeSpawnCommand("pi", ["list"], "win32");
    expect(result).toEqual({
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"pi ^"list^""`],
      windowsVerbatimArguments: true,
    });
  });

  it("quotes Windows shell args containing metacharacters", () => {
    const result = normalizeSpawnCommand(
      "claude",
      ["plugin", "install", "githits & more"],
      "win32",
    );
    expect(result).toEqual({
      command: process.env.ComSpec ?? "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        `"claude ^"plugin^" ^"install^" ^"githits^ ^&^ more^""`,
      ],
      windowsVerbatimArguments: true,
    });
  });
});

/** Run the service in a disposable parent so inherited stdio and SIGINT are real. */
function interactiveHarness(
  childCode: string,
  missing = false,
): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  const moduleUrl = new URL("./exec-service.ts", import.meta.url).href;
  const source = `
    import { ExecServiceImpl } from ${JSON.stringify(moduleUrl)};
    const count = process.listenerCount('SIGINT');
    try {
      const result = await new ExecServiceImpl().execInteractive(
        ${JSON.stringify(missing ? "githits-nonexistent-native-host" : "node")},
        ${JSON.stringify(missing ? [] : ["-e", childCode])}
      );
      process.stderr.write(JSON.stringify({result, restored:process.listenerCount('SIGINT')===count}));
    } catch {
      process.stderr.write(JSON.stringify({failed:true,restored:process.listenerCount('SIGINT')===count}));
    }
  `;
  return Bun.spawn([process.execPath, "--eval", source], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("interactive execution", () => {
  it("inherits stdin/stdout without capturing native output in the return value", async () => {
    const parent = interactiveHarness(
      "process.stdin.once('data', data => { process.stdout.write('native:'+data); process.exit(0); })",
    );
    parent.stdin.write("fixture-input");
    parent.stdin.end();
    expect(await new Response(parent.stdout).text()).toBe(
      "native:fixture-input",
    );
    const outcome = JSON.parse(await new Response(parent.stderr).text());
    expect(outcome).toEqual({
      result: { exitCode: 0, signal: null },
      restored: true,
    });
    expect(await parent.exited).toBe(0);
  });
  for (const exit of ["signal", "raw-exit"])
    it.skipIf(process.platform === "win32")(
      `awaits child ${exit} and restores parent signal handling`,
      async () => {
        const parent = interactiveHarness(
          `process.stdout.write('READY\\n'); process.stdin.once('data', () => { ${exit === "signal" ? "process.kill(process.pid,'SIGINT')" : "process.exit(1)"}; });`,
        );
        const reader = parent.stdout.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe(
          "READY\n",
        );
        parent.kill("SIGINT"); // Parent must survive while the native child owns stdin.
        parent.stdin.write("cancel");
        parent.stdin.end();
        const outcome = JSON.parse(await new Response(parent.stderr).text());
        expect(outcome.restored).toBe(true);
        expect(outcome.result).toEqual(
          exit === "signal"
            ? { exitCode: null, signal: "SIGINT" }
            : { exitCode: 1, signal: null },
        );
        expect(await parent.exited).toBe(0);
        reader.releaseLock();
      },
    );
  it("restores the signal listener after spawn errors", async () => {
    const parent = interactiveHarness("", true);
    const result = JSON.parse(await new Response(parent.stderr).text());
    expect(result.restored).toBe(true);
    // Windows resolves shims through cmd.exe; an absent command exits there.
    if (process.platform === "win32")
      expect(result.result.exitCode).not.toBe(0);
    else expect(result.failed).toBe(true);
    expect(await parent.exited).toBe(0);
  });
});

it.skipIf(process.platform === "win32")(
  "restores shared terminal flags after a raw-mode child is killed",
  async () => {
    const moduleUrl = new URL("./exec-service.ts", import.meta.url).href;
    const source = `
    import { ExecServiceImpl } from ${JSON.stringify(moduleUrl)};
    import { spawnSync } from 'node:child_process';
    await new ExecServiceImpl().execInteractive('node', ['-e', "process.stdin.setRawMode(true); process.kill(process.pid,'SIGKILL')"]);
    const flags = spawnSync('stty',['-a'],{stdio:['inherit','pipe','pipe']}).stdout.toString();
    process.stdout.write('RAW_RESTORED:'+JSON.stringify({ canonical: /(?:^|[;\\s])icanon(?:[;\\s]|$)/.test(flags), echo: /(?:^|[;\\s])echo(?:[;\\s]|$)/.test(flags) })+'\\n');
  `;
    const shellQuote = (value: string): string =>
      `'${value.replaceAll("'", "'\\''")}'`;
    const args =
      process.platform === "darwin"
        ? ["-q", "/dev/null", "node", "--input-type=module", "--eval", source]
        : [
            "-q",
            "-c",
            ["node", "--input-type=module", "--eval", source]
              .map(shellQuote)
              .join(" "),
            "/dev/null",
          ];
    const parent = Bun.spawn(["script", ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(parent.stdout).text();
    expect(await parent.exited).toBe(0);
    const result = output.match(/RAW_RESTORED:(\{[^\r\n]+\})/)?.[1];
    expect(result).toBeDefined();
    expect(JSON.parse(result!)).toEqual({ canonical: true, echo: true });
  },
);
