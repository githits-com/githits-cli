import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerPkgCommandGroup } from "./index.js";

describe("registerPkgCommandGroup", () => {
  it("does not register the pkg group without override or capability", async () => {
    const program = new Command();
    await registerPkgCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: false,
      capability: "disabled",
    });

    expect(program.commands.some((command) => command.name() === "pkg")).toBe(
      false,
    );
  });

  it("registers the pkg command group when capability is enabled", async () => {
    const program = new Command();
    await registerPkgCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: false,
      capability: "enabled",
    });

    const pkgCommand = program.commands.find(
      (command) => command.name() === "pkg",
    );
    expect(pkgCommand).toBeDefined();
    expect(
      pkgCommand?.commands.some((command) => command.name() === "info"),
    ).toBe(true);
    expect(
      pkgCommand?.commands.some((command) => command.name() === "vulns"),
    ).toBe(true);
  });

  it("registers the pkg command group when override and URL are set", async () => {
    const program = new Command();
    await registerPkgCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: true,
      capability: "disabled",
    });

    const pkgCommand = program.commands.find(
      (command) => command.name() === "pkg",
    );
    expect(pkgCommand).toBeDefined();
    expect(
      pkgCommand?.commands.some((command) => command.name() === "info"),
    ).toBe(true);
  });

  it("registers the pkg command group for opaque env tokens", async () => {
    const program = new Command();
    await registerPkgCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: false,
      capability: "unknown",
      envTokenPresent: true,
    });

    expect(program.commands.some((command) => command.name() === "pkg")).toBe(
      true,
    );
  });

  it("registers the pkg command group for expired stored auth", async () => {
    const program = new Command();
    await registerPkgCommandGroup(program, {
      codeNavigationUrl: "https://pkgseer.dev",
      overrideEnabled: false,
      capability: "unknown",
      expiredStoredAuth: true,
    });

    expect(program.commands.some((command) => command.name() === "pkg")).toBe(
      true,
    );
  });
});
