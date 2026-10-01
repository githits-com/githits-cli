import { describe, expect, it, mock } from "bun:test";
import type { FileSystemService } from "./filesystem-service.js";
import { loadSkillUpdateSettings, SkillConfigError } from "./skill-config.js";
import {
  createMockFileSystemService,
  withTestEnvVar,
  withTestPlatform,
} from "./test-helpers.js";

function configFile(contents: string): FileSystemService {
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

describe("skill update config", () => {
  it("defaults to enabled when the config is missing", async () => {
    await withDefaultLinuxConfigPath(async () => {
      await expect(
        loadSkillUpdateSettings(createMockFileSystemService()),
      ).resolves.toEqual({
        autoUpdate: true,
        configPath: "/home/test/.config/githits/config.toml",
      });
    });
  });

  it("defaults to enabled when the skills subsection is missing", async () => {
    await expect(
      loadSkillUpdateSettings(configFile('[future]\nvalue = "kept"\n')),
    ).resolves.toMatchObject({ autoUpdate: true });
  });

  it.each([
    ["true", true],
    ["false", false],
  ] as const)("loads skills.auto_update = %s", async (value, autoUpdate) => {
    await expect(
      loadSkillUpdateSettings(configFile(`[skills]\nauto_update = ${value}\n`)),
    ).resolves.toMatchObject({ autoUpdate });
  });

  it.each([['"true"'], ["1"]])(
    "rejects non-boolean skills.auto_update value %s",
    async (value) => {
      await expect(
        loadSkillUpdateSettings(
          configFile(`[skills]\nauto_update = ${value}\n`),
        ),
      ).rejects.toThrow(SkillConfigError);
    },
  );

  it("accepts unrelated root and skills keys", async () => {
    await expect(
      loadSkillUpdateSettings(
        configFile(
          '[future]\nvalue = "kept"\n\n[skills]\nauto_update = false\nnew_key = "kept"\n',
        ),
      ),
    ).resolves.toMatchObject({ autoUpdate: false });
  });

  it("returns a sanitized error for an invalid secret-like value", async () => {
    const sentinel = "secret-like-invalid-value-7f3a";
    try {
      await loadSkillUpdateSettings(
        configFile(`[skills]\nauto_update = "${sentinel}"\n`),
      );
      throw new Error("Expected config validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillConfigError);
      expect((error as Error).message).not.toContain(sentinel);
      expect((error as Error).message).toContain("skills.auto_update");
    }
  });

  it("returns a sanitized error for malformed TOML", async () => {
    const sentinel = "malformed-secret-like-value-9c2d";
    try {
      await loadSkillUpdateSettings(configFile(`[skills\n${sentinel}`));
      throw new Error("Expected TOML parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillConfigError);
      expect((error as Error).message).not.toContain(sentinel);
      expect((error as Error).message).not.toContain("Cannot parse");
    }
  });
});
