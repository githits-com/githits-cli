import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerCodeCommandGroup } from "./index.js";

describe("registerCodeCommandGroup", () => {
  it("does not register code commands with an explicitly empty code navigation URL", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, {
      codeNavigationUrl: "",
    });

    expect(program.commands.some((command) => command.name() === "code")).toBe(
      false,
    );
  });

  it("registers the code command group when code navigation URL is configured", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, {
      codeNavigationUrl: "https://nav.example.com",
      capability: "enabled",
    });

    const codeCommand = program.commands.find(
      (command) => command.name() === "code",
    );
    expect(codeCommand).toBeDefined();
    expect(
      codeCommand?.commands.some((command) => command.name() === "files"),
    ).toBe(true);
  });

  it("registers the code command group when override and URL are set", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: true,
      capability: "disabled",
    });

    const codeCommand = program.commands.find(
      (command) => command.name() === "code",
    );
    expect(codeCommand).toBeDefined();
    expect(
      codeCommand?.commands.some((command) => command.name() === "files"),
    ).toBe(true);
  });

  it("does not register the code command group when capability is unknown", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "unknown",
    });

    expect(program.commands.some((command) => command.name() === "code")).toBe(
      false,
    );
  });
});
