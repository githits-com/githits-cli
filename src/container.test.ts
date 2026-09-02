import { describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgenticAskServiceImpl,
  ResolveTargetServiceImpl,
} from "@githits/core-internal";
import {
  createAuthCommandDependencies,
  createAuthStatusDependencies,
  createContainer,
  createLogoutCommandDependencies,
  recordAuthFingerprint,
} from "./container.js";
import { AuthConfigError } from "./services/auth-config.js";
import {
  flushTelemetry,
  resetTelemetryCollectorForTests,
} from "./shared/telemetry.js";

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
    if (value === undefined) unsetEnvVar(key);
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) unsetEnvVar(key);
      else process.env[key] = value;
    }
  }
}

function unsetEnvVar(key: string): void {
  const isWindowsProxyKey =
    process.platform === "win32" &&
    ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"].includes(key.toUpperCase());
  if (isWindowsProxyKey) {
    // Bun 1.4 on Windows retains the deleted value through a differently-cased
    // process.env alias. Empty proxy values have the required unset semantics.
    process.env[key] = "";
  } else {
    delete process.env[key];
  }
}

async function withoutProxyEnv<T>(fn: () => Promise<T>): Promise<T> {
  const values: Record<string, string | undefined> = {
    HTTP_PROXY: undefined,
    HTTPS_PROXY: undefined,
    NO_PROXY: undefined,
    NODE_USE_ENV_PROXY: undefined,
    NODE_OPTIONS: undefined,
  };
  if (process.platform !== "win32") {
    values.http_proxy = undefined;
    values.https_proxy = undefined;
    values.no_proxy = undefined;
  }
  return withEnvVars(values, fn);
}

describe("container auth dependencies", () => {
  it("constructs logout dependencies without parsing malformed auth config", async () => {
    const xdgConfigHome = await mkdtemp(
      join(tmpdir(), "githits-logout-config-"),
    );
    const configDir = join(xdgConfigHome, "githits");
    await mkdir(configDir, { recursive: true });
    try {
      for (const contents of [
        "[experimental\n",
        '[auth]\nstorage = "invalid"\n',
      ]) {
        await writeFile(join(configDir, "config.toml"), contents);
        const configEnv =
          process.platform === "win32"
            ? { APPDATA: xdgConfigHome, XDG_CONFIG_HOME: undefined }
            : { XDG_CONFIG_HOME: xdgConfigHome, APPDATA: undefined };
        await withEnvVars(
          {
            ...configEnv,
            GITHITS_AUTH_STORAGE: "invalid",
            GITHITS_API_TOKEN: undefined,
          },
          async () => {
            const deps = await createLogoutCommandDependencies();
            expect(deps.authStorage).toBeDefined();
            expect(deps.authDiagnostics).toBeDefined();
            expect(deps.mcpUrl).toBe("https://mcp.githits.com");
          },
        );
      }
    } finally {
      await rm(xdgConfigHome, { recursive: true, force: true });
    }
  });

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
  it("constructs private experimental services for environment-token auth", async () => {
    await withoutProxyEnv(async () =>
      withApiToken("ghi-test", async () => {
        const deps = await createContainer({ resolveStoredToken: false });
        expect(deps.resolveTargetService).toBeInstanceOf(
          ResolveTargetServiceImpl,
        );
        expect(deps.agenticAskService).toBeInstanceOf(AgenticAskServiceImpl);
      }),
    );
  });

  it("constructs private experimental services for stored-token auth", async () => {
    await withoutProxyEnv(async () =>
      withApiToken(undefined, async () =>
        withAuthStorageEnv("file", async () => {
          const deps = await createContainer({ resolveStoredToken: false });
          expect(deps.resolveTargetService).toBeInstanceOf(
            ResolveTargetServiceImpl,
          );
          expect(deps.agenticAskService).toBeInstanceOf(AgenticAskServiceImpl);
        }),
      ),
    );
  });

  it("wires Agentic Ask to the API URL with the normal token and client identity", async () => {
    await withoutProxyEnv(async () =>
      withEnvVars(
        {
          GITHITS_API_TOKEN: "ghi-ask-test",
          GITHITS_API_URL: "https://api.githits.test",
        },
        async () => {
          const originalFetch = globalThis.fetch;
          let capturedUrl: string | undefined;
          let capturedInit: RequestInit | undefined;
          globalThis.fetch = mock(
            (url: string | URL | Request, init?: RequestInit) => {
              capturedUrl = String(url);
              capturedInit = init;
              return Promise.resolve(
                new Response(
                  JSON.stringify({
                    source_format: "cli",
                    tool_call_id: "018f47a6-7b32-7a1e-8f45-6a2d39c81720",
                    answer_markdown: "Grounded answer.",
                    sources: [],
                  }),
                ),
              );
            },
          ) as unknown as typeof fetch;

          try {
            const deps = await createContainer({ resolveStoredToken: false });
            await deps.agenticAskService.ask({
              target: "npm:example",
              question: "How?",
            });

            expect(capturedUrl).toBe("https://api.githits.test/ask");
            expect(capturedInit?.headers).toMatchObject({
              Authorization: "Bearer ghi-ask-test",
              "x-githits-client-name": "githits-cli",
              "x-githits-client-version": expect.stringMatching(/^\S+$/),
            });
            expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
          } finally {
            globalThis.fetch = originalFetch;
          }
        },
      ),
    );
  });

  it("passes the non-throwing stored refresh policy to the token manager", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "githits-init-auth-"));
    const authDir = join(storageRoot, "githits", "auth");
    const originalFetch = globalThis.fetch;
    const fetchFn = mock(() =>
      Promise.reject(new Error("network access was not expected")),
    );
    globalThis.fetch = fetchFn as unknown as typeof fetch;

    try {
      await mkdir(authDir, { recursive: true });
      await writeFile(
        join(authDir, "auth.json"),
        JSON.stringify({
          version: 1,
          tokens: {
            "https://mcp.githits.com": {
              accessToken: "expired-access-token",
              refreshToken: "retained-refresh-token",
              expiresAt: new Date(Date.now() - 60_000).toISOString(),
              createdAt: new Date(Date.now() - 7200_000).toISOString(),
            },
          },
        }),
      );

      const configEnv =
        process.platform === "win32"
          ? {
              APPDATA: storageRoot,
              XDG_CONFIG_HOME: undefined,
              USERPROFILE: storageRoot,
              HOME: storageRoot,
            }
          : {
              APPDATA: undefined,
              XDG_CONFIG_HOME: storageRoot,
              USERPROFILE: undefined,
              HOME: storageRoot,
            };

      await withoutProxyEnv(async () =>
        withEnvVars(
          {
            ...configEnv,
            GITHITS_API_TOKEN: undefined,
            GITHITS_AUTH_STORAGE: "file",
            GITHITS_MCP_URL: undefined,
          },
          async () => {
            await expect(createContainer()).rejects.toThrow(
              "OAuth client registration is missing or unreadable",
            );

            const deps = await createContainer({
              refreshFailureMode: "return-undefined",
            });
            expect(deps.hasValidToken).toBe(false);
            expect(deps.apiToken).toBeUndefined();
            expect(fetchFn).not.toHaveBeenCalled();
          },
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
      await rm(storageRoot, { recursive: true, force: true });
    }
  }, 20_000);

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

  it("threads explicit client telemetry into constructed services, including Ask", async () => {
    await withoutProxyEnv(async () =>
      withApiToken("ghi-test", async () => {
        const originalFetch = globalThis.fetch;
        let capturedHeaders: Record<string, string> | undefined;
        const fetchFn = mock((url: string, init?: RequestInit) => {
          capturedHeaders = init?.headers as Record<string, string>;
          return Promise.resolve(
            new Response(
              JSON.stringify(
                url.endsWith("/ask")
                  ? {
                      source_format: "mcp",
                      tool_call_id: "018f47a6-7b32-7a1e-8f45-6a2d39c81720",
                      answer_markdown: "Grounded answer.",
                      sources: [],
                    }
                  : [],
              ),
              {
                headers: { "Content-Type": "application/json" },
              },
            ),
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
          await deps.agenticAskService.ask({
            target: "npm:example",
            question: "How?",
            sourceFormat: "mcp",
          });

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

  it("routes container-built service spans through the shared collector", async () => {
    const writes: string[] = [];
    resetTelemetryCollectorForTests({
      env: { GITHITS_TELEMETRY: "1" },
      now: () => 0,
      write: (text) => writes.push(text),
    });

    try {
      await withoutProxyEnv(async () =>
        withApiToken("ghi-test", async () => {
          const originalFetch = globalThis.fetch;
          globalThis.fetch = mock(() =>
            Promise.resolve(new Response(JSON.stringify([]))),
          ) as unknown as typeof fetch;

          try {
            const deps = await createContainer({ resolveStoredToken: false });
            await deps.githitsService.getLanguages();
          } finally {
            globalThis.fetch = originalFetch;
          }
        }),
      );

      flushTelemetry(0);
      const report = writes.join("");
      expect(report).toContain("container.create");
      expect(report).toContain("githits.languages.request");
    } finally {
      resetTelemetryCollectorForTests({ env: {} });
    }
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
