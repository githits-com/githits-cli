import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerDocsCommandGroup } from "./index.js";

describe("registerDocsCommandGroup", () => {
  it("always registers the docs group", async () => {
    const program = new Command();
    await registerDocsCommandGroup(program);

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
