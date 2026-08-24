import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import {
  registerSearchCommand,
  registerUnifiedSearchCommands,
} from "./search.js";

describe("registerUnifiedSearchCommands", () => {
  it("always registers search commands", async () => {
    const program = new Command();
    await registerUnifiedSearchCommands(program);

    expect(
      program.commands.some((command) => command.name() === "search"),
    ).toBe(true);
    expect(
      program.commands.some((command) => command.name() === "search-status"),
    ).toBe(true);
  });

  it("documents explicit standalone site targets in search help", () => {
    const program = new Command();
    registerSearchCommand(program);
    const searchCommand = program.commands.find(
      (command) => command.name() === "search",
    );
    const searchHelp =
      searchCommand?.helpInformation().replace(/\s+/g, " ") ?? "";

    expect(searchHelp).toContain("site:<host[/path]>");
    expect(searchHelp).toContain(
      "terminal recovery guidance without a searchRef",
    );
    expect(searchHelp).toContain("stale-but-serveable evidence");
    expect(searchHelp).toContain("serveable subset");
    expect(searchHelp).toContain("completed result with an evidence notice");

    const statusCommand = program.commands.find(
      (command) => command.name() === "search-status",
    );
    const statusHelp =
      statusCommand?.helpInformation().replace(/\s+/g, " ") ?? "";
    expect(statusHelp).toContain("interim hits");
    expect(statusHelp).toContain("serveable subset");
    expect(statusHelp).toContain("completed result with an evidence notice");
    expect(statusHelp).toContain("unrecognized statuses are not polled");
  });

  it("rejects repeated --source values instead of changing semantics silently", () => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {} });
    registerSearchCommand(program);

    expect(() =>
      program.parse([
        "node",
        "githits",
        "search",
        "router",
        "--in",
        "npm:express",
        "--source",
        "docs",
        "--source",
        "code",
      ]),
    ).toThrow("Pass --source at most once");
  });
});
