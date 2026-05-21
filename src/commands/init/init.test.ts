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
import { Command } from "commander";
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
import {
  initAction,
  initUninstallAction,
  registerInitCommand,
} from "./init.js";

/** Suppress console.log during tests */
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let originalExitCode: string | number | null | undefined;

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = 0;
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  process.exitCode = originalExitCode;
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

function createUnauthLoginDeps(): () => Promise<
  LoginDependencies & { hasValidToken: boolean }
> {
  return mock(() =>
    Promise.resolve({
      authService: createMockAuthService(),
      authStorage: createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(null)),
      }),
      browserService: createMockBrowserService(),
      mcpUrl: "https://mcp.githits.com",
      hasValidToken: false,
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

function getErrorOutput(): string[] {
  return (errorSpy.mock.calls as unknown[][]).map((c) => String(c[0] ?? ""));
}

function expectReadyNextSteps(logCalls: string[]): void {
  expect(logCalls.some((msg) => msg.includes("GitHits is now connected"))).toBe(
    true,
  );
  expect(logCalls.some((msg) => msg.includes("new abilities"))).toBe(true);
  expect(
    logCalls.some((msg) =>
      msg.includes("How does Next.js implement route prefetching"),
    ),
  ).toBe(true);
  expect(logCalls.some((msg) => msg.includes("trigger guides"))).toBe(true);
}

function expectAuthNotCheckedNextSteps(logCalls: string[]): void {
  expect(logCalls.some((msg) => msg.includes("Sign-in was not checked"))).toBe(
    true,
  );
  expect(logCalls.some((msg) => msg.includes("npx githits@latest login"))).toBe(
    true,
  );
}

function lookupCommandFor(platform: string = process.platform): string {
  return platform === "win32" ? "where" : "which";
}

describe("initAction", () => {
  it("prints agent-safe guidance without side effects in non-interactive mode", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const execService = createMockExecService();
    const promptService = createMockPromptService();
    const createLoginDeps = mock(() =>
      Promise.resolve({} as LoginDependencies),
    );

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps,
        isInteractive: false,
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("non-interactive"))).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("npx -y githits@latest init --detect-agents"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("githits init -y"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("--detect-agents --json"))).toBe(
      true,
    );
    expect(promptService.select).not.toHaveBeenCalled();
    expect(promptService.checkbox).not.toHaveBeenCalled();
    expect(execService.exec).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(createLoginDeps).not.toHaveBeenCalled();
  });

  it("rejects non-interactive --yes before scan, writes, or auth", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const execService = createMockExecService();
    const promptService = createMockPromptService();
    const createLoginDeps = mock(() =>
      Promise.resolve({} as LoginDependencies),
    );

    await initAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps,
        isInteractive: false,
      },
    );

    expect(process.exitCode).toBe(1);
    expect(getErrorOutput().some((msg) => msg.includes("--yes"))).toBe(true);
    expect(promptService.select).not.toHaveBeenCalled();
    expect(promptService.checkbox).not.toHaveBeenCalled();
    expect(execService.exec).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(createLoginDeps).not.toHaveBeenCalled();
  });

  it("detects agents without writing config or authenticating", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const execService = createMockExecService();
    const createLoginDeps = mock(() =>
      Promise.resolve({} as LoginDependencies),
    );

    await initAction(
      { detectAgents: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps,
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Detected supported tools")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("cursor"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("needs setup"))).toBe(true);
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(createLoginDeps).not.toHaveBeenCalled();
  });

  it("prints no-tools guidance when staged detection finds no agents", async () => {
    const fs = createFsWithDetection([]);

    await initAction(
      { detectAgents: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("No supported AI coding tools")),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("already configured for detected")),
    ).toBe(false);
  });

  it("warns agents not to run init yes when detected tools are configured", async () => {
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
      { detectAgents: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("No detected tools need setup")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("githits init -y"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("verification step"))).toBe(
      true,
    );
  });

  it("emits JSON for agent detection", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);

    await initAction(
      { detectAgents: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.mode).toBe("detect-agents");
    expect(payload.installableIds).toContain("cursor");
    expect(payload.suggestedCommand).toContain("--install-agents cursor");
    expect(payload.instructions).toContain(
      "Do not run `githits init -y` or `githits init --yes` unless the user explicitly asks to configure every detected tool.",
    );
    expect(payload.instructions).toContain(
      "Do not run init again after a successful --install-agents run; verify with --detect-agents --json instead.",
    );
  });

  it("installs only explicitly requested agents in staged install mode", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.codeium/windsurf"],
      configFiles,
    );
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "cursor" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/home/test/.cursor/mcp.json",
      expect.any(String),
    );
    const writtenPaths = (fs.atomicWriteFile as ReturnType<typeof mock>).mock
      .calls as unknown[][];
    expect(
      writtenPaths.some((call) =>
        String(call[0] ?? "").includes(".codeium/windsurf"),
      ),
    ).toBe(false);
    expect(
      getLogOutput().some((msg) => msg.includes("npx -y githits@latest login")),
    ).toBe(true);
  });

  it("does not print login instructions when staged install finds existing auth", async () => {
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
      { installAgents: "cursor", json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.auth.required).toBe(false);
    expect(payload.auth.status).toBe("authenticated");
    expect(JSON.stringify(payload)).not.toContain("githits@latest login");
  });

  it("treats already configured staged install targets as idempotent", async () => {
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
      { installAgents: "cursor" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(
      getLogOutput().some((msg) => msg.includes("already configured")),
    ).toBe(true);
  });

  it("does not print login instructions when all staged installs fail", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    fs.atomicWriteFile = mock(async () => {
      throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "cursor" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(process.exitCode).toBe(1);
    expect(logCalls.some((msg) => msg.includes("completed with errors"))).toBe(
      true,
    );
    expect(
      logCalls.some((msg) => msg.includes("Fix installation errors")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("githits@latest login"))).toBe(
      false,
    );
  });

  it("marks auth not required in JSON when all staged installs fail", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    fs.atomicWriteFile = mock(async () => {
      throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "cursor", json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(process.exitCode).toBe(1);
    expect(payload.outcomes[0].status).toBe("failed");
    expect(payload.auth.required).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("githits@latest login");
  });

  it("rejects unknown staged install IDs before writing", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);

    await initAction(
      { installAgents: "cursor,unknown-agent" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(process.exitCode).toBe(1);
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(getErrorOutput().some((msg) => msg.includes("unknown-agent"))).toBe(
      true,
    );
  });

  it("rejects undetected staged install IDs before writing", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);

    await initAction(
      { installAgents: "windsurf" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(process.exitCode).toBe(1);
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(getErrorOutput().some((msg) => msg.includes("not detected"))).toBe(
      true,
    );
  });

  it("rejects --yes with staged init modes", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);

    await initAction(
      { yes: true, detectAgents: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(process.exitCode).toBe(1);
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(getErrorOutput().some((msg) => msg.includes("--yes"))).toBe(true);
  });

  it("prints Agent Skills instructions without changing MCP config", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const execService = createMockExecService();
    const createLoginDeps = mock(() =>
      Promise.resolve({} as LoginDependencies),
    );
    const promptService = createMockPromptService({
      select: mock(() => Promise.resolve("skills")) as PromptService["select"],
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps,
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("npx skills add githits-com/githits-cli"),
      ),
    ).toBe(true);
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(execService.exec).not.toHaveBeenCalled();
    expect(createLoginDeps).not.toHaveBeenCalled();
  });

  it("exits cleanly when user chooses Later", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const execService = createMockExecService();
    const promptService = createMockPromptService({
      select: mock(() => Promise.resolve("later")) as PromptService["select"],
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
    expect(logCalls.some((msg) => msg.includes("No changes made"))).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("Run `npx githits@latest init` whenever you're ready"),
      ),
    ).toBe(true);
    expect(execService.exec).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("scans agents and sets up unconfigured ones", async () => {
    // Cursor detected but not configured
    const fs = createFsWithDetection(["/home/test/.cursor"]);
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

    // Checkbox selection is the approval boundary.
    expect(promptService.checkbox).toHaveBeenCalled();
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("Your agent can only read your local codebase"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("navigate the open-source code your app depends on"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("With GitHits"))).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("https://docs.githits.com")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("1. Detect tools"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("2. Choose tools"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("3. Sign in"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("4. Install and verify"))).toBe(
      true,
    );
    expect(
      logCalls.some(
        (msg) => msg.includes("Cursor") && msg.includes("installing"),
      ),
    ).toBe(true);
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
    expectReadyNextSteps(logCalls);
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

    // Should only set up windsurf
    expect(promptService.checkbox).toHaveBeenCalledTimes(1);
    expect(promptService.confirm3).not.toHaveBeenCalled();
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

  it("configures only the agents selected in the checkbox", async () => {
    const fs = createFsWithDetection([
      "/home/test/.cursor",
      "/home/test/.codeium/windsurf",
    ]);
    const promptService = createMockPromptService({
      checkbox: mock((_message, choices) =>
        Promise.resolve([choices[0]!.value]),
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

    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/home/test/.cursor/mcp.json",
      expect.any(String),
    );
  });

  it("sets up Pi by installing adapter and writing Pi-owned MCP config", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection([], {});
    fs.readFile = mock((path: string) => {
      if (path in configFiles) {
        return Promise.resolve(configFiles[path]!);
      }
      return Promise.reject(enoent);
    });
    const atomicWriteFile = mock((path: string, content: string) => {
      configFiles[path] = content;
      return Promise.resolve();
    });
    fs.atomicWriteFile = atomicWriteFile;
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });
    let adapterInstalled = false;
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} pi`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/pi\n",
            stderr: "",
          });
        }
        if (key === "pi list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: adapterInstalled ? "pi-mcp-adapter\n" : "",
            stderr: "",
          });
        }
        if (key === "pi install npm:pi-mcp-adapter") {
          adapterInstalled = true;
          return Promise.resolve({
            exitCode: 0,
            stdout: "installed\n",
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

    expect(execService.exec).toHaveBeenCalledWith("pi", [
      "install",
      "npm:pi-mcp-adapter",
    ]);
    expect(atomicWriteFile).toHaveBeenCalled();
    const calls = atomicWriteFile.mock.calls;
    expect(calls[0]?.[0]).toBe("/home/test/.pi/agent/mcp.json");
    const written = String(calls[0]?.[1] ?? "");
    expect(JSON.parse(written).mcpServers.GitHits).toEqual({
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
      lifecycle: "eager",
    });
  });

  it("sets up Pi using npm global bin fallback when pi is not on PATH", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection([], {});
    fs.exists = mock((path: string) =>
      Promise.resolve(path === "/npm-global/bin/pi"),
    );
    fs.readFile = mock((path: string) => {
      if (path in configFiles) {
        return Promise.resolve(configFiles[path]!);
      }
      return Promise.reject(enoent);
    });
    const atomicWriteFile = mock((path: string, content: string) => {
      configFiles[path] = content;
      return Promise.resolve();
    });
    fs.atomicWriteFile = atomicWriteFile;
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });
    let adapterInstalled = false;
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} pi`) {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
        }
        if (key === "npm prefix -g") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/npm-global\n",
            stderr: "",
          });
        }
        if (key === "/npm-global/bin/pi list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: adapterInstalled ? "pi-mcp-adapter@1.0.0\n" : "",
            stderr: "",
          });
        }
        if (key === "/npm-global/bin/pi install npm:pi-mcp-adapter") {
          adapterInstalled = true;
          return Promise.resolve({
            exitCode: 0,
            stdout: "installed\n",
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

    expect(execService.exec).toHaveBeenCalledWith("/npm-global/bin/pi", [
      "install",
      "npm:pi-mcp-adapter",
    ]);
    expect(execService.exec).toHaveBeenCalledWith("/npm-global/bin/pi", [
      "list",
    ]);
    expect(atomicWriteFile).toHaveBeenCalled();
    const calls = atomicWriteFile.mock.calls;
    const written = String(calls[0]?.[1] ?? "");
    expect(JSON.parse(written).mcpServers.GitHits.lifecycle).toBe("eager");
  });

  it("skips already configured Pi without prompting", async () => {
    const fs = createFsWithDetection([], {
      "/home/test/.pi/agent/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
            lifecycle: "eager",
          },
        },
      }),
    });
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} pi`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/pi\n",
            stderr: "",
          });
        }
        if (key === "pi list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "pi-mcp-adapter\n",
            stderr: "",
          });
        }
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
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(
      getLogOutput().some(
        (msg) => msg.includes("Pi") && msg.includes("already configured"),
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
            stdout: "githits@githits-plugins\n",
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
    expectReadyNextSteps(logCalls);
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

    // Includes Pi fallback global-bin probes when pi is not on PATH.
    expect(execService.exec).toHaveBeenCalledTimes(13);
    expect(execService.exec).toHaveBeenCalledWith("claude", expect.any(Array));
  });

  it("uses one checkbox prompt for multiple unconfigured agents", async () => {
    // Two unconfigured config-file agents
    const fs = createFsWithDetection([
      "/home/test/.cursor",
      "/home/test/.codeium/windsurf",
    ]);
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

    expect(promptService.checkbox).toHaveBeenCalledTimes(1);
    expect(promptService.confirm3).not.toHaveBeenCalled();
  });

  it("skips setup when user selects no agents", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve([])),
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

    // One PATH lookup is attempted for each binary-detected agent, plus Pi fallback probes.
    expect(execService.exec).toHaveBeenCalledTimes(8);
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("No supported AI coding tools detected"),
      ),
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
    expectReadyNextSteps(logCalls);
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
    expectReadyNextSteps(logCalls);
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
    expect(logCalls.some((msg) => msg.includes("GitHits is connected"))).toBe(
      false,
    );
    expect(logCalls.some((msg) => msg.includes("- Claude Code:"))).toBe(true);
  });

  it("treats Gemini already-installed setup output as already configured", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService();
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
      logCalls.some((msg) => msg.includes("supported tools not found")),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) => msg.includes("Setting up") && msg.includes("Gemini CLI"),
      ),
    ).toBe(false);
    expect(promptService.confirm3).not.toHaveBeenCalled();
  });

  it("handles Ctrl+C on checkbox prompt gracefully", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService({
      checkbox: mock(() =>
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

  it("rethrows non-ExitPromptError from checkbox", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.reject(new Error("Unexpected error"))),
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
      checkbox: mock(() => Promise.resolve([])),
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
      expect(logCalls.some((msg) => msg.includes("Already signed in"))).toBe(
        true,
      );
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("skips browser login when token resolution already refreshed auth", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
      });
      const discoverEndpoints = mock(() =>
        Promise.reject(new Error("login flow should not run")),
      );
      const open = mock(() =>
        Promise.reject(new Error("browser not expected")),
      );
      const loadTokens = mock(() =>
        Promise.resolve(
          createValidTokenData({
            expiresAt: new Date(Date.now() - 3600_000).toISOString(),
          }),
        ),
      );
      const createLoginDeps = mock(() =>
        Promise.resolve({
          authService: createMockAuthService({ discoverEndpoints }),
          authStorage: createMockAuthStorage({ loadTokens }),
          browserService: createMockBrowserService({ open }),
          mcpUrl: "https://mcp.githits.com",
          hasValidToken: true,
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
      expect(logCalls.some((msg) => msg.includes("Already signed in"))).toBe(
        true,
      );
      expect(discoverEndpoints).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(loadTokens).not.toHaveBeenCalled();
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("clears stale client before init login when token resolution found no token", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
      });
      const authStorage = createMockAuthStorage({
        loadTokens: mock(() => Promise.resolve(null)),
      });
      const createLoginDeps = mock(() =>
        Promise.resolve({
          authService: createMockAuthService(),
          authStorage,
          browserService: createMockBrowserService(),
          mcpUrl: "https://mcp.githits.com",
          hasValidToken: false,
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

      expect(authStorage.clearClient).toHaveBeenCalledWith(
        "https://mcp.githits.com",
      );
      expect(authStorage.saveAuthSession).toHaveBeenCalledWith(
        "https://mcp.githits.com",
        expect.any(Object),
        expect.any(Object),
      );
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
        logCalls.some((msg) => msg.includes("Signed in successfully")),
      ).toBe(true);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("prompts to continue when login fails", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        select: mock((message, choices, defaultValue) => {
          if (String(message).includes("Authentication failed")) {
            return Promise.resolve("continue_without_auth");
          }
          return Promise.resolve(defaultValue ?? choices[0]?.value);
        }),
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
      expect(
        logCalls.some((msg) =>
          msg.includes("Continuing without authentication"),
        ),
      ).toBe(true);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("does not claim GitHits is ready after continuing without auth", async () => {
      const configFiles: Record<string, string> = {};
      const fs = createFsWithDetection(["/home/test/.cursor"], configFiles);
      fs.atomicWriteFile = mock((path: string, content: string) => {
        configFiles[path] = content;
        return Promise.resolve();
      });
      const promptService = createMockPromptService({
        select: mock((message, choices, defaultValue) => {
          if (String(message).includes("Authentication failed")) {
            return Promise.resolve("continue_without_auth");
          }
          return Promise.resolve(defaultValue ?? choices[0]?.value);
        }),
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
      expect(
        logCalls.some((msg) => msg.includes("sign-in is still needed")),
      ).toBe(true);
      expect(logCalls.some((msg) => msg.includes("GitHits is connected"))).toBe(
        false,
      );
    });

    it("cancels setup when login fails and user declines to continue", async () => {
      const fs = createFsWithDetection(["/home/test/.cursor"]);
      const promptService = createMockPromptService({
        select: mock((message, choices, defaultValue) => {
          if (String(message).includes("Authentication failed")) {
            return Promise.resolve("cancel");
          }
          return Promise.resolve(defaultValue ?? choices[0]?.value);
        }),
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
      const configFiles: Record<string, string> = {};
      const fs = createFsWithDetection(["/home/test/.cursor"], configFiles);
      fs.atomicWriteFile = mock((path: string, content: string) => {
        configFiles[path] = content;
        return Promise.resolve();
      });
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
      expect(logCalls.some((msg) => msg.includes("GitHits is connected"))).toBe(
        false,
      );
      expectAuthNotCheckedNextSteps(logCalls);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });
  });
});

describe("initUninstallAction", () => {
  it("prompts and removes configured config-file agents", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
        other: { command: "other" },
      },
    });
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": currentConfig,
    });
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/home/test/.cursor/mcp.json") {
          return currentConfig;
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(promptService.confirm3).toHaveBeenCalledTimes(1);
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(currentConfig);
    expect(parsed.mcpServers.GitHits).toBeUndefined();
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Done!"))).toBe(true);
  });

  it("--yes skips prompts", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": currentConfig,
    });
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async () => currentConfig,
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );
    const promptService = createMockPromptService();

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
  });

  it("removes legacy config entries that setup would migrate", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        githits: { url: "https://mcp.githits.com" },
        other: { command: "other" },
      },
    });
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": currentConfig,
    });
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async () => currentConfig,
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(currentConfig);
    expect(parsed.mcpServers.githits).toBeUndefined();
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
  });

  it("reports malformed detected config as failure without prompting", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": "{invalid",
    });
    const promptService = createMockPromptService();

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("- Cursor:"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Cannot parse"))).toBe(true);
  });

  it("reports non-ENOENT config read errors as failure", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(async () => {
      throw Object.assign(new Error("Disk error"), { code: "EIO" });
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Cannot read"))).toBe(true);
  });

  it("skips agent when user responds no", async () => {
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
    const promptService = createMockPromptService({
      confirm3: mock(() => Promise.resolve("no" as ConfirmChoice)),
    });

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Uninstall skipped"))).toBe(
      true,
    );
  });

  it("stops prompting after always response", async () => {
    let cursorConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    let windsurfConfig = cursorConfig;
    const fs = createFsWithDetection([
      "/home/test/.cursor",
      "/home/test/.codeium/windsurf",
    ]);
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/home/test/.cursor/mcp.json") return cursorConfig;
        if (path === "/home/test/.codeium/windsurf/mcp_config.json") {
          return windsurfConfig;
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string, content: string) => {
        if (path === "/home/test/.cursor/mcp.json") cursorConfig = content;
        if (path === "/home/test/.codeium/windsurf/mcp_config.json") {
          windsurfConfig = content;
        }
      },
    );
    const confirm3 = mock(() => Promise.resolve("always" as ConfirmChoice));

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService: createMockPromptService({ confirm3 }),
        execService: createMockExecService(),
      },
    );

    expect(confirm3).toHaveBeenCalledTimes(1);
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(2);
  });

  it("removes configured CLI agents with verified commands", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "githits\n",
            stderr: "",
          });
        }
        if (key === "codex mcp remove githits") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(execService.exec).toHaveBeenCalledWith("codex", [
      "mcp",
      "remove",
      "githits",
    ]);
  });

  it("removes Pi config and adapter package", async () => {
    const lookupCmd = lookupCommandFor();
    let piConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
          lifecycle: "eager",
        },
      },
    });
    let adapterInstalled = true;
    const fs = createFsWithDetection([], {
      "/home/test/.pi/agent/mcp.json": piConfig,
    });
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/home/test/.pi/agent/mcp.json") return piConfig;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        piConfig = content;
      },
    );
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} pi`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/pi\n",
            stderr: "",
          });
        }
        if (key === "pi list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: adapterInstalled ? "npm:pi-mcp-adapter\n" : "",
            stderr: "",
          });
        }
        if (key === "pi remove npm:pi-mcp-adapter") {
          adapterInstalled = false;
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(execService.exec).toHaveBeenCalledWith("pi", [
      "remove",
      "npm:pi-mcp-adapter",
    ]);
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(piConfig).mcpServers.GitHits).toBeUndefined();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Pi removed"))).toBe(true);
  });

  it("uses resolved Pi fallback executable for uninstall", async () => {
    const lookupCmd = lookupCommandFor();
    let piConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
          lifecycle: "eager",
        },
      },
    });
    let adapterInstalled = true;
    const fs = createFsWithDetection([], {
      "/home/test/.pi/agent/mcp.json": piConfig,
    });
    (fs.exists as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => path === "/npm-global/bin/pi",
    );
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/home/test/.pi/agent/mcp.json") return piConfig;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        piConfig = content;
      },
    );
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} pi`) {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
        }
        if (key === "npm prefix -g") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/npm-global\n",
            stderr: "",
          });
        }
        if (key === "/npm-global/bin/pi list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: adapterInstalled ? "pi-mcp-adapter@1.0.0\n" : "",
            stderr: "",
          });
        }
        if (key === "/npm-global/bin/pi remove npm:pi-mcp-adapter") {
          adapterInstalled = false;
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(execService.exec).toHaveBeenCalledWith("/npm-global/bin/pi", [
      "remove",
      "npm:pi-mcp-adapter",
    ]);
  });

  it("reports Pi failure when required adapter removal fails after config removal", async () => {
    const lookupCmd = lookupCommandFor();
    let piConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
          lifecycle: "eager",
        },
      },
    });
    const fs = createFsWithDetection([], {
      "/home/test/.pi/agent/mcp.json": piConfig,
    });
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/home/test/.pi/agent/mcp.json") return piConfig;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        piConfig = content;
      },
    );
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} pi`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/pi\n",
            stderr: "",
          });
        }
        if (key === "pi list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "npm:pi-mcp-adapter\n",
            stderr: "",
          });
        }
        if (key === "pi remove npm:pi-mcp-adapter") {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("- Pi:"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("boom"))).toBe(true);
  });

  it("removes stale Pi config when Pi CLI is missing", async () => {
    const lookupCmd = lookupCommandFor();
    let piConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
          lifecycle: "eager",
        },
      },
    });
    const fs = createFsWithDetection([], {
      "/home/test/.pi/agent/mcp.json": piConfig,
    });
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/home/test/.pi/agent/mcp.json") return piConfig;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        piConfig = content;
      },
    );
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} pi`) {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(execService.exec).not.toHaveBeenCalledWith("pi", [
      "remove",
      "npm:pi-mcp-adapter",
    ]);
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(piConfig).mcpServers.GitHits).toBeUndefined();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Pi removed"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Pi — not detected"))).toBe(
      false,
    );
  });

  it("removes stale Pi config from PI_CODING_AGENT_DIR when Pi CLI is missing", async () => {
    const originalPiDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = "~/custom-pi";
    try {
      const lookupCmd = lookupCommandFor();
      let piConfig = JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
            lifecycle: "eager",
          },
        },
      });
      const fs = createFsWithDetection([], {
        "/home/test/custom-pi/mcp.json": piConfig,
      });
      (fs.readFile as ReturnType<typeof mock>).mockImplementation(
        async (path: string) => {
          if (path === "/home/test/custom-pi/mcp.json") return piConfig;
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      );
      (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
        async (_path: string, content: string) => {
          piConfig = content;
        },
      );
      const execService = createMockExecService({
        exec: mock((cmd: string, args: string[]) => {
          const key = `${cmd} ${args.join(" ")}`;
          if (key === `${lookupCmd} pi`) {
            return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
          }
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
        }),
      });

      await initUninstallAction(
        { yes: true },
        {
          fileSystemService: fs,
          promptService: createMockPromptService(),
          execService,
        },
      );

      expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
      expect(JSON.parse(piConfig).mcpServers.GitHits).toBeUndefined();
    } finally {
      if (originalPiDir !== undefined) {
        process.env.PI_CODING_AGENT_DIR = originalPiDir;
      } else {
        delete process.env.PI_CODING_AGENT_DIR;
      }
    }
  });

  it("reports Claude marketplace cleanup failure as warning after plugin removal", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    let pluginInstalled = true;
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
            stdout: pluginInstalled ? "githits@githits-plugins\n" : "",
            stderr: "",
          });
        }
        if (key === "claude plugin uninstall githits") {
          pluginInstalled = false;
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        if (key === "claude plugin marketplace remove githits-plugins") {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Claude Code removed"))).toBe(
      true,
    );
    expect(logCalls.some((msg) => msg.includes("Warning:"))).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(false);
  });

  it("reports CLI probe failures as inspection failures without prompting", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService();
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp list") {
          return Promise.reject(new Error("probe exploded"));
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
      },
    );

    expect(promptService.confirm3).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("- Codex CLI:"))).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("Cannot inspect Codex CLI")),
    ).toBe(true);
  });

  it("uses Gemini filesystem fallback when config probe fails", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    (fs.exists as ReturnType<typeof mock>).mockImplementation(
      async (path: string) =>
        path === "/home/test/.gemini/extensions/githits/gemini-extension.json",
    );
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
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
        }
        if (key === "gemini extensions uninstall githits") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(execService.exec).toHaveBeenCalledWith("gemini", [
      "extensions",
      "uninstall",
      "githits",
    ]);
  });

  it("reports Gemini probe failure as inspection failure without fallback", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
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
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("- Gemini CLI:"))).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("Cannot inspect Gemini CLI")),
    ).toBe(true);
  });

  it("reports Gemini explicit not installed output as not configured", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService();
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
            exitCode: 1,
            stdout: "",
            stderr: 'Extension "githits" is not installed.\n',
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
      },
    );

    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(execService.exec).not.toHaveBeenCalledWith("gemini", [
      "extensions",
      "uninstall",
      "githits",
    ]);
    const logCalls = getLogOutput();
    expect(
      logCalls.some(
        (msg) => msg.includes("Gemini CLI") && msg.includes("not configured"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("Cannot inspect Gemini CLI")),
    ).toBe(false);
  });

  it("preserves warnings when verification fails after removal", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
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
            stdout: "githits@githits-plugins\n",
            stderr: "",
          });
        }
        if (key === "claude plugin uninstall githits") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        if (key === "claude plugin marketplace remove githits-plugins") {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("still configured after uninstall")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Warning:"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("boom"))).toBe(true);
  });

  it("fails verification when CLI agent is not detected after uninstall", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    let lookupCount = 0;
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} codex`) {
          lookupCount += 1;
          return Promise.resolve(
            lookupCount === 1
              ? { exitCode: 0, stdout: "/usr/bin/codex\n", stderr: "" }
              : { exitCode: 1, stdout: "", stderr: "" },
          );
        }
        if (key === "codex mcp list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "githits\n",
            stderr: "",
          });
        }
        if (key === "codex mcp remove githits") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(execService.exec).toHaveBeenCalledWith("codex", [
      "mcp",
      "remove",
      "githits",
    ]);
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("removal could not be confirmed")),
    ).toBe(true);
  });

  it("prints not configured headline when configured agent becomes absent before removal", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "githits\n",
            stderr: "",
          });
        }
        if (key === "codex mcp remove githits") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "MCP server githits not found\n",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes(
          "No GitHits MCP configurations were active. Nothing to remove.",
        ),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("Done! GitHits MCP configuration was removed"),
      ),
    ).toBe(false);
  });

  it("continues to next agent when one uninstall fails", async () => {
    const lookupCmd = lookupCommandFor();
    let cursorConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": cursorConfig,
    });
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async () => cursorConfig,
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        cursorConfig = content;
      },
    );
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "githits\n",
            stderr: "",
          });
        }
        if (key === "codex mcp remove githits") {
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("- Codex CLI:"))).toBe(true);
  });

  it("handles Ctrl+C on confirm prompt gracefully", async () => {
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
    const promptService = createMockPromptService({
      confirm3: mock(() =>
        Promise.reject(new ExitPromptError("User force closed")),
      ),
    });

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Uninstall cancelled"))).toBe(
      true,
    );
  });

  it("shows nothing to uninstall when no GitHits configs are found", async () => {
    const fs = createFsWithDetection([]);

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Nothing to uninstall"))).toBe(
      true,
    );
  });
});

describe("registerInitCommand", () => {
  it("registers init and init uninstall commands", () => {
    const program = new Command();
    registerInitCommand(program);

    const initCommand = program.commands.find((cmd) => cmd.name() === "init");
    expect(initCommand).toBeDefined();
    expect(
      initCommand?.commands.some((cmd) => cmd.name() === "uninstall"),
    ).toBe(true);
  });

  it("registers staged agent-safe init options", () => {
    const program = new Command();
    registerInitCommand(program);

    const initCommand = program.commands.find((cmd) => cmd.name() === "init");
    const optionLongNames = initCommand?.options.map((option) => option.long);

    expect(optionLongNames).toContain("--detect-agents");
    expect(optionLongNames).toContain("--install-agents");
    expect(optionLongNames).toContain("--json");
  });
});
