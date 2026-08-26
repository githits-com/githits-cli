import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { Command } from "commander";
import type {
  ExecOptions,
  ExecResult,
  ExecService,
} from "../../services/exec-service.js";
import type {
  ConfirmChoice,
  PromptService,
} from "../../services/prompt-service.js";
import {
  createMockExecService as createBaseMockExecService,
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockFileSystemService,
  createMockPromptService,
  createValidTokenData,
} from "../../services/test-helpers.js";
import type { LoginDependencies } from "../login.js";
import {
  GITHITS_GUIDANCE_BLOCK,
  GITHITS_GUIDANCE_MARKER,
  GITHITS_SKILL_CATALOG,
} from "./guidance-assets.js";
import {
  initAction,
  initUninstallAction,
  registerInitCommand,
} from "./init.js";

const CLAUDE_USER_CONFIG_PATH = "/home/test/.claude.json";
const CLAUDE_USER_CONFIG = JSON.stringify({
  mcpServers: {
    githits: {
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    },
  },
});
const CLAUDE_NON_CANONICAL_USER_CONFIG = JSON.stringify({
  mcpServers: {
    githits: {
      command: "custom",
      args: ["--pinned"],
    },
  },
});
const CODEX_CONFIGURED_OUTPUT = JSON.stringify({
  name: "githits",
  enabled: true,
  transport: { type: "stdio", command: "custom", args: ["--pinned"] },
});
const CODEX_MISSING_OUTPUT = "Error: No MCP server named 'githits' found.\n";

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

function readCanonicalSkillFiles(skillRoot: string): Record<string, string> {
  return Object.fromEntries(
    GITHITS_SKILL_CATALOG.map((skill) => [
      `${skillRoot}/${skill.name}/SKILL.md`,
      readFileSync(join(process.cwd(), ...skill.relativePath), "utf8"),
    ]),
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
  const skillSourceContents = new Map(
    GITHITS_SKILL_CATALOG.map((skill) => {
      const sourcePath = join(process.cwd(), ...skill.relativePath).replaceAll(
        "\\",
        "/",
      );
      return [sourcePath, readFileSync(sourcePath, "utf8")];
    }),
  );
  return createMockFileSystemService({
    getHomeDir: mock(() => "/home/test"),
    joinPath: mock((...segments: string[]) => segments.join("/")),
    isDirectory: mock(async (path: string) => detectedDirs.includes(path)),
    getDirname: mock(
      (path: string) => path.split("/").slice(0, -1).join("/") || "/",
    ),
    ensureDir: mock(() => Promise.resolve()),
    readFile: mock(async (path: string) => {
      const normalizedPath = path.replaceAll("\\", "/");
      const skillSource = skillSourceContents.get(normalizedPath);
      if (skillSource !== undefined) {
        return skillSource;
      }
      if (path in configFiles) {
        return configFiles[path]!;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    exists: mock(async (path: string) => path in configFiles),
    atomicWriteFile: mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }),
  });
}

/** Helper to extract log output as string array */
function getLogOutput(): string[] {
  return (logSpy.mock.calls as unknown[][]).map((c) => String(c[0] ?? ""));
}

function getErrorOutput(): string[] {
  return (errorSpy.mock.calls as unknown[][]).map((c) => String(c[0] ?? ""));
}

function normalizeHumanOutput(logCalls: string[] = getLogOutput()): string {
  return logCalls.join("\n").replace(/\s+/g, " ");
}

function expectCursorRemoteNextSteps(logCalls: string[]): void {
  const output = normalizeHumanOutput(logCalls);
  expect(logCalls.some((msg) => msg.includes("6. Next Steps"))).toBe(true);
  expect(logCalls.some((msg) => msg.includes("GitHits is now connected"))).toBe(
    false,
  );
  expect(output).toContain("Cursor is ready only after its separate OAuth");
  expect(output).toContain(
    "open the MCP panel and click Authenticate once for GitHits",
  );
  expect(output).toContain("cursor-agent mcp login GitHits");
  expect(output).toContain("separately from local GitHits CLI authentication");
  expect(
    logCalls.some(
      (msg) =>
        msg.trim() !== "cursor-agent mcp login GitHits" &&
        msg.includes("cursor-agent mcp login GitHits"),
    ),
  ).toBe(false);
  expect(
    logCalls.some((msg) => msg.trim() === "cursor-agent mcp login GitHits"),
  ).toBe(true);
  expect(logCalls.some((msg) => msg.trim() === "cursor-agent mcp list")).toBe(
    true,
  );
  expect(
    logCalls.some(
      (msg) => msg.trim() === "cursor-agent mcp list-tools GitHits",
    ),
  ).toBe(true);
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
    false,
  );
  expect(
    logCalls.some((msg) =>
      msg.includes("GitHits MCP is configured. Sign-in was not checked."),
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

function createMockExecService(impl: Partial<ExecService> = {}): ExecService {
  const service = createBaseMockExecService(impl);
  const originalExec = service.exec.bind(service);
  service.exec = mock(
    async (
      command: string,
      args: string[],
      options?: ExecOptions,
    ): Promise<ExecResult> => {
      if (command === "codex" && args.length === 1 && args[0] === "--version") {
        return { exitCode: 0, stdout: "codex 1.0.0\n", stderr: "" };
      }
      return originalExec(command, args, options);
    },
  );
  return service;
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
      { guidance: false },
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
    expect(
      logCalls.some((msg) =>
        msg.includes("GitHits queries and public package"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("is an outbound write"))).toBe(
      true,
    );
    const reviewIndex = logCalls.findIndex((msg) =>
      msg.includes("Show this install review"),
    );
    const approvalIndex = logCalls.findIndex((msg) =>
      msg.includes("Ask which tools should receive"),
    );
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(approvalIndex).toBeGreaterThan(reviewIndex);
    expect(
      logCalls.some((msg) =>
        msg.includes("--detect-agents --no-guidance --json"),
      ),
    ).toBe(true);
    const stagedCommands = logCalls.filter((msg) =>
      msg.includes("npx -y githits@latest init"),
    );
    expect(stagedCommands.length).toBeGreaterThan(0);
    expect(
      stagedCommands.every((command) => command.includes("--no-guidance")),
    ).toBe(true);
    expect(promptService.select).not.toHaveBeenCalled();
    expect(promptService.checkbox).not.toHaveBeenCalled();
    expect(execService.exec).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(createLoginDeps).not.toHaveBeenCalled();
  });

  it("keeps non-interactive staged commands guided by default", async () => {
    await initAction(
      {},
      {
        fileSystemService: createFsWithDetection([]),
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        isInteractive: false,
      },
    );

    const stagedCommands = getLogOutput().filter((msg) =>
      msg.includes("npx -y githits@latest init"),
    );
    expect(stagedCommands.length).toBeGreaterThan(0);
    expect(
      stagedCommands.every((command) => !command.includes("--no-guidance")),
    ).toBe(true);
  });

  it("rejects non-interactive --yes before scan, writes, or auth", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const execService = createMockExecService();
    const promptService = createMockPromptService();
    const createLoginDeps = mock(() =>
      Promise.resolve({} as LoginDependencies),
    );

    await initAction(
      { yes: true, guidance: false },
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
    const stagedCommands = getErrorOutput().filter((msg) =>
      msg.includes("npx -y githits@latest init"),
    );
    expect(stagedCommands.length).toBeGreaterThan(0);
    expect(
      stagedCommands.every((command) => command.includes("--no-guidance")),
    ).toBe(true);
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
      { detectAgents: true, guidance: false },
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
    expect(
      logCalls.some((msg) =>
        msg.includes("GitHits queries and public package"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("is an outbound write"))).toBe(
      true,
    );
    expect(
      logCalls.some((msg) =>
        msg.includes("--install-agents cursor --no-guidance"),
      ),
    ).toBe(true);
    const installCommand = logCalls.find((msg) =>
      msg.includes("--install-agents cursor --no-guidance"),
    );
    expect(installCommand).not.toContain("--json");
    expect(
      logCalls.some((msg) =>
        msg.includes("--detect-agents --no-guidance --json"),
      ),
    ).toBe(true);
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(createLoginDeps).not.toHaveBeenCalled();
  });

  it("prints no-tools guidance when staged detection finds no agents", async () => {
    const fs = createFsWithDetection([]);

    await initAction(
      { detectAgents: true, guidance: false },
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
    expect(logCalls.some((msg) => msg.includes("Install review"))).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("GitHits queries and public package"),
      ),
    ).toBe(false);
  });

  it("warns agents not to run init yes when detected tools are configured", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });

    await initAction(
      { detectAgents: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("No detected tools need MCP or guidance setup"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("githits init -y"))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("verification step"))).toBe(
      true,
    );
    expect(
      logCalls.some((msg) =>
        msg.includes("GitHits queries and public package"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("supporting guidance was not requested"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("requested supporting guidance is already configured"),
      ),
    ).toBe(false);
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
    expect(payload.suggestedCommand).toBe(
      "npx -y githits@latest init --install-agents cursor --json",
    );
    expect(payload.instructions).toContain(
      "Do not run `githits init -y` or `githits init --yes` unless the user explicitly asks to configure every detected tool.",
    );
    expect(payload.instructions).toContain(
      "Do not run init again after a successful --install-agents run; verify with npx -y githits@latest init --detect-agents --json instead.",
    );
    const reviewIndex = payload.instructions.findIndex((instruction: string) =>
      instruction.includes("Before asking for install approval"),
    );
    const queryDisclosureIndex = payload.instructions.findIndex(
      (instruction: string) =>
        instruction.includes("GitHits queries and public package"),
    );
    const feedbackDisclosureIndex = payload.instructions.findIndex(
      (instruction: string) => instruction.includes("is an outbound write"),
    );
    const localWorkspaceIndex = payload.instructions.findIndex(
      (instruction: string) =>
        instruction.includes("does not itself upload the local workspace"),
    );
    const newSessionIndex = payload.instructions.findIndex(
      (instruction: string) =>
        instruction.includes("open a new coding agent session"),
    );
    const approvalIndex = payload.instructions.findIndex(
      (instruction: string) =>
        instruction.includes("Ask which actionable tools should receive"),
    );
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(queryDisclosureIndex).toBeGreaterThan(reviewIndex);
    expect(feedbackDisclosureIndex).toBeGreaterThan(queryDisclosureIndex);
    expect(localWorkspaceIndex).toBeGreaterThan(feedbackDisclosureIndex);
    expect(newSessionIndex).toBeGreaterThan(localWorkspaceIndex);
    expect(approvalIndex).toBeGreaterThan(newSessionIndex);
    expect(JSON.stringify(payload.instructions)).not.toContain("--no-guidance");
  });

  it("preserves --no-guidance in staged detect follow-up commands", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);

    await initAction(
      { detectAgents: true, json: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.suggestedCommand).toBe(
      "npx -y githits@latest init --install-agents cursor --no-guidance --json",
    );
    expect(payload.instructions).toContain(
      "Do not run init again after a successful --install-agents run; verify with npx -y githits@latest init --detect-agents --no-guidance --json instead.",
    );
  });

  it("does not emit Cursor OAuth guidance while staged targets await selection", async () => {
    const fs = createFsWithDetection([
      "/home/test/.cursor",
      "/home/test/.codeium/windsurf",
    ]);

    await initAction(
      { detectAgents: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.actionableIds).toContain("cursor");
    expect(JSON.stringify(payload.instructions)).not.toContain(
      "Cursor uses the remote GitHits MCP",
    );
    expect(JSON.stringify(payload.instructions)).not.toContain(
      "cursor-agent mcp",
    );
  });

  it("reports guidance-only repair as actionable without changing installableIds", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });

    await initAction(
      { detectAgents: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    const cursor = payload.agents.find(
      (agent: { id: string }) => agent.id === "cursor",
    );
    expect(cursor.status).toBe("already_configured");
    expect(cursor.guidanceStatus).toBe("needs_setup");
    expect(payload.installableIds).toEqual([]);
    expect(payload.actionableIds).toEqual(["cursor"]);
    expect(payload.guidanceRequested).toBe(true);
    expect(payload.suggestedCommand).toBe(
      "npx -y githits@latest init --install-agents cursor --json",
    );
  });

  it("reports fully configured MCP and guidance as not actionable", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      ...readCanonicalSkillFiles("/home/test/.claude/skills"),
      "/home/test/.claude/CLAUDE.md": [
        GITHITS_GUIDANCE_MARKER,
        GITHITS_GUIDANCE_BLOCK,
        GITHITS_GUIDANCE_MARKER,
      ].join("\n"),
    });

    await initAction(
      { detectAgents: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    const cursor = payload.agents.find(
      (agent: { id: string }) => agent.id === "cursor",
    );
    expect(cursor.guidanceStatus).toBe("already_configured");
    expect(payload.installableIds).toEqual([]);
    expect(payload.actionableIds).toEqual([]);
    expect(payload.suggestedCommand).toBeNull();
    const reviewLeadIn = payload.instructions.indexOf(
      "Before authentication, show the user this install review:",
    );
    const configuredInstruction = payload.instructions.indexOf(
      "Tell the user that requested supporting guidance is already configured for tools with verified guidance targets.",
    );
    expect(reviewLeadIn).toBeGreaterThanOrEqual(0);
    expect(configuredInstruction).toBeGreaterThan(reviewLeadIn);
    expect(payload.instructions).toEqual(
      expect.arrayContaining([
        "GitHits queries and public package, repository, and documentation targets are sent to GitHits services for processing.",
        "Feedback submission is an outbound write that sends feedback data to GitHits services.",
        "Installing GitHits MCP does not itself upload the local workspace.",
        "After installation, open a new coding agent session so it loads the MCP configuration and any supporting instructions. You do not need to restart the terminal or machine.",
      ]),
    );
    expect(payload.instructions).toContain(
      "Do not ask the user to choose actionable IDs.",
    );
    expect(payload.instructions).toContain(
      "Cursor uses the remote GitHits MCP at https://mcp.githits.com and manages its OAuth separately from local GitHits CLI authentication.",
    );
    expect(
      payload.instructions.some((instruction: string) =>
        instruction.includes("cursor-agent mcp list-tools GitHits"),
      ),
    ).toBe(true);
  });

  it("deduplicates shared guidance checks across detected tools", async () => {
    const cursorMcpConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          url: "https://mcp.githits.com",
        },
      },
    });
    const qwenMcpConfig = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.qwen"],
      {
        "/home/test/.cursor/mcp.json": cursorMcpConfig,
        "/home/test/.qwen/settings.json": qwenMcpConfig,
        ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      },
    );

    await initAction(
      { detectAgents: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const targetReads = (fs.readFile as ReturnType<typeof mock>).mock.calls;
    for (const skill of GITHITS_SKILL_CATALOG) {
      const targetPath = `/home/test/.agents/skills/${skill.name}/SKILL.md`;
      expect(targetReads.filter(([path]) => path === targetPath)).toHaveLength(
        1,
      );
    }
  });

  it("does not make missing guidance actionable with --no-guidance", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });

    await initAction(
      { detectAgents: true, json: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    const cursor = payload.agents.find(
      (agent: { id: string }) => agent.id === "cursor",
    );
    expect(cursor.guidanceStatus).toBe("not_requested");
    expect(payload.guidanceRequested).toBe(false);
    expect(payload.actionableIds).toEqual([]);
    expect(payload.instructions).toContain(
      "Tell the user that GitHits MCP is already configured for detected tools.",
    );
    expect(payload.instructions).toContain(
      "Tell the user that supporting guidance was not requested.",
    );
    expect(JSON.stringify(payload.instructions)).not.toContain(
      "requested supporting guidance is already configured",
    );
  });

  it("reports detected tools without guidance targets as not supported", async () => {
    const fs = createFsWithDetection(["/home/test/.config/Claude"]);

    await initAction(
      { detectAgents: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    const claudeDesktop = payload.agents.find(
      (agent: { id: string }) => agent.id === "claude-desktop",
    );
    expect(claudeDesktop.status).toBe("needs_setup");
    expect(claudeDesktop.guidanceStatus).toBe("not_supported");
    expect(payload.actionableIds).toContain("claude-desktop");
  });

  it("does not claim unsupported guidance is configured in no-action detection", async () => {
    const fs = createFsWithDetection(["/home/test/.config/Claude"], {
      "/home/test/.config/Claude/claude_desktop_config.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
    });

    await initAction(
      { detectAgents: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.actionableIds).toEqual([]);
    expect(payload.instructions).toContain(
      "Tell the user that some detected tools do not have a verified supporting-guidance target.",
    );
    expect(JSON.stringify(payload.instructions)).not.toContain(
      "requested supporting guidance is already configured",
    );
  });

  it("shows guidance-only repair in human-readable staged detection", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
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
      },
    );

    const output = getLogOutput().join("\n");
    expect(output).toContain("already configured");
    expect(output).toContain("needs setup");
    expect(output).toContain("--install-agents cursor");
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
      { detectAgents: true, json: true, project: true, guidance: false },
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
    expect(payload.suggestedCommand).toBe(
      "npx -y githits@latest init --project --install-agents cursor --no-guidance --json",
    );
    expect(payload.instructions).toContain(
      "Explain that project-level install writes MCP config files into the current repo and those files may be committed.",
    );
    expect(createLoginDeps).not.toHaveBeenCalled();
  });

  it("emits a JSON-producing guided project install command", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);

    await initAction(
      { detectAgents: true, json: true, project: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.suggestedCommand).toBe(
      "npx -y githits@latest init --project --install-agents cursor --json",
    );
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
    expect(payload.instructions).not.toContain(
      "Before authentication, show the user this install review:",
    );
    expect(JSON.stringify(payload.instructions)).not.toContain(
      "GitHits queries and public package",
    );
  });

  it("does not ask for project install IDs when configured and unsupported tools are detected", async () => {
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.cursor", "/home/test/.codeium/windsurf"],
      {
        "/repo/.cursor/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              url: "https://mcp.githits.com",
            },
          },
        }),
      },
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;

    await initAction(
      { detectAgents: true, json: true, project: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.installableIds).toEqual([]);
    expect(payload.actionableIds).toEqual([]);
    expect(payload.suggestedCommand).toBeNull();
    const reviewIndex = payload.instructions.indexOf(
      "Before authentication, show the user this install review:",
    );
    const configuredIndex = payload.instructions.indexOf(
      "Explain that GitHits is already configured for detected project-configurable tools.",
    );
    const fallbackIndex = payload.instructions.findIndex(
      (instruction: string) =>
        instruction.includes("Offer user-level detection"),
    );
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(configuredIndex).toBeGreaterThan(reviewIndex);
    expect(fallbackIndex).toBeGreaterThan(configuredIndex);
    expect(payload.instructions).toEqual(
      expect.arrayContaining([
        "GitHits queries and public package, repository, and documentation targets are sent to GitHits services for processing.",
        "Feedback submission is an outbound write that sends feedback data to GitHits services.",
        "Installing GitHits MCP does not itself upload the local workspace.",
        "After installation, open a new coding agent session so it loads the MCP configuration and any supporting instructions. You do not need to restart the terminal or machine.",
      ]),
    );
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

  it("shows the review for configured and unsupported project tools in prose", async () => {
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.cursor", "/home/test/.codeium/windsurf"],
      {
        "/repo/.cursor/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              url: "https://mcp.githits.com",
            },
          },
        }),
      },
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;

    await initAction(
      { detectAgents: true, project: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const logCalls = getLogOutput();
    const reviewIndex = logCalls.findIndex((msg) =>
      msg.includes("Install review"),
    );
    const nextStepIndex = logCalls.findIndex((msg) =>
      msg.includes("Next step for agents"),
    );
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(nextStepIndex).toBeGreaterThan(reviewIndex);
    expect(logCalls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("GitHits queries and public package"),
        expect.stringContaining("Feedback submission is an outbound write"),
        expect.stringContaining(
          "Installing GitHits MCP does not itself upload the local workspace",
        ),
        expect.stringContaining("terminal or machine"),
        expect.stringContaining(
          "GitHits is already configured for the detected project-configurable tools",
        ),
        expect.stringContaining(
          "other detected tools do not have verified project-level MCP support",
        ),
        expect.stringContaining("Offer user-level install"),
      ]),
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
    expect(logCalls.some((msg) => msg.includes("Install review"))).toBe(false);
    expect(
      logCalls.some((msg) =>
        msg.includes("GitHits queries and public package"),
      ),
    ).toBe(false);
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
      { installAgents: "cursor", guidance: false },
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
    ).toBe(false);
    expect(
      getLogOutput().some((msg) =>
        msg.includes("Cursor uses the remote GitHits MCP"),
      ),
    ).toBe(true);
    expect(
      getLogOutput().some((msg) =>
        msg.includes(
          "reloads MCP configuration and any supporting instructions",
        ),
      ),
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
    expect(
      payload.instructions.some((instruction: string) =>
        instruction.includes(
          "reloads project MCP configuration and any supporting instructions",
        ),
      ),
    ).toBe(true);
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
    expect(logCalls.some((msg) => msg.includes("6. Next Steps"))).toBe(true);
    expectProjectAuthNotCheckedNextSteps(logCalls);
    expect(
      logCalls.filter((msg) => msg.includes("5. Install and verify")),
    ).toHaveLength(1);
    expect(normalizeHumanOutput(logCalls)).toContain(
      "loads the project config and any supporting instructions",
    );
    expect(JSON.parse(configFiles["/repo/.cursor/mcp.json"] ?? "{}")).toEqual({
      mcpServers: {
        GitHits: {
          url: "https://mcp.githits.com",
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
      { guidance: false },
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
      url: "https://mcp.githits.com",
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
      { guidance: false },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expectCursorRemoteNextSteps(logCalls);
    expect(
      logCalls.some((msg) =>
        msg.includes("GitHits MCP is configured for this project."),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("loads .mcp.json"))).toBe(false);
    expect(fs.atomicWriteFile).toHaveBeenCalledWith(
      "/repo/.cursor/mcp.json",
      expect.any(String),
    );
  });

  it("uses Cursor-specific project next steps without local auth", async () => {
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
    const createLoginDeps = createUnauthLoginDeps();

    await initAction(
      { guidance: false },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expectCursorRemoteNextSteps(getLogOutput());
    expect(createLoginDeps).not.toHaveBeenCalled();
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
    const signInIndex = logCalls.findIndex((msg) => msg.includes("4. Sign in"));
    const installIndex = logCalls.findIndex((msg) =>
      msg.includes("5. Install and verify"),
    );
    const mcpSectionIndex = logCalls.findIndex((msg) => msg.trim() === "MCP");
    const codexRowIndex = logCalls.findIndex(
      (msg) => msg.includes("Codex CLI") && msg.includes(".codex/config.toml"),
    );
    expect(warningIndex).toBeGreaterThanOrEqual(0);
    expect(warningIndex).toBeLessThan(signInIndex);
    expect(warningIndex).toBeLessThan(installIndex);
    expect(installIndex).toBeLessThan(mcpSectionIndex);
    expect(mcpSectionIndex).toBeLessThan(codexRowIndex);
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

  it("reports Cursor-managed auth without checking local CLI auth", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });

    const createLoginDeps = createAlreadyAuthLoginDeps();
    await initAction(
      { installAgents: "cursor", json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.auth.required).toBeNull();
    expect(payload.auth.status).toBe("managed_by_cursor");
    expect(payload.auth.loginCommand).toBe("cursor-agent mcp login GitHits");
    expect(payload.auth.verificationCommands).toContain(
      "cursor-agent mcp list-tools GitHits",
    );
    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain("githits@latest login");
  });

  it("bases staged mixed auth on MCP targets, not guidance-only repairs", async () => {
    const configFiles: Record<string, string> = {
      "/home/test/.config/opencode/opencode.json": JSON.stringify({
        mcp: {
          GitHits: {
            type: "local",
            command: ["npx", "-y", "githits@latest", "mcp", "start"],
            enabled: true,
          },
        },
      }),
    };
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.config/opencode"],
      configFiles,
    );
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const createLoginDeps = createAlreadyAuthLoginDeps();

    await initAction(
      { installAgents: "cursor,opencode", json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(payload.auth.status).toBe("managed_by_cursor");
    expect(payload.auth.loginCommand).toBe("cursor-agent mcp login GitHits");
    expect(payload.instructions).toContain(
      "Cursor uses the remote GitHits MCP at https://mcp.githits.com and manages its OAuth separately from local GitHits CLI authentication.",
    );
    expect(JSON.stringify(payload)).not.toContain("githits@latest login");
  });

  it("treats already configured staged install targets as idempotent", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });

    await initAction(
      { installAgents: "cursor", guidance: false },
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
    expect(
      logCalls.some((msg) => msg.includes("Open a new coding agent session")),
    ).toBe(false);
  });

  it("reports a new session after staged guidance-only repair", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
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
    expect(payload.outcomes[0]?.status).toBe("already_configured");
    expect(payload.guidance.status).toBe("success");
    expect(payload.instructions).toContain(
      "GitHits supporting instructions were installed or updated.",
    );
    expect(
      payload.instructions.some((instruction: string) =>
        instruction.includes("Open a new coding agent session"),
      ),
    ).toBe(true);
  });

  it("omits new-session guidance from staged JSON when nothing changed", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });

    await initAction(
      { installAgents: "cursor", guidance: false, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(
      payload.instructions.some((instruction: string) =>
        instruction.includes("Open a new coding agent session"),
      ),
    ).toBe(false);
    expect(payload.instructions).toContain(
      "Do not run init again after a successful --install-agents run; verify with npx -y githits@latest init --detect-agents --no-guidance --json instead.",
    );
    expect(payload.instructions).toContain(
      "Supporting instructions were intentionally not installed. If the user later asks for them, rerun staged install without --no-guidance.",
    );
  });

  it("reports already-configured supporting guidance accurately", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
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
    expect(payload.guidance.status).toBe("already_configured");
    expect(payload.instructions).toContain(
      "GitHits supporting instructions were already configured.",
    );
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
    expect(payload.instructions).toContain(
      "Fix installation errors before asking the user to sign in.",
    );
    expect(
      payload.instructions.some((instruction: string) =>
        instruction.includes("Supporting instruction installation failed"),
      ),
    ).toBe(true);
  });

  it.each([
    { name: "prose", json: false },
    { name: "JSON", json: true },
  ])(
    "prints reload guidance when guidance succeeds but every MCP install fails in $name output",
    async ({ json }) => {
      const configFiles: Record<string, string> = {};
      const fs = createFsWithDetection(["/home/test/.cursor"], configFiles);
      fs.atomicWriteFile = mock(async (path: string, content: string) => {
        if (path === "/home/test/.cursor/mcp.json") {
          throw Object.assign(new Error("Permission denied"), {
            code: "EACCES",
          });
        }
        configFiles[path] = content;
      }) as typeof fs.atomicWriteFile;

      await initAction(
        { installAgents: "cursor", json },
        {
          fileSystemService: fs,
          promptService: createMockPromptService(),
          execService: createMockExecService(),
          createLoginDeps: createAlreadyAuthLoginDeps(),
        },
      );

      expect(process.exitCode).toBe(1);
      expect(
        configFiles["/home/test/.agents/skills/githits-mcp/SKILL.md"],
      ).toBeDefined();
      if (json) {
        const payload = JSON.parse(getLogOutput()[0] ?? "{}");
        expect(payload.outcomes[0].status).toBe("failed");
        expect(payload.guidance.status).toBe("success");
        const reloadIndex = payload.instructions.findIndex(
          (instruction: string) =>
            instruction.includes("Open a new coding agent session"),
        );
        const fixIndex = payload.instructions.indexOf(
          "Fix installation errors before asking the user to sign in.",
        );
        expect(reloadIndex).toBeGreaterThanOrEqual(0);
        expect(fixIndex).toBeGreaterThan(reloadIndex);
        expect(JSON.stringify(payload)).not.toContain("githits@latest login");
        expect(JSON.stringify(payload.instructions)).not.toContain(
          "--detect-agents",
        );
        return;
      }

      const output = getLogOutput().join("\n");
      const reloadIndex = output.indexOf("Open a new coding agent session");
      const fixIndex = output.indexOf(
        "Fix installation errors before starting sign-in",
      );
      expect(reloadIndex).toBeGreaterThanOrEqual(0);
      expect(fixIndex).toBeGreaterThan(reloadIndex);
      expect(output).not.toContain("githits@latest login");
      expect(output).not.toContain("--detect-agents");
    },
  );

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
    // Trailing MCP server confirmation on the human text path names Cursor's
    // remote transport rather than the local stdio command.
    expect(
      logCalls.some(
        (msg) =>
          msg.includes('Configured MCP server "githits"') &&
          msg.includes("remote MCP at https://mcp.githits.com for Cursor"),
      ),
    ).toBe(true);
    expect(normalizeHumanOutput(logCalls)).toContain(
      "open the MCP panel and click Authenticate once for GitHits",
    );
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

  it("staged install adds supporting guidance by default", async () => {
    let codexConfigured = false;
    const fs = createFsWithDetection([]);
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
    }) as typeof fs.atomicWriteFile;
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp get githits --json") {
          return Promise.resolve({
            exitCode: 0,
            stdout: codexConfigured
              ? CODEX_CONFIGURED_OUTPUT
              : CODEX_MISSING_OUTPUT,
            stderr: "",
          });
        }
        if (key.startsWith("codex mcp add githits")) {
          codexConfigured = true;
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "codex-cli" },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(writes["/home/test/.agents/skills/githits-mcp/SKILL.md"]).toContain(
      "name: githits-mcp",
    );
    expect(writes["/home/test/.codex/AGENTS.md"]).toContain("<!-- githits -->");
    expect(writes["/home/test/.codex/AGENTS.md"]).toContain(
      "GitHits has been installed to the system",
    );
    expect(writes["/home/test/.codex/AGENTS.md"]).toContain(
      "Prefer default compact text tool output",
    );

    const logCalls = getLogOutput();
    const mcpSectionIndex = logCalls.findIndex((msg) => msg.trim() === "MCP");
    const skillsSectionIndex = logCalls.findIndex(
      (msg) => msg.trim() === "Skills",
    );
    const guidanceSectionIndex = logCalls.findIndex(
      (msg) => msg.trim() === "Agent guidance files",
    );
    expect(mcpSectionIndex).toBeGreaterThanOrEqual(0);
    expect(skillsSectionIndex).toBeGreaterThan(mcpSectionIndex);
    expect(guidanceSectionIndex).toBeGreaterThan(skillsSectionIndex);
    expect(
      logCalls.some((msg) =>
        msg.includes("~/.agents/skills/githits-mcp/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Codex CLI skill") &&
          msg.includes("~/.agents/skills/githits-mcp/SKILL.md"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Codex CLI guidance") &&
          msg.includes("~/.codex/AGENTS.md"),
      ),
    ).toBe(true);
  });

  it("fails before Codex add when an existing entry is disabled", async () => {
    const fs = createFsWithDetection([]);
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp get githits --json") {
          return Promise.resolve({
            exitCode: 0,
            stdout: JSON.stringify({ name: "githits", enabled: false }),
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      {
        installAgents: "codex-cli",
        json: true,
        guidance: false,
      },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.outcomes[0].status).toBe("failed");
    expect(payload.outcomes[0].message).toContain("disabled githits entry");
    expect(
      (execService.exec as ReturnType<typeof mock>).mock.calls.some(
        ([cmd, args]) =>
          cmd === "codex" &&
          (args as string[]).slice(0, 3).join(" ") === "mcp add githits",
      ),
    ).toBe(false);
  });

  it("blocks setup after an initial configuration probe failure", async () => {
    const fs = createFsWithDetection([]);
    const probeError = "probe-secret-output";
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp get githits --json") {
          return Promise.reject(new Error(probeError));
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      {
        installAgents: "codex-cli",
        json: true,
        guidance: false,
      },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.outcomes[0].status).toBe("failed");
    expect(payload.outcomes[0].message).toContain("configuration probe failed");
    expect(JSON.stringify(payload)).not.toContain(probeError);
    expect(
      (execService.exec as ReturnType<typeof mock>).mock.calls.some(
        ([cmd, args]) =>
          cmd === "codex" &&
          (args as string[]).slice(0, 3).join(" ") === "mcp add githits",
      ),
    ).toBe(false);
  });

  it("reports a failed post-setup Codex probe as inconclusive", async () => {
    const fs = createFsWithDetection([]);
    let checkCalls = 0;
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp get githits --json") {
          checkCalls += 1;
          if (checkCalls === 1) {
            return Promise.resolve({
              exitCode: 1,
              stdout: "",
              stderr: CODEX_MISSING_OUTPUT,
            });
          }
          return Promise.reject(new Error("probe failed"));
        }
        if (key.startsWith("codex mcp add githits")) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Added\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "codex-cli", json: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.outcomes[0].status).toBe("failed");
    expect(payload.outcomes[0].message).toContain("verification inconclusive");
    expect(payload.outcomes[0].message).not.toContain("not configured");
    expect(checkCalls).toBe(2);
  });

  it("staged install skips supporting guidance with --no-guidance", async () => {
    let codexConfigured = false;
    const fs = createFsWithDetection([]);
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
    }) as typeof fs.atomicWriteFile;
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp get githits --json") {
          return Promise.resolve({
            exitCode: codexConfigured ? 0 : 1,
            stdout: codexConfigured
              ? CODEX_CONFIGURED_OUTPUT
              : CODEX_MISSING_OUTPUT,
            stderr: "",
          });
        }
        if (key.startsWith("codex mcp add githits")) {
          codexConfigured = true;
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "codex-cli", guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(codexConfigured).toBe(true);
    expect(
      writes["/home/test/.agents/skills/githits-mcp/SKILL.md"],
    ).toBeUndefined();
    expect(writes["/home/test/.codex/AGENTS.md"]).toBeUndefined();
    expect(
      getLogOutput().some((msg) =>
        msg.includes("--detect-agents --no-guidance --json"),
      ),
    ).toBe(true);
  });

  it("staged guided install uses the shared skill path for Cline", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "cline", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    for (const skill of GITHITS_SKILL_CATALOG) {
      expect(
        writes[`/home/test/.agents/skills/${skill.name}/SKILL.md`],
      ).toContain(`name: ${skill.name}`);
    }
    expect(writes["/home/test/.cline/skills/githits-mcp/SKILL.md"]).toBe(
      undefined,
    );
    expect(
      getLogOutput().some(
        (msg) =>
          msg.includes("Cline skill") &&
          msg.includes("~/.agents/skills/githits-mcp/SKILL.md"),
      ),
    ).toBe(true);
    expect(getLogOutput().join("\n")).toContain(
      "GitHits skills in ~/.agents/skills/ are discovered by every compatible agent",
    );
    expect(getLogOutput().join("\n")).toContain(
      'Configured MCP server "githits": local stdio MCP command `npx -y githits@latest mcp start` for Cline',
    );
  });

  it("names local and remote transports for mixed staged MCP setup", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.cline"],
      configFiles,
    );
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "cursor,cline", guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const output = getLogOutput().join("\n");
    expect(output).toContain(
      'Configured MCP server "githits": local stdio MCP command `npx -y githits@latest mcp start` for Cline; remote MCP at https://mcp.githits.com for Cursor',
    );
  });

  it("repairs a missing subset of shared skills without MCP or auth", async () => {
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      "/home/test/.agents/skills/githits-mcp/SKILL.md": readCanonicalSkillFiles(
        "/home/test/.agents/skills",
      )["/home/test/.agents/skills/githits-mcp/SKILL.md"]!,
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    const writes: string[] = [];
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes.push(path);
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const createLoginDeps = createAlreadyAuthLoginDeps();

    await initAction(
      { installAgents: "cline", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(writes).toEqual(
      expect.arrayContaining([
        "/home/test/.agents/skills/githits-code/SKILL.md",
        "/home/test/.agents/skills/githits-onboarding/SKILL.md",
        "/home/test/.agents/skills/githits-package/SKILL.md",
      ]),
    );
    expect(writes).not.toContain(
      "/home/test/.cline/data/settings/cline_mcp_settings.json",
    );
  });

  it("keeps historical skills untouched when guidance is disabled", async () => {
    const legacyPath = "/home/test/.cline/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      [legacyPath]: "legacy Cline skill",
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    const deleteCalls: string[] = [];
    fs.deleteFile = mock(async (path: string) => {
      deleteCalls.push(path);
      delete configFiles[path];
    }) as typeof fs.deleteFile;

    await initAction(
      { detectAgents: true, guidance: false, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const detection = JSON.parse(getLogOutput()[0] ?? "{}");
    const cline = detection.agents.find(
      (entry: { id: string }) => entry.id === "cline",
    );
    expect(cline.status).toBe("already_configured");
    expect(cline.guidanceStatus).toBe("not_requested");
    expect(detection.actionableIds).toEqual([]);

    logSpy.mockClear();
    await initAction(
      { installAgents: "cline", guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(deleteCalls).toEqual([]);
    expect(configFiles[legacyPath]).toBe("legacy Cline skill");
  });

  it("treats a historical skill probe failure as actionable", async () => {
    const legacyPath = "/home/test/.cline/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    fs.exists = mock(async (path: string) => {
      if (path === legacyPath) throw new Error("legacy probe failure");
      return path in configFiles;
    }) as typeof fs.exists;

    await initAction(
      { detectAgents: true, guidance: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    const detection = JSON.parse(getLogOutput()[0] ?? "{}");
    const cline = detection.agents.find(
      (entry: { id: string }) => entry.id === "cline",
    );
    expect(cline.status).toBe("already_configured");
    expect(cline.guidanceStatus).toBe("needs_setup");
    expect(detection.actionableIds).toEqual(["cline"]);
  });

  it("migrates a complete Cline guidance set before removing its legacy skill", async () => {
    const legacyPath = "/home/test/.cline/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      [legacyPath]: "legacy Cline skill",
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    const deleteCalls: string[] = [];
    fs.deleteFile = mock(async (path: string) => {
      deleteCalls.push(path);
      delete configFiles[path];
    }) as typeof fs.deleteFile;
    const createLoginDeps = createAlreadyAuthLoginDeps();

    await initAction(
      { installAgents: "cline", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(deleteCalls).toEqual([legacyPath]);
    expect(configFiles[legacyPath]).toBeUndefined();
    for (const skill of GITHITS_SKILL_CATALOG) {
      expect(
        configFiles[`/home/test/.agents/skills/${skill.name}/SKILL.md`],
      ).toBe(
        readCanonicalSkillFiles("/home/test/.agents/skills")[
          `/home/test/.agents/skills/${skill.name}/SKILL.md`
        ],
      );
    }
    expect(
      getLogOutput().some(
        (msg) =>
          msg.includes("~/.cline/skills/githits-mcp/SKILL.md") &&
          msg.includes("removed"),
      ),
    ).toBe(true);
  });

  it("offers a Cline legacy cleanup as an interactive guidance repair", async () => {
    const legacyPath = "/home/test/.cline/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      [legacyPath]: "legacy Cline skill",
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    const deleteCalls: string[] = [];
    fs.deleteFile = mock(async (path: string) => {
      deleteCalls.push(path);
      delete configFiles[path];
    }) as typeof fs.deleteFile;
    const createLoginDeps = createAlreadyAuthLoginDeps();

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(deleteCalls).toEqual([legacyPath]);
    expect(getLogOutput().join("\n")).toContain("Guidance targets: Cline");
    expect(getLogOutput().join("\n")).toContain("removed");
  });

  it("preserves a Cline legacy skill when active guidance installation fails", async () => {
    const legacyPath = "/home/test/.cline/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      [legacyPath]: "legacy Cline skill",
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      if (path === "/home/test/.agents/skills/githits-code/SKILL.md") {
        throw new Error("active guidance write failed");
      }
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const deleteCalls: string[] = [];
    fs.deleteFile = mock(async (path: string) => {
      deleteCalls.push(path);
      delete configFiles[path];
    }) as typeof fs.deleteFile;

    await initAction(
      { installAgents: "cline", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(configFiles[legacyPath]).toBe("legacy Cline skill");
    expect(deleteCalls).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(getLogOutput().join("\n")).toContain("active guidance write failed");
  });

  it("keeps active guidance and reports a failed Cline legacy cleanup", async () => {
    const legacyPath = "/home/test/.cline/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      [legacyPath]: "legacy Cline skill",
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    fs.deleteFile = mock(async (path: string) => {
      if (path === legacyPath) throw new Error("legacy cleanup secret failure");
      delete configFiles[path];
    }) as typeof fs.deleteFile;

    await initAction(
      { installAgents: "cline", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(configFiles[legacyPath]).toBe("legacy Cline skill");
    for (const skill of GITHITS_SKILL_CATALOG) {
      expect(
        configFiles[`/home/test/.agents/skills/${skill.name}/SKILL.md`],
      ).toBe(
        readCanonicalSkillFiles("/home/test/.agents/skills")[
          `/home/test/.agents/skills/${skill.name}/SKILL.md`
        ],
      );
    }
    expect(process.exitCode).toBe(1);
    expect(getLogOutput().join("\n")).toContain(legacyPath);
    expect(getLogOutput().join("\n")).toContain("guidance cleanup failed");
    expect(getLogOutput().join("\n")).not.toContain(
      "legacy cleanup secret failure",
    );
  });

  it("converges a Cline cleanup-only migration to a no-op on rerun", async () => {
    const legacyPath = "/home/test/.cline/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      [legacyPath]: "legacy Cline skill",
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
    const deleteCalls: string[] = [];
    fs.deleteFile = mock(async (path: string) => {
      deleteCalls.push(path);
      delete configFiles[path];
    }) as typeof fs.deleteFile;
    const dependencies = {
      fileSystemService: fs,
      promptService: createMockPromptService(),
      execService: createMockExecService(),
      createLoginDeps: createAlreadyAuthLoginDeps(),
    };

    await initAction({ installAgents: "cline", guidance: true }, dependencies);
    expect(deleteCalls).toEqual([legacyPath]);
    const firstOutput = getLogOutput().join("\n");
    expect(firstOutput).toContain("removed");

    logSpy.mockClear();
    await initAction({ installAgents: "cline", guidance: true }, dependencies);

    expect(deleteCalls).toEqual([legacyPath]);
    expect(getLogOutput().join("\n")).toContain("already configured");
  });

  it("migrates Junie project guidance without removing another legacy root", async () => {
    const junieLegacyPath = "/repo/.junie/skills/githits-mcp/SKILL.md";
    const clineLegacyPath = "/repo/.cline/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/repo/.junie/mcp/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      ...readCanonicalSkillFiles("/repo/.agents/skills"),
      [junieLegacyPath]: "legacy Junie skill",
      [clineLegacyPath]: "legacy Cline skill",
    };
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.junie"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const deleteCalls: string[] = [];
    fs.deleteFile = mock(async (path: string) => {
      deleteCalls.push(path);
      delete configFiles[path];
    }) as typeof fs.deleteFile;
    const createLoginDeps = createAlreadyAuthLoginDeps();

    await initAction(
      { project: true, installAgents: "junie", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(deleteCalls).toEqual([junieLegacyPath]);
    expect(configFiles[junieLegacyPath]).toBeUndefined();
    expect(configFiles[clineLegacyPath]).toBe("legacy Cline skill");
  });

  it("staged guided install writes tool-native user guidance targets", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      [
        "/home/test/.config/Code",
        "/home/test/.codeium/windsurf",
        "/home/test/.kiro",
      ],
      configFiles,
    );
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "vscode,windsurf,kiro", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(
      writes[
        "/home/test/.copilot/instructions/githits.instructions.md"
      ]?.startsWith("---\nname: GitHits"),
    ).toBe(true);
    expect(
      writes["/home/test/.copilot/instructions/githits.instructions.md"],
    ).toContain('applyTo: "**"');
    expect(
      writes["/home/test/.codeium/windsurf/memories/global_rules.md"],
    ).toContain("<!-- githits -->");
    expect(writes["/home/test/.kiro/steering/AGENTS.md"]).toContain(
      "<!-- githits -->",
    );
    for (const skill of GITHITS_SKILL_CATALOG) {
      expect(
        writes[`/home/test/.agents/skills/${skill.name}/SKILL.md`],
      ).toContain(`name: ${skill.name}`);
      expect(
        writes[`/home/test/.kiro/skills/${skill.name}/SKILL.md`],
      ).toContain(`name: ${skill.name}`);
    }

    const logCalls = getLogOutput();
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("VS Code / Copilot guidance") &&
          msg.includes("~/.copilot/instructions/githits.instructions.md"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Windsurf guidance") &&
          msg.includes("~/.codeium/windsurf/memories/global_rules.md"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Kiro guidance") &&
          msg.includes("~/.kiro/steering/AGENTS.md"),
      ),
    ).toBe(true);
  });

  it("project guided install writes shared root AGENTS.md for project-aware tools", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.config/Code", "/home/test/.kiro"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      {
        project: true,
        installAgents: "cursor,vscode,kiro",
        guidance: true,
      },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(writes["/repo/AGENTS.md"]).toContain("<!-- githits -->");
    expect(
      getLogOutput().some(
        (msg) =>
          msg.includes("Shared agent guidance") && msg.includes("./AGENTS.md"),
      ),
    ).toBe(true);
    expect(getLogOutput().join("\n")).toContain(
      "GitHits skills in .agents/skills/ are discovered by every compatible agent",
    );
  });

  it("does not claim shared skill visibility for a native-only guidance root", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/home/test/.kiro"], configFiles);
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "kiro", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(getLogOutput().join("\n")).not.toContain(
      "GitHits skills in ~/.agents/skills/",
    );
  });

  it("staged guided install shows the Zed global AGENTS.md target", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/home/test/.config/zed"], configFiles);
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "zed", guidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(writes["/home/test/.config/zed/AGENTS.md"]).toContain(
      "<!-- githits -->",
    );
    expect(
      getLogOutput().some(
        (msg) =>
          msg.includes("Zed guidance") &&
          msg.includes("~/.config/zed/AGENTS.md"),
      ),
    ).toBe(true);
  });

  it("staged guided install skips filesystem guidance when no target is verified", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(
      ["/home/test/.config/Claude"],
      configFiles,
    );
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { installAgents: "claude-desktop", guidance: true, json: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(Object.keys(writes).some((path) => path.endsWith("/SKILL.md"))).toBe(
      false,
    );
    expect(
      Object.keys(writes).some((path) => path.endsWith("/CLAUDE.md")),
    ).toBe(false);
    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.guidance).toEqual({
      status: "skipped",
      message: "no selected tools need guidance",
    });
    expect(
      payload.instructions.some((instruction: string) =>
        instruction.includes("No verified guidance target exists"),
      ),
    ).toBe(true);
    expect(JSON.stringify(payload.instructions)).not.toContain(
      "rerun staged install without --no-guidance",
    );
  });

  it("reports a failed guidance write with actionable remediation", async () => {
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/home/test/.cursor"], configFiles);
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      if (path.endsWith("/SKILL.md")) {
        throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
      }
      configFiles[path] = content;
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
    expect(payload.outcomes[0].status).toBe("success");
    expect(payload.guidance.status).toBe("failed");
    expect(payload.guidance.message).toContain("Permission denied");
    expect(
      payload.instructions.some(
        (instruction: string) =>
          instruction.includes("Supporting instruction installation failed") &&
          instruction.includes("Permission denied") &&
          instruction.includes("before retrying"),
      ),
    ).toBe(true);
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
      { guidance: false },
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
      { guidance: false },
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
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection(["/home/test/.cursor"], configFiles);
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const promptService = createMockPromptService();

    await initAction(
      { guidance: false },
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
    expect(logCalls.some((msg) => msg.includes("3. Review and confirm"))).toBe(
      true,
    );
    expect(logCalls.some((msg) => msg.includes("4. Sign in"))).toBe(false);
    expect(logCalls.some((msg) => msg.includes("5. Install and verify"))).toBe(
      true,
    );
    const output = logCalls.join("\n");
    const installSectionIndex = output.indexOf("5. Install and verify");
    const configuredCountIndex = output.indexOf("1 tool configured.");
    const nextStepsIndex = output.indexOf("6. Next Steps");
    expect(configuredCountIndex).toBeGreaterThan(installSectionIndex);
    expect(nextStepsIndex).toBeGreaterThan(configuredCountIndex);
    const mcpSectionIndex = logCalls.findIndex((msg) => msg.trim() === "MCP");
    const cursorRowIndex = logCalls.findIndex(
      (msg) =>
        msg.includes("Cursor") &&
        msg.includes("created") &&
        msg.includes("~/.cursor/mcp.json"),
    );
    expect(mcpSectionIndex).toBeGreaterThanOrEqual(0);
    expect(logCalls.some((msg) => msg.trim() === "Skills")).toBe(false);
    expect(cursorRowIndex).toBeGreaterThan(mcpSectionIndex);
    expect(normalizeHumanOutput(logCalls)).toContain(
      "reloads MCP configuration and any supporting instructions",
    );
  });

  it("wraps narrow-terminal prose without changing commands or paths", async () => {
    const originalColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 40,
    });

    try {
      const configFiles: Record<string, string> = {};
      const fs = createFsWithDetection(["/home/test/.cline"], configFiles);
      const deps = {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      };

      await initAction({ guidance: false }, { ...deps, isInteractive: false });
      const introLines = getLogOutput();
      expect(introLines).toContain("  Your agent can only read your local");
      expect(introLines).toContain("  codebase.");
      expect(introLines).not.toContain("  codebas e.");

      logSpy.mockClear();
      await initAction({ installAgents: "cline", guidance: false }, deps);
      const stagedLines = getLogOutput();
      expect(
        stagedLines.some((line) =>
          line.includes("~/.cline/data/settings/cline_mcp_settings.json"),
        ),
      ).toBe(true);
      expect(stagedLines).toContain(
        "  After a successful --install-agents run, verify with npx -y githits@latest init --detect-agents --no-guidance --json instead of running init again.",
      );

      logSpy.mockClear();
      const cursorFs = createFsWithDetection(["/home/test/.cursor"]);
      await initAction(
        { guidance: false },
        {
          fileSystemService: cursorFs,
          promptService: createMockPromptService(),
          execService: createMockExecService(),
          createLoginDeps: createAlreadyAuthLoginDeps(),
        },
      );
      const cursorLines = getLogOutput();
      const cursorProseLines = cursorLines.filter(
        (line) =>
          line.includes("Cursor uses") ||
          line.includes("manages") ||
          line.includes("OAuth"),
      );
      expect(cursorProseLines.length).toBeGreaterThan(1);
      expect(cursorProseLines.every((line) => line.length <= 40)).toBe(true);
      expect(cursorLines).toContain("    cursor-agent mcp login GitHits");
      expect(cursorLines).toContain("    cursor-agent mcp list");
      expect(cursorLines).toContain("    cursor-agent mcp list-tools GitHits");
    } finally {
      Object.defineProperty(process.stdout, "columns", {
        configurable: true,
        value: originalColumns,
      });
    }
  });

  it("shows the install review before interactive setup confirmation", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const checkbox = mock((_message, choices) =>
      Promise.resolve([choices[0]!.value]),
    ) as PromptService["checkbox"];
    const confirm = mock((message: string) => {
      if (!message.includes("Continue with GitHits setup")) {
        return Promise.resolve(true);
      }
      const output = getLogOutput().join("\n");
      const normalizedOutput = output.replace(/\s+/g, " ");
      expect(
        normalizedOutput.includes("GitHits queries and public package"),
      ).toBe(true);
      expect(normalizedOutput.includes("is an outbound write")).toBe(true);
      expect(
        normalizedOutput.includes("does not itself upload the local workspace"),
      ).toBe(true);
      expect(normalizedOutput.includes("open a new coding agent session")).toBe(
        true,
      );
      expect(
        normalizedOutput.includes(
          "do not need to restart the terminal or machine",
        ),
      ).toBe(true);
      expect(normalizedOutput.includes("Scope: User")).toBe(true);
      expect(normalizedOutput.includes("MCP tools to configure: Cursor")).toBe(
        true,
      );
      expect(normalizedOutput.includes("Guidance targets: None")).toBe(true);
      expect(
        normalizedOutput.includes("Supporting instructions: Do not install"),
      ).toBe(true);
      return Promise.resolve(true);
    }) as PromptService["confirm"];

    await initAction(
      { guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService({ checkbox, confirm }),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(checkbox).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Continue with GitHits setup?", true);
  });

  it("shows only selected MCP transports in a mixed install review", async () => {
    const fs = createFsWithDetection([
      "/home/test/.cursor",
      "/home/test/.cline",
    ]);
    const checkbox = mock(
      (_message: string, choices: Array<{ value: string }>) =>
        Promise.resolve(choices.slice(0, 2).map((choice) => choice.value)),
    ) as PromptService["checkbox"];
    const confirm = mock((message: string) => {
      if (message.includes("Continue with GitHits setup")) {
        const output = getLogOutput().join("\n");
        expect(output).toContain(
          "MCP transport: local stdio MCP command `npx -y githits@latest mcp start` for Cline; remote MCP at https://mcp.githits.com for Cursor",
        );
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    }) as PromptService["confirm"];

    await initAction(
      { guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService({ checkbox, confirm }),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("shows no guidance target for a tool without a verified guidance surface", async () => {
    const fs = createFsWithDetection(["/home/test/.config/Claude"]);
    const confirm = mock((message: string) => {
      if (message.includes("Continue with GitHits setup")) {
        const output = getLogOutput().join("\n");
        expect(output).toContain("MCP tools to configure: Claude Desktop");
        expect(output).toContain("Guidance targets: None");
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    }) as PromptService["confirm"];

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService: createMockPromptService({ confirm }),
        execService: createMockExecService(),
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("lists only verified guidance targets in a mixed review", async () => {
    const fs = createFsWithDetection([
      "/home/test/.cursor",
      "/home/test/.config/Claude",
    ]);
    const confirm = mock((message: string) => {
      if (message.includes("Continue with GitHits setup")) {
        const guidanceLine = getLogOutput().find((line) =>
          line.includes("Guidance targets:"),
        );
        expect(guidanceLine).toContain("Cursor");
        expect(guidanceLine).not.toContain("Claude Desktop");
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    }) as PromptService["confirm"];

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService: createMockPromptService({ confirm }),
        execService: createMockExecService(),
        createLoginDeps: createUnauthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("cancels before authentication and writes when setup review is declined", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const createLoginDeps = createAlreadyAuthLoginDeps();
    const promptService = createMockPromptService({
      confirm: mock(() => Promise.resolve(false)),
    });

    await initAction(
      { guidance: false },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(getLogOutput().some((msg) => msg.includes("No changes made"))).toBe(
      true,
    );
  });

  it("cancels safely when setup review is interrupted", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"]);
    const createLoginDeps = createAlreadyAuthLoginDeps();
    const promptService = createMockPromptService({
      confirm: mock(() => Promise.reject(new ExitPromptError())),
    });

    await initAction(
      { guidance: false },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(getLogOutput().some((msg) => msg.includes("No changes made"))).toBe(
      true,
    );
  });

  it("skips already-configured agents without prompting", async () => {
    // Cursor detected AND already configured
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });
    const promptService = createMockPromptService();

    await initAction(
      { guidance: false },
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
    expectCursorRemoteNextSteps(logCalls);
    expect(
      logCalls.some((msg) => msg.includes("Open a new coding agent session")),
    ).toBe(false);
  });

  it("handles mixed status: configured + unconfigured", async () => {
    // Cursor configured, windsurf not configured
    const configFiles: Record<string, string> = {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
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
      { guidance: false },
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
    expect(
      logCalls.some((msg) => msg.includes("MCP tools to configure: Windsurf")),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("MCP tools to configure: Cursor")),
    ).toBe(false);
  });

  it("requires review before auth when plain MCP is already configured", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });
    const createLoginDeps = createUnauthLoginDeps();
    const promptService = createMockPromptService({
      confirm: mock(() => Promise.resolve(false)),
    });

    await initAction(
      { guidance: false },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    const output = getLogOutput().join("\n");
    expect(output).toContain("GitHits queries and public package");
    expect(output).toContain("MCP tools to configure: None");
    expect(output).toContain("Guidance targets: None");
    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("repairs selected guidance without MCP setup or authentication", async () => {
    const fs = createFsWithDetection(["/home/test/.cursor"], {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });
    const createLoginDeps = createAlreadyAuthLoginDeps();
    const promptService = createMockPromptService({
      checkbox: mock(
        async <T>(
          _message: string,
          choices: Array<{
            name: string;
            value: T;
            checked?: boolean;
            disabled?: boolean | string;
          }>,
        ) => {
          const repairChoice = choices.find((choice) =>
            String(choice.name).includes("guidance repair"),
          );
          expect(repairChoice?.checked).toBe(true);
          return [repairChoice!.value];
        },
      ) as PromptService["checkbox"],
      confirm: mock(() => Promise.resolve(true)),
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

    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalledWith(
      "/home/test/.cursor/mcp.json",
      expect.any(String),
    );
    const output = getLogOutput().join("\n");
    expect(output).toContain("MCP tools to configure: None");
    expect(output).toContain("Guidance targets: Cursor");
    expect(output).toContain("Cursor skill");
  });

  it("does not suggest local login after user-level guidance-only repair", async () => {
    const configFiles: Record<string, string> = {
      "/home/test/.config/opencode/opencode.json": JSON.stringify({
        mcp: {
          GitHits: {
            type: "local",
            command: ["npx", "-y", "githits@latest", "mcp", "start"],
            enabled: true,
          },
        },
      }),
    };
    const fs = createFsWithDetection(
      ["/home/test/.config/opencode"],
      configFiles,
    );
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const createLoginDeps = createAlreadyAuthLoginDeps();

    await initAction(
      {},
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps,
      },
    );

    const output = getLogOutput().join("\n");
    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(writes["/home/test/.config/opencode/AGENTS.md"]).toContain(
      "<!-- githits -->",
    );
    expect(output).toContain(
      "GitHits MCP was unchanged; supporting guidance was repaired.",
    );
    expect(output).toContain("Open a new coding agent session");
    expect(output).not.toContain("npx githits@latest login");
  });

  it("does not suggest local login after project-level guidance-only repair", async () => {
    const configFiles: Record<string, string> = {
      "/repo/opencode.json": JSON.stringify({
        mcp: {
          GitHits: {
            type: "local",
            command: ["npx", "-y", "githits@latest", "mcp", "start"],
            enabled: true,
          },
        },
      }),
    };
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.config/opencode"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const createLoginDeps = createAlreadyAuthLoginDeps();
    const promptService = createMockPromptService({
      select: mock(
        async <T>(
          message: string,
          choices: Array<{ value: T }>,
          defaultValue?: T,
        ) => {
          if (message.includes("Where should")) return "project" as T;
          return (defaultValue ?? choices[0]!.value) as T;
        },
      ) as PromptService["select"],
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

    const output = getLogOutput().join("\n");
    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(writes["/repo/AGENTS.md"]).toContain("<!-- githits -->");
    expect(output).toContain(
      "GitHits MCP was unchanged for this project; supporting guidance was repaired.",
    );
    expect(output).toContain("loads the project config");
    expect(output).not.toContain("npx githits@latest login");
  });

  it("does not retarget unselected guidance or Cursor during OpenCode setup", async () => {
    const configFiles: Record<string, string> = {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    };
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.config/opencode"],
      configFiles,
    );
    const writes: Record<string, string> = {};
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      writes[path] = content;
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} codex`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          });
        }
        if (key === "codex mcp get githits --json") {
          return Promise.resolve({
            exitCode: 0,
            stdout: CODEX_CONFIGURED_OUTPUT,
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });
    const promptService = createMockPromptService({
      checkbox: mock(
        async <T>(
          _message: string,
          choices: Array<{ name: string; value: T }>,
        ) =>
          choices
            .filter((choice) => String(choice.value) === "opencode")
            .map((choice) => choice.value),
      ) as PromptService["checkbox"],
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

    const output = getLogOutput().join("\n");
    expect(output).toContain("MCP tools to configure: OpenCode");
    expect(output).toContain("OpenCode guidance");
    expect(writes["/home/test/.config/opencode/AGENTS.md"]).toContain(
      "<!-- githits -->",
    );
    expect(writes["/home/test/.codex/AGENTS.md"]).toBeUndefined();
    expect(output).not.toContain("Codex CLI guidance");
    expect(output).not.toContain("cursor-agent mcp");
  });

  it("recomputes selection when project guidance repair is declined", async () => {
    const fs = createFsWithDetection(["/repo", "/home/test/.cursor"], {
      "/repo/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
    });
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const createLoginDeps = createAlreadyAuthLoginDeps();
    const promptService = createMockPromptService({
      select: mock(
        async <T>(
          message: string,
          choices: Array<{ value: T }>,
          defaultValue?: T,
        ) => {
          if (message.includes("Where should")) return "project" as T;
          return (defaultValue ?? choices[0]!.value) as T;
        },
      ) as PromptService["select"],
      confirm: mock(
        async (message: string) => !message.includes("Add project-level"),
      ),
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

    expect(createLoginDeps).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(getLogOutput().join("\n")).toContain(
      "Nothing selected, no changes made",
    );
  });

  it("shows already-configured rows when no new tools are selected", async () => {
    const fs = createFsWithDetection(
      ["/home/test/.cursor", "/home/test/.codeium/windsurf"],
      {
        "/home/test/.cursor/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              url: "https://mcp.githits.com",
            },
          },
        }),
      },
    );
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve([])) as PromptService["checkbox"],
    });

    await initAction(
      { guidance: false },
      {
        fileSystemService: fs,
        promptService,
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Nothing selected, no changes made")),
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
        (msg) => msg.includes("Windsurf") && msg.includes("created"),
      ),
    ).toBe(false);
    expect(logCalls.some((msg) => msg.includes("cursor-agent mcp"))).toBe(
      false,
    );
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
      { guidance: false },
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
      { guidance: false },
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
      directTools: true,
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
      { guidance: false },
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
            directTools: true,
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
      { guidance: false },
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
      [CLAUDE_USER_CONFIG_PATH]: CLAUDE_USER_CONFIG,
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      ...readCanonicalSkillFiles("/home/test/.claude/skills"),
      "/home/test/.claude/CLAUDE.md": [
        GITHITS_GUIDANCE_MARKER,
        GITHITS_GUIDANCE_BLOCK,
        GITHITS_GUIDANCE_MARKER,
      ].join("\n"),
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
    expectCursorRemoteNextSteps(logCalls);
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

    // Includes PATH lookups for all binary-detected agents plus Pi fallback probes.
    expect(execService.exec).toHaveBeenCalledTimes(21);
    expect(execService.exec).toHaveBeenCalledWith("claude", expect.any(Array));
  });

  it("replaces a non-canonical Claude user entry during setup", async () => {
    const configFiles: Record<string, string> = {
      [CLAUDE_USER_CONFIG_PATH]: CLAUDE_NON_CANONICAL_USER_CONFIG,
    };
    const fs = createFsWithDetection([], configFiles);
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (key === `${lookupCommandFor()} claude`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/claude\n",
            stderr: "",
          });
        }
        if (key === "claude mcp remove githits --scope user") {
          delete configFiles[CLAUDE_USER_CONFIG_PATH];
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        if (
          key ===
          "claude mcp add --transport stdio --scope user githits -- npx -y githits@latest mcp start"
        ) {
          configFiles[CLAUDE_USER_CONFIG_PATH] = CLAUDE_USER_CONFIG;
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        if (
          key === "claude plugin uninstall githits" ||
          key === "claude plugin marketplace remove githits-plugins"
        ) {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "claude-code", json: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.outcomes[0].status).toBe("success");
    const claudeCommands = (
      execService.exec as ReturnType<typeof mock>
    ).mock.calls
      .filter(([cmd]) => cmd === "claude")
      .map(([, args]) => (args as string[]).join(" "));
    expect(
      claudeCommands.indexOf("mcp remove githits --scope user"),
    ).toBeLessThan(
      claudeCommands.indexOf(
        "mcp add --transport stdio --scope user githits -- npx -y githits@latest mcp start",
      ),
    );
    expect(configFiles[CLAUDE_USER_CONFIG_PATH]).toBe(CLAUDE_USER_CONFIG);
    expect(claudeCommands.some((command) => command.includes("mcp get"))).toBe(
      false,
    );
  });

  it("blocks Claude setup for malformed user config without mutation", async () => {
    const secret = "claude-malformed-secret";
    const fs = createFsWithDetection([], {
      [CLAUDE_USER_CONFIG_PATH]: `{"mcpServers":{"githits":"${secret}"`,
    });
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        if (`${cmd} ${args.join(" ")}` === `${lookupCommandFor()} claude`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/claude\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "claude-code", json: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.outcomes[0].status).toBe("failed");
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(
      (execService.exec as ReturnType<typeof mock>).mock.calls.some(
        ([cmd]) => cmd === "claude",
      ),
    ).toBe(false);
  });

  it("blocks Claude setup for unreadable user config without mutation", async () => {
    const secret = "claude-permission-secret";
    const fs = createFsWithDetection([]);
    fs.readFile = mock(async (path: string) => {
      if (path === CLAUDE_USER_CONFIG_PATH) {
        throw Object.assign(new Error(secret), { code: "EACCES" });
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }) as typeof fs.readFile;
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        if (`${cmd} ${args.join(" ")}` === `${lookupCommandFor()} claude`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/claude\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "claude-code", json: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const payload = JSON.parse(getLogOutput()[0] ?? "{}");
    expect(payload.outcomes[0].status).toBe("failed");
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(
      (execService.exec as ReturnType<typeof mock>).mock.calls.some(
        ([cmd]) => cmd === "claude",
      ),
    ).toBe(false);
  });

  it("renders already configured CLI agents with check command details", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([], {
      [CLAUDE_USER_CONFIG_PATH]: CLAUDE_USER_CONFIG,
    });
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
        if (key === "codex mcp get githits --json") {
          return Promise.resolve({
            exitCode: 0,
            stdout: CODEX_CONFIGURED_OUTPUT,
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
    expect(claudeRow ?? "").toContain("checked via ~/.claude.json");
    expect(codexRow ?? "").toContain("unchanged");
    expect(codexRow ?? "").toContain(
      "checked via codex mcp get githits --json",
    );
    expect(claudeRow ?? "").not.toContain("mcp add");
    expect(codexRow ?? "").not.toContain("mcp add");
    expect(execService.exec).not.toHaveBeenCalledWith("claude", [
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "githits",
      "--",
      "npx",
      "-y",
      "githits@latest",
      "mcp",
      "start",
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
    expect(
      (execService.exec as ReturnType<typeof mock>).mock.calls.some(
        ([cmd, args]) => cmd === "claude" && (args as string[]).includes("get"),
      ),
    ).toBe(false);
  });

  it("renders only Claude Code commands that actually ran", async () => {
    const lookupCmd = lookupCommandFor();
    const configFiles: Record<string, string> = {};
    const fs = createFsWithDetection([], configFiles);
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
        if (
          key === "claude plugin uninstall githits" ||
          key === "claude plugin marketplace remove githits-plugins" ||
          key === "claude mcp remove githits --scope user"
        ) {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: key.includes("marketplace")
              ? "Marketplace githits-plugins was not found"
              : key.includes("uninstall")
                ? "Plugin githits was not found"
                : "MCP server githits was not found",
          });
        }
        if (
          key ===
          "claude mcp add --transport stdio --scope user githits -- npx -y githits@latest mcp start"
        ) {
          configFiles[CLAUDE_USER_CONFIG_PATH] = CLAUDE_USER_CONFIG;
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
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "githits",
      "--",
      "npx",
      "-y",
      "githits@latest",
      "mcp",
      "start",
    ]);
    expect(execService.exec).not.toHaveBeenCalledWith("claude", [
      "mcp",
      "remove",
      "githits",
      "--scope",
      "user",
    ]);
    const claudeRows = getLogOutput().filter(
      (msg) => msg.includes("Claude Code") && msg.includes("claude mcp"),
    );
    expect(claudeRows).toHaveLength(1);
    const claudeRow = claudeRows[0]!;
    expect(claudeRow).toContain(
      "claude mcp add --transport stdio --scope user githits",
    );
    expect(
      getLogOutput().some((msg) =>
        msg.includes('Configured MCP server "githits"'),
      ),
    ).toBe(true);
  });

  it("does not render cleanup no-ops as unchanged when Claude setup fails", async () => {
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
        if (key === "claude mcp remove githits --scope user") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: 'No MCP server named "githits" in user scope\n',
          });
        }
        if (key === "claude plugin uninstall githits") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "Plugin githits was not found\n",
          });
        }
        if (key === "claude plugin marketplace remove githits-plugins") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "Marketplace githits-plugins was not found\n",
          });
        }
        if (
          key ===
          "claude mcp add --transport stdio --scope user githits -- npx -y githits@latest mcp start"
        ) {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "add failed\n",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "" });
      }),
    });

    await initAction(
      { installAgents: "claude-code", guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const claudeRows = getLogOutput().filter((msg) =>
      msg.includes("Claude Code"),
    );
    expect(claudeRows.some((msg) => msg.includes("failed"))).toBe(true);
    expect(claudeRows.some((msg) => msg.includes("unchanged"))).toBe(false);
    expect(claudeRows.some((msg) => msg.includes("checked via"))).toBe(false);
  });

  it("does not render checked-via detail when a later CLI command runs", async () => {
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
        if (
          key === "claude plugin uninstall githits" ||
          key === "claude plugin marketplace remove githits-plugins" ||
          key === "claude mcp remove githits --scope user"
        ) {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: key.includes("marketplace")
              ? "Marketplace githits-plugins was not found"
              : key.includes("uninstall")
                ? "Plugin githits was not found"
                : "MCP server githits was not found",
          });
        }
        if (
          key ===
          "claude mcp add --transport stdio --scope user githits -- npx -y githits@latest mcp start"
        ) {
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
      logCalls.some((msg) => msg.includes("checked via ~/.claude.json")),
    ).toBe(false);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("Claude Code") &&
          msg.includes("ran") &&
          msg.includes("claude mcp add --transport stdio"),
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
      { yes: true, guidance: false },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    expect(promptService.checkbox).not.toHaveBeenCalled();
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(promptService.confirm).not.toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("GitHits queries and public package"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("is an outbound write"))).toBe(
      true,
    );
  });

  it("--yes with no agents detected prints message and returns", async () => {
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService();
    const execService = createMockExecService();

    await initAction(
      { yes: true, guidance: false },
      {
        fileSystemService: fs,
        promptService,
        execService,
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    // One PATH lookup is attempted for each binary-detected agent, plus Pi fallback probes.
    expect(execService.exec).toHaveBeenCalledTimes(17);
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
            url: "https://mcp.githits.com",
          },
        },
      }),
    });

    await initAction(
      { yes: true, guidance: false },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
        createLoginDeps: createAlreadyAuthLoginDeps(),
      },
    );

    const logCalls = getLogOutput();
    expectCursorRemoteNextSteps(logCalls);
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

  it("migrates legacy local Cursor stdio config to the remote MCP", async () => {
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
    const fs = createFsWithDetection(["/home/test/.cursor"], configFiles);
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initAction(
      { yes: true, guidance: false },
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
    expect(JSON.parse(written).mcpServers.GitHits).toEqual({
      url: "https://mcp.githits.com",
    });
    const logCalls = getLogOutput();
    expectCursorRemoteNextSteps(logCalls);
  });

  it("migrates non-@latest local Cursor config to the remote MCP", async () => {
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
      { yes: true, guidance: false },
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
      url: "https://mcp.githits.com",
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
      { yes: true, guidance: false },
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

  it("accepts Gemini already-exists output when the stdio MCP verifies", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService();
    let listCalls = 0;
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
        if (key === "gemini mcp list") {
          listCalls += 1;
          return Promise.resolve({
            exitCode: 0,
            stdout:
              listCalls > 1
                ? "githits: npx -y githits@latest mcp start (stdio)\n"
                : "",
            stderr: "",
          });
        }
        if (key === "gemini extensions uninstall githits") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: 'Extension "githits" is not installed.\n',
          });
        }
        if (key === "gemini mcp remove --scope user githits") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: 'MCP server "githits" was not found.\n',
          });
        }
        if (
          key ===
          "gemini mcp add --transport stdio --scope user githits npx -- -y githits@latest mcp start"
        ) {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: 'MCP server "githits" already exists.\n',
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

    expect(execService.exec).toHaveBeenCalledWith("gemini", [
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "githits",
      "npx",
      "--",
      "-y",
      "githits@latest",
      "mcp",
      "start",
    ]);
    expect(listCalls).toBe(2);
    const output = [...getLogOutput(), ...getErrorOutput()];
    expect(output.some((msg) => msg.includes("failed to configure"))).toBe(
      false,
    );
  });

  it("marks Gemini setup as failed when the stdio MCP is not present after setup", async () => {
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
        if (key === "gemini mcp list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "",
            stderr: "",
          });
        }
        if (key === "gemini extensions uninstall githits") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: 'Extension "githits" is not installed.\n',
          });
        }
        if (key === "gemini mcp remove --scope user githits") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: 'MCP server "githits" was not found.\n',
          });
        }
        if (
          key ===
          "gemini mcp add --transport stdio --scope user githits npx -- -y githits@latest mcp start"
        ) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Added MCP server.\n",
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

    const logCalls = [...getLogOutput(), ...getErrorOutput()];
    expect(
      logCalls.some((msg) =>
        msg.includes("verification failed: not configured after setup"),
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
    expect(
      logCalls.some((msg) => msg.includes("Nothing selected, no changes made")),
    ).toBe(true);
  });

  describe("login integration", () => {
    it("runs login flow and proceeds when already authenticated", async () => {
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
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
      expect(
        logCalls.some((msg) =>
          msg.includes("Already signed in (local CLI auth only)"),
        ),
      ).toBe(true);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("skips browser login when token resolution already refreshed auth", async () => {
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
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
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
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
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
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

    it("prints login URL instead of opening browser with --no-browser", async () => {
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
      const browserService = createMockBrowserService();
      const authService = createMockAuthService();
      const promptService = createMockPromptService({
        confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
      });
      const createLoginDeps = mock(() =>
        Promise.resolve({
          authService,
          authStorage: createMockAuthStorage(),
          browserService,
          mcpUrl: "https://mcp.githits.com",
        }),
      );

      await initAction(
        { browser: false, port: 8765 },
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
          createLoginDeps,
        },
      );

      const logCalls = getLogOutput();
      expect(browserService.open).not.toHaveBeenCalled();
      expect(authService.startCallbackServer).toHaveBeenCalledWith(
        8765,
        "test-state",
      );
      expect(
        logCalls.some((msg) => msg.includes("We'll print a sign-in URL")),
      ).toBe(true);
      expect(
        logCalls.some((msg) => msg.includes("Open this URL in your browser:")),
      ).toBe(true);
      expect(
        logCalls.some((msg) =>
          msg.includes("https://accounts.githits.com/oauth/authorize"),
        ),
      ).toBe(true);
      expect(
        logCalls.some((msg) =>
          msg.includes("ssh -N -L 8765:127.0.0.1:8765 user@remote-host"),
        ),
      ).toBe(true);
      expect(fs.atomicWriteFile).toHaveBeenCalled();
    });

    it("prompts to continue when login fails", async () => {
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
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
      const fs = createFsWithDetection(
        ["/home/test/.cursor", "/home/test/.codeium/windsurf"],
        configFiles,
      );
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
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
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
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
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
      const fs = createFsWithDetection([
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ]);
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
      const fs = createFsWithDetection(
        ["/home/test/.cursor", "/home/test/.codeium/windsurf"],
        configFiles,
      );
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
        msg.includes("githits uninstall --project --yes"),
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
            url: "https://mcp.githits.com",
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
            url: "https://mcp.githits.com",
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
      logCalls.some((msg) => msg.includes("githits uninstall --yes")),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("githits uninstall --project --yes")),
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
    const configFiles: Record<string, string> = {
      "/home/test/.cursor/mcp.json": currentConfig,
      "/home/test/.agents/skills/githits-mcp/SKILL.md": "skill",
    };
    const fs = createFsWithDetection(["/home/test/.cursor"], configFiles);
    (fs.readFile as ReturnType<typeof mock>).mockImplementation(
      async (path: string) => {
        if (path === "/home/test/.cursor/mcp.json") {
          return currentConfig;
        }
        if (path in configFiles) return configFiles[path]!;
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
    expect(logCalls.some((msg) => msg.includes("1 agent removed."))).toBe(true);
    expect(logCalls.some((msg) => msg.includes("2 agents removed."))).toBe(
      false,
    );
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("GitHits guidance") &&
          msg.includes("~/.agents/skills/githits-mcp/SKILL.md"),
      ),
    ).toBe(true);
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
            url: "https://mcp.githits.com",
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
    let removed = false;
    let checkCalls = 0;
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
        if (key === "codex mcp get githits --json") {
          checkCalls += 1;
          return Promise.resolve(
            removed
              ? { exitCode: 1, stdout: "", stderr: CODEX_MISSING_OUTPUT }
              : {
                  exitCode: 0,
                  stdout: CODEX_CONFIGURED_OUTPUT,
                  stderr: "",
                },
          );
        }
        if (key === "codex mcp remove githits") {
          removed = true;
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
    expect(checkCalls).toBe(2);
    expect(
      getLogOutput().some((msg) =>
        msg.includes("Uninstall completed with errors"),
      ),
    ).toBe(false);
  });

  it("removes disabled Codex entries without overwriting them", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    let removed = false;
    let checkCalls = 0;
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
        if (key === "codex mcp get githits --json") {
          checkCalls += 1;
          return Promise.resolve(
            removed
              ? { exitCode: 1, stdout: "", stderr: CODEX_MISSING_OUTPUT }
              : {
                  exitCode: 0,
                  stdout: JSON.stringify({
                    name: "githits",
                    enabled: false,
                    transport: {
                      type: "stdio",
                      command: "custom",
                      args: ["--pinned"],
                    },
                  }),
                  stderr: "",
                },
          );
        }
        if (key === "codex mcp remove githits") {
          removed = true;
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
    expect(checkCalls).toBe(2);
  });

  it("removes non-canonical Claude entries instead of reporting a probe failure", async () => {
    const lookupCmd = lookupCommandFor();
    const configFiles: Record<string, string> = {
      [CLAUDE_USER_CONFIG_PATH]: CLAUDE_NON_CANONICAL_USER_CONFIG,
    };
    const fs = createFsWithDetection([], configFiles);
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
        if (key === "claude mcp remove githits --scope user") {
          delete configFiles[CLAUDE_USER_CONFIG_PATH];
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        if (key === "claude plugin uninstall githits") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "Plugin githits was not found\n",
          });
        }
        if (key === "claude plugin marketplace remove githits-plugins") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "Marketplace githits-plugins was not found\n",
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
      "mcp",
      "remove",
      "githits",
      "--scope",
      "user",
    ]);
    expect(configFiles[CLAUDE_USER_CONFIG_PATH]).toBeUndefined();
    expect(
      (execService.exec as ReturnType<typeof mock>).mock.calls.some(
        ([cmd, args]) => cmd === "claude" && (args as string[]).includes("get"),
      ),
    ).toBe(false);
    expect(
      getLogOutput().some((msg) => msg.includes("Cannot inspect Claude Code")),
    ).toBe(false);
  });

  it("skips Claude uninstall when the user config is absent", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    const execService = createMockExecService({
      exec: mock((cmd: string, args: string[]) => {
        if (`${cmd} ${args.join(" ")}` === `${lookupCmd} claude`) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "/usr/bin/claude\n",
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

    expect(
      (execService.exec as ReturnType<typeof mock>).mock.calls.some(
        ([cmd]) => cmd === "claude",
      ),
    ).toBe(false);
    expect(
      getLogOutput().some(
        (msg) => msg.includes("Claude Code") && msg.includes("not configured"),
      ),
    ).toBe(true);
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
    const configFiles: Record<string, string> = {
      [CLAUDE_USER_CONFIG_PATH]: CLAUDE_USER_CONFIG,
    };
    const fs = createFsWithDetection([], configFiles);
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
        if (key === "claude mcp remove githits --scope user") {
          delete configFiles[CLAUDE_USER_CONFIG_PATH];
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        if (key === "claude plugin uninstall githits") {
          return Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr: "Plugin githits was not found\n",
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
    const configFiles: Record<string, string> = {
      [CLAUDE_USER_CONFIG_PATH]: CLAUDE_USER_CONFIG,
    };
    const fs = createFsWithDetection([], configFiles);
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
        if (key === "claude mcp remove githits --scope user") {
          delete configFiles[CLAUDE_USER_CONFIG_PATH];
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
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
      "mcp",
      "remove",
      "githits",
      "--scope",
      "user",
    ]);
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
      (msg) => msg.includes("Claude Code") && msg.includes("claude mcp remove"),
    );
    const pluginRow = getLogOutput().find((msg) =>
      msg.includes("claude plugin uninstall githits"),
    );
    const marketplaceRow = getLogOutput().find((msg) =>
      msg.includes("claude plugin marketplace remove githits-plugins"),
    );
    expect(uninstallRow).toBeDefined();
    expect(pluginRow).toBeDefined();
    expect(marketplaceRow).toBeDefined();
    expect(pluginRow).not.toContain("Claude Code");
    expect(marketplaceRow).not.toContain("Claude Code");
    expect(pluginRow?.indexOf("claude plugin uninstall")).toBe(
      uninstallRow?.indexOf("claude mcp remove"),
    );
    expect(marketplaceRow?.indexOf("claude plugin marketplace")).toBe(
      uninstallRow?.indexOf("claude mcp remove"),
    );
    expect(
      getLogOutput().some((msg) =>
        msg.includes("Uninstall completed with errors"),
      ),
    ).toBe(false);
    expect(
      getLogOutput().some((msg) =>
        msg.includes("GitHits MCP configuration was removed"),
      ),
    ).toBe(true);
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
        if (key === "codex mcp get githits --json") {
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

  it("reports a failed post-uninstall probe as inconclusive", async () => {
    const lookupCmd = lookupCommandFor();
    const fs = createFsWithDetection([]);
    let checkCalls = 0;
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
        if (key === "codex mcp get githits --json") {
          checkCalls += 1;
          if (checkCalls === 1) {
            return Promise.resolve({
              exitCode: 0,
              stdout: CODEX_CONFIGURED_OUTPUT,
              stderr: "",
            });
          }
          return Promise.reject(new Error("post-uninstall probe failed"));
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

    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("verification inconclusive")),
    ).toBe(true);
    expect(
      logCalls.some((msg) => msg.includes("still configured after uninstall")),
    ).toBe(false);
    expect(checkCalls).toBe(2);
  });

  it("does not use the legacy Gemini extension as an uninstall fallback", async () => {
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
        if (key === "gemini mcp list") {
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

    expect(execService.exec).not.toHaveBeenCalledWith("gemini", [
      "mcp",
      "remove",
      "--scope",
      "user",
      "githits",
    ]);
    expect(execService.exec).not.toHaveBeenCalledWith("gemini", [
      "extensions",
      "uninstall",
      "githits",
    ]);
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Cannot inspect Gemini CLI")),
    ).toBe(true);
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
        if (key === "gemini mcp list") {
          return Promise.reject(new Error("probe exploded"));
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

  it("reports an empty Gemini MCP list as not configured", async () => {
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
        if (key === "gemini mcp list") {
          return Promise.resolve({
            exitCode: 0,
            stdout: "",
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
    const fs = createFsWithDetection([], {
      [CLAUDE_USER_CONFIG_PATH]: CLAUDE_USER_CONFIG,
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
        if (key === "claude mcp remove githits --scope user") {
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
          msg.includes("claude mcp remove githits --scope user"),
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
        if (key === "codex mcp get githits --json") {
          return Promise.resolve({
            exitCode: 0,
            stdout: CODEX_CONFIGURED_OUTPUT,
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
        if (key === "codex mcp get githits --json") {
          return Promise.resolve({
            exitCode: 0,
            stdout: CODEX_CONFIGURED_OUTPUT,
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
          msg.includes("checked via codex mcp get githits --json"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes(
          "No GitHits MCP configurations were active. Nothing to uninstall.",
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
        if (key === "codex mcp get githits --json") {
          return Promise.resolve({
            exitCode: 0,
            stdout: CODEX_CONFIGURED_OUTPUT,
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
            url: "https://mcp.githits.com",
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

  it("removes GitHits guidance when uninstalling without MCP configs", async () => {
    const block = [
      "Existing",
      "",
      "<!-- githits -->",
      "old guidance",
      "<!-- githits -->",
      "",
    ].join("\n");
    const configFiles: Record<string, string> = {
      "/home/test/.agents/skills/githits-code/SKILL.md":
        "---\nname: githits-code\n---\n",
      "/home/test/.agents/skills/githits-mcp/SKILL.md":
        "---\nname: githits-mcp\n---\n",
      "/home/test/.agents/skills/githits-onboarding/SKILL.md":
        "---\nname: githits-onboarding\n---\n",
      "/home/test/.agents/skills/githits-package/SKILL.md":
        "---\nname: githits-package\n---\n",
      "/home/test/.cline/skills/githits-mcp/SKILL.md":
        "---\nname: githits-mcp\n---\n",
      "/home/test/.junie/skills/githits-mcp/SKILL.md":
        "---\nname: githits-mcp\n---\n",
      "/home/test/.codex/AGENTS.md": block,
    };
    const fs = createFsWithDetection([], configFiles);
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;
    fs.deleteFile = mock(async (path: string) => {
      delete configFiles[path];
    }) as typeof fs.deleteFile;

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/home/test/.agents/skills/githits-code/SKILL.md",
    );
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/home/test/.agents/skills/githits-mcp/SKILL.md",
    );
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/home/test/.agents/skills/githits-onboarding/SKILL.md",
    );
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/home/test/.agents/skills/githits-package/SKILL.md",
    );
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/home/test/.cline/skills/githits-mcp/SKILL.md",
    );
    expect(fs.deleteFile).toHaveBeenCalledWith(
      "/home/test/.junie/skills/githits-mcp/SKILL.md",
    );
    expect(configFiles["/home/test/.codex/AGENTS.md"]).toBe("Existing\n");
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) =>
        msg.includes("Done! GitHits guidance was removed."),
      ),
    ).toBe(true);
    expect(logCalls.join("\n")).not.toMatch(/\b\d+ agents? removed\./);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("~/.claude/skills/githits-code/SKILL.md") &&
          msg.includes("unchanged"),
      ),
    ).toBe(true);
  });

  it("preserves active and historical user guidance with --keep-guidance", async () => {
    const guidanceFiles = {
      ...readCanonicalSkillFiles("/home/test/.agents/skills"),
      "/home/test/.cline/skills/githits-mcp/SKILL.md": "legacy Cline skill",
      "/home/test/.junie/skills/githits-mcp/SKILL.md": "legacy Junie skill",
    };
    const configFiles: Record<string, string> = {
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      ),
      ...guidanceFiles,
    };
    const fs = createFsWithDetection(["/home/test/.cline"], configFiles);

    await initUninstallAction(
      { yes: true, keepGuidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    for (const [path, content] of Object.entries(guidanceFiles)) {
      expect(configFiles[path]).toBe(content);
    }
    expect(getLogOutput().some((msg) => msg.includes("GitHits guidance"))).toBe(
      false,
    );
  });

  it("preserves active and historical project guidance with --keep-guidance", async () => {
    const guidanceFiles = {
      ...readCanonicalSkillFiles("/repo/.agents/skills"),
      "/repo/.cline/skills/githits-mcp/SKILL.md": "legacy Cline skill",
      "/repo/.junie/skills/githits-mcp/SKILL.md": "legacy Junie skill",
    };
    const configFiles: Record<string, string> = {
      "/repo/.junie/mcp/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      ...guidanceFiles,
    };
    const fs = createFsWithDetection(["/home/test/.junie"], configFiles);
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;

    await initUninstallAction(
      { project: true, yes: true, keepGuidance: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    for (const [path, content] of Object.entries(guidanceFiles)) {
      expect(configFiles[path]).toBe(content);
    }
    expect(getLogOutput().some((msg) => msg.includes("GitHits guidance"))).toBe(
      false,
    );
  });

  it("removes both historical project skill roots during project uninstall", async () => {
    const clineLegacyPath = "/repo/.cline/skills/githits-mcp/SKILL.md";
    const junieLegacyPath = "/repo/.junie/skills/githits-mcp/SKILL.md";
    const configFiles: Record<string, string> = {
      "/repo/.junie/mcp/mcp.json": JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      ...readCanonicalSkillFiles("/repo/.agents/skills"),
      [clineLegacyPath]: "legacy Cline skill",
      [junieLegacyPath]: "legacy Junie skill",
    };
    const fs = createFsWithDetection(
      ["/repo", "/home/test/.junie"],
      configFiles,
    );
    fs.getCwd = mock(() => "/repo") as typeof fs.getCwd;
    const deleteCalls: string[] = [];
    fs.deleteFile = mock(async (path: string) => {
      deleteCalls.push(path);
      delete configFiles[path];
    }) as typeof fs.deleteFile;

    await initUninstallAction(
      { project: true, yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(deleteCalls).toEqual(
      expect.arrayContaining([clineLegacyPath, junieLegacyPath]),
    );
    expect(configFiles[clineLegacyPath]).toBeUndefined();
    expect(configFiles[junieLegacyPath]).toBeUndefined();
  });

  it("continues guidance cleanup after multiple target failures", async () => {
    const firstSkillPath = "/home/test/.claude/skills/githits-mcp/SKILL.md";
    const sharedSkillPath = "/home/test/.agents/skills/githits-mcp/SKILL.md";
    const laterSkillPath = "/home/test/.cline/skills/githits-mcp/SKILL.md";
    const managedBlockPath = "/home/test/.claude/CLAUDE.md";
    const configFiles: Record<string, string> = {
      [firstSkillPath]: "first skill",
      [sharedSkillPath]: "shared skill",
      [laterSkillPath]: "later skill",
      [managedBlockPath]: [
        "Existing",
        "",
        "<!-- githits -->",
        "old guidance",
        "<!-- githits -->",
        "",
      ].join("\n"),
    };
    const fs = createFsWithDetection([], configFiles);
    const deleteCalls: string[] = [];
    fs.deleteFile = mock(async (path: string) => {
      deleteCalls.push(path);
      if (path === firstSkillPath || path === sharedSkillPath) {
        throw new Error("guidance secret failure");
      }
      delete configFiles[path];
    }) as typeof fs.deleteFile;
    fs.atomicWriteFile = mock(async (path: string, content: string) => {
      configFiles[path] = content;
    }) as typeof fs.atomicWriteFile;

    await initUninstallAction(
      { yes: true },
      {
        fileSystemService: fs,
        promptService: createMockPromptService(),
        execService: createMockExecService(),
      },
    );

    expect(deleteCalls).toContain(firstSkillPath);
    expect(deleteCalls).toContain(sharedSkillPath);
    expect(deleteCalls).toContain(laterSkillPath);
    expect(configFiles[laterSkillPath]).toBeUndefined();
    expect(configFiles[managedBlockPath]).toBe("Existing\n");
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("Uninstall completed with errors")),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("~/.claude/skills/githits-mcp/SKILL.md") &&
          msg.includes("guidance cleanup failed"),
      ),
    ).toBe(true);
    expect(
      logCalls.some(
        (msg) =>
          msg.includes("~/.agents/skills/githits-mcp/SKILL.md") &&
          msg.includes("guidance cleanup failed"),
      ),
    ).toBe(true);
    expect(
      logCalls.some((msg) =>
        msg.includes("~/.cline/skills/githits-mcp/SKILL.md"),
      ),
    ).toBe(true);
    expect(logCalls.some((msg) => msg.includes("~/.claude/CLAUDE.md"))).toBe(
      true,
    );
    expect(
      logCalls.some((msg) => msg.includes("guidance secret failure")),
    ).toBe(false);
    expect(logCalls.join("\n")).not.toMatch(
      /\b\d+ agents? failed to uninstall\./,
    );
    expect(process.exitCode).toBe(1);
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
    const guidanceRows = logCalls.filter((msg) =>
      msg.includes("GitHits guidance"),
    );
    expect(guidanceRows).toHaveLength(1);
    expect(guidanceRows[0]).toContain("unchanged");
    expect(guidanceRows[0]).not.toContain("SKILL.md");
    expect(guidanceRows[0]).not.toContain("AGENTS.md");
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

  it("registers init, root uninstall, and nested uninstall commands", () => {
    const program = new Command();
    registerInitCommand(program);

    const initCommand = program.commands.find((cmd) => cmd.name() === "init");
    const rootUninstallCommand = program.commands.find(
      (cmd) => cmd.name() === "uninstall",
    );
    expect(initCommand).toBeDefined();
    expect(rootUninstallCommand).toBeDefined();
    expect(
      initCommand?.commands.some((cmd) => cmd.name() === "uninstall"),
    ).toBe(true);
    expect(program.helpInformation()).toContain("uninstall");
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
    expect(optionLongNames).toContain("--guidance");
    expect(optionLongNames).toContain("--no-guidance");
    expect(optionLongNames).toContain("--no-browser");
    expect(optionLongNames).toContain("--port");
  });

  it("registers identical root and nested uninstall options", () => {
    const program = new Command();
    registerInitCommand(program);

    const initCommand = program.commands.find((cmd) => cmd.name() === "init");
    const nestedUninstallCommand = initCommand?.commands.find(
      (cmd) => cmd.name() === "uninstall",
    );
    const rootUninstallCommand = program.commands.find(
      (cmd) => cmd.name() === "uninstall",
    );
    const describeOptions = (command: Command | undefined) =>
      command?.options.map((option) => ({
        flags: option.flags,
        description: option.description,
        required: option.required,
        optional: option.optional,
        defaultValue: option.defaultValue,
      }));

    expect(rootUninstallCommand?.summary()).toBe(
      nestedUninstallCommand?.summary(),
    );
    expect(rootUninstallCommand?.description()).toBe(
      nestedUninstallCommand?.description(),
    );
    expect(describeOptions(rootUninstallCommand)).toEqual(
      describeOptions(nestedUninstallCommand),
    );
  });

  it("routes root uninstall --project to project uninstall", async () => {
    await withNonInteractiveStdio(() =>
      parseRegisteredInit(["uninstall", "--project", "--yes"]),
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
    expect(errorCalls.some((msg) => msg.includes('githits uninstall"'))).toBe(
      true,
    );
    expect(errorCalls.some((msg) => msg.includes("--project"))).toBe(false);
  });

  it("suggests root uninstall for a close root command typo", async () => {
    await expect(parseRegisteredInit(["uninztall"])).rejects.toMatchObject({
      code: "commander.unknownCommand",
      message: expect.stringContaining("Did you mean uninstall?"),
    });
  });
});
