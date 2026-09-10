import { describe, expect, it, mock } from "bun:test";
import {
  ExperimentalConfigError,
  loadExperimentalSettings,
} from "./experimental-config.js";
import {
  createMockFileSystemService,
  withTestEnvVar,
  withTestPlatform,
} from "./test-helpers.js";

function configFile(contents: string) {
  return createMockFileSystemService({
    exists: mock(() => Promise.resolve(true)),
    readFile: mock(() => Promise.resolve(contents)),
  });
}

async function withDefaultLinuxConfigPath<T>(fn: () => Promise<T>): Promise<T> {
  return withTestPlatform("linux", () =>
    withTestEnvVar("XDG_CONFIG_HOME", undefined, fn),
  );
}

describe("experimental config", () => {
  it("defaults tools off when the config is missing", async () => {
    await withDefaultLinuxConfigPath(async () => {
      await expect(
        loadExperimentalSettings(createMockFileSystemService()),
      ).resolves.toEqual({
        tools: false,
        configPath: "/home/test/.config/githits/config.toml",
      });
    });
  });

  it.each([
    ["true", true],
    ["false", false],
  ] as const)("loads tools = %s", async (value, tools) => {
    await expect(
      loadExperimentalSettings(
        configFile(`[experimental]\ntools = ${value}\n`),
      ),
    ).resolves.toMatchObject({ tools });
  });

  it.each(['[experimental]\ntools = "true"\n', "[experimental]\ntools = 1\n"])(
    "rejects invalid experimental setting: %s",
    async (contents) => {
      await expect(
        loadExperimentalSettings(configFile(contents)),
      ).rejects.toThrow(ExperimentalConfigError);
    },
  );

  it.each(['"experimental"', '"all"', '"never"', "true"])(
    "ignores retired reporting value %s without changing tool availability",
    async (value) => {
      for (const tools of [false, true]) {
        const settings = await loadExperimentalSettings(
          configFile(
            `[experimental]\ntools = ${tools}\nreport_tool_issues = ${value}\n`,
          ),
        );
        expect(settings.tools).toBe(tools);
        expect(settings).not.toHaveProperty("reportToolIssues");
      }
    },
  );

  it("accepts unknown root and experimental keys", async () => {
    await expect(
      loadExperimentalSettings(
        configFile(
          '[future]\nvalue = "kept"\n\n[experimental]\ntools = true\nnew_key = "kept"\n',
        ),
      ),
    ).resolves.toMatchObject({ tools: true });
  });

  it("qualifies invalid setting errors with the config path", async () => {
    await withDefaultLinuxConfigPath(async () => {
      await expect(
        loadExperimentalSettings(configFile("[experimental]\ntools = 1\n")),
      ).rejects.toThrow(
        /Invalid GitHits config at \/home\/test\/\.config\/githits\/config\.toml/,
      );
    });
  });

  it("qualifies invalid TOML errors with the config path", async () => {
    await withDefaultLinuxConfigPath(async () => {
      await expect(
        loadExperimentalSettings(configFile("[experimental\n")),
      ).rejects.toThrow(ExperimentalConfigError);
      await expect(
        loadExperimentalSettings(configFile("[experimental\n")),
      ).rejects.toThrow(
        /Cannot parse GitHits config at \/home\/test\/\.config\/githits\/config\.toml/,
      );
    });
  });
});
