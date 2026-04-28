import { describe, expect, it, mock } from "bun:test";
import { createMockFileSystemService } from "./test-helpers.js";
import {
  formatUpdateNotice,
  NpmRegistryUpdateCheckService,
  resolveConfigHome,
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
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/home/test/.config/githits/update-check.json",
      expect.any(String),
      0o600,
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
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/tmp/xdg/githits/update-check.json",
      expect.any(String),
      0o600,
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

    expect(fetcher).not.toHaveBeenCalled();
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

    expect(fetcher).not.toHaveBeenCalled();
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

function getWrittenCache(
  fs: ReturnType<typeof createMockFileSystemService>,
): Record<string, unknown> {
  const calls = (fs.writeFile as ReturnType<typeof mock>).mock.calls;
  return JSON.parse(calls.at(-1)?.[1] as string) as Record<string, unknown>;
}
