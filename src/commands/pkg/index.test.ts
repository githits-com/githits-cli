import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerPkgCommandGroup } from "./index.js";

describe("registerPkgCommandGroup", () => {
  it("always registers the pkg command group", async () => {
    const program = new Command();
    await registerPkgCommandGroup(program);

    const pkgCommand = program.commands.find(
      (command) => command.name() === "pkg",
    );
    expect(pkgCommand).toBeDefined();
    expect(
      pkgCommand?.commands.some((command) => command.name() === "info"),
    ).toBe(true);
    expect(
      pkgCommand?.commands.some((command) => command.name() === "vulns"),
    ).toBe(true);
    expect(
      pkgCommand?.commands.some((command) => command.name() === "deps"),
    ).toBe(true);
  });
});
