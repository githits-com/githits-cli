import { describe, expect, it } from "bun:test";
import { ExecServiceImpl, normalizeSpawnCommand } from "./exec-service.js";

describe("ExecServiceImpl", () => {
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
