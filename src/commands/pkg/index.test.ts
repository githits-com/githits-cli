import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerPkgCommandGroup } from "./index.js";

describe("registerPkgCommandGroup", () => {
  it("does not register the pkg group with an explicitly empty code navigation URL", async () => {
    const program = new Command();
    await registerPkgCommandGroup(program, {
      codeNavigationUrl: "",
    });

    expect(program.commands.some((command) => command.name() === "pkg")).toBe(
      false,
    );
  });

  it("registers the pkg command group when code navigation URL is configured", async () => {
    const program = new Command();
    await registerPkgCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
    });

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
