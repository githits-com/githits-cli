import { describe, expect, it, mock } from "bun:test";
import {
  EXPERIMENTAL_CLI_COMMANDS,
  ExperimentalToolsDisabledError,
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
    expect(EXPERIMENTAL_CLI_COMMANDS).toEqual(["resolve", "code diff"]);
    expect(isExperimentalCliCommand("resolve")).toBe(true);
    expect(isExperimentalCliCommand("code diff")).toBe(true);
    expect(isExperimentalCliCommand("code files")).toBe(false);
    expect(shouldRegisterCliCommand("resolve", false)).toBe(false);
    expect(shouldRegisterCliCommand("code diff", false)).toBe(false);
    expect(shouldRegisterCliCommand("resolve", true)).toBe(true);
    expect(shouldRegisterCliCommand("code diff", true)).toBe(true);
    expect(shouldRegisterCliCommand("code files", false)).toBe(true);
  });

  it("detects direct commands and their help forms", () => {
    expect(getExperimentalCliCommand(["resolve", "express"])).toBe("resolve");
    expect(getExperimentalCliCommand(["resolve", "--help"])).toBe("resolve");
    expect(getExperimentalCliCommand(["help", "code", "diff"])).toBe(
      "code diff",
    );
    expect(
      getExperimentalCliCommand(["--no-color", "code", "diff", "--help"]),
    ).toBe("code diff");
    expect(getExperimentalCliCommand(["code", "files", "--help"])).toBe(
      undefined,
    );
  });

  it("rejects a disabled direct invocation before its action can run", async () => {
    await expect(
      resolveExperimentalCliPolicy(createMockFileSystemService(), [
        "resolve",
        "express",
      ]),
    ).rejects.toMatchObject({
      name: "ExperimentalToolsDisabledError",
      message: expect.stringContaining("[experimental]\ntools = true"),
    });
    await expect(
      resolveExperimentalCliPolicy(createMockFileSystemService(), [
        "resolve",
        "express",
      ]),
    ).rejects.toBeInstanceOf(ExperimentalToolsDisabledError);
  });

  it("returns enabled settings for experimental invocations", async () => {
    await expect(
      resolveExperimentalCliPolicy(
        configFile("[experimental]\ntools = true\n"),
        ["code", "diff", "--help"],
      ),
    ).resolves.toMatchObject({ tools: true });
  });

  it("surfaces malformed config for direct invocations", async () => {
    await expect(
      resolveExperimentalCliPolicy(configFile("[experimental\n"), [
        "resolve",
        "express",
      ]),
    ).rejects.toBeInstanceOf(ExperimentalConfigError);
  });

  it("falls back to stable policy for non-experimental invocations", async () => {
    await expect(
      resolveExperimentalCliPolicy(configFile("[experimental\n"), [
        "doctor",
        "--help",
      ]),
    ).resolves.toMatchObject({ tools: false });
  });
});
