import { describe, expect, it, mock, spyOn } from "bun:test";
import type { Dependencies } from "../container.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockFileSystemService,
  createMockGitHitsService,
} from "../services/test-helpers.js";
import { AuthRequiredError } from "../shared/require-auth.js";
import {
  createAuthenticatedDependencies,
  withAuthenticatedAction,
} from "./shared.js";

function createDeps(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    authStorage: createMockAuthStorage(),
    authService: createMockAuthService(),
    browserService: createMockBrowserService(),
    fileSystemService: createMockFileSystemService(),
    mcpUrl: "https://mcp.githits.com",
    apiUrl: "https://api.githits.com",
    apiToken: undefined,
    hasValidToken: false,
    envApiToken: undefined,
    githitsService: createMockGitHitsService(),
    refreshAuth: mock(async () => ({
      apiToken: "fresh-token",
      hasValidToken: true,
      githitsService: createMockGitHitsService(),
    })),
    ...overrides,
  };
}

function withTty<T>(
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
  run: () => Promise<T>,
): Promise<T> {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(
    process.stdin,
    "isTTY",
  );
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(
    process.stdout,
    "isTTY",
  );

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: stdinIsTTY,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: stdoutIsTTY,
  });

  return run().finally(() => {
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    }
    if (stdoutDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
    }
  });
}

describe("createAuthenticatedDependencies", () => {
  it("returns existing dependencies when token is already valid", async () => {
    const deps = createDeps({
      hasValidToken: true,
      apiToken: "existing-token",
    });
    const login = mock(async () => true);

    const result = await createAuthenticatedDependencies(deps, login);

    expect(result).toBe(deps);
    expect(login).not.toHaveBeenCalled();
    expect(deps.refreshAuth).not.toHaveBeenCalled();
  });

  it("falls back to requireAuth in non-interactive mode", async () => {
    const deps = createDeps();
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const login = mock(async () => true);

    await expect(
      withTty(false, false, () => createAuthenticatedDependencies(deps, login)),
    ).rejects.toThrow(AuthRequiredError);

    expect(login).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("runs login flow and refreshes dependencies in interactive mode", async () => {
    const refreshedService = createMockGitHitsService();
    const deps = createDeps({
      refreshAuth: mock(async () => ({
        apiToken: "fresh-token",
        hasValidToken: true,
        githitsService: refreshedService,
      })),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const login = mock(async () => true);

    const result = await withTty(true, true, () =>
      createAuthenticatedDependencies(deps, login),
    );

    expect(login).toHaveBeenCalledWith(deps);
    expect(deps.refreshAuth).toHaveBeenCalledTimes(1);
    expect(result.apiToken).toBe("fresh-token");
    expect(result.hasValidToken).toBe(true);
    expect(result.githitsService).toBe(refreshedService);
    consoleSpy.mockRestore();
  });

  it("throws when interactive login fails", async () => {
    const deps = createDeps();
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const login = mock(async () => false);

    await expect(
      withTty(true, true, () => createAuthenticatedDependencies(deps, login)),
    ).rejects.toThrow(AuthRequiredError);

    const output = consoleSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("Not authenticated. Starting login...");
    expect(output).toContain("npx githits@latest login");
    expect(deps.refreshAuth).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("withAuthenticatedAction", () => {
  it("passes only business args and injects dependencies last", async () => {
    const deps = createDeps({
      hasValidToken: true,
      apiToken: "existing-token",
    });
    const action = mock(
      async (
        query: string,
        options: { json?: boolean },
        resolvedDeps: Dependencies,
      ) => {
        expect(query).toBe("search term");
        expect(options).toEqual({ json: true });
        expect(resolvedDeps).toBe(deps);
      },
    );

    const wrapped = withAuthenticatedAction(action, {
      createDeps: async () => deps,
      authenticateDeps: async (inputDeps) => inputDeps,
    });

    await wrapped("search term", { json: true }, { opts: () => ({}) });

    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("search term", { json: true }, deps);
  });
});
