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
    expect(result.command).toBe(
      '"C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\pi.cmd"',
    );
    expect(result.args).toEqual(["list"]);
    expect(result.shell).toBe(true);
  });

  it("keeps simple Windows commands unquoted", () => {
    const result = normalizeSpawnCommand("pi", ["list"], "win32");
    expect(result).toEqual({ command: "pi", args: ["list"], shell: true });
  });
});
