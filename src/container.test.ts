import { describe, expect, it } from "bun:test";
import {
  createAuthCommandDependencies,
  createAuthStatusDependencies,
} from "./container.js";
import { AuthConfigError } from "./services/auth-config.js";

async function withAuthStorageEnv<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.env.GITHITS_AUTH_STORAGE;
  if (value === undefined) delete process.env.GITHITS_AUTH_STORAGE;
  else process.env.GITHITS_AUTH_STORAGE = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.GITHITS_AUTH_STORAGE;
    else process.env.GITHITS_AUTH_STORAGE = original;
  }
}

async function withApiToken<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.env.GITHITS_API_TOKEN;
  if (value === undefined) delete process.env.GITHITS_API_TOKEN;
  else process.env.GITHITS_API_TOKEN = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.GITHITS_API_TOKEN;
    else process.env.GITHITS_API_TOKEN = original;
  }
}

describe("container auth dependencies", () => {
  it("login/logout auth dependencies still honor auth storage config with env token set", async () => {
    await withApiToken("ghi-test", async () => {
      await withAuthStorageEnv("file", async () => {
        const deps = await createAuthCommandDependencies();
        expect(deps.envApiToken).toBe("ghi-test");
        expect(deps.authStorage.getStorageLocation()).toContain("githits/auth");
      });
    });
  });

  it("auth status env-token path bypasses invalid auth storage config", async () => {
    await withApiToken("ghi-test", async () => {
      await withAuthStorageEnv("invalid", async () => {
        const deps = await createAuthStatusDependencies();
        expect(deps.envApiToken).toBe("ghi-test");
      });
    });
  });

  it("auth command dependencies reject invalid auth storage config without env token", async () => {
    await withApiToken(undefined, async () => {
      await withAuthStorageEnv("invalid", async () => {
        await expect(createAuthCommandDependencies()).rejects.toThrow(
          AuthConfigError,
        );
      });
    });
  });
});
