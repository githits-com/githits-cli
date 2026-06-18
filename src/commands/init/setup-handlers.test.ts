import { describe, expect, it, mock } from "bun:test";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  createMockExecService,
  createMockFileSystemService,
} from "../../services/test-helpers.js";
import type {
  CliSetup,
  CliUninstall,
  CompositeSetup,
  CompositeUninstall,
  ConfigFileSetup,
} from "./agent-definitions.js";
import type { CliCheckCommand, MergeResult } from "./setup-handlers.js";
import {
  detectConfigFormat,
  executeCliSetup,
  executeCliUninstall,
  executeCompositeSetup,
  executeCompositeUninstall,
  executeConfigFileSetup,
  executeConfigFileUninstall,
  getCliCheckStatus,
  getConfigUninstallCheckStatus,
  hasServerConfigEntry,
  isAlreadyConfigured,
  isCliAlreadyConfigured,
  isConfiguredForUninstall,
  isSetupAlreadyConfigured,
  mergeServerConfig,
  removeServerConfig,
} from "./setup-handlers.js";

describe("detectConfigFormat", () => {
  it("returns json for strict JSON", () => {
    expect(detectConfigFormat('{"mcpServers": {}}')).toBe("json");
  });

  it("returns jsonc for JSONC with comments and trailing commas", () => {
    const content = `{
      // comment
      "mcpServers": {
        "GitHits": {
          "command": "npx",
          "args": ["-y", "githits@latest", "mcp", "start",],
        },
      },
    }`;
    expect(detectConfigFormat(content)).toBe("jsonc");
  });

  it("returns invalid for malformed content", () => {
    expect(detectConfigFormat("{invalid json")).toBe("invalid");
  });
});

/** Assert that a MergeResult is "added" and return its content */
function expectAdded(result: MergeResult): string {
  expect(result.status).toBe("added");
  if (result.status !== "added") throw new Error("unreachable");
  return result.content;
}

function expectUpdated(result: MergeResult): string {
  expect(result.status).toBe("updated");
  if (result.status !== "updated") throw new Error("unreachable");
  return result.content;
}

/** Assert that a MergeResult is "parse_error" and return its error */
function expectParseError(result: MergeResult): string {
  expect(result.status).toBe("parse_error");
  if (result.status !== "parse_error") throw new Error("unreachable");
  return result.error;
}

function expectRemoved(result: ReturnType<typeof removeServerConfig>): string {
  expect(result.status).toBe("removed");
  if (result.status !== "removed") throw new Error("unreachable");
  return result.content;
}

// -- isAlreadyConfigured (read-only check) --

describe("isAlreadyConfigured", () => {
  const configSetup: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.cursor/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: {
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    },
  };

  it("returns true when config file contains the server entry", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(true);
  });

  it("returns false when GitHits exists with legacy remote shape", async () => {
    const existing = JSON.stringify({
      mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns true when config uses equivalent npx @latest invocation", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(true);
  });

  it("returns false when config uses npx without @latest", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits", "mcp", "start"],
        },
      },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns false when config uses direct githits invocation", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "githits",
          args: ["mcp", "start"],
        },
      },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns false when local command is mixed with legacy remote url", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
          url: "https://mcp.githits.com",
        },
      },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns false when config file exists but server entry is missing", async () => {
    const existing = JSON.stringify({ mcpServers: { Other: {} } });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns false when only lowercase githits key exists", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        githits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(false);
  });

  it("returns false when both GitHits and githits keys are present", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
        githits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
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

  it("returns true for JSONC config with comments and trailing commas", async () => {
    const existing = `{
      // VS Code style config
      "mcpServers": {
        "GitHits": {
          "command": "npx",
          "args": ["-y", "githits@latest", "mcp", "start",],
        },
      },
    }`;
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });
    expect(await isAlreadyConfigured(configSetup, fs)).toBe(true);
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
      serverConfig: {
        command: "npx",
        args: ["-y", "githits@latest", "mcp", "start"],
      },
    };
    const existing = JSON.stringify({
      servers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
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
    const existing = `${bom}${JSON.stringify({ mcpServers: { GitHits: { command: "npx", args: ["-y", "githits@latest", "mcp", "start"] } } })}`;
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

  it("returns not_configured when non-zero output matches notConfiguredPattern", async () => {
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

  it("passes timeout option to read-only CLI checks", async () => {
    const check: CliCheckCommand = {
      command: "codex",
      args: ["mcp", "list"],
      configuredPattern: /^githits\b/im,
    };
    const exec = mock(() =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    );
    const execService = createMockExecService({ exec });

    await getCliCheckStatus(check, execService);

    expect(exec).toHaveBeenCalledWith("codex", ["mcp", "list"], {
      timeoutMs: 5_000,
    });
  });

  it("returns probe_failed when read-only CLI check times out", async () => {
    const check: CliCheckCommand = {
      command: "codex",
      args: ["mcp", "list"],
      configuredPattern: /^githits\b/im,
    };
    const execService = createMockExecService({
      exec: mock(() => {
        const error = new Error("timed out");
        error.name = "ExecTimeoutError";
        return Promise.reject(error);
      }),
    });

    expect(await getCliCheckStatus(check, execService)).toBe("probe_failed");
  });
});

// -- mergeServerConfig (pure function) --

describe("mergeServerConfig", () => {
  const serverConfig = {
    command: "npx",
    args: ["-y", "githits@latest", "mcp", "start"],
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

  it("returns already_configured when server value already matches", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
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

  it("returns updated when server exists with different value", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: { url: "https://mcp.githits.com" },
      },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectUpdated(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("updates existing Pi GitHits config when lifecycle is missing", () => {
    const eagerServerConfig = {
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
      lifecycle: "eager",
    };
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });

    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      eagerServerConfig,
    );
    const content = expectUpdated(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(eagerServerConfig);
  });

  it("returns updated and normalizes lowercase githits key to GitHits", () => {
    const existing = JSON.stringify({
      mcpServers: {
        githits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectUpdated(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
    expect(parsed.mcpServers.githits).toBeUndefined();
  });

  it("returns updated and removes duplicate case-variant keys", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
        githits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectUpdated(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
    expect(parsed.mcpServers.githits).toBeUndefined();
  });

  it("returns already_configured for equivalent npx invocation", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
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

  it("returns updated for npx command missing @latest", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits", "mcp", "start"],
        },
      },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectUpdated(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("returns updated for direct githits command", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "githits",
          args: ["mcp", "start"],
        },
      },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectUpdated(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
  });

  it("returns updated when equivalent command also has legacy remote fields", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
          url: "https://mcp.githits.com",
        },
      },
    });
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectUpdated(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
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

  it("parses JSONC with comments and trailing commas", () => {
    const existing = `{
      // existing MCP servers
      "mcpServers": {
        "other": { "command": "other" },
      },
    }`;
    const result = mergeServerConfig(
      existing,
      "mcpServers",
      "GitHits",
      serverConfig,
    );
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
    expect(parsed.mcpServers.GitHits).toEqual(serverConfig);
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
    const vscodeConfig = {
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    };
    const result = mergeServerConfig("{}", "servers", "GitHits", vscodeConfig);
    const content = expectAdded(result);
    const parsed = JSON.parse(content);
    expect(parsed.servers.GitHits).toEqual(vscodeConfig);
  });

  it("adds Codex project config as TOML", () => {
    const result = mergeServerConfig(
      'model = "gpt-5"\n',
      "mcp_servers",
      "githits",
      serverConfig,
      "toml",
    );
    const content = expectAdded(result);
    const parsed = parseToml(content) as Record<string, unknown>;
    expect(parsed.model).toBe("gpt-5");
    expect((parsed.mcp_servers as Record<string, unknown>).githits).toEqual(
      serverConfig,
    );
  });

  it("adds server to empty YAML config", () => {
    const result = mergeServerConfig(
      "",
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    const content = expectAdded(result);
    const parsed = parseYaml(content);
    expect(parsed.mcp_servers.GitHits).toEqual(serverConfig);
  });

  it("preserves unrelated YAML keys", () => {
    const existing = [
      "provider: openrouter",
      "mcp_servers:",
      "  other:",
      '    command: "other"',
      "",
    ].join("\n");
    const result = mergeServerConfig(
      existing,
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    const content = expectAdded(result);
    const parsed = parseYaml(content);
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.mcp_servers.other).toEqual({ command: "other" });
    expect(parsed.mcp_servers.GitHits).toEqual(serverConfig);
  });

  it("treats null YAML servers section as missing and initializes it", () => {
    const existing = ["mcp_servers:", "provider: openrouter", ""].join("\n");
    const result = mergeServerConfig(
      existing,
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    const content = expectAdded(result);
    const parsed = parseYaml(content);
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.mcp_servers.GitHits).toEqual(serverConfig);
  });

  it("preserves YAML comments when adding GitHits", () => {
    const existing = [
      "# top comment",
      "provider: openrouter",
      "mcp_servers:",
      "  # keep other",
      "  other:",
      "    command: other",
      "",
    ].join("\n");
    const result = mergeServerConfig(
      existing,
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    const content = expectAdded(result);
    expect(content).toContain("# top comment");
    expect(content).toContain("# keep other");
    expect(content).toContain("provider: openrouter");
    expect(content).toContain("other:");
    expect(content).toContain("GitHits:");
  });

  it("returns already_configured for matching YAML config", () => {
    const existing = [
      "mcp_servers:",
      "  GitHits:",
      '    command: "npx"',
      '    args: ["-y", "githits@latest", "mcp", "start"]',
      "",
    ].join("\n");
    const result = mergeServerConfig(
      existing,
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    expect(result.status).toBe("already_configured");
  });

  it("returns updated and normalizes lowercase githits key in YAML config", () => {
    const existing = [
      "mcp_servers:",
      "  githits:",
      '    command: "npx"',
      '    args: ["-y", "githits@latest", "mcp", "start"]',
      "",
    ].join("\n");
    const result = mergeServerConfig(
      existing,
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    const content = expectUpdated(result);
    const parsed = parseYaml(content);
    expect(parsed.mcp_servers.GitHits).toEqual(serverConfig);
    expect(parsed.mcp_servers.githits).toBeUndefined();
  });

  it("returns parse_error for malformed YAML", () => {
    const result = mergeServerConfig(
      "mcp_servers:\n  GitHits: [unterminated",
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    const error = expectParseError(result);
    expect(error).toContain("Invalid YAML");
  });

  it("returns parse_error when YAML root is not an object", () => {
    const result = mergeServerConfig(
      "- one\n- two\n",
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    const error = expectParseError(result);
    expect(error).toContain("not a YAML object");
  });

  it("returns parse_error when YAML serversKey is not an object", () => {
    const result = mergeServerConfig(
      "mcp_servers: disabled\n",
      "mcp_servers",
      "GitHits",
      serverConfig,
      "yaml",
    );
    const error = expectParseError(result);
    expect(error).toContain("not a YAML object");
  });
});

describe("removeServerConfig", () => {
  it("removes GitHits while preserving other servers", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: { command: "npx" },
        other: { command: "other" },
      },
      setting: true,
    });
    const content = expectRemoved(
      removeServerConfig(existing, "mcpServers", "GitHits"),
    );
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toBeUndefined();
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
    expect(parsed.setting).toBe(true);
  });

  it("removes lowercase githits key", () => {
    const existing = JSON.stringify({
      mcpServers: { githits: { command: "npx" } },
    });
    const content = expectRemoved(
      removeServerConfig(existing, "mcpServers", "GitHits"),
    );
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.githits).toBeUndefined();
  });

  it("removes duplicate case-variant keys", () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: { command: "npx" },
        githits: { command: "npx" },
        GITHITS: { command: "npx" },
      },
    });
    const content = expectRemoved(
      removeServerConfig(existing, "mcpServers", "GitHits"),
    );
    const parsed = JSON.parse(content);
    expect(Object.keys(parsed.mcpServers)).toEqual([]);
  });

  it("returns not_configured when GitHits is absent", () => {
    const result = removeServerConfig(
      JSON.stringify({ mcpServers: { other: {} } }),
      "mcpServers",
      "GitHits",
    );
    expect(result.status).toBe("not_configured");
  });

  it("returns parse_error for malformed content", () => {
    const result = removeServerConfig("{invalid", "mcpServers", "GitHits");
    expect(result.status).toBe("parse_error");
  });

  it("supports JSONC and writes canonical JSON", () => {
    const existing = `{
      // comment
      "mcpServers": {
        "GitHits": { "command": "npx" },
        "other": { "command": "other", },
      },
    }`;
    const content = expectRemoved(
      removeServerConfig(existing, "mcpServers", "GitHits"),
    );
    expect(content).toEndWith("\n");
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.GitHits).toBeUndefined();
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
  });

  it("supports VS Code servers key", () => {
    const content = expectRemoved(
      removeServerConfig(
        JSON.stringify({ servers: { GitHits: {}, other: {} } }),
        "servers",
        "GitHits",
      ),
    );
    const parsed = JSON.parse(content);
    expect(parsed.servers.GitHits).toBeUndefined();
    expect(parsed.servers.other).toEqual({});
  });

  it("supports OpenCode mcp key", () => {
    const content = expectRemoved(
      removeServerConfig(
        JSON.stringify({ mcp: { GitHits: {}, other: {} } }),
        "mcp",
        "GitHits",
      ),
    );
    const parsed = JSON.parse(content);
    expect(parsed.mcp.GitHits).toBeUndefined();
    expect(parsed.mcp.other).toEqual({});
  });

  it("removes Codex project config from TOML", () => {
    const existing = `model = "gpt-5"

[mcp_servers.other]
command = "other"

[mcp_servers.githits]
command = "npx"
args = ["-y", "githits@latest", "mcp", "start"]
`;
    const content = expectRemoved(
      removeServerConfig(existing, "mcp_servers", "githits", "toml"),
    );
    const parsed = parseToml(content) as Record<string, unknown>;
    const servers = parsed.mcp_servers as Record<string, unknown>;
    expect(parsed.model).toBe("gpt-5");
    expect(servers.githits).toBeUndefined();
    expect(servers.other).toEqual({ command: "other" });
  });

  it("removes GitHits from YAML while preserving other servers", () => {
    const existing = [
      "mcp_servers:",
      "  GitHits:",
      '    command: "npx"',
      "  other:",
      '    command: "other"',
      "setting: true",
      "",
    ].join("\n");
    const content = expectRemoved(
      removeServerConfig(existing, "mcp_servers", "GitHits", "yaml"),
    );
    const parsed = parseYaml(content);
    expect(parsed.mcp_servers.GitHits).toBeUndefined();
    expect(parsed.mcp_servers.other).toEqual({ command: "other" });
    expect(parsed.setting).toBe(true);
  });

  it("removes lowercase GitHits key from YAML", () => {
    const existing = [
      "mcp_servers:",
      "  githits:",
      '    command: "npx"',
      "",
    ].join("\n");
    const content = expectRemoved(
      removeServerConfig(existing, "mcp_servers", "GitHits", "yaml"),
    );
    const parsed = parseYaml(content);
    expect(parsed.mcp_servers.githits).toBeUndefined();
  });

  it("returns not_configured when YAML servers section is null", () => {
    const result = removeServerConfig(
      "mcp_servers:\nprovider: openrouter\n",
      "mcp_servers",
      "GitHits",
      "yaml",
    );
    expect(result.status).toBe("not_configured");
  });
});

describe("hasServerConfigEntry", () => {
  it("returns true for legacy and case-variant GitHits entries", () => {
    expect(
      hasServerConfigEntry(
        JSON.stringify({
          mcpServers: { githits: { url: "https://mcp.githits.com" } },
        }),
        "mcpServers",
        "GitHits",
      ),
    ).toBe(true);
  });

  it("returns false when server entry is absent or malformed", () => {
    expect(
      hasServerConfigEntry(
        JSON.stringify({ mcpServers: { other: {} } }),
        "mcpServers",
        "GitHits",
      ),
    ).toBe(false);
    expect(hasServerConfigEntry("{invalid", "mcpServers", "GitHits")).toBe(
      false,
    );
  });

  it("returns true for case-variant YAML GitHits entries", () => {
    expect(
      hasServerConfigEntry(
        "mcp_servers:\n  githits:\n    command: npx\n",
        "mcp_servers",
        "GitHits",
        "yaml",
      ),
    ).toBe(true);
  });

  it("returns false for YAML null servers section", () => {
    expect(
      hasServerConfigEntry(
        "mcp_servers:\nprovider: openrouter\n",
        "mcp_servers",
        "GitHits",
        "yaml",
      ),
    ).toBe(false);
  });
});

describe("isConfiguredForUninstall", () => {
  const configSetup: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.cursor/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: {},
  };

  it("detects legacy removable config entries", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
          }),
        ),
      ),
    });

    expect(await isConfiguredForUninstall(configSetup, fs)).toBe(true);
  });

  it("returns false when file is missing", async () => {
    const fs = createMockFileSystemService();
    expect(await isConfiguredForUninstall(configSetup, fs)).toBe(false);
  });

  it("returns false when file is malformed", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve("{invalid")),
    });
    expect(await isConfiguredForUninstall(configSetup, fs)).toBe(false);
  });
});

describe("getConfigUninstallCheckStatus", () => {
  const configSetup: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.cursor/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: {},
  };

  it("returns failed for malformed config", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve("{invalid")),
    });

    const result = await getConfigUninstallCheckStatus(configSetup, fs);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.message).toContain("Cannot parse");
    expect(result.message).toContain("File left unchanged");
  });

  it("returns failed for non-ENOENT read errors", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.reject(Object.assign(new Error("Disk error"), { code: "EIO" })),
      ),
    });

    const result = await getConfigUninstallCheckStatus(configSetup, fs);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.message).toContain("Cannot read");
  });

  it("returns not_configured for YAML null servers section", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve("mcp_servers:\nprovider: openrouter\n"),
      ),
    });
    const result = await getConfigUninstallCheckStatus(
      {
        ...configSetup,
        configPath: "/home/test/.hermes/config.yaml",
        serversKey: "mcp_servers",
        format: "yaml",
      },
      fs,
    );
    expect(result.status).toBe("not_configured");
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

  it("emits one ran change per command on success", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "OK\n", stderr: "" }),
      ),
    });
    const result = await executeCliSetup(multiStepSetup, execService);
    expect(result.changes).toEqual([
      {
        kind: "command",
        command: "claude plugin marketplace add githits-com/githits-cli",
        change: "ran",
      },
      {
        kind: "command",
        command: "claude plugin install githits@githits-plugins",
        change: "ran",
      },
    ]);
  });

  it("reports per-command state for a mixed multi-step run", async () => {
    // First command is already configured, second actually runs.
    const responses = [
      { exitCode: 0, stdout: "MCP server GitHits already exists", stderr: "" },
      { exitCode: 0, stdout: "Installed\n", stderr: "" },
    ];
    let call = 0;
    const execService = createMockExecService({
      exec: mock(() => Promise.resolve(responses[call++]!)),
    });
    const result = await executeCliSetup(multiStepSetup, execService);
    // A command ran, so the overall result is success, not already_configured.
    expect(result.status).toBe("success");
    expect(result.changes).toEqual([
      {
        kind: "command",
        command: "claude plugin marketplace add githits-com/githits-cli",
        change: "unchanged",
      },
      {
        kind: "command",
        command: "claude plugin install githits@githits-plugins",
        change: "ran",
      },
    ]);
  });

  it("is already_configured only when every command was a no-op", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "MCP server GitHits already exists",
          stderr: "",
        }),
      ),
    });
    const result = await executeCliSetup(multiStepSetup, execService);
    expect(result.status).toBe("already_configured");
    expect(result.changes?.every((c) => c.change === "unchanged")).toBe(true);
  });

  it("keeps changes from commands that ran before a later failure", async () => {
    const responses = [
      { exitCode: 0, stdout: "Added.\n", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "Install failed\n" },
    ];
    let call = 0;
    const execService = createMockExecService({
      exec: mock(() => Promise.resolve(responses[call++]!)),
    });
    const result = await executeCliSetup(multiStepSetup, execService);
    expect(result.status).toBe("failed");
    expect(result.changes).toEqual([
      {
        kind: "command",
        command: "claude plugin marketplace add githits-com/githits-cli",
        change: "ran",
      },
    ]);
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

  it("runs every step and reports success when a later step runs", async () => {
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
    // A command ran, so this is success — not already_configured.
    expect(result.status).toBe("success");
    // Both commands should still run
    expect(execService.exec).toHaveBeenCalledTimes(2);
  });
});

describe("executeCliUninstall", () => {
  const uninstall: CliUninstall = {
    method: "cli",
    commands: [{ command: "codex", args: ["mcp", "remove", "githits"] }],
  };

  it("returns removed on exit code 0", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "Removed\n", stderr: "" }),
      ),
    });

    const result = await executeCliUninstall(uninstall, execService);
    expect(result.status).toBe("removed");
    expect(execService.exec).toHaveBeenCalledWith("codex", [
      "mcp",
      "remove",
      "githits",
    ]);
  });

  it("emits a ran change per command", async () => {
    const multi: CliUninstall = {
      method: "cli",
      commands: [
        { command: "claude", args: ["plugin", "uninstall", "githits"] },
        { command: "claude", args: ["plugin", "marketplace", "remove", "x"] },
      ],
    };
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "Removed\n", stderr: "" }),
      ),
    });
    const result = await executeCliUninstall(multi, execService);
    expect(result.changes).toEqual([
      {
        kind: "command",
        command: "claude plugin uninstall githits",
        change: "ran",
      },
      {
        kind: "command",
        command: "claude plugin marketplace remove x",
        change: "ran",
      },
    ]);
  });

  it("returns not_configured for already-absent output", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "MCP server githits not found\n",
        }),
      ),
    });

    const result = await executeCliUninstall(uninstall, execService);
    expect(result.status).toBe("not_configured");
  });

  it("returns failed for unrelated missing command output", async () => {
    for (const stderr of ['command "mcp" not found\n', "no such command\n"]) {
      const execService = createMockExecService({
        exec: mock(() =>
          Promise.resolve({
            exitCode: 1,
            stdout: "",
            stderr,
          }),
        ),
      });

      const result = await executeCliUninstall(uninstall, execService);
      expect(result.status).toBe("failed");
    }
  });

  it("returns failed without executing when no uninstall commands are configured", async () => {
    const execService = createMockExecService();
    const result = await executeCliUninstall(
      { method: "cli", commands: [] } as never,
      execService,
    );

    expect(result.status).toBe("failed");
    expect(result.message).toBe("No uninstall commands configured.");
    expect(execService.exec).not.toHaveBeenCalled();
  });

  it("treats successful output with absent wording as removed", async () => {
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "Removed githits; backup not found\n",
          stderr: "",
        }),
      ),
    });

    const result = await executeCliUninstall(uninstall, execService);
    expect(result.status).toBe("removed");
  });

  it("treats cleanup not_configured after removal as removed with warning", async () => {
    const multi: CliUninstall = {
      method: "cli",
      commands: [
        { command: "claude", args: ["plugin", "uninstall", "githits"] },
        {
          command: "claude",
          args: ["plugin", "marketplace", "remove", "githits-plugins"],
        },
      ],
    };
    let callCount = 0;
    const execService = createMockExecService({
      exec: mock(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        return Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "Marketplace githits-plugins not found\n",
        });
      }),
    });

    const result = await executeCliUninstall(multi, execService);
    expect(result.status).toBe("removed");
    expect(result.warnings).toHaveLength(1);
  });

  it("treats cleanup hard failure after removal as removed with warning", async () => {
    const multi: CliUninstall = {
      method: "cli",
      commands: [
        { command: "claude", args: ["plugin", "uninstall", "githits"] },
        {
          command: "claude",
          args: ["plugin", "marketplace", "remove", "githits-plugins"],
        },
      ],
    };
    let callCount = 0;
    const execService = createMockExecService({
      exec: mock(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            exitCode: 0,
            stdout: "Removed\n",
            stderr: "",
          });
        }
        return Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" });
      }),
    });

    const result = await executeCliUninstall(multi, execService);
    expect(result.status).toBe("removed");
    expect(result.warnings?.[0]).toContain("boom");
  });

  it("stops on first hard failure", async () => {
    const multi: CliUninstall = {
      method: "cli",
      commands: [
        { command: "claude", args: ["plugin", "uninstall", "githits"] },
        {
          command: "claude",
          args: ["plugin", "marketplace", "remove", "githits-plugins"],
        },
      ],
    };
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" }),
      ),
    });

    const result = await executeCliUninstall(multi, execService);
    expect(result.status).toBe("failed");
    expect(execService.exec).toHaveBeenCalledTimes(1);
  });
});

// -- executeConfigFileSetup --

describe("executeConfigFileSetup", () => {
  const configSetup: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.cursor/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: {
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    },
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
    const calls = atomicWrite.mock.calls as unknown as [string, string][];
    const writtenContent = calls[0]![1];
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

  it("returns already_configured when GitHits already matches desired config", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const atomicWrite = mock((_path: string, _content: string) =>
      Promise.resolve(),
    );
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

  it("reports a created change when the file did not exist", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: mock(() => Promise.resolve()),
    });
    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.changes).toEqual([
      {
        kind: "config-file",
        path: "/home/test/.cursor/mcp.json",
        change: "created",
      },
    ]);
  });

  it("reports an updated change when the file already existed", async () => {
    const existing = JSON.stringify({
      mcpServers: { other: { command: "other" } },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: mock(() => Promise.resolve()),
    });
    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.changes).toEqual([
      {
        kind: "config-file",
        path: "/home/test/.cursor/mcp.json",
        change: "updated",
      },
    ]);
  });

  it("reports an updated change for a pre-existing empty file", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve("")),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: mock(() => Promise.resolve()),
    });
    const result = await executeConfigFileSetup(configSetup, fs);
    // An existing (even empty) file is "updated", only a missing file is "created".
    expect(result.changes?.[0]).toMatchObject({ change: "updated" });
  });

  it("reports an unchanged change when already configured", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: mock(() => Promise.resolve()),
    });
    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.changes).toEqual([
      {
        kind: "config-file",
        path: "/home/test/.cursor/mcp.json",
        change: "unchanged",
      },
    ]);
  });

  it("migrates legacy remote config to local CLI command", async () => {
    const existing = JSON.stringify({
      mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
    });
    const atomicWrite = mock((_path: string, _content: string) =>
      Promise.resolve(),
    );
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.status).toBe("success");
    expect(atomicWrite).toHaveBeenCalledTimes(1);
    const calls = atomicWrite.mock.calls as unknown[][];
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const writtenContent = firstCall?.[1];
    expect(typeof writtenContent).toBe("string");
    if (typeof writtenContent !== "string") {
      throw new Error("Expected written config content");
    }
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcpServers.GitHits).toEqual(configSetup.serverConfig);
  });

  it("does not rewrite equivalent npx local config", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: {
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        },
      },
    });
    const atomicWrite = mock((_path: string, _content: string) =>
      Promise.resolve(),
    );
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

  it("treats opencode-style npx array command as equivalent local config", async () => {
    const opencodeSetup: ConfigFileSetup = {
      method: "config-file",
      configPath: "/home/test/.config/opencode/opencode.json",
      serversKey: "mcp",
      serverName: "GitHits",
      serverConfig: {
        type: "local",
        command: ["npx", "-y", "githits@latest", "mcp", "start"],
        enabled: true,
      },
    };
    const existing = JSON.stringify({
      mcp: {
        GitHits: {
          type: "local",
          command: ["npx", "-y", "githits@latest", "mcp", "start"],
          enabled: true,
        },
      },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
    });

    expect(await isAlreadyConfigured(opencodeSetup, fs)).toBe(true);
  });

  it("returns failed on malformed JSON without writing", async () => {
    const atomicWrite = mock((_path: string, _content: string) =>
      Promise.resolve(),
    );
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

  it("supports JSONC config in executeConfigFileSetup", async () => {
    const existing = `{
      // existing server
      "mcpServers": {
        "other": { "command": "other" },
      },
    }`;
    const atomicWrite = mock(() => Promise.resolve());
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.cursor"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(configSetup, fs);
    expect(result.status).toBe("success");
    expect(atomicWrite).toHaveBeenCalledTimes(1);
    const calls = atomicWrite.mock.calls as unknown[][];
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const writtenContent = firstCall?.[1];
    expect(typeof writtenContent).toBe("string");
    if (typeof writtenContent !== "string") {
      throw new Error("Expected written config content");
    }
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
    expect(parsed.mcpServers.GitHits).toEqual(configSetup.serverConfig);
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

  it("writes YAML config for Hermes-style setup", async () => {
    const hermesSetup: ConfigFileSetup = {
      method: "config-file",
      format: "yaml",
      configPath: "/home/test/.hermes/config.yaml",
      serversKey: "mcp_servers",
      serverName: "GitHits",
      serverConfig: configSetup.serverConfig,
    };
    const existing = "provider: openrouter\nmcp_servers: {}\n";
    const atomicWrite = mock((_path: string, _content: string) =>
      Promise.resolve(),
    );
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.hermes"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(hermesSetup, fs);
    expect(result.status).toBe("success");
    const writtenContent = atomicWrite.mock.calls[0]![1];
    const parsed = parseYaml(writtenContent);
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.mcp_servers.GitHits).toEqual(hermesSetup.serverConfig);
  });

  it("writes YAML config when servers section is null", async () => {
    const hermesSetup: ConfigFileSetup = {
      method: "config-file",
      format: "yaml",
      configPath: "/home/test/.hermes/config.yaml",
      serversKey: "mcp_servers",
      serverName: "GitHits",
      serverConfig: configSetup.serverConfig,
    };
    const existing = "mcp_servers:\nprovider: openrouter\n";
    const atomicWrite = mock((_path: string, _content: string) =>
      Promise.resolve(),
    );
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.hermes"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(hermesSetup, fs);
    expect(result.status).toBe("success");
    const writtenContent = atomicWrite.mock.calls[0]![1];
    const parsed = parseYaml(writtenContent);
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.mcp_servers.GitHits).toEqual(hermesSetup.serverConfig);
  });

  it("does not rewrite matching YAML config", async () => {
    const hermesSetup: ConfigFileSetup = {
      method: "config-file",
      format: "yaml",
      configPath: "/home/test/.hermes/config.yaml",
      serversKey: "mcp_servers",
      serverName: "GitHits",
      serverConfig: configSetup.serverConfig,
    };
    const existing = [
      "mcp_servers:",
      "  GitHits:",
      '    command: "npx"',
      '    args: ["-y", "githits@latest", "mcp", "start"]',
      "",
    ].join("\n");
    const atomicWrite = mock((_path: string, _content: string) =>
      Promise.resolve(),
    );
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      getDirname: mock(() => "/home/test/.hermes"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(hermesSetup, fs);
    expect(result.status).toBe("already_configured");
    expect(atomicWrite).not.toHaveBeenCalled();
  });

  it("leaves YAML file unchanged on parse error", async () => {
    const hermesSetup: ConfigFileSetup = {
      method: "config-file",
      format: "yaml",
      configPath: "/home/test/.hermes/config.yaml",
      serversKey: "mcp_servers",
      serverName: "GitHits",
      serverConfig: configSetup.serverConfig,
    };
    const atomicWrite = mock((_path: string, _content: string) =>
      Promise.resolve(),
    );
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve("mcp_servers:\n  GitHits: [unterminated"),
      ),
      getDirname: mock(() => "/home/test/.hermes"),
      ensureDir: mock(() => Promise.resolve()),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileSetup(hermesSetup, fs);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Invalid YAML");
    expect(atomicWrite).not.toHaveBeenCalled();
  });
});

describe("executeCompositeSetup", () => {
  const piConfigSetup: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.pi/agent/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: {
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    },
  };

  const piSetup: CompositeSetup = {
    method: "composite",
    steps: [
      {
        method: "cli",
        commands: [{ command: "pi", args: ["install", "npm:pi-mcp-adapter"] }],
        checkCommand: {
          command: "pi",
          args: ["list"],
          configuredPattern: /pi-mcp-adapter/i,
        },
      },
      piConfigSetup,
    ],
  };

  it("reports already_configured when all steps are configured", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            mcpServers: { GitHits: piConfigSetup.serverConfig },
          }),
        ),
      ),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "npm:pi-mcp-adapter\n",
          stderr: "",
        }),
      ),
    });

    expect(await isSetupAlreadyConfigured(piSetup, fs, execService)).toBe(true);
    const result = await executeCompositeSetup(piSetup, fs, execService);
    expect(result.status).toBe("already_configured");
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("writes missing config when adapter is already installed", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
      getDirname: mock(() => "/home/test/.pi/agent"),
      atomicWriteFile: mock(() => Promise.resolve()),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 0,
          stdout: "pi-mcp-adapter\n",
          stderr: "",
        }),
      ),
    });

    const result = await executeCompositeSetup(piSetup, fs, execService);
    expect(result.status).toBe("success");
    expect(execService.exec).toHaveBeenCalledTimes(1);
    expect(execService.exec).toHaveBeenCalledWith("pi", ["list"], {
      timeoutMs: 5_000,
    });
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
  });

  it("installs adapter when config is already present", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            mcpServers: { GitHits: piConfigSetup.serverConfig },
          }),
        ),
      ),
    });
    const execService = createMockExecService({
      exec: mock((command: string, args: string[]) => {
        if (command === "pi" && args.join(" ") === "list") {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({
          exitCode: 0,
          stdout: "installed\n",
          stderr: "",
        });
      }),
    });

    const result = await executeCompositeSetup(piSetup, fs, execService);
    expect(result.status).toBe("success");
    expect(execService.exec).toHaveBeenCalledWith("pi", [
      "install",
      "npm:pi-mcp-adapter",
    ]);
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("reports both sub-steps even when one was already configured", async () => {
    // Adapter step runs; config-file step is already configured (skipped) and
    // must still appear as an unchanged change.
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            mcpServers: { GitHits: piConfigSetup.serverConfig },
          }),
        ),
      ),
    });
    const execService = createMockExecService({
      exec: mock((command: string, args: string[]) => {
        if (command === "pi" && args.join(" ") === "list") {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({
          exitCode: 0,
          stdout: "installed\n",
          stderr: "",
        });
      }),
    });

    const result = await executeCompositeSetup(piSetup, fs, execService);
    expect(result.changes).toEqual([
      {
        kind: "command",
        command: "pi install npm:pi-mcp-adapter",
        change: "ran",
      },
      {
        kind: "config-file",
        path: "/home/test/.pi/agent/mcp.json",
        change: "unchanged",
      },
    ]);
  });

  it("reports already_configured when a false-negative pre-check still changes nothing", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            mcpServers: { GitHits: piConfigSetup.serverConfig },
          }),
        ),
      ),
    });
    const execService = createMockExecService({
      exec: mock((command: string, args: string[]) => {
        if (command === "pi" && args.join(" ") === "list") {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "MCP server GitHits already exists\n",
        });
      }),
    });

    const result = await executeCompositeSetup(piSetup, fs, execService);
    expect(result.status).toBe("already_configured");
    expect(result.changes).toEqual([
      {
        kind: "command",
        command: "pi install npm:pi-mcp-adapter",
        change: "unchanged",
      },
      {
        kind: "config-file",
        path: "/home/test/.pi/agent/mcp.json",
        change: "unchanged",
      },
    ]);
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("stops on failed install before writing config", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
      atomicWriteFile: mock(() => Promise.resolve()),
    });
    const execService = createMockExecService({
      exec: mock((command: string, args: string[]) => {
        if (command === "pi" && args.join(" ") === "list") {
          return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
        }
        return Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "install failed",
        });
      }),
    });

    const result = await executeCompositeSetup(piSetup, fs, execService);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("install failed");
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });
});

describe("executeConfigFileUninstall", () => {
  const configSetup: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.cursor/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: {
      command: "npx",
      args: ["-y", "githits@latest", "mcp", "start"],
    },
  };

  it("removes GitHits and preserves other entries", async () => {
    const existing = JSON.stringify({
      mcpServers: {
        GitHits: { command: "npx" },
        other: { command: "other" },
      },
    });
    const atomicWrite = mock(() => Promise.resolve());
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileUninstall(configSetup, fs);
    expect(result.status).toBe("removed");
    expect(fs.ensureDir).not.toHaveBeenCalled();
    const calls = atomicWrite.mock.calls as unknown as [string, string][];
    const writtenContent = calls[0]![1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcpServers.GitHits).toBeUndefined();
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
  });

  it("returns not_configured when file is missing", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
    });

    const result = await executeConfigFileUninstall(configSetup, fs);
    expect(result.status).toBe("not_configured");
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("reports an updated change with the path (file kept, entry stripped)", async () => {
    const existing = JSON.stringify({
      mcpServers: { GitHits: { command: "npx" } },
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      atomicWriteFile: mock(() => Promise.resolve()),
    });
    const result = await executeConfigFileUninstall(configSetup, fs);
    expect(result.changes).toEqual([
      {
        kind: "config-file",
        path: "/home/test/.cursor/mcp.json",
        change: "updated",
      },
    ]);
  });

  it("reports an unchanged change when the file is missing", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
    });
    const result = await executeConfigFileUninstall(configSetup, fs);
    expect(result.changes).toEqual([
      {
        kind: "config-file",
        path: "/home/test/.cursor/mcp.json",
        change: "unchanged",
      },
    ]);
  });

  it("returns failed on malformed JSON without writing", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve("{invalid")),
    });

    const result = await executeConfigFileUninstall(configSetup, fs);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("File left unchanged");
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("removes GitHits from YAML config and preserves other entries", async () => {
    const hermesSetup: ConfigFileSetup = {
      method: "config-file",
      format: "yaml",
      configPath: "/home/test/.hermes/config.yaml",
      serversKey: "mcp_servers",
      serverName: "GitHits",
      serverConfig: {},
    };
    const existing = [
      "mcp_servers:",
      "  GitHits:",
      '    command: "npx"',
      "  other:",
      '    command: "other"',
      "provider: openrouter",
      "",
    ].join("\n");
    const atomicWrite = mock(() => Promise.resolve());
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve(existing)),
      atomicWriteFile: atomicWrite,
    });

    const result = await executeConfigFileUninstall(hermesSetup, fs);
    expect(result.status).toBe("removed");
    const calls = atomicWrite.mock.calls as unknown as [string, string][];
    const writtenContent = calls[0]![1];
    const parsed = parseYaml(writtenContent);
    expect(parsed.mcp_servers.GitHits).toBeUndefined();
    expect(parsed.mcp_servers.other).toEqual({ command: "other" });
    expect(parsed.provider).toBe("openrouter");
  });

  it("returns not_configured for YAML null servers section during uninstall", async () => {
    const hermesSetup: ConfigFileSetup = {
      method: "config-file",
      format: "yaml",
      configPath: "/home/test/.hermes/config.yaml",
      serversKey: "mcp_servers",
      serverName: "GitHits",
      serverConfig: {},
    };
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve("mcp_servers:\nprovider: openrouter\n"),
      ),
    });

    const result = await executeConfigFileUninstall(hermesSetup, fs);
    expect(result.status).toBe("not_configured");
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("leaves YAML file unchanged on uninstall parse error", async () => {
    const hermesSetup: ConfigFileSetup = {
      method: "config-file",
      format: "yaml",
      configPath: "/home/test/.hermes/config.yaml",
      serversKey: "mcp_servers",
      serverName: "GitHits",
      serverConfig: {},
    };
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve("mcp_servers:\n  GitHits: [unterminated"),
      ),
    });

    const result = await executeConfigFileUninstall(hermesSetup, fs);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Invalid YAML");
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("returns failed on write permission errors", async () => {
    const eacces = Object.assign(new Error("Permission denied"), {
      code: "EACCES",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(JSON.stringify({ mcpServers: { GitHits: {} } })),
      ),
      atomicWriteFile: mock(() => Promise.reject(eacces)),
    });

    const result = await executeConfigFileUninstall(configSetup, fs);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Permission denied");
  });
});

describe("executeCompositeUninstall", () => {
  const piConfigUninstall: ConfigFileSetup = {
    method: "config-file",
    configPath: "/home/test/.pi/agent/mcp.json",
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: {},
  };
  const piUninstall: CompositeUninstall = {
    method: "composite",
    steps: [
      {
        failureMode: "required",
        step: piConfigUninstall,
      },
      {
        failureMode: "required",
        step: {
          method: "cli",
          commands: [{ command: "pi", args: ["remove", "npm:pi-mcp-adapter"] }],
        },
      },
    ],
  };

  it("removes config and adapter when both are present", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(JSON.stringify({ mcpServers: { GitHits: {} } })),
      ),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "Removed\n", stderr: "" }),
      ),
    });

    const result = await executeCompositeUninstall(
      piUninstall,
      fs,
      execService,
    );
    expect(result.status).toBe("removed");
    expect(fs.atomicWriteFile).toHaveBeenCalledTimes(1);
    expect(execService.exec).toHaveBeenCalledWith("pi", [
      "remove",
      "npm:pi-mcp-adapter",
    ]);
    // The config file is updated (entry stripped); the adapter-removal command
    // is reported as ran.
    expect(result.changes).toEqual([
      {
        kind: "config-file",
        path: "/home/test/.pi/agent/mcp.json",
        change: "updated",
      },
      {
        kind: "command",
        command: "pi remove npm:pi-mcp-adapter",
        change: "ran",
      },
    ]);
  });

  it("keeps changes from earlier steps when a required step fails", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(JSON.stringify({ mcpServers: { GitHits: {} } })),
      ),
    });
    // Config removal succeeds; the required adapter removal command fails.
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" }),
      ),
    });

    const result = await executeCompositeUninstall(
      piUninstall,
      fs,
      execService,
    );
    expect(result.status).toBe("failed");
    expect(result.changes).toEqual([
      {
        kind: "config-file",
        path: "/home/test/.pi/agent/mcp.json",
        change: "updated",
      },
    ]);
  });

  it("returns removed when required adapter is already absent after config removal", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(JSON.stringify({ mcpServers: { GitHits: {} } })),
      ),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "Package pi-mcp-adapter is not installed\n",
        }),
      ),
    });

    const result = await executeCompositeUninstall(
      piUninstall,
      fs,
      execService,
    );
    expect(result.status).toBe("removed");
    expect(result.warnings).toHaveLength(1);
  });

  it("returns removed with warning for best-effort failure after removal", async () => {
    const bestEffortUninstall: CompositeUninstall = {
      method: "composite",
      steps: [
        { failureMode: "required", step: piConfigUninstall },
        {
          failureMode: "best-effort",
          step: {
            method: "cli",
            commands: [{ command: "pi", args: ["cleanup"] }],
          },
        },
      ],
    };
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(JSON.stringify({ mcpServers: { GitHits: {} } })),
      ),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" }),
      ),
    });

    const result = await executeCompositeUninstall(
      bestEffortUninstall,
      fs,
      execService,
    );
    expect(result.status).toBe("removed");
    expect(result.warnings?.[0]).toContain("boom");
  });

  it("returns removed when only adapter is present", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 0, stdout: "Removed\n", stderr: "" }),
      ),
    });

    const result = await executeCompositeUninstall(
      piUninstall,
      fs,
      execService,
    );
    expect(result.status).toBe("removed");
    expect(fs.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("returns not_configured when all steps are absent", async () => {
    const enoent = Object.assign(new Error("File not found"), {
      code: "ENOENT",
    });
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.reject(enoent)),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "Package pi-mcp-adapter is not installed\n",
        }),
      ),
    });

    const result = await executeCompositeUninstall(
      piUninstall,
      fs,
      execService,
    );
    expect(result.status).toBe("not_configured");
  });

  it("fails on first hard failure before any removal", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() => Promise.resolve("{invalid")),
    });
    const execService = createMockExecService();

    const result = await executeCompositeUninstall(
      piUninstall,
      fs,
      execService,
    );
    expect(result.status).toBe("failed");
    expect(execService.exec).not.toHaveBeenCalled();
  });

  it("fails on later required hard failure", async () => {
    const fs = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(JSON.stringify({ mcpServers: { GitHits: {} } })),
      ),
    });
    const execService = createMockExecService({
      exec: mock(() =>
        Promise.resolve({ exitCode: 1, stdout: "", stderr: "boom\n" }),
      ),
    });

    const result = await executeCompositeUninstall(
      piUninstall,
      fs,
      execService,
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("boom");
  });
});
