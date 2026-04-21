import { describe, expect, it, mock } from "bun:test";
import {
  createMockExecService,
  createMockFileSystemService,
} from "../../services/test-helpers.js";
import type { CliSetup, ConfigFileSetup } from "./agent-definitions.js";
import type { CliCheckCommand, MergeResult } from "./setup-handlers.js";
import {
  executeCliSetup,
  executeConfigFileSetup,
  formatSetupPreview,
  getCliCheckStatus,
  isAlreadyConfigured,
  isCliAlreadyConfigured,
  mergeServerConfig,
} from "./setup-handlers.js";

/** Assert that a MergeResult is "added" and return its content */
function expectAdded(result: MergeResult): string {
  expect(result.status).toBe("added");
  if (result.status !== "added") throw new Error("unreachable");
  return result.content;
}

/** Assert that a MergeResult is "parse_error" and return its error */
function expectParseError(result: MergeResult): string {
  expect(result.status).toBe("parse_error");
  if (result.status !== "parse_error") throw new Error("unreachable");
  return result.error;
}

// -- isAlreadyConfigured (read-only check) --

describe("isAlreadyConfigured", () => {
  const configSetup: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.cursor/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: { url: "https://mcp.githits.com/" },
  };

  it("returns true when config file contains the server entry", async () => {
    const existing = JSON.stringify({
      mcpServers: { GitHits: { url: "https://mcp.githits.com/" } },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(true);
  });

  it("returns false when config file exists but server entry is missing", async () => {
    const existing = JSON.stringify({ mcpServers: { Other: {} } });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns false when config file does not exist", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns false when config file has malformed JSON", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve("{invalid json")),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns false when serversKey is missing", async () => {
    const existing = JSON.stringify({ otherKey: {} });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("works with 'servers' key for VS Code config", async () => {
    const vscodeSetup: ConfigFileSetup = {
      method: "config-file",
      configPath: "/home/test/.vscode/mcp.json",
      serversKey: "servers",
      serverName: "GitHits",
      serverConfig: { url: "https://mcp.githits.com/", type: "http" },
    };
    const existing = JSON.stringify({
      servers: { GitHits: { url: "https://mcp.githits.com/", type: "http" } },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(vscodeSetup, fs)).toBe(true);
  });

  it("returns false on empty file", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve("")),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("handles BOM prefix", async () => {
    const bom = "\uFEFF";
    const existing = `${bom}${JSON.stringify({ mcpServers: { GitHits: {} } })}`;
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(true);
  });
});

// -- isCliAlreadyConfigured (read-only CLI check) --

describe("isCliAlreadyConfigured", () => {
  const check: CliCheckCommand = {
    command: "claude",
    args: ["plugin", "list"],
    configuredPattern: /githits/i,
  };

  it("returns true when pattern matches stdout", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "githits-plugin\nother-plugin\n",
          stderr: "",
        }),
      ),
    });
    expect(await isCliAlreadyConfigured(check, execService)).toBe(true);
  });

  it("returns true when pattern matches stderr", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "GitHits is installed",
        }),
      ),
    });
    expect(await isCliAlreadyConfigured(check, execService)).toBe(true);
  });

  it("returns false when pattern does not match output", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "other-plugin\n", stderr: "" }),
      ),
    });
    expect(await isCliAlreadyConfigured(check, execService)).toBe(false);
  });

  it("returns false when command not found (ENOENT)", async () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    const execService = createMockExecService({
      exec: mock(() => Promise.reject(enoent)),
    });
    expect(await isCliAlreadyConfigured(check, execService)).toBe(false);
  });

  it("returns false on non-zero exit code with no pattern match", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 1, stdout: "", stderr: "error occurred" }),
      ),
    });
    expect(await isCliAlreadyConfigured(check, execService)).toBe(false);
  });

  it("returns true on non-zero exit code when pattern matches", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "GitHits already installed",
        }),
      ),
    });
    expect(await isCliAlreadyConfigured(check, execService)).toBe(true);
  });

  it("supports negative-only checks via notConfiguredPattern", async () => {
    const negativeOnlyCheck: CliCheckCommand = {
      command: "gemini",
      args: ["extensions", "config", "githits"],
      notConfiguredPattern: /not installed/i,
      requireExitCodeZero: true,
    };

    const installedExec = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
        }),
      ),
    });
    expect(await isCliAlreadyConfigured(negativeOnlyCheck, installedExec)).toBe(
      true,
    );

    const missingExec = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: 'Extension "githits" is not installed.\n',
        }),
      ),
    });
    expect(await isCliAlreadyConfigured(negativeOnlyCheck, missingExec)).toBe(
      false,
    );
  });

  it("returns false for negative-only checks when requireExitCodeZero is set and command fails", async () => {
    const negativeOnlyCheck: CliCheckCommand = {
      command: "gemini",
      args: ["extensions", "config", "githits"],
      notConfiguredPattern: /not installed/i,
      requireExitCodeZero: true,
    };
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "",
        }),
      ),
    });
    expect(await isCliAlreadyConfigured(negativeOnlyCheck, execService)).toBe(
      false,
    );
  });
});

describe("getCliCheckStatus", () => {
  it("returns not_configured when notConfiguredPattern matches", async () => {
    const check: CliCheckCommand = {
      command: "gemini",
      args: ["extensions", "config", "githits"],
      notConfiguredPattern: /not installed/i,
      requireExitCodeZero: true,
    };
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: 'Extension "githits" is not installed.\n',
        }),
      ),
    });
    expect(await getCliCheckStatus(check, execService)).toBe("not_configured");
  });

  it("returns probe_failed when requireExitCodeZero is set and command fails", async () => {
    const check: CliCheckCommand = {
      command: "gemini",
      args: ["extensions", "config", "githits"],
      notConfiguredPattern: /not installed/i,
      requireExitCodeZero: true,
    };
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "",
        }),
      ),
    });
    expect(await getCliCheckStatus(check, execService)).toBe("probe_failed");
  });
});

// -- mergeServerConfig (pure function) --

describe("mergeServerConfig", () => {
  const serverConfig = {
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.githits.com"],
  };

  it("adds server to empty string input", () => {
    const result = mergeServerConfig("", "mcpServers", "GitHits", serverConfig);
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("adds server to whitespace-only content", () => {
    const result = mergeServerConfig(
      "   \n  ",
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("adds server to empty object", () => {
    const result = mergeServerConfig(
      "{}",
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("preserves existing servers", () => {
    const existing = JSON.stringify({
      mcpServers: {
        other: { command: "other-cmd" },
      },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.other).toEqual({ command: "other-cmd" });
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("preserves other top-level keys", () => {
    const existing = JSON.stringify({
      someOtherSetting: true,
      mcpServers: {},
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.someOtherSetting).toBe(true);
  });

  it("returns already_configured when server exists", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: { command: "old-cmd" },
      },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    expect(result.status).toBe("already_configured");
  });

  it("returns parse_error for malformed JSON", () => {
    const result = mergeServerConfig(
      "{invalid json",
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const error = expectParseError(result);
    expect(error).toContain("Invalid JSON");
  });

  it("returns parse_error when root is not an object", () => {
    const result = mergeServerConfig(
      "[1,2,3]",
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const error = expectParseError(result);
    expect(error).toContain("not a JSON object");
  });

  it("returns parse_error when serversKey is not an object", () => {
    const result = mergeServerConfig(
      '{"mcpServers": "not-an-object"}',
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const error = expectParseError(result);
    expect(error).toContain("not a JSON object");
  });

  it("strips BOM prefix before parsing", () => {
    const bom = "\uFEFF";
    const existing = `${bom}{"mcpServers": {}}`;
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("creates serversKey if it does not exist", () => {
    const existing = '{"otherKey": 42}';
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.otherKey).toBe(42);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("outputs 2-space indentation with trailing newline", () => {
    const result = mergeServerConfig(
      "{}",
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    expect(content).toMatch(/^{\n {2}/); // starts with 2-space indent
    expect(content).toEndWith("}\n"); // trailing newline
  });

  it("handles deeply nested existing config", () => {
    const existing = JSON.stringify({
      mcpServers: {},
      settings: { nested: { deep: { value: true } } },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.settings.nested.deep.value).toBe(true);
  });

  it("works with 'servers' key for VS Code config", () => {
    const vscodeConfig = { url: "https://mcp.githits.com", type: "http" };
    const result = mergeServerConfig("{}", "servers", "GitHits", vscodeConfig);
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.servers.GitHits).toEqual(vscodeConfig);
  });
});

// -- formatSetupPreview --

describe("formatSetupPreview", () => {
  it("formats single-step CLI setup as a command", () => {
    const setup: CliSetup = {
      method: "cli",
      commands: [{ command: "codex", args: ["mcp", "add", "githits"] }],
    };
    const preview = formatSetupPreview(setup);
    expect(preview).toBe("Will run: codex mcp add githits");
  });

  it("formats multi-step CLI setup as multiple lines", () => {
    const setup: CliSetup = {
      method: "cli",
      commands: [
        {
          command: "claude",
          args: ["plugin", "marketplace", "add", "githits-com/githits-cli"],
        },
        {
          command: "claude",
          args: ["plugin", "install", "githits@githits-plugins"],
        },
      ],
    };
    const preview = formatSetupPreview(setup);
    expect(preview).toContain(
      "Will run: claude plugin marketplace add githits-com/githits-cli",
    );
    expect(preview).toContain(
      "Will run: claude plugin install githits@githits-plugins",
    );
    expect(preview.split("\n")).toHaveLength(2);
  });

  it("formats config file setup with path and JSON snippet", () => {
    const setup: ConfigFileSetup = {
      method: "config-file",
      configPath: "/home/test/.cursor/mcp.json",
      serversKey: "mcpServers",
      serverName: "GitHits",
      serverConfig: { url: "https://mcp.githits.com/" },
    };
    const preview = formatSetupPreview(setup);
    expect(preview).toContain("Will add to /home/test/.cursor/mcp.json:");
    expect(preview).toContain('"GitHits"');
    expect(preview).toContain('"url"');
  });
});

// -- executeCliSetup --

describe("executeCliSetup", () => {
  const singleStepSetup: CliSetup = {
    method: "cli",
    commands: [{ command: "codex", args: ["mcp", "add", "githits"] }],
  };

  const multiStepSetup: CliSetup = {
    method: "cli",
    commands: [
      {
        command: "claude",
        args: ["plugin", "marketplace", "add", "githits-com/githits-cli"],
      },
      {
        command: "claude",
        args: ["plugin", "install", "githits@githits-plugins"],
      },
    ],
  };

  it("returns success on exit code 0 for single-step", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "Added.\n", stderr: "" }),
      ),
    });
    const result = await executeCliSetup(singleStepSetup, execService);
    expect(result.status).toBe("success");
    expect(execService.exec).toHaveBeenCalledWith("codex", [
      "mcp",
      "add",
      "githits",
    ]);
  });

  it("returns success when all multi-step commands succeed", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "OK\n", stderr: "" }),
      ),
    });
    const result = await executeCliSetup(multiStepSetup, execService);
    expect(result.status).toBe("success");
    expect(execService.exec).toHaveBeenCalledTimes(2);
  });

  it("returns failed with stderr on non-zero exit", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "Unknown command\n",
        }),
      ),
    });
    const result = await executeCliSetup(singleStepSetup, execService);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("code 1");
    expect(result.message).toContain("Unknown command");
  });

  it("returns failed with CLI not found on ENOENT", async () => {
    const enoent = Object.assign(new Error("spawn ENOENT"), {
      code: "ENOENT",
    });
    const execService = createMockExecService({
      exec: mock(() => Promise.reject(enoent)),
    });
    const result = await executeCliSetup(singleStepSetup, execService);
    expect(result.status).toBe("failed");
    expect(result.message).toContain('"codex" not found on PATH');
  });

  it("returns failed with message on other errors", async () => {
    const execService = createMockExecService({
      exec: mock(() => Promise.reject(new Error("Unexpected error"))),
    });
    const result = await executeCliSetup(singleStepSetup, execService);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Unexpected error");
  });

  it("detects already-exists on non-zero exit", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "MCP server GitHits already exists in user config\n",
        }),
      ),
    });
    const result = await executeCliSetup(singleStepSetup, execService);
    expect(result.status).toBe("already_configured");
  });

  it("detects already-exists on zero exit (codex pattern)", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "Server GitHits already added\n",
          stderr: "",
        }),
      ),
    });
    const result = await executeCliSetup(singleStepSetup, execService);
    expect(result.status).toBe("already_configured");
  });

  it("detects already-installed on non-zero exit (gemini pattern)", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr:
            'Extension "githits" is already installed. Please uninstall it first.\n',
        }),
      ),
    });
    const result = await executeCliSetup(singleStepSetup, execService);
    expect(result.status).toBe("already_configured");
  });

  it("stops on first failure in multi-step setup", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "command not found\n",
        }),
      ),
    });
    const result = await executeCliSetup(multiStepSetup, execService);
    expect(result.status).toBe("failed");
    // Only the first command should have been attempted
    expect(execService.exec).toHaveBeenCalledTimes(1);
  });

  it("returns already_configured when any step reports it", async () => {
    let callCount = 0;
    const execService = createMockExecService({
      exec: mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "already exists\n",
            stderr: "",
          });
        }
        return Promise.resolve({
          exitCode: 0,
          stdout: "OK\n",
          stderr: "",
        });
      }),
    });
    const result = await executeCliSetup(multiStepSetup, execService);
    expect(result.status).toBe("already_configured");
    // Both commands should still run
    expect(execService.exec).toHaveBeenCalledTimes(2);
  });
});

// -- executeConfigFileSetup --

describe("executeConfigFileSetup", () => {
  const configSetup: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.cursor/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: { url: "https://mcp.githits.com/" },
  };

  it("creates new config when file does not exist", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const atomicWrite = mock(
      (_path: string, _content: string) => Promise.resolve() as Promise<void>,
    );
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.status).toBe("success");
    expect(atomicWrite).toHaveBeenCalled();
    // Verify the written content is valid JSON with the server entry
    const writtenContent = atomicWrite.mock.calls[0]![1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcpServers.GitHits).toEqual(configSetup.serverConfig);
  });

  it("merges into existing config preserving other entries", async () => {
    const existing = JSON.stringify({
      mcpServers: { other: { command: "other" } },
    });
    const atomicWrite = mock(
      (_path: string, _content: string) => Promise.resolve() as Promise<void>,
    );
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.status).toBe("success");
    const writtenContent = atomicWrite.mock.calls[0]![1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
    expect(parsed.mcpServers.GitHits).toEqual(configSetup.serverConfig);
  });

  it("returns already_configured when GitHits already present", async () => {
    const existing = JSON.stringify({
      mcpServers: { GitHits: { command: "old" } },
    });
    const atomicWrite = mock(() => Promise.resolve());
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.status).toBe("already_configured");
    expect(atomicWrite).not.toHaveBeenCalled();
  });

  it("returns failed on malformed JSON without writing", async () => {
    const atomicWrite = mock(() => Promise.resolve());
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve("{invalid")),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Cannot parse");
    expect(atomicWrite).not.toHaveBeenCalled();
  });

  it("ensures parent directory exists before writing", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const ensureDir = mock(() => Promise.resolve());
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir,
      atomicWriteFile: mock(() => Promise.resolve()),
    });

    await executeConfigFileSetup(configSetup, fs);
    expect(ensureDir).toHaveBeenCalledWith("/home/test/.cursor");
  });

  it("returns failed on permission denied", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const eacces = Object.assign(new Error("Permission denied"), {
      code: "EACCES",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: mock(() => Promise.reject(eacces)),
    });

    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Permission denied");
  });

  it("returns failed on non-ENOENT read errors", async () => {
    const err = Object.assign(new Error("Disk error"), { code: "EIO" });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(err)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: mock(() => Promise.resolve()),
    });

    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Cannot read");
  });

  it("uses atomicWriteFile for writing", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const atomicWrite = mock(() => Promise.resolve());
    const writeFile = mock(() => Promise.resolve());
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
      writeFile,
    });

    await executeConfigFileSetup(configSetup, fs);
    // Should use atomic write, not regular write
    expect(atomicWrite).toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
