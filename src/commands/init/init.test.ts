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
import type { ConfirmChoice } from "../../services/prompt-service.js";
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

function lookupCommandFor(platform: string = process.platform): string {
  return platform === "win32" ? "where" : "which";
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
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
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
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
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
    const lookupCmd = lookupCommandFor();
    // Detect Claude Code (CLI) and Cursor (config-file), both configured
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
    });
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} claude`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/claude\n",
            stderr: "",
          });
        }
        if (key === "claude plugin list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "githits-plugin\n",
            stderr: "",
          });
        }
        // Default: command not found (e.g., which opencode)
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
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
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} claude`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/claude\n",
            stderr: "",
          });
        }
        if (key === "claude plugin list") {
          // Check command: no match = needs setup
          return Promise.resolve({
            exitCode: 0,
            stdout: "other-plugin\n",
            stderr: "",
          });
        }
        if (cmd === "claude") {
          // Setup commands
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        // Default: command not found (e.g., which opencode)
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
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

    // 4 binary detections + 1 check + 2 setup commands + 2 post-setup verification calls = 9
    expect(execService.exec).toHaveBeenCalledTimes(9);
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

    // One PATH lookup is attempted for each binary-detected agent
    expect(execService.exec).toHaveBeenCalledTimes(4);
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("No coding agents detected")),
    ).toBe(true);
  });

  it("--yes with all agents already configured shows nothing to do", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
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

  it("treats equivalent local npx @latest configs as already configured", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
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

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Nothing to do"))).toBe(true);
  });

  it("migrates non-@latest local config to @latest", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits", "mcp", "start"],
          },
        },
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

    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    const written = (fs.atomicWriteFile as ReturnType<typeof mock>).mock
      .calls[0]![1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.mcpServers.GitHits).toEqual({
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    });
  });

  it("cleans duplicate lowercase githits entry during setup", async () => {
    const fs = createFsWithDetection(["/home/test/.cline"], {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            githits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
            GitHits: {
              command: "npx",
              args: ["-y", "githits", "mcp", "start"],
            },
          },
        },
      ),
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

    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    const written = (fs.atomicWriteFile as ReturnType<typeof mock>).mock
      .calls[0]![1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.mcpServers.GitHits).toEqual({
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    });
    expect(parsed.mcpServers.githits).toBeUndefined();
  });

  it("continues to next agent when one fails", async () => {
    const lookupCmd = lookupCommandFor();
    // Claude (CLI, will fail) + cursor (config-file, should still work)
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} claude`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/claude\n",
            stderr: "",
          });
        }
        if (key === "claude plugin list") {
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

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Setup completed with errors")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Done! GitHits is ready"))).toBe(
      false,
    );
    expect(logCalls.some((msg) => msg.includes("- Claude Code:"))).toBe(true);
  });

  it("treats Gemini already-installed setup output as already configured", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} gemini`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/gemini\n",
            stderr: "",
          });
        }
        if (key === "gemini extensions config githits") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "",
            stderr: "",
          });
        }
        if (
          key ===
          "gemini extensions install --consent https://github.com/githits-com/githits-cli"
        ) {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr:
              'Extension "githits" is already installed. Please uninstall it first.\n',
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
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

    const logCalls = getLogOutput();
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Gemini CLI") && msg.includes("already configured"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("failed to configure"))).toBe(
      false,
    );
  });

  it("marks Gemini setup as failed when install does not actually configure extension", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} gemini`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/gemini\n",
            stderr: "",
          });
        }
        if (key === "gemini extensions config githits") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "",
            stderr: 'Extension "githits" is not installed.\n',
          });
        }
        if (
          key ===
          "gemini extensions install --consent https://github.com/githits-com/githits-cli"
        ) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Do you want to continue? [Y/n]: ",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
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

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("Gemini installation did not complete"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("failed to configure"))).toBe(
      true,
    );
    expect(logCalls.some((msg) => msg.includes("- Gemini CLI:"))).toBe(true);
  });

  it("does not attempt Gemini setup when only .gemini directory exists", async () => {
    const fs = createFsWithDetection(["/home/test/.gemini"]);
    const promptService = createMockPromptService();
    const execService = createMockExecService();

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some(
        (msg) => msg.includes("Gemini CLI") && msg.includes("not detected"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) => msg.includes("Setting up") && msg.includes("Gemini CLI"),
      ),
    ).toBe(false);
    expect(promptService.confirm3).not.toHaveBeenCalled();
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
