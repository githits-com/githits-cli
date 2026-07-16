import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerCodeCommandGroup } from "./index.js";

describe("registerCodeCommandGroup", () => {
  it("always registers the code command group", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program);

    const codeCommand = program.commands.find(
      (command) => command.name() === "code",
    );
    expect(codeCommand).toBeDefined();
    expect(
      codeCommand?.commands.some((command) => command.name() === "files"),
    ).toBe(true);
  });
});
