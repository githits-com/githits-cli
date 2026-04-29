import { describe, expect, it, mock } from "bun:test";
import { createMockFileSystemService } from "./test-helpers.js";
import {
  formatRequiredUpdateNotice,
  formatUpdateCommand,
  formatUpdateNotice,
  NpmRegistryUpdateCheckService,
  resolveConfigHome,
  shouldRunRequiredUpdateEnforcement,
  shouldRunUpdateCheck,
  type UpdateCheckFetcher,
} from "./update-check-service.js";

const NOW = new Date("2026-04-28T12:00:00.000Z");
const STALE = new Date("2026-04-26T12:00:00.000Z").toISOString();
const FRESH = new Date("2026-04-28T11:30:00.000Z").toISOString();

describe("NpmRegistryUpdateCheckService", () => {
  it("fetches npm dist-tags when cache is missing and returns update notice", async () => {
    const fetcher = createJsonFetcher({ latest: "0.3.0" });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(false)),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    const notice = await service.checkForUpdate();

    expect(fetcher).toHaveBeenCalledWith(
      "https://registry.npmjs.org/-/package/githits/dist-tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(notice).toEqual({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
      updateCommand: "npm i -g githits@latest",
    });
    expect(fs.ensureDir).toHaveBeenCalledWith(
      "/home/test/.config/githits",
      0o700,
    );
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/home/test/.config/githits/update-check.json",
      expect.any(String),
    );
  });

  it("uses XDG_CONFIG_HOME when set", async () => {
    const fetcher = createJsonFetcher({ latest: "0.3.0" });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(false)),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: { XDG_CONFIG_HOME: "/tmp/xdg" },
    });

    await service.checkForUpdate();

    expect(fs.ensureDir).toHaveBeenCalledWith("/tmp/xdg/githits", 0o700);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/tmp/xdg/githits/update-check.json",
      expect.any(String),
    );
  });

  it("returns a fresh cached update without fetching", async () => {
    const fetcher = createJsonFetcher({ latest: "0.4.0" });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            checkedAt: FRESH,
            latestVersion: "0.3.0",
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    const notice = await service.checkForUpdate();

    expect(fetcher).toHaveBeenCalledWith(
      "https://registry.npmjs.org/githits/0.2.0",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(notice?.latestVersion).toBe("0.3.0");
  });

  it("returns a fresh cached update even when a legacy notification marker exists", async () => {
    const fetcher = createJsonFetcher({ latest: "0.4.0" });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            checkedAt: FRESH,
            latestVersion: "0.3.0",
            lastNotifiedVersion: "0.3.0",
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    const notice = await service.checkForUpdate();

    expect(fetcher).toHaveBeenCalledWith(
      "https://registry.npmjs.org/githits/0.2.0",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(notice?.latestVersion).toBe("0.3.0");
  });

  it("refetches stale cache and returns the newer remote latest", async () => {
    const fetcher = createJsonFetcher({ latest: "0.4.0" });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            checkedAt: STALE,
            latestVersion: "0.3.0",
            lastNotifiedVersion: "0.3.0",
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    const notice = await service.checkForUpdate();

    expect(fetcher).toHaveBeenCalled();
    expect(notice?.latestVersion).toBe("0.4.0");
    const written = getWrittenCache(fs);
    expect(written.checkedAt).toBe(NOW.toISOString());
    expect(written.latestVersion).toBe("0.4.0");
    expect(written.lastNotifiedVersion).toBeUndefined();
  });

  it("does not notify when remote latest equals current", async () => {
    const service = createService({
      currentVersion: "0.3.0",
      body: { latest: "0.3.0" },
    });

    await expect(service.checkForUpdate()).resolves.toBeUndefined();
  });

  it("does not notify when remote latest is lower than current", async () => {
    const fetcher = createJsonFetcher({ latest: "0.3.0" });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(false)),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.4.0-beta.1",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    const notice = await service.checkForUpdate();

    expect(notice).toBeUndefined();
    const written = getWrittenCache(fs);
    expect(written.latestVersion).toBe("0.3.0");
  });

  it("ignores invalid semver in registry response", async () => {
    const service = createService({ body: { latest: "not-semver" } });

    await expect(service.checkForUpdate()).resolves.toBeUndefined();
  });

  it("ignores malformed registry response", async () => {
    const service = createService({ body: { version: "0.3.0" } });

    await expect(service.checkForUpdate()).resolves.toBeUndefined();
  });

  it("ignores non-2xx registry response", async () => {
    const fetcher = mock(() =>
      Promise.resolve(new Response("not found", { status: 404 })),
    ) as UpdateCheckFetcher & ReturnType<typeof mock>;
    const service = createService({ fetcher });

    await expect(service.checkForUpdate()).resolves.toBeUndefined();
  });

  it("ignores fetch rejections", async () => {
    const fetcher = mock(() => Promise.reject(new Error("network down")));
    const service = createService({ fetcher });

    await expect(service.checkForUpdate()).resolves.toBeUndefined();
  });

  it("ignores corrupt cache and fetches", async () => {
    const fetcher = createJsonFetcher({ latest: "0.3.0" });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() => Promise.resolve("{")),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    const notice = await service.checkForUpdate();

    expect(fetcher).toHaveBeenCalled();
    expect(notice?.latestVersion).toBe("0.3.0");
  });

  it("falls back to stale cached update when refresh fails", async () => {
    const fetcher = mock(() => Promise.reject(new Error("network down")));
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            checkedAt: STALE,
            latestVersion: "0.3.0",
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    const notice = await service.checkForUpdate();

    expect(fetcher).toHaveBeenCalled();
    expect(notice?.latestVersion).toBe("0.3.0");
  });

  it("refreshes and caches deprecated current version status", async () => {
    const fetcher = createRouteFetcher({
      "https://registry.npmjs.org/githits/0.2.0": {
        deprecated: "Backend protocol changed",
      },
    });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            checkedAt: FRESH,
            latestVersion: "0.3.0",
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    await service.refreshRequiredUpdateStatus();

    expect(fetcher).toHaveBeenCalledWith(
      "https://registry.npmjs.org/githits/0.2.0",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getWrittenCache(fs).currentVersionStatus).toEqual({
      version: "0.2.0",
      checkedAt: NOW.toISOString(),
      deprecatedReason: "Backend protocol changed",
    });
  });

  it("returns cached required update notice without fetching", async () => {
    const fetcher = createJsonFetcher({ latest: "0.4.0" });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            checkedAt: FRESH,
            latestVersion: "0.3.0",
            currentVersionStatus: {
              version: "0.2.0",
              checkedAt: FRESH,
              deprecatedReason: "Backend protocol changed",
            },
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    await expect(service.getRequiredUpdateNotice()).resolves.toEqual({
      currentVersion: "0.2.0",
      latestKnownVersion: "0.3.0",
      reason: "Backend protocol changed",
      updateCommand: "npm i -g githits@latest",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ignores cached required update notice for a different current version", async () => {
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            currentVersionStatus: {
              version: "0.1.0",
              checkedAt: FRESH,
              deprecatedReason: "Backend protocol changed",
            },
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher: createJsonFetcher({}),
      now: () => NOW,
      env: {},
    });

    await expect(service.getRequiredUpdateNotice()).resolves.toBeUndefined();
  });

  it("preserves cached deprecated status when refresh fails", async () => {
    const fetcher = mock(() => Promise.reject(new Error("network down")));
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            checkedAt: FRESH,
            latestVersion: "0.3.0",
            currentVersionStatus: {
              version: "0.2.0",
              checkedAt: STALE,
              deprecatedReason: "Backend protocol changed",
            },
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    await service.refreshRequiredUpdateStatus();

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    await expect(service.getRequiredUpdateNotice()).resolves.toMatchObject({
      reason: "Backend protocol changed",
    });
  });

  it("clears cached deprecated status after successful non-deprecated metadata", async () => {
    const fetcher = createRouteFetcher({
      "https://registry.npmjs.org/githits/0.2.0": { version: "0.2.0" },
    });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(true)),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            checkedAt: FRESH,
            latestVersion: "0.3.0",
            currentVersionStatus: {
              version: "0.2.0",
              checkedAt: STALE,
              deprecatedReason: "Backend protocol changed",
            },
          }),
        ),
      ),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    await service.refreshRequiredUpdateStatus();

    expect(getWrittenCache(fs).currentVersionStatus).toEqual({
      version: "0.2.0",
      checkedAt: NOW.toISOString(),
    });
  });

  it("sanitizes deprecated reason before caching", async () => {
    const fetcher = createRouteFetcher({
      "https://registry.npmjs.org/githits/0.2.0": {
        deprecated: "\u001b[31mBackend\nprotocol\tchanged\u001b[0m",
      },
    });
    const fs = createMockFileSystemService({
      exists: mock(() => Promise.resolve(false)),
    });
    const service = new NpmRegistryUpdateCheckService({
      currentVersion: "0.2.0",
      fileSystemService: fs,
      fetcher,
      now: () => NOW,
      env: {},
    });

    await service.refreshRequiredUpdateStatus();

    expect(getWrittenCache(fs).currentVersionStatus).toMatchObject({
      deprecatedReason: "[31mBackend protocol changed [0m",
    });
  });
});

describe("resolveConfigHome", () => {
  it("uses XDG_CONFIG_HOME when provided", () => {
    const fs = createMockFileSystemService();

    expect(resolveConfigHome({ XDG_CONFIG_HOME: "/xdg/config" }, fs)).toBe(
      "/xdg/config",
    );
  });

  it("falls back to ~/.config", () => {
    const fs = createMockFileSystemService();

    expect(resolveConfigHome({}, fs)).toBe("/home/test/.config");
  });
});

describe("shouldRunUpdateCheck", () => {
  const base = {
    env: {},
    stderrIsTTY: true,
    stdinIsTTY: true,
    stdoutIsTTY: true,
  };

  it("allows normal command invocations", () => {
    expect(shouldRunUpdateCheck({ ...base, args: ["example", "query"] })).toBe(
      true,
    );
  });

  it("skips help and version invocations", () => {
    expect(shouldRunUpdateCheck({ ...base, args: ["--help"] })).toBe(false);
    expect(shouldRunUpdateCheck({ ...base, args: ["help"] })).toBe(false);
    expect(shouldRunUpdateCheck({ ...base, args: ["--version"] })).toBe(false);
    expect(shouldRunUpdateCheck({ ...base, args: ["-V"] })).toBe(false);
  });

  it("skips npx and bunx invocations", () => {
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["example", "query"],
        env: { npm_lifecycle_event: "npx" },
      }),
    ).toBe(false);
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["example", "query"],
        env: { npm_lifecycle_event: "bunx" },
      }),
    ).toBe(false);
  });

  it("skips npm exec and bun exec style invocations", () => {
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["example", "query"],
        env: { npm_command: "exec", npm_config_user_agent: "npm/11.6.2" },
      }),
    ).toBe(false);
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["example", "query"],
        env: { npm_command: "exec", npm_config_user_agent: "bun/1.3.11" },
      }),
    ).toBe(false);
  });

  it("skips MCP stdio server invocations", () => {
    expect(shouldRunUpdateCheck({ ...base, args: ["mcp", "start"] })).toBe(
      false,
    );
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["mcp"],
        stdinIsTTY: false,
      }),
    ).toBe(false);
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["mcp"],
        stdoutIsTTY: false,
      }),
    ).toBe(false);
  });

  it("allows interactive MCP setup invocation", () => {
    expect(shouldRunUpdateCheck({ ...base, args: ["mcp"] })).toBe(true);
  });

  it("skips CI, disabled, and non-TTY stderr", () => {
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["example", "query"],
        env: { CI: "1" },
      }),
    ).toBe(false);
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["example", "query"],
        env: { GITHITS_DISABLE_UPDATE_CHECK: "1" },
      }),
    ).toBe(false);
    expect(
      shouldRunUpdateCheck({
        ...base,
        args: ["example", "query"],
        stderrIsTTY: false,
      }),
    ).toBe(false);
  });
});

describe("shouldRunRequiredUpdateEnforcement", () => {
  it("allows CI, non-TTY, and disabled advisory update checks", () => {
    expect(
      shouldRunRequiredUpdateEnforcement({
        args: ["example", "query"],
        env: { CI: "1", GITHITS_DISABLE_UPDATE_CHECK: "1" },
      }),
    ).toBe(true);
  });

  it("skips help, version, and ephemeral package-runner invocations", () => {
    expect(
      shouldRunRequiredUpdateEnforcement({ args: ["--help"], env: {} }),
    ).toBe(false);
    expect(shouldRunRequiredUpdateEnforcement({ args: ["-V"], env: {} })).toBe(
      false,
    );
    expect(
      shouldRunRequiredUpdateEnforcement({
        args: ["example", "query"],
        env: { npm_lifecycle_event: "npx" },
      }),
    ).toBe(false);
  });
});

describe("formatUpdateNotice", () => {
  it("formats stderr-only update notice text", () => {
    expect(
      formatUpdateNotice({
        currentVersion: "0.2.0",
        latestVersion: "0.3.0",
        updateCommand: "npm i -g githits@latest",
      }),
    ).toBe(
      "Update available: githits 0.2.0 -> 0.3.0\nRun: npm i -g githits@latest",
    );
  });
});

describe("formatRequiredUpdateNotice", () => {
  it("formats blocking required update text", () => {
    expect(
      formatRequiredUpdateNotice({
        currentVersion: "0.2.0",
        reason: "Backend protocol changed",
        updateCommand: "npm i -g githits@latest",
      }),
    ).toBe(
      "Update required: Backend protocol changed\n\nInstalled githits 0.2.0 is no longer supported.\nUpdate with:\n  npm i -g githits@latest",
    );
  });

  it("includes latest known version when present", () => {
    expect(
      formatRequiredUpdateNotice({
        currentVersion: "0.2.0",
        latestKnownVersion: "0.3.0",
        reason: "Backend protocol changed",
        updateCommand: "npm i -g githits@latest",
      }),
    ).toBe(
      "Update required: Backend protocol changed\n\nInstalled githits 0.2.0 is no longer supported.\nLatest known version: 0.3.0\nUpdate with:\n  npm i -g githits@latest",
    );
  });
});

describe("formatUpdateCommand", () => {
  it("uses package-manager hints when present", () => {
    expect(formatUpdateCommand({ npm_config_user_agent: "pnpm/9.0.0" })).toBe(
      "pnpm add -g githits@latest",
    );
    expect(formatUpdateCommand({ npm_execpath: "/bin/yarn.js" })).toBe(
      "yarn global add githits@latest",
    );
    expect(formatUpdateCommand({ npm_config_user_agent: "bun/1.3.0" })).toBe(
      "bun add -g githits@latest",
    );
    expect(formatUpdateCommand({})).toBe("npm i -g githits@latest");
  });
});

function createService(options: {
  currentVersion?: string;
  body?: unknown;
  fetcher?: UpdateCheckFetcher;
}): NpmRegistryUpdateCheckService {
  return new NpmRegistryUpdateCheckService({
    currentVersion: options.currentVersion ?? "0.2.0",
    fileSystemService: createMockFileSystemService({
      exists: mock(() => Promise.resolve(false)),
    }),
    fetcher: options.fetcher ?? createJsonFetcher(options.body),
    now: () => NOW,
    env: {},
  });
}

function createJsonFetcher(
  body: unknown,
): UpdateCheckFetcher & ReturnType<typeof mock> {
  return mock(() =>
    Promise.resolve(Response.json(body)),
  ) as UpdateCheckFetcher & ReturnType<typeof mock>;
}

function createRouteFetcher(
  routes: Record<string, unknown>,
): UpdateCheckFetcher & ReturnType<typeof mock> {
  return mock((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = routes[url];
    if (body === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(Response.json(body));
  }) as UpdateCheckFetcher & ReturnType<typeof mock>;
}

function getWrittenCache(
  fs: ReturnType<typeof createMockFileSystemService>,
): Record<string, unknown> {
  const calls = (fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls;
  return JSON.parse(calls.at(-1)?.[1] as string) as Record<string, unknown>;
}
