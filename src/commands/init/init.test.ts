import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
let originalPlatform: NodeJS.Platform;

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = 0;
  originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: "linux",
  });
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  process.exitCode = originalExitCode;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: originalPlatform,
  });
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
    exists: mock(async (path: string) => path in configFiles),
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

function expectProjectAuthNotCheckedNextSteps(logCalls: string[]): void {
  expect(
    logCalls.some((msg) =>
      msg.includes(
        "GitHits MCP is configured for this project. Sign-in was not checked.",
      ),
    ),
  ).toBe(true);
  expect(logCalls.some((msg) => msg.includes("loads the project config"))).toBe(
    true,
  );
  expect(logCalls.some((msg) => msg.includes("npx githits@latest login"))).toBe(
    true,
  );
  expect(
    logCalls.some((msg) =>
      msg.includes("GitHits MCP is configured. Sign-in was not checked."),
    ),
  ).toBe(false);
}

function expectProjectAuthRequiredNextSteps(logCalls: string[]): void {
  expect(
    logCalls.some((msg) =>
      msg.includes(
        "GitHits MCP is configured for this project, but sign-in is still needed.",
      ),
    ),
  ).toBe(true);
  expect(logCalls.some((msg) => msg.includes("loads the project config"))).toBe(
    true,
  );
  expect(logCalls.some((msg) => msg.includes("npx githits@latest login"))).toBe(
    true,
  );
  expect(
    logCalls.some((msg) =>
      msg.includes("GitHits MCP is configured, but sign-in is still needed."),
    ),
  ).toBe(false);
}

function createProjectScopeSelectMock(): PromptService["select"] {
  return mock(
    async <T>(_message: string, choices: Array<{ value: T }>): Promise<T> => {
      const projectChoice = choices.find(
        (choice) => choice.value === "project",
      );
      return projectChoice?.value ?? choices[0]!.value;
    },
  ) as PromptService["select"];
}

function createSelectAllCheckboxMock(): PromptService["checkbox"] {
  return mock(
    async <T>(_message: string, choices: Array<{ value: T }>): Promise<T[]> =>
      choices.map((choice) => choice.value),
  ) as PromptService["checkbox"];
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
    expect(logCalls.some((msg) => msg.includes("Detected tools"))).toBe(true);
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
    expect(payload.scope).toBe("user");
    expect(payload.installableIds).toContain("cursor");
    expect(payload.suggestedCommand).toContain("--install-agents cursor");
    expect(payload.instructions).toContain(
      "Do not run `githits init -y` or `githits init --yes` unless the user explicitly asks to configure every detected tool.",
    );
    expect(payload.instructions).toContain(
      "Do not run init again after a successful --install-agents run; verify with npx -y githits@latest init --detect-agents --json instead.",
    );
  });

  it("keeps detect JSON parseable when init trace is enabled", async () => {
    const originalTrace = process.env.GITHITS_INIT_TRACE;
    process.env.GITHITS_INIT_TRACE = "1";
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    try {
      await initAction(
        { detectAgents: true, json: true },
        {
          fileSystemService: fs,
          promptService: createMockPromptService(),
          execService: createMockExecService(),
          createLoginDeps: createUnauthLoginDeps(),
        },
      );
    } finally {
      if (originalTrace === undefined) {
        delete process.env.GITHITS_INIT_TRACE;
      } else {
        process.env.GITHITS_INIT_TRACE = originalTrace;
      }
    }

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.mode).toBe("detect-agents");
    expect(getErrorOutput().some((msg) => msg.includes("[githits:init]"))).toBe(
      true,
    );
  });

  it("emits project-scoped JSON for agent detection", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const createLoginDeps = mock(() =>
      Promise.resolve({} as LoginDependencies),
    );

    await initAction(
      { detectAgents: true, json: true, project: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(process.exitCode).toBe(0);
    expect(payload.scope).toBe("project");
    expect(payload.suggestedCommand).toContain(
      "--project --install-agents cursor",
    );
    expect(payload.instructions).toContain(
      "Explain that project-level install writes MCP config files into the current repo and those files may be committed.",
    );
    expect(createLoginDeps).not.toHaveBeenCalled();
  });

  it("marks detected tools without project config as unsupported in staged project detection", async () => {
    const fs = createFsWithDetection(["/home/test/.codeium/windsurf"]);

    await initAction(
      { detectAgents: true, json: true, project: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    const windsurf = payload.agents.find(
      (agent: { id: string }) => agent.id === "windsurf",
    );
    expect(windsurf.status).toBe("unsupported_project_config");
    expect(windsurf.reason).toContain("not verified");
    expect(payload.installableIds).not.toContain("windsurf");
    expect(payload.suggestedCommand).toBeNull();
    expect(payload.instructions).toContain(
      "Do not ask the user to choose project install IDs.",
    );
    expect(payload.instructions).not.toContain(
      "Ask which tools should receive the GitHits MCP server.",
    );
  });

  it("does not ask for project install IDs when configured and unsupported tools are detected", async () => {
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.cursor", "/home/test/.codeium/windsurf"],
      {
        "/repo/.cursor/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        }),
      },
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;

    await initAction(
      { detectAgents: true, json: true, project: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.installableIds).toEqual([]);
    expect(payload.instructions).toContain(
      "Explain that GitHits is already configured for detected project-configurable tools.",
    );
    expect(payload.instructions).toContain(
      "Do not ask the user to choose project install IDs.",
    );
    expect(payload.instructions).not.toContain(
      "Explain that no detected tools have verified project-level MCP support.",
    );
    expect(payload.instructions).not.toContain(
      "Ask which tools should receive the GitHits MCP server.",
    );
  });

  it("does not tell agents unsupported-only project detection is already configured", async () => {
    const fs = createFsWithDetection(["/home/test/.codeium/windsurf"]);

    await initAction(
      { detectAgents: true, project: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Detected tools (project-level")),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("unsupported project config")),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("not verified for Windsurf")),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("No detected tools can be installed with project-level"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("already configured for detected")),
    ).toBe(false);
    expect(logCalls.some((msg) => msg.includes("user-level install"))).toBe(
      true,
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

  it("installs project config in staged install mode", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.cursor"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "cursor", json: true, project: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(process.exitCode).toBe(0);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.cursor/mcp.json",
      expect.any(String),
    );
    expect(fs.atomicWriteFile).not.toHaveBeenCalledWith(
      "/home/test/.cursor/mcp.json",
      expect.any(String),
    );
    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.scope).toBe("project");
    expect(payload.instructions).toContain(
      "Do not run init again after a successful --install-agents run; verify with npx -y githits@latest init --project --detect-agents --json instead.",
    );
  });

  it("rejects unsupported project agent IDs in staged install mode", async () => {
    const fs = createFsWithDetection(["/home/test/.codeium/windsurf"]);

    await initAction(
      { installAgents: "windsurf", json: true, project: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(process.exitCode).toBe(1);
    const payload = JSON.parse(getErrorOutput()[0] ?? "{}");
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("cannot use project-level install");
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("writes project configs for project-supported tools through init scope prompt", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.cursor"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
      checkbox: mock(
        async <T>(message: string, choices: Array<{ value: T }>) => {
          expect(message).toContain("Select which tools");
          return choices.map((choice) => choice.value);
        },
      ) as PromptService["checkbox"],
    });

    await initAction(
      { skipLogin: true },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.cursor/mcp.json",
      expect.any(String),
    );
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("Project-level config is available for some tools."),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("Tools without project-level config are shown below"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("Found 1 tool. 1 supports project-level config."),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("5. Next Steps"))).toBe(true);
    expectProjectAuthNotCheckedNextSteps(logCalls);
    expect(
      logCalls.filter((msg) => msg.includes("4. Install and verify")),
    ).toHaveLength(1);
    expect(JSON.parse(configFiles["/repo/.cursor/mcp.json"] ?? "{}")).toEqual({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
  });

  it("skips detected tools without verified project config", async () => {
    const fs = createFsWithDetection(["/repo", "/home/test/.codeium/windsurf"]);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const createLoginDeps = createUnauthLoginDeps();
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
    });

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(promptService.checkbox).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Windsurf"))).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("no project-level config")),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("project-level MCP config not verified"),
      ),
    ).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("Found 1 tool. 0 support project-level config."),
      ),
    ).toBe(true);
  });

  it("preserves existing project config servers", async () => {
    const configFiles: Record<string, string> = {
      "/repo/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          Other: { command: "other", args: [] },
        },
      }),
    };
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.cursor"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
      checkbox: createSelectAllCheckboxMock(),
    });

    await initAction(
      { skipLogin: true },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    const written = JSON.parse(configFiles["/repo/.cursor/mcp.json"] ?? "{}");
    expect(written.mcpServers.Other).toEqual({ command: "other", args: [] });
    expect(written.mcpServers.GitHits).toEqual({
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    });
  });

  it("prints standard ready copy for authenticated project setup", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.cursor"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
      checkbox: createSelectAllCheckboxMock(),
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
    expectReadyNextSteps(logCalls);
    expect(
      logCalls.some((msg) =>
        msg.includes("GitHits MCP is configured for this project."),
      ),
    ).toBe(false);
    expect(logCalls.some((msg) => msg.includes("loads .mcp.json"))).toBe(false);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.cursor/mcp.json",
      expect.any(String),
    );
  });

  it("prints project-specific next steps when project auth fails and user continues", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.cursor"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const promptService = createMockPromptService({
      select: mock(
        async <T>(
          _message: string,
          choices: Array<{ value: T }>,
        ): Promise<T> => {
          if (choices.some((choice) => choice.value === "project")) {
            return "project" as T;
          }
          if (
            choices.some((choice) => choice.value === "continue_without_auth")
          ) {
            return "continue_without_auth" as T;
          }
          return choices[0]!.value;
        },
      ) as PromptService["select"],
      checkbox: createSelectAllCheckboxMock(),
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

    expectProjectAuthRequiredNextSteps(getLogOutput());
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.cursor/mcp.json",
      expect.any(String),
    );
  });

  it("writes Codex project config as TOML", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const execService = createMockExecService({
      exec: mock(async (command: string, args: string[]) => {
        if (command === lookupCommandFor() && args[0] === "codex") {
          return { stdout: "/usr/bin/codex", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }),
    });
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
      checkbox: createSelectAllCheckboxMock(),
    });

    await initAction(
      { skipLogin: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.codex/config.toml",
      expect.stringContaining("[mcp_servers.githits]"),
    );
    expect(configFiles["/repo/.codex/config.toml"]).toContain(
      'command = "npx"',
    );
  });

  it("warns before rewriting existing Codex TOML project config", async () => {
    const configFiles: Record<string, string> = {
      "/repo/.codex/config.toml": "# keep me\n[other]\nvalue = true\n",
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const execService = createMockExecService({
      exec: mock(async (command: string, args: string[]) => {
        if (command === lookupCommandFor() && args[0] === "codex") {
          return { stdout: "/usr/bin/codex", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }),
    });
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
      checkbox: createSelectAllCheckboxMock(),
    });

    await initAction(
      { skipLogin: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    const warningIndex = logCalls.findIndex((msg) =>
      msg.includes("existing TOML comments/formatting will not be preserved"),
    );
    const signInIndex = logCalls.findIndex((msg) => msg.includes("3. Sign in"));
    const installIndex = logCalls.findIndex((msg) =>
      msg.includes("4. Install and verify"),
    );
    const installingIndex = logCalls.findIndex(
      (msg) => msg.includes("Codex CLI") && msg.includes("installing"),
    );
    expect(warningIndex).toBeGreaterThanOrEqual(0);
    expect(warningIndex).toBeLessThan(signInIndex);
    expect(warningIndex).toBeLessThan(installIndex);
    expect(installIndex).toBeLessThan(installingIndex);
  });

  it("sets up Pi project config through adapter and shared .mcp.json", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    let adapterInstalled = false;
    const execService = createMockExecService({
      exec: mock(async (command: string, args: string[]) => {
        const key = `${command} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} pi`) {
          return { stdout: "/usr/bin/pi\n", stderr: "", exitCode: 0 };
        }
        if (key === "pi list") {
          return {
            stdout: adapterInstalled ? "pi-mcp-adapter\n" : "",
            stderr: "",
            exitCode: 0,
          };
        }
        if (key === "pi install npm:pi-mcp-adapter") {
          adapterInstalled = true;
          return { stdout: "installed\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }),
    });
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
      checkbox: createSelectAllCheckboxMock(),
    });

    await initAction(
      { skipLogin: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(execService.exec).toHaveBeenCalledWith("pi", [
      "install",
      "npm:pi-mcp-adapter",
    ]);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.mcp.json",
      expect.any(String),
    );
    expect(fs.atomicWriteFile).not.toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
      expect.any(String),
    );
    const written = JSON.parse(configFiles["/repo/.mcp.json"] ?? "{}");
    expect(written.mcpServers.GitHits).toEqual({
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    });
    expect(written.mcpServers.GitHits.lifecycle).toBeUndefined();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Pi"))).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("no project-level config")),
    ).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("Found 1 tool. 1 supports project-level config."),
      ),
    ).toBe(true);
  });

  it("does not record Pi project ownership when adapter already existed", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const execService = createMockExecService({
      exec: mock(async (command: string, args: string[]) => {
        const key = `${command} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} pi`) {
          return { stdout: "/usr/bin/pi\n", stderr: "", exitCode: 0 };
        }
        if (key === "pi list") {
          return { stdout: "pi-mcp-adapter\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }),
    });
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
      checkbox: createSelectAllCheckboxMock(),
    });

    await initAction(
      { skipLogin: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.mcp.json",
      expect.any(String),
    );
    expect(fs.atomicWriteFile).not.toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
      expect.any(String),
    );
  });

  it("keeps shared project .mcp.json standard when Claude Code and Pi are selected", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    let adapterInstalled = false;
    const execService = createMockExecService({
      exec: mock(async (command: string, args: string[]) => {
        const key = `${command} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} claude`) {
          return { stdout: "/usr/bin/claude\n", stderr: "", exitCode: 0 };
        }
        if (key === `${lookupCommandFor()} pi`) {
          return { stdout: "/usr/bin/pi\n", stderr: "", exitCode: 0 };
        }
        if (key === "pi list") {
          return {
            stdout: adapterInstalled ? "pi-mcp-adapter\n" : "",
            stderr: "",
            exitCode: 0,
          };
        }
        if (key === "pi install npm:pi-mcp-adapter") {
          adapterInstalled = true;
          return { stdout: "installed\n", stderr: "", exitCode: 0 };
        }
        if (key === "claude plugin list") {
          return {
            stdout: "githits@githits-plugins\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }),
    });
    const promptService = createMockPromptService({
      select: createProjectScopeSelectMock(),
      checkbox: createSelectAllCheckboxMock(),
    });

    await initAction(
      { skipLogin: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    const written = JSON.parse(configFiles["/repo/.mcp.json"] ?? "{}");
    expect(written.mcpServers.GitHits).toEqual({
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    });
    expect(written.mcpServers.GitHits.lifecycle).toBeUndefined();
  });

  it("rejects direct project setup flag", async () => {
    const fs = createFsWithDetection(["/repo"]);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const createLoginDeps = createUnauthLoginDeps();

    await initAction(
      { project: true, yes: true, skipLogin: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(getErrorOutput()[0] ?? "{}").code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(createLoginDeps).not.toHaveBeenCalled();
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
    // Already-configured targets render an "unchanged" row pointing at the
    // existing config file rather than rewriting it.
    const logCalls = getLogOutput();
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("unchanged") && msg.includes("~/.cursor/mcp.json"),
      ),
    ).toBe(true);
    // Nothing was installed this run, so we must not claim we configured it now.
    expect(
      logCalls.some((msg) => msg.includes('Configured MCP server "githits"')),
    ).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes('MCP server "githits" already configured'),
      ),
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

  it("shows a created row, collapsed path, and the MCP server block", async () => {
    // A store so the post-setup verification scan sees what was written.
    const store: Record<string, string> = {};
    const fs = createFsWithDetection(["/home/test/.cursor"], store);
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      store[path] = content;
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
    // Per-client row: verb + home-collapsed path (not the old fixed wording).
    expect(
      logCalls.some(
        (msg) => msg.includes("created") && msg.includes("~/.cursor/mcp.json"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("configured and verified")),
    ).toBe(false);
    // Trailing MCP server confirmation on the human text path: states that the
    // server was configured and shows the launch command inline.
    expect(
      logCalls.some(
        (msg) =>
          msg.includes('Configured MCP server "githits"') &&
          msg.includes("npx -y githits@latest mcp start"),
      ),
    ).toBe(true);
  });

  it("includes structured changes in --install-agents --json output", async () => {
    const store: Record<string, string> = {};
    const fs = createFsWithDetection(["/home/test/.cursor"], store);
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      store[path] = content;
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
    expect(payload.outcomes[0].status).toBe("success");
    expect(payload.outcomes[0].changes).toEqual([
      {
        kind: "config-file",
        path: "/home/test/.cursor/mcp.json",
        change: "created",
      },
    ]);
    // The friendly MCP block is text-only; it must not leak into JSON.
    expect(JSON.stringify(payload)).not.toContain("with local command");
  });

  it("keeps the written path visible when verification fails", async () => {
    // The write "succeeds" but persists an entry without GitHits, so the
    // post-setup verification scan fails — the created path must still show.
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    fs.atomicWriteFile = mock(async () => {
      // Intentionally do not persist a usable GitHits entry.
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
    // The created path is still shown, alongside a failed row.
    expect(logCalls.some((msg) => msg.includes("~/.cursor/mcp.json"))).toBe(
      true,
    );
    expect(logCalls.some((msg) => msg.includes("failed"))).toBe(true);
    // No success confirmation block when verification failed.
    expect(logCalls.some((msg) => msg.includes("with local command"))).toBe(
      false,
    );
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
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Cursor") &&
          msg.includes("unchanged") &&
          msg.includes("~/.cursor/mcp.json"),
      ),
    ).toBe(true);
    expectReadyNextSteps(logCalls);
  });

  it("handles mixed status: configured + unconfigured", async () => {
    // Cursor configured, windsurf not configured
    const configFiles: Record<string, string> = {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
    };
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.codeium/windsurf"],
      configFiles,
    );
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
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
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Cursor") &&
          msg.includes("unchanged") &&
          msg.includes("~/.cursor/mcp.json"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Windsurf") &&
          msg.includes("created") &&
          msg.includes("~/.codeium/windsurf/mcp_config.json"),
      ),
    ).toBe(true);
  });

  it("shows already-configured rows when no new tools are selected", async () => {
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
      checkbox: mock(() => Promise.resolve([])) as PromptService["checkbox"],
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
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Setup skipped"))).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Cursor") &&
          msg.includes("unchanged") &&
          msg.includes("~/.cursor/mcp.json"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) => msg.includes("Windsurf") && msg.includes("created"),
      ),
    ).toBe(false);
    expectReadyNextSteps(logCalls);
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

  it("shows checked CLI detail when a composite setup also writes config", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection([], {});
    fs.readFile = mock((path: string) => {
      if (path in configFiles) {
        return Promise.resolve(configFiles[path]!);
      }
      return Promise.reject(enoent);
    });
    fs.atomicWriteFile = mock((path: string, content: string) => {
      configFiles[path] = content;
      return Promise.resolve();
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

    await initAction(
      { installAgents: "pi" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Pi") &&
          msg.includes("unchanged") &&
          msg.includes("checked via pi list"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Pi") &&
          msg.includes("created") &&
          msg.includes("~/.pi/agent/mcp.json"),
      ),
    ).toBe(true);
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
    expect(execService.exec).toHaveBeenCalledWith(
      "/npm-global/bin/pi",
      ["list"],
      { timeoutMs: 5_000 },
    );
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
    expect(execService.exec).toHaveBeenCalledTimes(14);
    expect(execService.exec).toHaveBeenCalledWith("claude", expect.any(Array));
  });

  it("renders already configured CLI agents with check command details", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCmd} claude` || key === `${lookupCmd} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: `/usr/bin/${args[0]}\n`,
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
        if (key === "codex mcp list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "githits\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "claude-code,codex-cli" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const claudeRow = getLogOutput().find((msg) => msg.includes("Claude Code"));
    const codexRow = getLogOutput().find((msg) => msg.includes("Codex CLI"));
    expect(claudeRow).toBeDefined();
    expect(codexRow).toBeDefined();
    expect(claudeRow ?? "").toContain("unchanged");
    expect(claudeRow ?? "").toContain("checked via claude plugin list");
    expect(codexRow ?? "").toContain("unchanged");
    expect(codexRow ?? "").toContain("checked via codex mcp list");
    expect(claudeRow ?? "").not.toContain("plugin install");
    expect(codexRow ?? "").not.toContain("mcp add");
    expect(execService.exec).not.toHaveBeenCalledWith("claude", [
      "plugin",
      "marketplace",
      "add",
      "githits-com/githits-cli",
    ]);
    expect(execService.exec).not.toHaveBeenCalledWith("claude", [
      "plugin",
      "install",
      "githits@githits-plugins",
    ]);
    expect(execService.exec).not.toHaveBeenCalledWith("codex", [
      "mcp",
      "add",
      "githits",
      "--",
      "npx",
      "-y",
      "githits@latest",
      "mcp",
      "start",
    ]);
  });

  it("renders only Claude Code commands that actually ran", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    let pluginListCalls = 0;
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
          pluginListCalls += 1;
          return Promise.resolve({
            exitCode: 0,
            stdout:
              pluginListCalls === 1
                ? "other-plugin\n"
                : "githits@githits-plugins\n",
            stderr: "",
          });
        }
        if (
          key === "claude plugin marketplace add githits-com/githits-cli" ||
          key === "claude plugin install githits@githits-plugins"
        ) {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "claude-code" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(execService.exec).toHaveBeenCalledWith("claude", [
      "plugin",
      "marketplace",
      "add",
      "githits-com/githits-cli",
    ]);
    expect(execService.exec).toHaveBeenCalledWith("claude", [
      "plugin",
      "install",
      "githits@githits-plugins",
    ]);
    const claudeRows = getLogOutput().filter(
      (msg) => msg.includes("Claude Code") && msg.includes("claude plugin"),
    );
    expect(claudeRows).toHaveLength(1);
    const claudeRow = claudeRows[0]!;
    expect(claudeRow).toContain(
      "claude plugin marketplace add githits-com/githits-cli",
    );
    const installRow = getLogOutput().find((msg) =>
      msg.includes("claude plugin install githits@githits-plugins"),
    );
    expect(installRow).toBeDefined();
    expect(installRow?.trim()).toBe(
      "claude plugin install githits@githits-plugins",
    );
    expect(installRow?.indexOf("claude plugin install")).toBe(
      claudeRow.indexOf("claude plugin marketplace"),
    );
  });

  it("does not render checked-via detail when a later CLI command runs", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    let pluginListCalls = 0;
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
          pluginListCalls += 1;
          return Promise.resolve({
            exitCode: 0,
            stdout:
              pluginListCalls === 1
                ? "other-plugin\n"
                : "githits@githits-plugins\n",
            stderr: "",
          });
        }
        if (key === "claude plugin marketplace add githits-com/githits-cli") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Marketplace already added\n",
            stderr: "",
          });
        }
        if (key === "claude plugin install githits@githits-plugins") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Installed\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "claude-code" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("checked via claude plugin list")),
    ).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("claude plugin marketplace add githits-com/githits-cli"),
      ),
    ).toBe(false);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Claude Code") &&
          msg.includes("ran") &&
          msg.includes("claude plugin install githits@githits-plugins"),
      ),
    ).toBe(true);
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
    expect(execService.exec).toHaveBeenCalledTimes(9);
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("No supported AI coding tools detected"),
      ),
    ).toBe(true);
  });

  it("--yes with all agents already configured shows unchanged paths", async () => {
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
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Cursor") &&
          msg.includes("unchanged") &&
          msg.includes("~/.cursor/mcp.json"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Nothing to install"))).toBe(
      false,
    );
    // The MCP server is still confirmed, with already-configured wording.
    expect(
      logCalls.some((msg) =>
        msg.includes('MCP server "githits" already configured'),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Configured MCP server"))).toBe(
      false,
    );
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

      expect(authStorage.clearActiveClient).toHaveBeenCalledWith(
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
  it("removes project GitHits config and preserves other servers", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
        Other: { command: "other" },
      },
      custom: true,
    });
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.mcp.json": currentConfig,
      "/repo/.githits/init/project-setup.json": JSON.stringify({
        version: 1,
        projectSetup: { pi: { installedPackages: ["npm:pi-mcp-adapter"] } },
      }),
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );
    const promptService = createMockPromptService({
      confirm: mock(() => Promise.resolve(true)),
    });

    await initUninstallAction(
      { project: true },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(promptService.confirm).toHaveBeenCalledTimes(1);
    expect(promptService.confirm).toHaveBeenCalledWith(
      "Remove GitHits MCP config from this project?",
      false,
    );
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.mcp.json",
      expect.any(String),
    );
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
    );
    const parsed = JSON.parse(currentConfig);
    expect(parsed.mcpServers.GitHits).toBeUndefined();
    expect(parsed.mcpServers.Other).toEqual({ command: "other" });
    expect(parsed.custom).toBe(true);
  });

  it("removes empty project mcpServers while preserving other top-level config", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
      custom: true,
    });
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.mcp.json": currentConfig,
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.mcp.json",
      expect.any(String),
    );
    expect(fs.deleteFile).not.toHaveBeenCalled();
    expect(JSON.parse(currentConfig)).toEqual({ custom: true, mcpServers: {} });
  });

  it("removes project GitHits config when only GitHits config remains", async () => {
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.mcp.json",
      expect.any(String),
    );
    expect(fs.deleteFile).not.toHaveBeenCalled();
  });

  it("does not write project uninstall when config is missing", async () => {
    const fs = createFsWithDetection(["/repo"]);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const promptService = createMockPromptService();

    await initUninstallAction(
      { project: true },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(promptService.confirm).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(fs.deleteFile).not.toHaveBeenCalled();
  });

  it("leaves malformed project .mcp.json unchanged during uninstall", async () => {
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.mcp.json": "{bad json",
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const promptService = createMockPromptService();

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(process.exitCode).toBe(1);
    expect(promptService.confirm).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(fs.deleteFile).not.toHaveBeenCalled();
  });

  it("does not uninstall project config in non-interactive mode without --yes", async () => {
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;

    await initUninstallAction(
      { project: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        isInteractive: false,
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(fs.deleteFile).not.toHaveBeenCalled();
    expect(
      getLogOutput().some((msg) =>
        msg.includes("githits init uninstall --project --yes"),
      ),
    ).toBe(true);
  });

  it("prompts for project scope and removes project config without scanning global agents", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const configFiles: Record<string, string> = {
      "/repo/.mcp.json": currentConfig,
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        if (path in configFiles) return configFiles[path]!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );
    const promptService = createMockPromptService({
      select: mock(() => Promise.resolve("project")) as PromptService["select"],
      confirm: mock(() => Promise.resolve(true)),
    });

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(promptService.select).toHaveBeenCalledTimes(1);
    expect(promptService.confirm).toHaveBeenCalledTimes(1);
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.mcp.json",
      expect.any(String),
    );
    expect(
      getLogOutput().some((msg) =>
        msg.includes("Scanning for configured agents"),
      ),
    ).toBe(false);
  });

  it("does not run Pi cleanup for shared config without ownership marker", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const configFiles: Record<string, string> = {
      "/repo/.mcp.json": currentConfig,
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        if (path in configFiles) return configFiles[path]!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );
    const execService = createMockExecService();
    const promptService = createMockPromptService();

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService,
        execService,
      },
    );

    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.mcp.json",
      expect.any(String),
    );
    expect(promptService.confirm).not.toHaveBeenCalled();
    expect(execService.exec).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("pi remove npm:pi-mcp-adapter")),
    ).toBe(false);
    expect(logCalls.some((msg) => msg.includes("Uninstalling Pi"))).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("Cleanup: setup installed for this project"),
      ),
    ).toBe(false);
    expect(logCalls.some((msg) => msg.includes("Claude Code"))).toBe(false);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("GitHits project config") &&
          msg.includes("updated") &&
          msg.includes("./.mcp.json"),
      ),
    ).toBe(true);
  });

  it("does not remove global Pi adapter and clears ownership marker", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const configFiles: Record<string, string> = {
      "/repo/.mcp.json": currentConfig,
      "/repo/.githits/init/project-setup.json": JSON.stringify({
        version: 1,
        projectSetup: { pi: { installedPackages: ["npm:pi-mcp-adapter"] } },
      }),
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        if (path in configFiles) return configFiles[path]!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string, content: string) => {
        if (path === "/repo/.mcp.json") currentConfig = content;
        configFiles[path] = content;
      },
    );
    const execService = createMockExecService();

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(execService.exec).not.toHaveBeenCalled();
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
    );
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("Cleanup: setup installed for this project"),
      ),
    ).toBe(false);
    expect(logCalls.some((msg) => msg.includes("Project setup cleanup"))).toBe(
      false,
    );
    expect(logCalls.some((msg) => msg.includes("Uninstalling Pi"))).toBe(false);
  });

  it("ignores null project marker entries during project uninstall", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const configFiles: Record<string, string> = {
      "/repo/.mcp.json": currentConfig,
      "/repo/.githits/init/project-setup.json": JSON.stringify({
        version: 1,
        projectSetup: { pi: null },
      }),
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        if (path in configFiles) return configFiles[path]!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );
    const execService = createMockExecService();

    await expect(
      initUninstallAction(
        { project: true, yes: true },
        {
          fileSystemService: fs,
          promptService: createMockPromptService(),
          execService,
        },
      ),
    ).resolves.toBeUndefined();

    expect(JSON.parse(currentConfig).mcpServers?.GitHits).toBeUndefined();
    expect(execService.exec).not.toHaveBeenCalled();
  });

  it("ignores non-array installedPackages during project uninstall", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const configFiles: Record<string, string> = {
      "/repo/.mcp.json": currentConfig,
      "/repo/.githits/init/project-setup.json": JSON.stringify({
        version: 1,
        projectSetup: {
          pi: { installedPackages: "npm:pi-mcp-adapter" },
        },
      }),
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        if (path in configFiles) return configFiles[path]!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );
    const execService = createMockExecService();

    await expect(
      initUninstallAction(
        { project: true, yes: true },
        {
          fileSystemService: fs,
          promptService: createMockPromptService(),
          execService,
        },
      ),
    ).resolves.toBeUndefined();

    expect(JSON.parse(currentConfig).mcpServers?.GitHits).toBeUndefined();
    expect(execService.exec).not.toHaveBeenCalled();
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
    );
  });

  it("clears valid project marker entries while ignoring invalid siblings", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const configFiles: Record<string, string> = {
      "/repo/.mcp.json": currentConfig,
      "/repo/.githits/init/project-setup.json": JSON.stringify({
        version: 1,
        projectSetup: {
          bad: null,
          pi: {
            installedPackages: ["npm:pi-mcp-adapter", "npm:pi-mcp-adapter"],
          },
        },
      }),
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        if (path in configFiles) return configFiles[path]!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string, content: string) => {
        if (path === "/repo/.mcp.json") currentConfig = content;
        configFiles[path] = content;
      },
    );

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(JSON.parse(currentConfig).mcpServers?.GitHits).toBeUndefined();
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
    );
  });

  it("clears ownership marker without checking whether Pi adapter is already absent", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const configFiles: Record<string, string> = {
      "/repo/.mcp.json": currentConfig,
      "/repo/.githits/init/project-setup.json": JSON.stringify({
        version: 1,
        projectSetup: { pi: { installedPackages: ["npm:pi-mcp-adapter"] } },
      }),
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        if (path in configFiles) return configFiles[path]!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (_path: string, content: string) => {
        currentConfig = content;
      },
    );
    const execService = createMockExecService();

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(process.exitCode).not.toBe(1);
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(execService.exec).not.toHaveBeenCalled();
    expect(
      getLogOutput().some((msg) => msg.includes("Project setup cleanup")),
    ).toBe(false);
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
    );
  });

  it("preserves ownership marker when project marker cleanup fails", async () => {
    let currentConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const marker = JSON.stringify({
      version: 1,
      projectSetup: { pi: { installedPackages: ["npm:pi-mcp-adapter"] } },
    });
    const configFiles: Record<string, string> = {
      "/repo/.mcp.json": currentConfig,
      "/repo/.githits/init/project-setup.json": marker,
    };
    const fs = createFsWithDetection(["/repo"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.mcp.json") return currentConfig;
        if (path in configFiles) return configFiles[path]!;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string, content: string) => {
        if (path === "/repo/.mcp.json") {
          currentConfig = content;
          configFiles[path] = content;
          return;
        }
        configFiles[path] = content;
      },
    );
    (fs.deleteFile as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("marker delete failed");
    });
    const execService = createMockExecService();

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(process.exitCode).toBe(1);
    expect(execService.exec).not.toHaveBeenCalled();
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
    );
    expect(configFiles["/repo/.githits/init/project-setup.json"]).toBe(marker);
    expect(
      getLogOutput().some((msg) => msg.includes("marker delete failed")),
    ).toBe(true);
  });

  it("does not run project cleanup when config removal fails", async () => {
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      "/repo/.githits/init/project-setup.json": JSON.stringify({
        version: 1,
        projectSetup: { pi: { installedPackages: ["npm:pi-mcp-adapter"] } },
      }),
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async () => {
        throw new Error("Disk full");
      },
    );
    const execService = createMockExecService();

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(process.exitCode).toBe(1);
    expect(execService.exec).not.toHaveBeenCalled();
  });

  it("cleans legacy marker without claiming MCP config was removed", async () => {
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.mcp.json": JSON.stringify({ mcpServers: {} }),
      "/repo/.githits/init/project-setup.json": JSON.stringify({
        version: 1,
        projectSetup: { pi: { installedPackages: ["npm:pi-mcp-adapter"] } },
      }),
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const execService = createMockExecService();

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(execService.exec).not.toHaveBeenCalled();
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/repo/.githits/init/project-setup.json",
    );
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("Removed legacy GitHits project setup marker"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Legacy project setup marker") &&
          msg.includes("updated") &&
          msg.includes("./.githits/init/project-setup.json"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("MCP configuration was removed from this project"),
      ),
    ).toBe(false);
  });

  it("keeps project uninstall failure exit code when sibling config removes", async () => {
    let cursorConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.mcp.json": "{invalid",
      "/repo/.cursor/mcp.json": cursorConfig,
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.cursor/mcp.json") return cursorConfig;
        if (path === "/repo/.mcp.json") return "{invalid";
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string, content: string) => {
        if (path === "/repo/.cursor/mcp.json") cursorConfig = content;
      },
    );

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(process.exitCode).toBe(1);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.cursor/mcp.json",
      expect.any(String),
    );
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Cannot parse"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Done!"))).toBe(false);
  });

  it("still removes project config when legacy marker probe fails", async () => {
    let cursorConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createFsWithDetection(["/repo"], {
      "/repo/.cursor/mcp.json": cursorConfig,
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/repo/.cursor/mcp.json") return cursorConfig;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string, content: string) => {
        if (path === "/repo/.cursor/mcp.json") cursorConfig = content;
      },
    );
    (fs.exists as ReturnType<typeof mock>).mockImplementation(async (path) => {
      if (path === "/repo/.githits/init/project-setup.json") {
        throw new Error("marker stat failed");
      }
      return false;
    });

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(process.exitCode).toBe(1);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.cursor/mcp.json",
      expect.any(String),
    );
    expect(JSON.parse(cursorConfig).mcpServers?.GitHits).toBeUndefined();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("marker stat failed"))).toBe(
      true,
    );
    expect(logCalls.some((msg) => msg.includes("completed with errors"))).toBe(
      true,
    );
  });

  it("does not write when uninstall scope prompt is cancelled", async () => {
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
      select: mock(() => Promise.reject(new ExitPromptError())),
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
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(getLogOutput().some((msg) => msg.includes("No changes made"))).toBe(
      true,
    );
  });

  it("does not uninstall anything in non-interactive mode without yes", async () => {
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

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        isInteractive: false,
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("githits init uninstall --yes")),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("githits init uninstall --project --yes"),
      ),
    ).toBe(true);
  });

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
    // Default checkbox mock selects all pre-checked (configured) tools.
    const promptService = createMockPromptService();

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    // The selection checkbox is the consent — no per-agent confirm prompt.
    expect(promptService.checkbox).toHaveBeenCalledTimes(1);
    expect(promptService.confirm3).not.toHaveBeenCalled();
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
    // Deselecting everything in the checkbox keeps all tools.
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve([])) as PromptService["checkbox"],
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

  it("removes all selected tools without per-agent prompts", async () => {
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
    // Default checkbox selects both pre-checked configured tools.
    const promptService = createMockPromptService();

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(promptService.checkbox).toHaveBeenCalledTimes(1);
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(2);
  });

  it("removes only the tools left selected in the checkbox", async () => {
    const githits = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const writes: string[] = [];
    const fs = createFsWithDetection([
      "/home/test/.cursor",
      "/home/test/.codeium/windsurf",
    ]);
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (
          path === "/home/test/.cursor/mcp.json" ||
          path === "/home/test/.codeium/windsurf/mcp_config.json"
        ) {
          return githits;
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    );
    (fs.atomicWriteFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        writes.push(path);
      },
    );
    // Keep Windsurf by leaving only Cursor checked.
    const promptService = createMockPromptService({
      checkbox: mock(<T>(_m: string, choices: { value: T }[]) =>
        Promise.resolve(
          choices
            .map((c) => c.value)
            .filter((v): v is T => (v as { id?: string }).id === "cursor"),
        ),
      ) as PromptService["checkbox"],
    });

    await initUninstallAction(
      {},
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
      },
    );

    expect(writes).toEqual(["/home/test/.cursor/mcp.json"]);
    const logCalls = getLogOutput();
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Cursor") &&
          msg.includes("updated") &&
          msg.includes("~/.cursor/mcp.json"),
      ),
    ).toBe(true);
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
    expect(
      logCalls.some((msg) => msg.includes("Pi") && msg.includes("updated")),
    ).toBe(true);
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
    expect(
      logCalls.some((msg) => msg.includes("Pi") && msg.includes("updated")),
    ).toBe(true);
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
    expect(
      logCalls.some(
        (msg) => msg.includes("Claude Code") && msg.includes("ran"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("Warning:"))).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(false);
  });

  it("renders multi-step Claude uninstall commands as continuation rows", async () => {
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

    expect(execService.exec).toHaveBeenCalledWith("claude", [
      "plugin",
      "uninstall",
      "githits",
    ]);
    expect(execService.exec).toHaveBeenCalledWith("claude", [
      "plugin",
      "marketplace",
      "remove",
      "githits-plugins",
    ]);
    const uninstallRow = getLogOutput().find(
      (msg) =>
        msg.includes("Claude Code") && msg.includes("claude plugin uninstall"),
    );
    const marketplaceRow = getLogOutput().find((msg) =>
      msg.includes("claude plugin marketplace remove githits-plugins"),
    );
    expect(uninstallRow).toBeDefined();
    expect(marketplaceRow).toBeDefined();
    expect(marketplaceRow).not.toContain("Claude Code");
    expect(marketplaceRow?.indexOf("claude plugin marketplace")).toBe(
      uninstallRow?.indexOf("claude plugin uninstall"),
    );
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
    // The command that did run stays visible even though verification failed.
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("ran") &&
          msg.includes("claude plugin uninstall githits"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) => msg.includes("Claude Code") && msg.includes("failed"),
      ),
    ).toBe(true);
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
      logCalls.some(
        (msg) =>
          msg.includes("Codex CLI") &&
          msg.includes("unchanged") &&
          msg.includes("checked via codex mcp list"),
      ),
    ).toBe(true);
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

  it("handles Ctrl+C on the selection prompt gracefully", async () => {
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
      checkbox: mock(() =>
        Promise.reject(new ExitPromptError("User force closed")),
      ) as PromptService["checkbox"],
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
  async function parseRegisteredInit(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerInitCommand(program);
    const originalCwd = process.cwd();
    const tempCwd = mkdtempSync(join(tmpdir(), "githits-init-test-"));
    process.chdir(tempCwd);
    try {
      await program.parseAsync(["node", "githits", ...args], { from: "node" });
    } finally {
      process.chdir(originalCwd);
    }
  }

  function withNonInteractiveStdio<T>(fn: () => Promise<T>): Promise<T> {
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
      value: false,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    return fn().finally(() => {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
      }
      if (stdoutDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      }
    });
  }

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
    expect(optionLongNames).toContain("--project");
  });

  it("registers uninstall --project as a boolean option", () => {
    const program = new Command();
    registerInitCommand(program);

    const initCommand = program.commands.find((cmd) => cmd.name() === "init");
    const uninstallCommand = initCommand?.commands.find(
      (cmd) => cmd.name() === "uninstall",
    );
    const projectOption = uninstallCommand?.options.find(
      (option) => option.long === "--project",
    );

    expect(projectOption?.required).toBe(false);
    expect(projectOption?.optional).toBe(false);
  });

  it("routes init uninstall --project to project uninstall", async () => {
    await withNonInteractiveStdio(() =>
      parseRegisteredInit(["init", "uninstall", "--project", "--yes"]),
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("Remove GitHits from this project's MCP config"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("Scanning for configured agents")),
    ).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("Project uninstall needs confirmation"),
      ),
    ).toBe(false);
  });

  it("routes parent init --project before uninstall to project uninstall", async () => {
    await withNonInteractiveStdio(() =>
      parseRegisteredInit(["init", "--project", "uninstall", "--yes"]),
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("Remove GitHits from this project's MCP config"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("Scanning for configured agents")),
    ).toBe(false);
  });

  it("routes init uninstall --yes without non-interactive guidance", async () => {
    await withNonInteractiveStdio(() =>
      parseRegisteredInit(["init", "uninstall", "--yes", "--project"]),
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Uninstall is interactive")),
    ).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("Project uninstall needs confirmation"),
      ),
    ).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("Remove GitHits from this project's MCP config"),
      ),
    ).toBe(true);
  });

  it("rejects unknown init action with generic guidance", async () => {
    await parseRegisteredInit(["init", "foo"]);

    expect(process.exitCode).toBe(1);
    const errorCalls = getErrorOutput();
    expect(
      errorCalls.some((msg) => msg.includes("Unknown init action: foo")),
    ).toBe(true);
    expect(
      errorCalls.some((msg) => msg.includes('githits init uninstall"')),
    ).toBe(true);
    expect(errorCalls.some((msg) => msg.includes("--project"))).toBe(false);
  });
});
