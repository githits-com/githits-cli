import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerUnifiedSearchCommands } from "./search.js";

describe("registerUnifiedSearchCommands", () => {
  it("does not register search commands with an explicitly empty code navigation URL", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "",
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(false);
    expect(
      program.commands.some((command) => command.name() === "search-status"),
    ).toBe(false);
  });

  it("registers search commands when code navigation URL is configured", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "https://nav.example.com",
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(true);
    expect(
      program.commands.some((command) => command.name() === "search-status"),
    ).toBe(true);
  });
});
