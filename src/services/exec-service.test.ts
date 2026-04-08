import { describe, expect, it } from "bun:test";
import { ExecServiceImpl } from "./exec-service.js";

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
});
