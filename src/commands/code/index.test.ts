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
    });

    const codeCommand = program.commands.find(
      (command) => command.name() === "code",
    );
    expect(codeCommand).toBeDefined();
    expect(
      codeCommand?.commands.some((command) => command.name() === "files"),
    ).toBe(true);
  });
});
