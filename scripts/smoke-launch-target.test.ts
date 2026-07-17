import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  appendCliArgs,
  forwardedCliEntryArgs,
  parseCliLaunchTarget,
  toStdioLaunch,
} from "./smoke-launch-target.ts";

describe("smoke CLI launch targets", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the source CLI by default", () => {
    const parsed = parseCliLaunchTarget(["--mode", "unauthenticated"]);

    expect(parsed.target).toEqual({
      kind: "source",
      argv: ["bun", "run", "dev"],
    });
    expect(parsed.remainingArgs).toEqual(["--mode", "unauthenticated"]);
    expect(forwardedCliEntryArgs(parsed.target)).toEqual([]);
  });

  it("resolves a relative built entry once", () => {
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
      args: ["run", "dev", "mcp", "start"],
    });
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
