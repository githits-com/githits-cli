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

  it("does not register search commands when capability is disabled", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "disabled",
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(false);
    expect(
      program.commands.some((command) => command.name() === "search-status"),
    ).toBe(false);
  });

  it("registers search commands when capability is enabled", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "enabled",
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(true);
    expect(
      program.commands.some((command) => command.name() === "search-status"),
    ).toBe(true);
  });

  it("registers search commands when override is enabled", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: true,
      capability: "disabled",
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(true);
  });

  it("does not register search commands when capability is unknown", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "unknown",
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(false);
  });
});
