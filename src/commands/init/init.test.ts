import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { ExitPromptError } from "@inquirer/core";
import type {
  ConfirmChoice,
  PromptService,
} from "../../services/prompt-service.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockExecService,
  createMockFileSystemService,
  createMockPromptService,
  createValidTokenData,
} from "../../services/test-helpers.js";
import type { LoginDependencies } from "../login.js";
import type { InitDependencies } from "./init.js";
import { initAction } from "./init.js";

/** Suppress console.log during tests */
let logSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

/** Create mock login deps that report already authenticated */
function createAlreadyAuthLoginDeps(): () => Promise<LoginDependencies> {
  return mock(() =>
    Promise.resolve({
      authService: createMockAuthService(),
      authStorage: createMockAuthStorage({
        loadTokens: mock(() =>
          Promise.resolve(
            createValidTokenData({
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            }),
          ),
        ),
      }),
      browserService: createMockBrowserService(),
      mcpUrl: "https://mcp.githits.com",
    }),
  );
}

/** Create default deps with overrides */
function createDeps(
  overrides: Partial<InitDependencies> = {},
): InitDependencies {
  return {
    fileSystemService: createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
      isDirectory: mock(() => Promise.resolve(false)),
    }),
    promptService: createMockPromptService(),
    execService: createMockExecService(),
    createLoginDeps: createAlreadyAuthLoginDeps(),
    ...overrides,
  };
}

/**
 * Create a FileSystemService mock that detects specific agents
 * and optionally has config files with content.
 */
function createFsWithDetection(
  detectedDirs: string[],
  configFiles: Record<string, string> = {},
) {
  return createMockFileSystemService({
    getHomeDir: mock(() => "/home/test"),
    joinPath: mock((...segments: string[]) => segments.join("/")),
    isDirectory: mock(async (path: string) => detectedDirs.includes(path)),
    getDirname: mock(
      (path: string) => path.split("/").slice(0, -1).join("/") || "/",
    ),
    ensureDir: mock(() => Promise.resolve()),
    readFile: mock(async (path: string) => {
      if (path in configFiles) {
        return configFiles[path]!;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    atomicWriteFile: mock(() => Promise.resolve()),
  });
}

/** Helper to extract log output as string array */
function getLogOutput(): string[] {
  return (logSpy.mock.calls as unknown[][]).map((c) => String(c[0] ?? ""));
}

describe("initAction", () => {
  it("scans agents and sets up unconfigured ones", async () => {
    // Cursor detected but not configured
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    // Should attempt to write cursor config (no checkbox prompt)
    expect(promptService.checkbox).not.toHaveBeenCalled();
    expect(promptService.confirm3).toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalled();
  });

  it("skips already-configured agents without prompting", async () => {
    // Cursor detected AND already configured
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
      }),
    });
    const promptService = createMockPromptService();

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    // Should not prompt or write anything
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("already configured"))).toBe(
      true,
    );
    expect(logCalls.some((msg) => msg.includes("Nothing to do"))).toBe(true);
  });

  it("handles mixed status: configured + unconfigured", async () => {
    // Cursor configured, windsurf not configured
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.codeium/windsurf"],
      {
        "/home/test/.cursor/mcp.json": JSON.stringify({
          mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
        }),
      },
    );
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    // Should only set up windsurf
    expect(promptService.confirm3).toHaveBeenCalledTimes(1);
    expect(fs.atomicWriteFile).toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some(
        (msg) => msg.includes("Cursor") && msg.includes("already configured"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) => msg.includes("Windsurf") && msg.includes("needs setup"),
      ),
    ).toBe(true);
  });

  it("shows all agents as already configured when all check commands match", async () => {
    // Detect Claude Code (CLI) and Cursor (config-file), both configured
    const fs = createFsWithDetection(
      ["/home/test/.claude", "/home/test/.cursor"],
      {
        "/home/test/.cursor/mcp.json": JSON.stringify({
          mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
        }),
      },
    );
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "githits-plugin\n",
          stderr: "",
        }),
      ),
    });
    const promptService = createMockPromptService();

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(promptService.confirm3).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Nothing to do"))).toBe(true);
  });

  it("sets up CLI agents that are not yet configured", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });
    let callCount = 0;
    const execService = createMockExecService({
      exec: mock(() => {
        callCount++;
        // First call: check command (no match = needs setup)
        if (callCount === 1) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "other-plugin\n",
            stderr: "",
          });
        }
        // Subsequent calls: setup commands
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    // 1 check + 2 setup commands = 3 exec calls
    expect(execService.exec).toHaveBeenCalledTimes(3);
    expect(execService.exec).toHaveBeenCalledWith("claude", expect.any(Array));
  });

  it("stops prompting after 'always' response", async () => {
    // Two unconfigured config-file agents
    const fs = createFsWithDetection([
      "/home/test/.cursor",
      "/home/test/.codeium/windsurf",
    ]);
    const confirm3 = mock(() => Promise.resolve("always" as ConfirmChoice));
    const promptService = createMockPromptService({ confirm3 });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    // confirm3 called once (first agent), then "always" kicks in
    expect(confirm3).toHaveBeenCalledTimes(1);
  });

  it("skips agent when user responds 'no'", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("no" as ConfirmChoice)),
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("--yes flag skips all prompts and configures all unconfigured agents", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService();
    const execService = createMockExecService();

    await initAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(promptService.checkbox).not.toHaveBeenCalled();
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalled();
  });

  it("--yes with no agents detected prints message and returns", async () => {
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService();
    const execService = createMockExecService();

    await initAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(execService.exec).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("No coding agents detected")),
    ).toBe(true);
  });

  it("--yes with all agents already configured shows nothing to do", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
      }),
    });

    await initAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Nothing to do"))).toBe(true);
  });

  it("continues to next agent when one fails", async () => {
    // Claude (CLI, will fail) + cursor (config-file, should still work)
    const fs = createFsWithDetection([
      "/home/test/.claude",
      "/home/test/.cursor",
    ]);
    let callCount = 0;
    const execService = createMockExecService({
      exec: mock(() => {
        callCount++;
        // First call: check command for claude (no match = needs setup)
        if (callCount === 1) {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        // Setup commands: fail
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "error" });
      }),
    });
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("always" as ConfirmChoice)),
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    // Both should be attempted
    expect(execService.exec).toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalled();
  });

  it("handles Ctrl+C on confirm3 prompt gracefully", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService({
      confirm3: mock(() =>
        Promise.reject(new ExitPromptError("User force closed")),
      ),
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("cancelled"))).toBe(true);
  });

  it("rethrows non-ExitPromptError from confirm3", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.reject(new Error("Unexpected error"))),
    });

    await expect(
      initAction(
        {},
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
          createLoginDeps: createAlreadyAuthLoginDeps(),
        },
      ),
    ).rejects.toThrow("Unexpected error");
  });

  it("shows 'Setup skipped' when all unconfigured agents are skipped", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("no" as ConfirmChoice)),
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Setup skipped"))).toBe(true);
  });

  describe("login integration", () => {
    it("runs login flow and proceeds when already authenticated", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
      });

      await initAction(
        {},
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
          createLoginDeps: createAlreadyAuthLoginDeps(),
        },
      );

      const logCalls = getLogOutput();
      expect(
        logCalls.some((msg) => msg.includes("Already authenticated")),
      ).toBe(true);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("runs login flow and proceeds on success", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
      });
      const createLoginDeps = mock(() =>
        Promise.resolve({
          authService: createMockAuthService(),
          authStorage: createMockAuthStorage(),
          browserService: createMockBrowserService(),
          mcpUrl: "https://mcp.githits.com",
        }),
      );

      await initAction(
        {},
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
          createLoginDeps,
        },
      );

      const logCalls = getLogOutput();
      expect(
        logCalls.some((msg) => msg.includes("Logged in successfully")),
      ).toBe(true);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("prompts to continue when login fails", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
      });
      const createLoginDeps = mock(() =>
        Promise.resolve({
          authService: createMockAuthService({
            discoverEndpoints: mock(() =>
              Promise.reject(new Error("Network error")),
            ),
          }),
          authStorage: createMockAuthStorage(),
          browserService: createMockBrowserService(),
          mcpUrl: "https://mcp.githits.com",
        }),
      );

      await initAction(
        {},
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
          createLoginDeps,
        },
      );

      const logCalls = getLogOutput();
      expect(logCalls.some((msg) => msg.includes("Login failed"))).toBe(true);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("cancels setup when login fails and user declines to continue", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("no" as ConfirmChoice)),
      });
      const createLoginDeps = mock(() =>
        Promise.resolve({
          authService: createMockAuthService({
            discoverEndpoints: mock(() =>
              Promise.reject(new Error("Network error")),
            ),
          }),
          authStorage: createMockAuthStorage(),
          browserService: createMockBrowserService(),
          mcpUrl: "https://mcp.githits.com",
        }),
      );

      await initAction(
        {},
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
          createLoginDeps,
        },
      );

      const logCalls = getLogOutput();
      expect(logCalls.some((msg) => msg.includes("Setup cancelled"))).toBe(
        true,
      );
      expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    });

    it("--skip-login skips authentication step", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
      });
      const createLoginDeps = mock(() =>
        Promise.reject(new Error("should not be called")),
      );

      await initAction(
        { skipLogin: true },
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
          createLoginDeps,
        },
      );

      expect(createLoginDeps).not.toHaveBeenCalled();
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("--yes mode continues on login failure without prompting", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService();
      const createLoginDeps = mock(() =>
        Promise.resolve({
          authService: createMockAuthService({
            discoverEndpoints: mock(() =>
              Promise.reject(new Error("Network error")),
            ),
          }),
          authStorage: createMockAuthStorage(),
          browserService: createMockBrowserService(),
          mcpUrl: "https://mcp.githits.com",
        }),
      );

      await initAction(
        { yes: true },
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
          createLoginDeps,
        },
      );

      expect(promptService.confirm3).not.toHaveBeenCalled();
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("skips login when createLoginDeps is not provided", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
      });

      await initAction(
        {},
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
        },
      );

      const logCalls = getLogOutput();
      expect(
        logCalls.some((msg) => msg.includes("Checking authentication")),
      ).toBe(false);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });
  });
});
