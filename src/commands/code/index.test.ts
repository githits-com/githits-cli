import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerCodeCommandGroup } from "./index.js";

describe("registerCodeCommandGroup", () => {
  it("does not register code commands without override or capability", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "disabled",
    });

    expect(program.commands.some((command) => command.name() === "code")).toBe(
      false,
    );
  });

  it("registers the code command group when capability is enabled", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "enabled",
    });

    const codeCommand = program.commands.find(
      (command) => command.name() === "code",
    );
    expect(codeCommand).toBeDefined();
    expect(
      codeCommand?.commands.some((command) => command.name() === "search"),
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
      codeCommand?.commands.some((command) => command.name() === "search"),
    ).toBe(true);
  });

  it("registers the code command group for opaque env tokens", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "unknown",
      envTokenPresent: true,
    });

    expect(program.commands.some((command) => command.name() === "code")).toBe(
      true,
    );
  });

  it("registers the code command group for expired stored auth", async () => {
    const program = new Command();
    await registerCodeCommandGroup(program, {
      codeNavigationUrl: "https://nav.example.com",
      overrideEnabled: false,
      capability: "unknown",
      expiredStoredAuth: true,
    });

    expect(program.commands.some((command) => command.name() === "code")).toBe(
      true,
    );
  });
});
