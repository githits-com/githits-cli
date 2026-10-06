import { describe, expect, it, mock } from "bun:test";
import {
  EXPERIMENTAL_CLI_COMMANDS,
  getExperimentalCliCommand,
  isExperimentalCliCommand,
  resolveExperimentalCliPolicy,
  shouldRegisterCliCommand,
} from "./experimental-cli-policy.js";
import { ExperimentalConfigError } from "./experimental-config.js";
import { createMockFileSystemService } from "./test-helpers.js";

function configFile(contents: string) {
  return createMockFileSystemService({
    exists: mock(() => Promise.resolve(true)),
    readFile: mock(() => Promise.resolve(contents)),
  });
}

describe("experimental CLI policy", () => {
  it("keeps experimental CLI membership in one data list", () => {
    expect(EXPERIMENTAL_CLI_COMMANDS).toEqual(["research", "ask"]);
    expect(isExperimentalCliCommand("research")).toBe(true);
    expect(isExperimentalCliCommand("ask")).toBe(true);
    expect(isExperimentalCliCommand("resolve")).toBe(false);
    expect(isExperimentalCliCommand("code diff")).toBe(false);
    expect(isExperimentalCliCommand("code files")).toBe(false);
    expect(shouldRegisterCliCommand("resolve", false)).toBe(true);
    expect(shouldRegisterCliCommand("research", false)).toBe(false);
    expect(shouldRegisterCliCommand("ask", false)).toBe(false);
    expect(shouldRegisterCliCommand("code diff", false)).toBe(true);
    expect(shouldRegisterCliCommand("resolve", true)).toBe(true);
    expect(shouldRegisterCliCommand("research", true)).toBe(true);
    expect(shouldRegisterCliCommand("code diff", true)).toBe(true);
    expect(shouldRegisterCliCommand("code files", false)).toBe(true);
  });

  it("detects direct commands and their help forms", () => {
    expect(getExperimentalCliCommand(["research", "npm:express", "How?"])).toBe(
      "research",
    );
    expect(getExperimentalCliCommand(["help", "research"])).toBe("research");
    expect(getExperimentalCliCommand(["ask", "npm:express", "How?"])).toBe(
      "ask",
    );
    expect(getExperimentalCliCommand(["help", "ask"])).toBe("ask");
    expect(getExperimentalCliCommand(["resolve", "express"])).toBe(undefined);
    expect(getExperimentalCliCommand(["resolve", "--help"])).toBe(undefined);
    expect(getExperimentalCliCommand(["help", "code", "diff"])).toBe(undefined);
    expect(
      getExperimentalCliCommand(["--no-color", "code", "diff", "--help"]),
    ).toBe(undefined);
    expect(getExperimentalCliCommand(["code", "files", "--help"])).toBe(
      undefined,
    );
  });

  it("returns enabled settings for experimental invocations", async () => {
    await expect(
      resolveExperimentalCliPolicy(
        configFile("[experimental]\ntools = true\n"),
        ["research", "--help"],
      ),
    ).resolves.toMatchObject({ tools: true });
    await expect(
      resolveExperimentalCliPolicy(
        configFile("[experimental]\ntools = true\n"),
        ["ask", "--help"],
      ),
    ).resolves.toMatchObject({ tools: true });
  });

  it("surfaces malformed config for direct invocations", async () => {
    for (const command of ["research", "ask"]) {
      await expect(
        resolveExperimentalCliPolicy(configFile("[experimental\n"), [
          command,
          "--help",
        ]),
      ).rejects.toBeInstanceOf(ExperimentalConfigError);
    }
  });

  it("falls back to stable policy for non-experimental invocations", async () => {
    await expect(
      resolveExperimentalCliPolicy(configFile("[experimental\n"), [
        "doctor",
        "--help",
      ]),
    ).resolves.toMatchObject({ tools: false });
    await expect(
      resolveExperimentalCliPolicy(configFile("[experimental\n"), [
        "resolve",
        "--help",
      ]),
    ).resolves.toMatchObject({ tools: false });
    await expect(
      resolveExperimentalCliPolicy(createMockFileSystemService(), [
        "resolve",
        "--help",
      ]),
    ).resolves.toMatchObject({ tools: false });
    await expect(
      resolveExperimentalCliPolicy(
        configFile("[experimental]\ntools = false\n"),
        ["resolve", "--help"],
      ),
    ).resolves.toMatchObject({ tools: false });
  });
});
