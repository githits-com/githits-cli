import { describe, expect, it, mock } from "bun:test";
import type { LoginDependencies } from "../commands/login.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
} from "../services/test-helpers.js";
import {
  type CommandLike,
  getCommandPath,
  isAutoLoginEligibleCommand,
  maybeAutoLoginBeforeCommand,
} from "./auto-login.js";

function createCommand(
  path: string[],
  options: Record<string, unknown> = {},
): CommandLike {
  let current: CommandLike = {
    name: () => "githits",
    opts: () => ({}),
    parent: null,
  };

  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index]!;
    const isLeaf = index === path.length - 1;
    const parent = current;
    current = {
      name: () => segment,
      opts: () => (isLeaf ? options : {}),
      parent,
    };
  }

  return current;
}

function createLoginDeps(
  overrides: Partial<LoginDependencies & { hasValidToken: boolean }> = {},
): LoginDependencies & { hasValidToken: boolean } {
  return {
    authService: createMockAuthService(),
    authStorage: createMockAuthStorage(),
    browserService: createMockBrowserService(),
    mcpUrl: "https://mcp.githits.com",
    hasValidToken: false,
    ...overrides,
  };
}

describe("getCommandPath", () => {
  it("returns the leaf command path without the root program", () => {
    expect(getCommandPath(createCommand(["auth", "status"]))).toEqual([
      "auth",
      "status",
    ]);
  });
});

describe("isAutoLoginEligibleCommand", () => {
  it("allows interactive example invocations", () => {
    expect(
      isAutoLoginEligibleCommand(createCommand(["example"]), {
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(true);
  });

  it("leaves init auth handling to the init command", () => {
    expect(
      isAutoLoginEligibleCommand(createCommand(["init"]), {
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(false);
  });

  it("does not auto-login for init uninstall", () => {
    expect(
      isAutoLoginEligibleCommand(createCommand(["init", "uninstall"]), {
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(false);
  });

  it("does not special-case init --skip-login in root auto-login", () => {
    expect(
      isAutoLoginEligibleCommand(createCommand(["init"], { skipLogin: true }), {
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(false);
  });

  it("allows interactive package/source command invocations", () => {
    for (const path of [
      ["search"],
      ["search-status"],
      ["code", "files"],
      ["code", "read"],
      ["code", "grep"],
      ["docs", "list"],
      ["docs", "read"],
      ["pkg", "info"],
      ["pkg", "vulns"],
      ["pkg", "deps"],
      ["pkg", "changelog"],
    ]) {
      expect(
        isAutoLoginEligibleCommand(createCommand(path), {
          stdinIsTTY: true,
          stdoutIsTTY: true,
        }),
      ).toBe(true);
    }
  });

  it("allows interactive --json invocations once login output is redirected", () => {
    expect(
      isAutoLoginEligibleCommand(createCommand(["example"], { json: true }), {
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe(true);
  });

  it("skips eligible commands when stdout is not interactive", () => {
    expect(
      isAutoLoginEligibleCommand(createCommand(["languages"]), {
        stdinIsTTY: true,
        stdoutIsTTY: false,
      }),
    ).toBe(false);
  });

  it("skips exempt commands", () => {
    for (const path of [
      ["login"],
      ["logout"],
      ["auth", "status"],
      ["mcp"],
      ["mcp", "start"],
    ]) {
      expect(
        isAutoLoginEligibleCommand(createCommand(path), {
          stdinIsTTY: true,
          stdoutIsTTY: true,
        }),
      ).toBe(false);
    }
  });
});

describe("maybeAutoLoginBeforeCommand", () => {
  it("skips bootstrap for ineligible commands", async () => {
    const createContainer = mock(() => Promise.resolve(createLoginDeps()));
    const login = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );

    const result = await maybeAutoLoginBeforeCommand(
      createCommand(["logout"]),
      {
        createContainer,
        loginFlow: login,
        stdinIsTTY: true,
        stdoutIsTTY: true,
      },
    );

    expect(result).toEqual({ status: "skipped" });
    expect(createContainer).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("skips login when the container already has a valid token", async () => {
    const createContainer = mock(() =>
      Promise.resolve(createLoginDeps({ hasValidToken: true })),
    );
    const login = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully.",
      }),
    );

    const result = await maybeAutoLoginBeforeCommand(
      createCommand(["example"]),
      {
        createContainer,
        loginFlow: login,
        stdinIsTTY: true,
        stdoutIsTTY: true,
      },
    );

    expect(result).toEqual({ status: "already-authenticated" });
    expect(createContainer).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it("runs login for eligible unauthenticated commands", async () => {
    const container = createLoginDeps({ hasValidToken: false });
    const createContainer = mock(() => Promise.resolve(container));
    const login = mock(() =>
      Promise.resolve({
        status: "success" as const,
        message: "Logged in successfully. Token expires in 1 hour.",
      }),
    );

    const result = await maybeAutoLoginBeforeCommand(
      createCommand(["feedback"]),
      {
        createContainer,
        loginFlow: login,
        stdinIsTTY: true,
        stdoutIsTTY: true,
      },
    );

    expect(result).toEqual({
      status: "authenticated",
      message: "Logged in successfully. Token expires in 1 hour.",
    });
    expect(login).toHaveBeenCalledWith({}, container);
  });

  it("returns the login failure without continuing", async () => {
    const createContainer = mock(() => Promise.resolve(createLoginDeps()));
    const login = mock(() =>
      Promise.resolve({
        status: "failed" as const,
        message: "Authentication timed out.",
      }),
    );

    const result = await maybeAutoLoginBeforeCommand(
      createCommand(["languages"]),
      {
        createContainer,
        loginFlow: login,
        stdinIsTTY: true,
        stdoutIsTTY: true,
      },
    );

    expect(result).toEqual({
      status: "failed",
      message: "Authentication timed out.",
    });
  });
});
