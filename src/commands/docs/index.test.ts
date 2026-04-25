import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerDocsCommandGroup } from "./index.js";

describe("registerDocsCommandGroup", () => {
  it("does not register docs group without override or capability", async () => {
    const program = new Command();
    await registerDocsCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: false,
      capability: "disabled",
    });

    expect(program.commands.some((command) => command.name() === "docs")).toBe(
      false,
    );
  });

  it("registers docs group when capability is enabled", async () => {
    const program = new Command();
    await registerDocsCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: false,
      capability: "enabled",
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
