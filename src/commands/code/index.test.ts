import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerCodeCommandGroup } from "./index.js";

describe("registerCodeCommandGroup", () => {
  it("registers all stable code commands and describes diff addressing", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program);

    const codeCommand = program.commands.find(
      (command) => command.name() === "code",
    );
    expect(codeCommand).toBeDefined();
    expect(codeCommand?.commands.map((command) => command.name())).toEqual([
      "files",
      "read",
      "grep",
      "diff",
    ]);
    expect(codeCommand?.description()).toContain("compare exact trees");
    expect(codeCommand?.description()).toContain("<from>..<to>");
  });
});
