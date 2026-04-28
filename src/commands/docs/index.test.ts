import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerDocsCommandGroup } from "./index.js";

describe("registerDocsCommandGroup", () => {
  it("does not register docs group with an explicitly empty code navigation URL", async () => {
    const program = new Command();
    await registerDocsCommandGroup(program, {
      codeNavigationUrl: "",
    });

    expect(program.commands.some((command) => command.name() === "docs")).toBe(
      false,
    );
  });

  it("registers docs group when code navigation URL is configured", async () => {
    const program = new Command();
    await registerDocsCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
    });

    const docsCommand = program.commands.find(
      (command) => command.name() === "docs",
    );
    expect(docsCommand).toBeDefined();
    expect(
      docsCommand?.commands.some((command) => command.name() === "list"),
    ).toBe(true);
    expect(
      docsCommand?.commands.some((command) => command.name() === "read"),
    ).toBe(true);
  });
});
