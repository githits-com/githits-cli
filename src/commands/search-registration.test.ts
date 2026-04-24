import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerUnifiedSearchCommands } from "./search.js";

describe("registerUnifiedSearchCommands", () => {
  it("does not register search commands without code navigation URL", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "",
      overrideEnabled: false,
      capability: "enabled",
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(false);
    expect(
      program.commands.some((command) => command.name() === "search-status"),
    ).toBe(false);
  });

  it("does not register search commands without override or explicit capability", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "disabled",
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
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

  it("does not register search commands for opaque env tokens without the capability claim", async () => {
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

  it("registers search commands for expired stored auth so direct invocation can refresh", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "unknown",
      expiredStoredAuth: true,
    });

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(true);
  });
});
