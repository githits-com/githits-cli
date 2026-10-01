import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendCliArgs,
  forwardedCliEntryArgs,
  parseCliLaunchTarget,
  SOURCE_CLI_LAUNCH_TARGET,
  toStdioLaunch,
} from "./smoke-launch-target.ts";

describe("smoke CLI launch targets", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses an absolute source CLI entry by default", () => {
    const parsed = parseCliLaunchTarget(["--mode", "unauthenticated"]);
    const sourceEntry = fileURLToPath(
      new URL("../src/cli.ts", import.meta.url),
    );

    expect(parsed.target).toEqual({
      kind: "source",
      argv: ["bun", "run", sourceEntry],
    });
    expect(SOURCE_CLI_LAUNCH_TARGET.argv[2]).toBe(sourceEntry);
    expect(isAbsolute(sourceEntry)).toBe(true);
    expect(parsed.remainingArgs).toEqual(["--mode", "unauthenticated"]);
    expect(forwardedCliEntryArgs(parsed.target)).toEqual([]);
  });

  it("keeps built targets on Node with a resolved absolute entry", () => {
    const { dir, entry } = createEntry("dist/cli.js");

    const parsed = parseCliLaunchTarget(["--cli-entry", "dist/cli.js"], dir);

    expect(parsed.target.argv).toEqual(["node", entry]);
    expect(parsed.target.cliEntry).toBe(entry);
    expect(forwardedCliEntryArgs(parsed.target)).toEqual([
      "--cli-entry",
      entry,
    ]);
  });

  it("keeps an absolute path containing spaces as one argument", () => {
    const { entry } = createEntry("built output/cli entry.js");
    const parsed = parseCliLaunchTarget(["--cli-entry", entry]);

    expect(appendCliArgs(parsed.target, ["--help"])).toEqual([
      "node",
      entry,
      "--help",
    ]);
    expect(toStdioLaunch(parsed.target, ["mcp", "start"])).toEqual({
      command: "node",
      args: [entry, "mcp", "start"],
    });
  });

  it("builds the source stdio launch without a shell command", () => {
    const { target } = parseCliLaunchTarget([]);

    expect(toStdioLaunch(target, ["mcp", "start"])).toEqual({
      command: "bun",
      args: [
        "run",
        fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
        "mcp",
        "start",
      ],
    });
  });

  it("runs the source CLI from a temporary cwd outside the repository", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "githits-smoke-source-cwd-"));
    tempDirs.push(cwd);
    const relativeFromRepo = relative(process.cwd(), cwd);
    expect(
      isAbsolute(relativeFromRepo) ||
        relativeFromRepo === ".." ||
        relativeFromRepo.startsWith(`..${sep}`),
    ).toBe(true);

    const proc = Bun.spawn(
      appendCliArgs(SOURCE_CLI_LAUNCH_TARGET, ["--version"]),
      {
        cwd,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: cwd,
          USERPROFILE: cwd,
          XDG_CONFIG_HOME: join(cwd, ".config"),
          APPDATA: join(cwd, "AppData", "Roaming"),
          NO_COLOR: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).not.toBe("");
    expect(stderr).toBe("");
  });

  it("rejects a missing entry value", () => {
    expect(() => parseCliLaunchTarget(["--cli-entry"])).toThrow(
      "--cli-entry requires a file path",
    );
  });

  it("rejects a nonexistent entry", () => {
    const entry = resolve("missing-dist-cli.js");
    expect(() => parseCliLaunchTarget(["--cli-entry", entry])).toThrow(entry);
  });

  it("rejects a directory entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "githits-smoke-entry-"));
    tempDirs.push(dir);

    expect(() => parseCliLaunchTarget(["--cli-entry", dir])).toThrow(
      "must reference an existing file",
    );
  });

  it("rejects duplicate entry options", () => {
    const { entry } = createEntry("cli.js");
    expect(() =>
      parseCliLaunchTarget(["--cli-entry", entry, "--cli-entry", entry]),
    ).toThrow("may only be specified once");
  });

  function createEntry(relativePath: string): {
    dir: string;
    entry: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), "githits smoke entry "));
    tempDirs.push(dir);
    const entry = resolve(dir, relativePath);
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, "export {};\n");
    return { dir, entry };
  }
});
