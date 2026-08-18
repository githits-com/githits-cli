import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerCodeCommandGroup } from "./index.js";

describe("registerCodeCommandGroup", () => {
  it("always registers the code command group", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, { experimentalTools: true });

    const codeCommand = program.commands.find(
      (command) => command.name() === "code",
    );
    expect(codeCommand).toBeDefined();
    expect(
      codeCommand?.commands.some((command) => command.name() === "files"),
    ).toBe(true);
    expect(
      codeCommand?.commands.some((command) => command.name() === "diff"),
    ).toBe(true);
  });

  it("omits the experimental diff command when tools are disabled", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, { experimentalTools: false });

    const codeCommand = program.commands.find(
      (command) => command.name() === "code",
    );
    expect(codeCommand?.commands.map((command) => command.name())).toEqual([
      "files",
      "read",
      "grep",
    ]);
    expect(codeCommand?.description()).not.toContain("diff");
  });
});
