import { describe, expect, it, mock } from "bun:test";
import {
  flushTelemetry,
  ResolveTargetServiceImpl,
  resetTelemetryCollectorForTests,
} from "@githits/core-internal";
import {
  createAuthCommandDependencies,
  createAuthStatusDependencies,
  createContainer,
  recordAuthFingerprint,
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

async function withEnvVars<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const originals = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withoutProxyEnv<T>(fn: () => Promise<T>): Promise<T> {
  return withEnvVars(
    {
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      NO_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      no_proxy: undefined,
      NODE_USE_ENV_PROXY: undefined,
      NODE_OPTIONS: undefined,
    },
    fn,
  );
}

describe("container auth dependencies", () => {
  it("login/logout auth dependencies still honor auth storage config with env token set", async () => {
    await withApiToken("ghi-test", async () => {
      await withAuthStorageEnv("file", async () => {
        const deps = await createAuthCommandDependencies();
        expect(deps.envApiToken).toBe("ghi-test");
        expect(
          deps.authStorage.getStorageLocation().split(/[\\/]/).slice(-2),
        ).toEqual(["githits", "auth"]);
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

  it("auth command dependencies defer proxy validation until network use", async () => {
    await withApiToken(undefined, async () => {
      await withAuthStorageEnv("file", async () => {
        await withEnvVars({ HTTP_PROXY: "not a proxy secret" }, async () => {
          const deps = await createAuthCommandDependencies();
          expect(deps.envApiToken).toBeUndefined();
        });
      });
    });
  });

  it("auth-only dependencies defer service URL validation until network use", async () => {
    await withAuthStorageEnv("file", async () => {
      await withEnvVars(
        {
          GITHITS_MCP_URL: "http://attacker.test",
          GITHITS_API_URL: "http://attacker.test",
        },
        async () => {
          const deps = await createAuthCommandDependencies();
          expect(deps.mcpUrl).toBe("http://attacker.test");
        },
      );
    });
  });

  it("auth status env-token path defers proxy validation for local status", async () => {
    await withApiToken("ghi-test", async () => {
      await withAuthStorageEnv("invalid", async () => {
        await withEnvVars({ HTTP_PROXY: "not a proxy secret" }, async () => {
          const deps = await createAuthStatusDependencies();
          expect(deps.envApiToken).toBe("ghi-test");
        });
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

describe("createContainer", () => {
  it("constructs the resolve service for environment-token auth", async () => {
    await withoutProxyEnv(async () =>
      withApiToken("ghi-test", async () => {
        const deps = await createContainer({ resolveStoredToken: false });
        expect(deps.resolveTargetService).toBeInstanceOf(
          ResolveTargetServiceImpl,
        );
      }),
    );
  });

  it("constructs the resolve service for stored-token auth", async () => {
    await withoutProxyEnv(async () =>
      withApiToken(undefined, async () =>
        withAuthStorageEnv("file", async () => {
          const deps = await createContainer({ resolveStoredToken: false });
          expect(deps.resolveTargetService).toBeInstanceOf(
            ResolveTargetServiceImpl,
          );
        }),
      ),
    );
  });

  it("rejects insecure service URLs before constructing authenticated clients", async () => {
    await withEnvVars(
      {
        GITHITS_API_TOKEN: "ghi-test",
        GITHITS_API_URL: "http://attacker.test",
      },
      async () => {
        await expect(
          createContainer({ resolveStoredToken: false }),
        ).rejects.toThrow("GITHITS_API_URL");
      },
    );
  });

  it("threads explicit client telemetry into constructed services", async () => {
    await withoutProxyEnv(async () =>
      withApiToken("ghi-test", async () => {
        const originalFetch = globalThis.fetch;
        let capturedHeaders: Record<string, string> | undefined;
        const fetchFn = mock((_url: string, init?: RequestInit) => {
          capturedHeaders = init?.headers as Record<string, string>;
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        });
        globalThis.fetch = fetchFn as unknown as typeof fetch;

        try {
          const deps = await createContainer({
            resolveStoredToken: false,
            clientName: "githits-cli/mcp",
            agentProvider: () => ({ name: "cursor", version: "1.0.0" }),
          });

          await deps.githitsService.getLanguages();

          expect(capturedHeaders?.Authorization).toBe("Bearer ghi-test");
          expect(capturedHeaders?.["User-Agent"]).toMatch(/^githits-cli\/\S+$/);
          expect(capturedHeaders?.["x-githits-client-name"]).toBe(
            "githits-cli/mcp",
          );
          expect(capturedHeaders?.["x-githits-client-version"]).toMatch(
            /^\S+$/,
          );
          expect(capturedHeaders?.["x-githits-agent"]).toBe("cursor/1.0.0");
          expect(capturedHeaders?.["x-githits-session-id"]).toMatch(
            /^[0-9a-f]{16}$/,
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      }),
    );
  });

  describe("recordAuthFingerprint", () => {
    it("records mode and env presence as booleans, never raw values", () => {
      const writes: string[] = [];
      resetTelemetryCollectorForTests({
        env: { GITHITS_TELEMETRY: "1" },
        now: () => 0,
        write: (text) => writes.push(text),
      });

      recordAuthFingerprint("file", {
        HOME: "/home/secret-user",
        XDG_CONFIG_HOME: "/home/secret-user/.config",
      } as NodeJS.ProcessEnv);
      flushTelemetry(0);

      const report = writes.join("");
      expect(report).toContain("auth.fingerprint");
      expect(report).toContain("mode=file");
      expect(report).toContain("homeSet=true");
      expect(report).toContain("xdgConfigHomeSet=true");
      expect(report).toContain("appDataSet=false");
      // Privacy: env values must never reach telemetry output.
      expect(report).not.toContain("secret-user");
      resetTelemetryCollectorForTests({ env: {} });
    });
  });
});
