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
  createMockExecService,
  createMockFileSystemService,
  createMockPromptService,
} from "../../services/test-helpers.js";
import type { InitDependencies } from "./init.js";
import { initAction } from "./init.js";

/** Type-safe cast for checkbox mock overrides */
type CheckboxMock = PromptService["checkbox"];

/** Suppress console.log during tests */
let logSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

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
    ...overrides,
  };
}

/** Create a FileSystemService mock that detects specific agents */
function createFsWithDetection(detectedDirs: string[]) {
  return createMockFileSystemService({
    getHomeDir: mock(() => "/home/test"),
    joinPath: mock((...segments: string[]) => segments.join("/")),
    isDirectory: mock(async (path: string) => detectedDirs.includes(path)),
    getDirname: mock(
      (path: string) => path.split("/").slice(0, -1).join("/") || "/",
    ),
    ensureDir: mock(() => Promise.resolve()),
    readFile: mock(() =>
      Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
    ),
    atomicWriteFile: mock(() => Promise.resolve()),
  });
}

/** Helper to extract log output as string array */
function getLogOutput(): string[] {
  return (logSpy.mock.calls as unknown[][]).map((c) => String(c[0] ?? ""));
}

describe("initAction", () => {
  it("detects agents, prompts, and configures selected ones", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve(["claude-code"])) as CheckboxMock,
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
      ),
    });

    await initAction({}, { fileSystemService: fs, promptService, execService });

    expect(promptService.checkbox).toHaveBeenCalled();
    expect(promptService.confirm3).toHaveBeenCalled();
    expect(execService.exec).toHaveBeenCalledWith("claude", expect.any(Array));
  });

  it("only sets up selected agents, not all detected", async () => {
    const fs = createFsWithDetection([
      "/home/test/.claude",
      "/home/test/.cursor",
    ]);
    // User selects only cursor, not claude-code
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve(["cursor"])) as CheckboxMock,
      confirm3: mock(() => Promise.resolve("yes" as ConfirmChoice)),
    });
    const execService = createMockExecService();

    await initAction({}, { fileSystemService: fs, promptService, execService });

    // exec should NOT be called (cursor uses config-file, not CLI)
    expect(execService.exec).not.toHaveBeenCalled();
    // atomicWriteFile should be called for cursor config
    expect(fs.atomicWriteFile).toHaveBeenCalled();
  });

  it("stops prompting after 'always' response", async () => {
    const fs = createFsWithDetection([
      "/home/test/.claude",
      "/home/test/.cursor",
    ]);
    const confirm3 = mock(() => Promise.resolve("always" as ConfirmChoice));
    const promptService = createMockPromptService({
      checkbox: mock(() =>
        Promise.resolve(["claude-code", "cursor"]),
      ) as CheckboxMock,
      confirm3,
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
      ),
    });

    await initAction({}, { fileSystemService: fs, promptService, execService });

    // confirm3 should be called only once (for first agent, then "always" kicks in)
    expect(confirm3).toHaveBeenCalledTimes(1);
  });

  it("skips agent when user responds 'no'", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve(["claude-code"])) as CheckboxMock,
      confirm3: mock(() => Promise.resolve("no" as ConfirmChoice)),
    });
    const execService = createMockExecService();

    await initAction({}, { fileSystemService: fs, promptService, execService });

    // exec should NOT be called because user said no
    expect(execService.exec).not.toHaveBeenCalled();
  });

  it("--yes flag skips all prompts and configures all detected agents", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService();
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
      ),
    });

    await initAction(
      { yes: true },
      { fileSystemService: fs, promptService, execService },
    );

    expect(promptService.checkbox).not.toHaveBeenCalled();
    expect(promptService.confirm3).not.toHaveBeenCalled();
    expect(execService.exec).toHaveBeenCalled();
  });

  it("--yes with no agents detected prints message and returns", async () => {
    const fs = createFsWithDetection([]);
    const promptService = createMockPromptService();
    const execService = createMockExecService();

    await initAction(
      { yes: true },
      { fileSystemService: fs, promptService, execService },
    );

    expect(promptService.checkbox).not.toHaveBeenCalled();
    expect(execService.exec).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(
      logCalls.some((msg) => msg.includes("No coding agents detected")),
    ).toBe(true);
  });

  it("continues to next agent when one fails", async () => {
    const fs = createFsWithDetection([
      "/home/test/.claude",
      "/home/test/.cursor",
    ]);
    // Claude exec will fail, cursor config write should still happen
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 1, stdout: "", stderr: "error" }),
      ),
    });
    const promptService = createMockPromptService({
      checkbox: mock(() =>
        Promise.resolve(["claude-code", "cursor"]),
      ) as CheckboxMock,
      confirm3: mock(() => Promise.resolve("always" as ConfirmChoice)),
    });

    await initAction({}, { fileSystemService: fs, promptService, execService });

    // Both should be attempted: exec for claude, atomicWriteFile for cursor
    expect(execService.exec).toHaveBeenCalled();
    expect(fs.atomicWriteFile).toHaveBeenCalled();
  });

  it("handles all agents already configured", async () => {
    // Cursor config already has GitHits
    const existing = JSON.stringify({
      mcpServers: { GitHits: { command: "old" } },
    });
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
      isDirectory: mock(async (path: string) => path === "/home/test/.cursor"),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      readFile: mock(() => Promise.resolve(existing)),
      atomicWriteFile: mock(() => Promise.resolve()),
    });
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve(["cursor"])) as CheckboxMock,
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

    // Should not write (already configured)
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
    // Should mention "already configured" in output
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("already configured"))).toBe(
      true,
    );
  });

  it("handles empty selection gracefully", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve([])) as CheckboxMock,
    });
    const execService = createMockExecService();

    await initAction({}, { fileSystemService: fs, promptService, execService });

    expect(execService.exec).not.toHaveBeenCalled();
    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("No agents selected"))).toBe(
      true,
    );
  });

  it("handles Ctrl+C on checkbox prompt gracefully", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      checkbox: mock(() =>
        Promise.reject(new ExitPromptError("User force closed")),
      ) as CheckboxMock,
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
    expect(logCalls.some((msg) => msg.includes("cancelled"))).toBe(true);
  });

  it("handles Ctrl+C on confirm3 prompt gracefully", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve(["claude-code"])) as CheckboxMock,
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
      },
    );

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("cancelled"))).toBe(true);
  });

  it("rethrows non-ExitPromptError from checkbox", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      checkbox: mock(() =>
        Promise.reject(new Error("Unexpected error")),
      ) as CheckboxMock,
    });

    await expect(
      initAction(
        {},
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
        },
      ),
    ).rejects.toThrow("Unexpected error");
  });

  it("rethrows non-ExitPromptError from confirm3", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve(["claude-code"])) as CheckboxMock,
      confirm3: mock(() => Promise.reject(new Error("Unexpected error"))),
    });

    await expect(
      initAction(
        {},
        {
          fileSystemService: fs,
          promptService,
          execService: createMockExecService(),
        },
      ),
    ).rejects.toThrow("Unexpected error");
  });

  it("shows 'Setup skipped' when all agents are skipped", async () => {
    const fs = createFsWithDetection(["/home/test/.claude"]);
    const promptService = createMockPromptService({
      checkbox: mock(() => Promise.resolve(["claude-code"])) as CheckboxMock,
      confirm3: mock(() => Promise.resolve("no" as ConfirmChoice)),
    });
    const execService = createMockExecService();

    await initAction({}, { fileSystemService: fs, promptService, execService });

    const logCalls = getLogOutput();
    expect(logCalls.some((msg) => msg.includes("Setup skipped"))).toBe(true);
  });
});
