import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { win32 } from "node:path";
import type { ExecResult } from "../../services/exec-service.js";
import {
  createMockExecService,
  createMockFileSystemService,
  createPlatformMockFileSystemService,
  withTestPlatform,
} from "../../services/test-helpers.js";
import {
  type AgentDefinition,
  agentDefinitions,
  buildCheckboxChoices,
  detectAgents,
  getAgentSetupConfig,
  scanAgents,
} from "./agent-definitions.js";

function createWindowsFileSystemService(
  impl: Parameters<typeof createMockFileSystemService>[0] = {},
) {
  return createPlatformMockFileSystemService("win32", impl);
}

describe("agentDefinitions", () => {
  it("defines 19 agents", () => {
    expect(agentDefinitions).toHaveLength(19);
  });

  it("has unique ids", () => {
    const ids = agentDefinitions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique names", () => {
    const names = agentDefinitions.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("detection configuration", () => {
  it("claude-code uses binary detection only", () => {
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    expect(agent.detectBinary).toBeDefined();
    expect(agent.detectPaths).toBeUndefined();
  });

  it("cursor uses ~/.cursor/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "cursor")!;
    const paths = agent.detectPaths?.(fs);
    expect(paths).toEqual(["/home/test/.cursor"]);
  });

  it("codex-cli uses binary detection only", () => {
    const agent = agentDefinitions.find((a) => a.id === "codex-cli")!;
    expect(agent.detectBinary).toBeDefined();
    expect(agent.detectPaths).toBeUndefined();
  });

  it("windsurf detects via ~/.codeium/windsurf/ directory", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "windsurf")!;
    const paths = agent.detectPaths?.(fs);
    expect(paths).toEqual(["/home/test/.codeium/windsurf"]);
  });

  it("cline uses ~/.cline/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "cline")!;
    const paths = agent.detectPaths?.(fs);
    expect(paths).toEqual(["/home/test/.cline"]);
  });

  it("gemini-cli uses binary detection only", () => {
    const agent = agentDefinitions.find((a) => a.id === "gemini-cli")!;
    expect(agent.detectBinary).toBeDefined();
    expect(agent.detectPaths).toBeUndefined();
  });

  it("pi uses binary detection only", () => {
    const agent = agentDefinitions.find((a) => a.id === "pi")!;
    expect(agent.detectCommand).toBeDefined();
    expect(agent.detectPaths).toBeUndefined();
  });

  it("google-antigravity uses ~/.gemini/antigravity/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "google-antigravity")!;
    const paths = agent.detectPaths?.(fs);
    expect(paths).toEqual(["/home/test/.gemini/antigravity"]);
  });

  it("opencode uses hybrid detection", () => {
    const agent = agentDefinitions.find((a) => a.id === "opencode")!;
    expect(agent.detectBinary).toBeDefined();
    expect(agent.detectPaths).toBeDefined();
  });

  it("hermes-agent uses hybrid detection", () => {
    const agent = agentDefinitions.find((a) => a.id === "hermes-agent")!;
    expect(agent.detectBinary).toBeDefined();
    expect(agent.detectPaths).toBeDefined();
  });

  it("hermes-agent detects default ~/.hermes directory", () => {
    const originalHermesHome = process.env.HERMES_HOME;
    delete process.env.HERMES_HOME;
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "hermes-agent")!;
      const paths = agent.detectPaths?.(fs);
      expect(paths).toEqual(["/home/test/.hermes"]);
    } finally {
      if (originalHermesHome !== undefined) {
        process.env.HERMES_HOME = originalHermesHome;
      }
    }
  });

  it("hermes-agent respects HERMES_HOME for detection", () => {
    const originalHermesHome = process.env.HERMES_HOME;
    process.env.HERMES_HOME = "~/custom-hermes";
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "hermes-agent")!;
      const paths = agent.detectPaths?.(fs);
      expect(paths).toEqual(["/home/test/custom-hermes"]);
    } finally {
      if (originalHermesHome !== undefined) {
        process.env.HERMES_HOME = originalHermesHome;
      } else {
        delete process.env.HERMES_HOME;
      }
    }
  });

  it("opencode includes desktop and config detection paths on linux", () => {
    const originalPlatform = process.platform;
    const originalXdgDataHome = process.env.XDG_DATA_HOME;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    process.env.XDG_DATA_HOME = "/home/test/.local/share";
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "opencode")!;
      const paths = agent.detectPaths?.(fs);
      expect(paths).toEqual([
        "/home/test/.local/share/ai.opencode.desktop",
        "/home/test/.local/share/ai.opencode.desktop.beta",
        "/home/test/.local/share/ai.opencode.desktop.dev",
        "/home/test/.config/opencode",
      ]);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalXdgDataHome !== undefined) {
        process.env.XDG_DATA_HOME = originalXdgDataHome;
      } else {
        delete process.env.XDG_DATA_HOME;
      }
    }
  });

  it("opencode includes desktop and config detection paths on darwin", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "opencode")!;
      const paths = agent.detectPaths?.(fs);
      expect(paths).toEqual([
        "/home/test/Library/Application Support/ai.opencode.desktop",
        "/home/test/Library/Application Support/ai.opencode.desktop.beta",
        "/home/test/Library/Application Support/ai.opencode.desktop.dev",
        "/home/test/.config/opencode",
      ]);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("opencode includes desktop and config detection paths on win32", () => {
    const originalPlatform = process.platform;
    const originalAppdata = process.env.APPDATA;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    try {
      const fs = createWindowsFileSystemService();
      const agent = agentDefinitions.find((a) => a.id === "opencode")!;
      const paths = agent.detectPaths?.(fs);
      expect(paths).toEqual([
        win32.join("C:\\Users\\test\\AppData\\Roaming", "ai.opencode.desktop"),
        win32.join(
          "C:\\Users\\test\\AppData\\Roaming",
          "ai.opencode.desktop.beta",
        ),
        win32.join(
          "C:\\Users\\test\\AppData\\Roaming",
          "ai.opencode.desktop.dev",
        ),
        win32.join("C:\\Users\\test\\AppData\\Roaming", "opencode"),
      ]);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }
    }
  });

  it("claude-desktop checks multiple Windows paths on win32", () => {
    const originalPlatform = process.platform;
    const originalLocalAppdata = process.env.LOCALAPPDATA;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
    try {
      const fs = createWindowsFileSystemService();
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const paths = agent.detectPaths?.(fs);
      expect(paths).toBeDefined();
      if (!paths) throw new Error("expected claude-desktop paths");
      expect(paths).toHaveLength(3);
      expect(paths[0]).toContain("Roaming");
      expect(paths[1]).toContain(win32.join("Local", "Claude"));
      expect(paths[2]).toContain(win32.join("Local", "Programs", "Claude"));
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalLocalAppdata !== undefined) {
        process.env.LOCALAPPDATA = originalLocalAppdata;
      } else {
        delete process.env.LOCALAPPDATA;
      }
    }
  });

  it("claude-desktop returns single path on non-Windows", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const paths = agent.detectPaths?.(fs);
      expect(paths).toBeDefined();
      if (!paths) throw new Error("expected claude-desktop paths");
      expect(paths).toHaveLength(1);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("claude-desktop falls back to AppData/Local when LOCALAPPDATA is unset on win32", () => {
    const originalPlatform = process.platform;
    const originalLocalAppdata = process.env.LOCALAPPDATA;
    const originalAppdata = process.env.APPDATA;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    delete process.env.LOCALAPPDATA;
    try {
      const fs = createWindowsFileSystemService();
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const paths = agent.detectPaths?.(fs);
      expect(paths).toBeDefined();
      if (!paths) throw new Error("expected claude-desktop paths");
      expect(paths).toHaveLength(3);
      expect(paths[1]).toBe(
        win32.join("C:\\Users\\test", "AppData", "Local", "Claude"),
      );
      expect(paths[2]).toBe(
        win32.join("C:\\Users\\test", "AppData", "Local", "Programs", "Claude"),
      );
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalLocalAppdata !== undefined) {
        process.env.LOCALAPPDATA = originalLocalAppdata;
      } else {
        delete process.env.LOCALAPPDATA;
      }
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }
    }
  });

  it("opencode detectBinary returns true when binary found", async () => {
    const exec = createMockExecService({
      exec: mock(async () => ({
        exitCode: 0,
        stdout: "/usr/bin/opencode\n",
        stderr: "",
      })),
    });
    const agent = agentDefinitions.find((a) => a.id === "opencode")!;
    expect(await agent.detectBinary!(exec)).toBe(true);
  });

  it("opencode detectBinary returns false when binary not found", async () => {
    const exec = createMockExecService({
      exec: mock(async () => ({ exitCode: 1, stdout: "", stderr: "" })),
    });
    const agent = agentDefinitions.find((a) => a.id === "opencode")!;
    expect(await agent.detectBinary!(exec)).toBe(false);
  });

  it("opencode detectBinary returns false on exec error", async () => {
    const exec = createMockExecService({
      exec: mock(async () => {
        throw new Error("spawn ENOENT");
      }),
    });
    const agent = agentDefinitions.find((a) => a.id === "opencode")!;
    expect(await agent.detectBinary!(exec)).toBe(false);
  });

  it("claude-code detectBinary returns true when binary found", async () => {
    const exec = createMockExecService({
      exec: mock(async () => ({
        exitCode: 0,
        stdout: "/usr/bin/claude\n",
        stderr: "",
      })),
    });
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    expect(await agent.detectBinary!(exec)).toBe(true);
  });

  it("binary detectors use correct command and binary name on linux", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    try {
      const testCases = [
        { id: "claude-code", binary: "claude" },
        { id: "codex-cli", binary: "codex" },
        { id: "gemini-cli", binary: "gemini" },
        { id: "opencode", binary: "opencode" },
      ];

      for (const testCase of testCases) {
        const exec = createMockExecService({
          exec: mock(async () => ({
            exitCode: 0,
            stdout: "/usr/bin/mock\n",
            stderr: "",
          })),
        });
        const agent = agentDefinitions.find((a) => a.id === testCase.id)!;
        expect(await agent.detectBinary!(exec)).toBe(true);
        expect(exec.exec).toHaveBeenCalledWith("which", [testCase.binary], {
          timeoutMs: 2_000,
        });
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("binary detectors use where on win32", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    try {
      const exec = createMockExecService({
        exec: mock(async () => ({
          exitCode: 0,
          stdout: "C:\\Program Files\\Claude\\claude.exe\n",
          stderr: "",
        })),
      });
      const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
      expect(await agent.detectBinary!(exec)).toBe(true);
      expect(exec.exec).toHaveBeenCalledWith("where", ["claude"], {
        timeoutMs: 2_000,
      });
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("claude-code detectBinary returns false when binary not found", async () => {
    const exec = createMockExecService({
      exec: mock(async () => ({ exitCode: 1, stdout: "", stderr: "" })),
    });
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    expect(await agent.detectBinary!(exec)).toBe(false);
  });

  it("claude-code detectBinary returns false on exec error", async () => {
    const exec = createMockExecService({
      exec: mock(async () => {
        throw new Error("spawn ENOENT");
      }),
    });
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    expect(await agent.detectBinary!(exec)).toBe(false);
  });

  it("path/hybrid-detected agents use FileSystemService.getHomeDir (not hardcoded)", () => {
    const originalPlatform = process.platform;
    const originalAppdata = process.env.APPDATA;
    const originalXdgDataHome = process.env.XDG_DATA_HOME;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    delete process.env.APPDATA;
    delete process.env.XDG_DATA_HOME;
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/custom/home"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      for (const agent of agentDefinitions) {
        const paths = agent.detectPaths?.(fs);
        if (!paths) {
          continue;
        }
        for (const path of paths) {
          expect(path).toContain("/custom/home");
        }
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }
      if (originalXdgDataHome !== undefined) {
        process.env.XDG_DATA_HOME = originalXdgDataHome;
      } else {
        delete process.env.XDG_DATA_HOME;
      }
    }
  });
});

describe("getSetupConfig", () => {
  it("claude-code returns CLI setup with stdio MCP migration commands", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.commands).toHaveLength(4);
      expect(config.commands[0]!.command).toBe("claude");
      expect(config.commands[0]!.args).toEqual([
        "plugin",
        "uninstall",
        "githits",
      ]);
      expect(config.commands[0]!.allowAlreadyAbsent).toBe(true);
      expect(config.commands[1]!.args).toEqual([
        "plugin",
        "marketplace",
        "remove",
        "githits-plugins",
      ]);
      expect(config.commands[1]!.allowAlreadyAbsent).toBe(true);
      expect(config.commands[2]!.args).toEqual([
        "mcp",
        "remove",
        "githits",
        "--scope",
        "user",
      ]);
      expect(config.commands[2]!.allowAlreadyAbsent).toBe(true);
      expect(config.commands[3]!.args).toEqual([
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
    }
  });

  it("claude-code removes stdio MCP and legacy plugin state", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    const config = agent.getUninstallConfig?.(fs);
    expect(config?.method).toBe("cli");
    if (config?.method !== "cli") throw new Error("expected cli uninstall");
    expect(config.commands[0]).toEqual({
      command: "claude",
      args: ["mcp", "remove", "githits", "--scope", "user"],
    });
    expect(config.commands[2]).toEqual({
      command: "claude",
      args: ["plugin", "marketplace", "remove", "githits-plugins"],
      allowAlreadyAbsent: true,
    });
  });

  it("cursor returns config-file setup with the remote MCP URL", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "cursor")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("config-file");
    if (config.method === "config-file") {
      expect(config.configPath).toBe("/home/test/.cursor/mcp.json");
      expect(config.serversKey).toBe("mcpServers");
      expect(config.serverName).toBe("GitHits");
      expect(config.serverConfig).toEqual({
        url: "https://mcp.githits.com",
      });
    }
  });

  it("cursor uses the remote MCP URL for project config", () => {
    const fs = createMockFileSystemService({
      getCwd: mock(() => "/workspace/repo"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "cursor")!;
    const config = getAgentSetupConfig(agent, fs, "project");
    expect(config?.method).toBe("config-file");
    if (config?.method === "config-file") {
      expect(config.configPath).toBe("/workspace/repo/.cursor/mcp.json");
      expect(config.serverConfig).toEqual({
        url: "https://mcp.githits.com",
      });
    }
  });

  it("windsurf returns config-file setup with npm MCP command", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "windsurf")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("config-file");
    if (config.method === "config-file") {
      expect(config.configPath).toBe(
        "/home/test/.codeium/windsurf/mcp_config.json",
      );
      expect(config.serversKey).toBe("mcpServers");
      expect(config.serverName).toBe("GitHits");
      expect(config.serverConfig).toEqual({
        command: "npx",
        args: ["-y", "githits@latest", "mcp", "start"],
      });
    }
  });

  it("claude-desktop returns config-file setup with npm MCP command", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("config-file");
    if (config.method === "config-file") {
      expect(config.configPath).toContain("claude_desktop_config.json");
      expect(config.serversKey).toBe("mcpServers");
      expect(config.serverName).toBe("GitHits");
      expect(config.serverConfig).toEqual({
        command: "npx",
        args: ["-y", "githits@latest", "mcp", "start"],
      });
    }
  });

  it("claude-desktop uses Library/Application Support on darwin", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const config = agent.getSetupConfig(fs);
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          "/home/test/Library/Application Support/Claude/claude_desktop_config.json",
        );
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("claude-desktop uses .config on linux", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const config = agent.getSetupConfig(fs);
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          "/home/test/.config/Claude/claude_desktop_config.json",
        );
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("claude-desktop uses APPDATA on win32", () => {
    const originalPlatform = process.platform;
    const originalAppdata = process.env.APPDATA;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    try {
      const fs = createWindowsFileSystemService();
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const config = agent.getSetupConfig(fs);
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          win32.join(
            "C:\\Users\\test\\AppData\\Roaming",
            "Claude",
            "claude_desktop_config.json",
          ),
        );
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }
    }
  });

  it("claude-desktop falls back to AppData/Roaming on win32 without APPDATA", () => {
    const originalPlatform = process.platform;
    const originalAppdata = process.env.APPDATA;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    delete process.env.APPDATA;
    try {
      const fs = createWindowsFileSystemService();
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const config = agent.getSetupConfig(fs);
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          win32.join(
            "C:\\Users\\test",
            "AppData",
            "Roaming",
            "Claude",
            "claude_desktop_config.json",
          ),
        );
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }
    }
  });

  it("codex-cli returns CLI setup with npm MCP command", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "codex-cli")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.commands).toHaveLength(1);
      expect(config.commands[0]!.command).toBe("codex");
      expect(config.commands[0]!.args).toContain("mcp");
      expect(config.commands[0]!.args).toContain("add");
      expect(config.commands[0]!.args).toContain("npx");
      expect(config.commands[0]!.args).toContain("githits@latest");
      expect(config.commands[0]!.args).toContain("githits");
    }
  });

  it("amazon-q-cli returns documented q mcp add command shape", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "amazon-q-cli")!;
    const config = agent.getSetupConfig(fs, { command: "qchat" });

    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.commands).toEqual([
        {
          command: "qchat",
          args: [
            "mcp",
            "add",
            "--name",
            "githits",
            "--command",
            "npx",
            "--args",
            JSON.stringify(["-y", "githits@latest", "mcp", "start"]),
          ],
        },
      ]);
      expect(config.checkCommand).toEqual({
        command: "qchat",
        args: ["mcp", "list"],
        configuredPattern: /githits/i,
      });
    }
  });

  it("vscode returns config-file setup with servers key and stdio MCP command", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "vscode")!;
      const config = agent.getSetupConfig(fs);
      expect(config.method).toBe("config-file");
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          "/home/test/Library/Application Support/Code/User/mcp.json",
        );
        expect(config.serversKey).toBe("servers");
        expect(config.serverName).toBe("GitHits");
        expect(config.serverConfig).toEqual({
          type: "stdio",
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        });
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("vscode project setup includes required stdio type", () => {
    const fs = createMockFileSystemService({
      getCwd: mock(() => "/repo"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "vscode")!;
    const config = agent.projectSetup?.supported
      ? agent.projectSetup.getSetupConfig(fs)
      : null;

    expect(config?.method).toBe("config-file");
    if (config?.method === "config-file") {
      expect(config.configPath).toBe("/repo/.vscode/mcp.json");
      expect(config.serversKey).toBe("servers");
      expect(config.serverConfig).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "githits@latest", "mcp", "start"],
      });
    }
  });

  it("cline returns config-file setup with npm MCP command", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "cline")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("config-file");
    if (config.method === "config-file") {
      expect(config.configPath).toBe(
        "/home/test/.cline/data/settings/cline_mcp_settings.json",
      );
      expect(config.serversKey).toBe("mcpServers");
      expect(config.serverName).toBe("GitHits");
      expect(config.serverConfig).toEqual({
        command: "npx",
        args: ["-y", "githits@latest", "mcp", "start"],
      });
    }
  });

  it("gemini-cli returns CLI setup with stdio MCP migration commands", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "gemini-cli")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.commands).toHaveLength(3);
      expect(config.commands[0]!.command).toBe("gemini");
      expect(config.commands[0]!.args).toContain("extensions");
      expect(config.commands[0]!.args).toContain("uninstall");
      expect(config.commands[0]!.allowAlreadyAbsent).toBe(true);
      expect(config.commands[1]).toEqual({
        command: "gemini",
        args: ["mcp", "remove", "--scope", "user", "githits"],
        allowAlreadyAbsent: true,
      });
      expect(config.commands[2]).toEqual({
        command: "gemini",
        args: [
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
        ],
      });
    }
  });

  it("pi returns composite setup with adapter install and Pi-owned MCP config", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "pi")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("composite");
    if (config.method === "composite") {
      expect(config.steps).toHaveLength(2);
      const installStep = config.steps[0]!;
      const configStep = config.steps[1]!;
      expect(installStep.method).toBe("cli");
      if (installStep.method === "cli") {
        expect(installStep.commands).toEqual([
          { command: "pi", args: ["install", "npm:pi-mcp-adapter"] },
        ]);
        expect(installStep.checkCommand).toEqual(
          expect.objectContaining({ command: "pi", args: ["list"] }),
        );
      }
      expect(configStep.method).toBe("config-file");
      if (configStep.method === "config-file") {
        expect(configStep.configPath).toBe("/home/test/.pi/agent/mcp.json");
        expect(configStep.serversKey).toBe("mcpServers");
        expect(configStep.serverName).toBe("GitHits");
        expect(configStep.serverConfig).toEqual({
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
          lifecycle: "eager",
        });
      }
    }
  });

  it("pi respects PI_CODING_AGENT_DIR for MCP config path", () => {
    const originalPiDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = "~/custom-pi";
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "pi")!;
      const config = agent.getSetupConfig(fs);
      if (config.method !== "composite") {
        throw new Error("expected pi composite setup");
      }
      const configStep = config.steps[1]!;
      if (configStep.method !== "config-file") {
        throw new Error("expected config-file setup step");
      }
      expect(configStep.configPath).toBe("/home/test/custom-pi/mcp.json");
    } finally {
      if (originalPiDir !== undefined) {
        process.env.PI_CODING_AGENT_DIR = originalPiDir;
      } else {
        delete process.env.PI_CODING_AGENT_DIR;
      }
    }
  });

  it("pi returns composite uninstall for Pi-owned config and adapter removal", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "pi")!;
    const config = agent.getUninstallConfig?.(fs);
    expect(config?.method).toBe("composite");
    if (config?.method !== "composite") {
      throw new Error("expected pi composite uninstall");
    }
    expect(config.steps).toHaveLength(2);
    const configStep = config.steps[0]!.step;
    const removeStep = config.steps[1]!.step;
    expect(config.steps[0]!.failureMode).toBe("required");
    expect(config.steps[1]!.failureMode).toBe("required");
    expect(configStep.method).toBe("config-file");
    if (configStep.method === "config-file") {
      expect(configStep.configPath).toBe("/home/test/.pi/agent/mcp.json");
      expect(configStep.serversKey).toBe("mcpServers");
      expect(configStep.serverName).toBe("GitHits");
    }
    expect(removeStep.method).toBe("cli");
    if (removeStep.method === "cli") {
      expect(removeStep.commands).toEqual([
        { command: "pi", args: ["remove", "npm:pi-mcp-adapter"] },
      ]);
    }
  });

  it("pi uninstall uses resolved command context", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "pi")!;
    const config = agent.getUninstallConfig?.(fs, {
      command: "/npm-global/bin/pi",
    });
    if (config?.method !== "composite") {
      throw new Error("expected pi composite uninstall");
    }
    const removeStep = config.steps[1]!.step;
    if (removeStep.method !== "cli") {
      throw new Error("expected pi cli uninstall step");
    }
    expect(removeStep.commands[0]).toEqual({
      command: "/npm-global/bin/pi",
      args: ["remove", "npm:pi-mcp-adapter"],
    });
  });

  it("pi uninstall respects PI_CODING_AGENT_DIR for MCP config path", () => {
    const originalPiDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = "~/custom-pi";
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "pi")!;
      const config = agent.getUninstallConfig?.(fs);
      if (config?.method !== "composite") {
        throw new Error("expected pi composite uninstall");
      }
      const configStep = config.steps[0]!.step;
      if (configStep.method !== "config-file") {
        throw new Error("expected config-file uninstall step");
      }
      expect(configStep.configPath).toBe("/home/test/custom-pi/mcp.json");
    } finally {
      if (originalPiDir !== undefined) {
        process.env.PI_CODING_AGENT_DIR = originalPiDir;
      } else {
        delete process.env.PI_CODING_AGENT_DIR;
      }
    }
  });

  it("google-antigravity returns config-file setup with npm MCP command", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "google-antigravity")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("config-file");
    if (config.method === "config-file") {
      expect(config.configPath).toBe(
        "/home/test/.gemini/config/mcp_config.json",
      );
      expect(config.serversKey).toBe("mcpServers");
      expect(config.serverName).toBe("GitHits");
      expect(config.serverConfig).toEqual({
        command: "npx",
        args: ["-y", "githits@latest", "mcp", "start"],
      });
    }
  });

  it("google-antigravity uses the current workspace MCP config path", () => {
    const fs = createMockFileSystemService({
      getCwd: mock(() => "/workspace/repo"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "google-antigravity")!;
    const config = getAgentSetupConfig(agent, fs, "project");

    expect(config?.method).toBe("config-file");
    if (config?.method === "config-file") {
      expect(config.configPath).toBe("/workspace/repo/.agents/mcp_config.json");
      expect(config.serversKey).toBe("mcpServers");
      expect(config.serverConfig).toEqual({
        command: "npx",
        args: ["-y", "githits@latest", "mcp", "start"],
      });
    }
  });

  it("opencode returns config-file setup with mcp serversKey and array command", async () => {
    await withTestPlatform("linux", () => {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "opencode")!;
      const config = agent.getSetupConfig(fs);
      expect(config.method).toBe("config-file");
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          "/home/test/.config/opencode/opencode.json",
        );
        expect(config.serversKey).toBe("mcp");
        expect(config.serverName).toBe("GitHits");
        expect(config.serverConfig).toEqual({
          type: "local",
          command: ["npx", "-y", "githits@latest", "mcp", "start"],
          enabled: true,
        });
      }
    });
  });

  it("opencode uses APPDATA on win32 for config path", () => {
    const originalPlatform = process.platform;
    const originalAppdata = process.env.APPDATA;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    try {
      const fs = createWindowsFileSystemService();
      const agent = agentDefinitions.find((a) => a.id === "opencode")!;
      const config = agent.getSetupConfig(fs);
      expect(config.method).toBe("config-file");
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          win32.join(
            "C:\\Users\\test\\AppData\\Roaming",
            "opencode",
            "opencode.json",
          ),
        );
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }
    }
  });

  it("hermes-agent returns YAML config-file setup with mcp_servers key", () => {
    const originalHermesHome = process.env.HERMES_HOME;
    delete process.env.HERMES_HOME;
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "hermes-agent")!;
      const config = agent.getSetupConfig(fs);
      expect(config.method).toBe("config-file");
      if (config.method === "config-file") {
        expect(config.format).toBe("yaml");
        expect(config.configPath).toBe("/home/test/.hermes/config.yaml");
        expect(config.serversKey).toBe("mcp_servers");
        expect(config.serverName).toBe("GitHits");
        expect(config.serverConfig).toEqual({
          command: "npx",
          args: ["-y", "githits@latest", "mcp", "start"],
        });
      }
    } finally {
      if (originalHermesHome !== undefined) {
        process.env.HERMES_HOME = originalHermesHome;
      }
    }
  });

  it("hermes-agent respects HERMES_HOME for config path", () => {
    const originalHermesHome = process.env.HERMES_HOME;
    process.env.HERMES_HOME = "~/custom-hermes";
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "hermes-agent")!;
      const config = agent.getSetupConfig(fs);
      expect(config.method).toBe("config-file");
      if (config.method === "config-file") {
        expect(config.configPath).toBe("/home/test/custom-hermes/config.yaml");
      }
    } finally {
      if (originalHermesHome !== undefined) {
        process.env.HERMES_HOME = originalHermesHome;
      } else {
        delete process.env.HERMES_HOME;
      }
    }
  });

  it("config-file agents use their verified local or remote MCP shape", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const configFileAgents = agentDefinitions.filter(
      (a) => a.setupMethod === "config-file",
    );
    for (const agent of configFileAgents) {
      const config = agent.getSetupConfig(fs);
      if (config.method === "config-file") {
        if (agent.id === "cursor") {
          expect(config.serverConfig).toEqual({
            url: "https://mcp.githits.com",
          });
        } else if (agent.id === "opencode" || agent.id === "kilo-code") {
          expect(config.serverConfig).toEqual({
            type: "local",
            command: ["npx", "-y", "githits@latest", "mcp", "start"],
            enabled: true,
          });
        } else if (agent.id === "zed") {
          expect(config.serverConfig).toEqual({
            source: "custom",
            command: {
              path: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          });
        } else if (agent.id === "vscode") {
          expect(config.serverConfig).toEqual({
            type: "stdio",
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          });
        } else if (agent.id === "hermes-agent") {
          expect(config.format).toBe("yaml");
          expect(config.serversKey).toBe("mcp_servers");
          expect(config.serverConfig).toEqual({
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          });
        } else {
          expect(config.serverConfig).toEqual({
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          });
        }
      }
    }
  });
});

describe("detectAgents", () => {
  it("returns ids of agents whose directories exist", async () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
      isDirectory: mock(async (path: string) => {
        return path === "/home/test/.claude" || path === "/home/test/.cursor";
      }),
    });
    const detected = await detectAgents(agentDefinitions, fs);
    expect(detected).toContain("cursor");
    expect(detected).not.toContain("windsurf");
    expect(detected).not.toContain("claude-desktop");
    expect(detected).not.toContain("codex-cli");
  });

  it("returns empty array when no agents detected", async () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
      isDirectory: mock(() => Promise.resolve(false)),
    });
    const detected = await detectAgents(agentDefinitions, fs);
    expect(detected).toEqual([]);
  });

  it("returns ids of all directory-detectable agents when all dirs exist", async () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
      isDirectory: mock(() => Promise.resolve(true)),
    });
    const detected = await detectAgents(agentDefinitions, fs);
    // detectAgents (deprecated) checks path and hybrid agents
    expect(detected).toHaveLength(14);
    expect(detected).not.toContain("claude-code");
    expect(detected).not.toContain("codex-cli");
    expect(detected).not.toContain("pi");
    expect(detected).not.toContain("gemini-cli");
    expect(detected).toContain("opencode");
    expect(detected).toContain("hermes-agent");
  });
});

describe("scanAgents", () => {
  function lookupCommandFor(platform: string = process.platform): string {
    return platform === "win32" ? "where" : "which";
  }

  function createPathOnlyAgent(id: string): AgentDefinition {
    return {
      id,
      name: id,
      detectionMethod: "path",
      setupMethod: "config-file",
      detectPaths: () => [`/agents/${id}`],
      getSetupConfig: () => ({
        method: "config-file",
        configPath: `/agents/${id}/mcp.json`,
        serversKey: "mcpServers",
        serverName: "GitHits",
        serverConfig: {},
      }),
    };
  }

  /** Helper to create fs + exec mocks for scan tests */
  function createScanMocks(opts: {
    detectedDirs?: string[];
    configFiles?: Record<string, string>;
    existingFiles?: string[];
    execResults?: Record<string, ExecResult | Error>;
    pathPlatform?: "posix" | "win32";
  }) {
    const isWin32 = opts.pathPlatform === "win32";
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => (isWin32 ? "C:\\Users\\test" : "/home/test")),
      joinPath: mock((...segments: string[]) =>
        isWin32 ? win32.join(...segments) : segments.join("/"),
      ),
      isDirectory: mock(async (path: string) =>
        (opts.detectedDirs ?? []).includes(path),
      ),
      readFile: mock(async (path: string) => {
        if (opts.configFiles && path in opts.configFiles) {
          return opts.configFiles[path]!;
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }),
      exists: mock(async (path: string) =>
        (opts.existingFiles ?? []).includes(path),
      ),
    });
    const execService = createMockExecService({
      exec: mock(async (cmd: string, args: string[], _options?: unknown) => {
        const key = `${cmd} ${args.join(" ")}`;
        if (opts.execResults && key in opts.execResults) {
          const val = opts.execResults[key]!;
          if (val instanceof Error) throw val;
          return val;
        }
        return { exitCode: 1, stdout: "", stderr: "" };
      }),
    });
    return { fs, execService };
  }

  it("scans agents in parallel and reports progress", async () => {
    let activeChecks = 0;
    let maxActiveChecks = 0;
    const fs = createMockFileSystemService({
      isDirectory: mock(async () => {
        activeChecks += 1;
        maxActiveChecks = Math.max(maxActiveChecks, activeChecks);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeChecks -= 1;
        return false;
      }),
    });
    const execService = createMockExecService();
    const progress: number[] = [];

    const result = await scanAgents(
      [createPathOnlyAgent("one"), createPathOnlyAgent("two")],
      fs,
      execService,
      {
        onProgress: ({ completed }) => progress.push(completed),
      },
    );

    expect(result.notDetected.map((agent) => agent.id)).toEqual(["one", "two"]);
    expect(maxActiveChecks).toBe(2);
    expect(progress).toEqual([1, 2]);
  });

  it("categorizes config-file agent as alreadyConfigured when config has GitHits", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.cursor"],
      configFiles: {
        "/home/test/.cursor/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              url: "https://mcp.githits.com",
            },
          },
        }),
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.alreadyConfigured.some((a) => a.id === "cursor")).toBe(true);
    expect(result.needsSetup.some((a) => a.id === "cursor")).toBe(false);
  });

  it("categorizes legacy local Cursor stdio config as needsSetup", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.cursor"],
      configFiles: {
        "/home/test/.cursor/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        }),
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "cursor")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "cursor")).toBe(false);
  });

  it("categorizes config-file agent as needsSetup when config file is missing", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.cursor"],
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "cursor")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "cursor")).toBe(false);
  });

  it("categorizes Claude Code as alreadyConfigured for the stdio CLI entry", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} claude`]: {
          exitCode: 0,
          stdout: "/usr/bin/claude\n",
          stderr: "",
        },
        "claude mcp list": {
          exitCode: 0,
          stdout: "githits: npx -y githits@latest mcp start\nother\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.alreadyConfigured.some((a) => a.id === "claude-code")).toBe(
      true,
    );
    expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(false);
  });

  it("categorizes the remote Claude plugin as needing stdio CLI setup", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} claude`]: {
          exitCode: 0,
          stdout: "/usr/bin/claude\n",
          stderr: "",
        },
        "claude mcp list": {
          exitCode: 0,
          stdout: "plugin:githits:githits: https://mcp.githits.com\n",
          stderr: "",
        },
      },
    });

    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "claude-code")).toBe(
      false,
    );
  });

  it("does not categorize Claude Code as configured for a non-stdio MCP row", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} claude`]: {
          exitCode: 0,
          stdout: "/usr/bin/claude\n",
          stderr: "",
        },
        "claude mcp list": {
          exitCode: 0,
          stdout: "githits: https://mcp.githits.com\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "claude-code")).toBe(
      false,
    );
  });

  it("does not categorize Claude Code as configured for incidental githits output", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} claude`]: {
          exitCode: 0,
          stdout: "/usr/bin/claude\n",
          stderr: "",
        },
        "claude mcp list": {
          exitCode: 0,
          stdout: "No githits MCP server installed\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "claude-code")).toBe(
      false,
    );
  });

  it("categorizes Gemini CLI as configured only for the stdio CLI entry", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} gemini`]: {
          exitCode: 0,
          stdout: "/usr/bin/gemini\n",
          stderr: "",
        },
        "gemini mcp list": {
          exitCode: 0,
          stdout:
            "✓ githits: npx -y githits@latest mcp start (stdio) - Connected\n",
          stderr: "",
        },
      },
    });

    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.alreadyConfigured.some((a) => a.id === "gemini-cli")).toBe(
      true,
    );
    expect(result.needsSetup.some((a) => a.id === "gemini-cli")).toBe(false);
  });

  it("categorizes CLI agent as needsSetup when check command does not match", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} claude`]: {
          exitCode: 0,
          stdout: "/usr/bin/claude\n",
          stderr: "",
        },
        "claude mcp list": {
          exitCode: 0,
          stdout: "other-plugin\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "claude-code")).toBe(
      false,
    );
  });

  it("categorizes CLI agent as needsSetup when check command fails (ENOENT)", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} claude`]: {
          exitCode: 0,
          stdout: "/usr/bin/claude\n",
          stderr: "",
        },
        "claude mcp list": Object.assign(new Error("spawn ENOENT"), {
          code: "ENOENT",
        }),
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(true);
  });

  it("detects agent via detectBinary when directory does not exist", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} opencode`]: {
          exitCode: 0,
          stdout: "/usr/bin/opencode\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "opencode")).toBe(true);
    expect(result.notDetected.some((a) => a.id === "opencode")).toBe(false);
  });

  it("detects Hermes Agent via hermes-agent binary when directory does not exist", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} hermes-agent`]: {
          exitCode: 0,
          stdout: "/usr/bin/hermes-agent\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "hermes-agent")).toBe(true);
    expect(result.notDetected.some((a) => a.id === "hermes-agent")).toBe(false);
  });

  it("does not detect Hermes Agent from generic hermes binary alone", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} hermes`]: {
          exitCode: 0,
          stdout: "/usr/bin/hermes\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.notDetected.some((a) => a.id === "hermes-agent")).toBe(true);
    expect(result.needsSetup.some((a) => a.id === "hermes-agent")).toBe(false);
  });

  it("detects codex via detectBinary when directory does not exist", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} codex`]: {
          exitCode: 0,
          stdout: "/usr/bin/codex\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "codex-cli")).toBe(true);
    expect(result.notDetected.some((a) => a.id === "codex-cli")).toBe(false);
  });

  it("passes timeout option to binary lookup probes", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({ detectedDirs: [] });

    await scanAgents(agentDefinitions, fs, execService);

    expect(execService.exec).toHaveBeenCalledWith(lookupCmd, ["codex"], {
      timeoutMs: 2_000,
    });
  });

  it("detects pi via detectBinary and requires adapter plus Pi-owned config", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} pi`]: {
          exitCode: 0,
          stdout: "/usr/bin/pi\n",
          stderr: "",
        },
        "pi list": {
          exitCode: 0,
          stdout: "npm:pi-mcp-adapter\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "pi")).toBe(true);
    expect(result.notDetected.some((a) => a.id === "pi")).toBe(false);
  });

  it("categorizes Codex CLI as alreadyConfigured when githits is a listed server row", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} codex`]: {
          exitCode: 0,
          stdout: "/usr/bin/codex\n",
          stderr: "",
        },
        "codex mcp list": {
          exitCode: 0,
          stdout: "githits  npx -y githits@latest mcp start\n",
          stderr: "",
        },
      },
    });

    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.alreadyConfigured.some((a) => a.id === "codex-cli")).toBe(
      true,
    );
    expect(result.needsSetup.some((a) => a.id === "codex-cli")).toBe(false);
  });

  it("keeps Codex CLI installable when config check times out", async () => {
    const lookupCmd = lookupCommandFor();
    const timeout = new Error("timed out");
    timeout.name = "ExecTimeoutError";
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} codex`]: {
          exitCode: 0,
          stdout: "/usr/bin/codex\n",
          stderr: "",
        },
        "codex mcp list": timeout,
      },
    });

    const result = await scanAgents(agentDefinitions, fs, execService);

    expect(result.needsSetup.some((a) => a.id === "codex-cli")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "codex-cli")).toBe(
      false,
    );
  });

  it("does not categorize Codex CLI as configured for incidental githits text", async () => {
    const lookupCmd = lookupCommandFor();
    const outputs = ["try githits docs\n", "not-githits\n"];

    for (const output of outputs) {
      const { fs, execService } = createScanMocks({
        detectedDirs: [],
        execResults: {
          [`${lookupCmd} codex`]: {
            exitCode: 0,
            stdout: "/usr/bin/codex\n",
            stderr: "",
          },
          "codex mcp list": {
            exitCode: 0,
            stdout: output,
            stderr: "",
          },
        },
      });

      const result = await scanAgents(agentDefinitions, fs, execService);
      expect(result.needsSetup.some((a) => a.id === "codex-cli")).toBe(true);
      expect(result.alreadyConfigured.some((a) => a.id === "codex-cli")).toBe(
        false,
      );
    }
  });

  it("detects pi from npm global bin when not on PATH", async () => {
    await withTestPlatform("linux", async () => {
      const lookupCmd = lookupCommandFor();
      const { fs, execService } = createScanMocks({
        detectedDirs: [],
        existingFiles: ["/npm-global/bin/pi"],
        execResults: {
          [`${lookupCmd} pi`]: { exitCode: 1, stdout: "", stderr: "" },
          "npm prefix -g": {
            exitCode: 0,
            stdout: "/npm-global\n",
            stderr: "",
          },
        },
      });
      const result = await scanAgents(agentDefinitions, fs, execService);
      const piAgent = result.needsSetup.find((a) => a.id === "pi");
      expect(piAgent).toBeDefined();
      const config = piAgent?.resolvedSetupConfig;
      expect(config?.method).toBe("composite");
      if (config?.method === "composite") {
        const installStep = config.steps[0]!;
        expect(installStep.method).toBe("cli");
        if (installStep.method === "cli") {
          expect(installStep.commands[0]!.command).toBe("/npm-global/bin/pi");
          expect(installStep.checkCommand?.command).toBe("/npm-global/bin/pi");
        }
      }
    });
  });

  it("passes timeout option to Pi global bin probes", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} pi`]: { exitCode: 1, stdout: "", stderr: "" },
      },
    });

    await scanAgents(agentDefinitions, fs, execService);

    expect(execService.exec).toHaveBeenCalledWith("npm", ["prefix", "-g"], {
      timeoutMs: 3_000,
    });
  });

  it("detects pi from pnpm global bin when npm candidate is missing", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      existingFiles: ["/pnpm-global/bin/pi"],
      execResults: {
        [`${lookupCmd} pi`]: { exitCode: 1, stdout: "", stderr: "" },
        "npm prefix -g": {
          exitCode: 0,
          stdout: "/npm-global\n",
          stderr: "",
        },
        "pnpm bin -g": {
          exitCode: 0,
          stdout: "/pnpm-global/bin\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    const piAgent = result.needsSetup.find((a) => a.id === "pi");
    expect(piAgent).toBeDefined();
    const config = piAgent?.resolvedSetupConfig;
    if (config?.method !== "composite") {
      throw new Error("expected pi composite setup");
    }
    const installStep = config.steps[0]!;
    if (installStep.method !== "cli") {
      throw new Error("expected pi cli setup step");
    }
    expect(installStep.commands[0]!.command).toBe("/pnpm-global/bin/pi");
  });

  it("detects pi from bun global bin when earlier candidates are missing", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      existingFiles: ["/bun-global/bin/pi"],
      execResults: {
        [`${lookupCmd} pi`]: { exitCode: 1, stdout: "", stderr: "" },
        "npm prefix -g": {
          exitCode: 0,
          stdout: "/npm-global\n",
          stderr: "",
        },
        "pnpm bin -g": {
          exitCode: 0,
          stdout: "/pnpm-global/bin\n",
          stderr: "",
        },
        "bun pm bin -g": {
          exitCode: 0,
          stdout: "/bun-global/bin\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    const piAgent = result.needsSetup.find((a) => a.id === "pi");
    expect(piAgent).toBeDefined();
    const config = piAgent?.resolvedSetupConfig;
    if (config?.method !== "composite") {
      throw new Error("expected pi composite setup");
    }
    const installStep = config.steps[0]!;
    if (installStep.method !== "cli") {
      throw new Error("expected pi cli setup step");
    }
    expect(installStep.commands[0]!.command).toBe("/bun-global/bin/pi");
  });

  it("does not detect pi when global bin candidates are missing", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        [`${lookupCmd} pi`]: { exitCode: 1, stdout: "", stderr: "" },
        "npm prefix -g": {
          exitCode: 0,
          stdout: "/npm-global\n",
          stderr: "",
        },
        "pnpm bin -g": {
          exitCode: 0,
          stdout: "/pnpm-global/bin\n",
          stderr: "",
        },
        "bun pm bin -g": {
          exitCode: 0,
          stdout: "/bun-global/bin\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.notDetected.some((a) => a.id === "pi")).toBe(true);
  });

  it("detects pi.cmd from npm global bin on win32", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    try {
      const piCmd = win32.join("C:\\npm", "pi.cmd");
      const { fs, execService } = createScanMocks({
        pathPlatform: "win32",
        detectedDirs: [],
        existingFiles: [piCmd],
        execResults: {
          "where pi": { exitCode: 1, stdout: "", stderr: "" },
          "npm prefix -g": {
            exitCode: 0,
            stdout: "C:\\npm\n",
            stderr: "",
          },
        },
      });
      const result = await scanAgents(agentDefinitions, fs, execService);
      const piAgent = result.needsSetup.find((a) => a.id === "pi");
      expect(piAgent).toBeDefined();
      const config = piAgent?.resolvedSetupConfig;
      if (config?.method !== "composite") {
        throw new Error("expected pi composite setup");
      }
      const installStep = config.steps[0]!;
      if (installStep.method !== "cli") {
        throw new Error("expected pi cli setup step");
      }
      expect(installStep.commands[0]!.command).toBe(piCmd);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("detects pi.cmd from npm global bin path with spaces on win32", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    try {
      const piCmd = win32.join(
        "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm",
        "pi.cmd",
      );
      const { fs, execService } = createScanMocks({
        pathPlatform: "win32",
        existingFiles: [piCmd],
        execResults: {
          "where pi": { exitCode: 1, stdout: "", stderr: "" },
          "npm prefix -g": {
            exitCode: 0,
            stdout: "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\n",
            stderr: "",
          },
        },
      });

      const result = await scanAgents(agentDefinitions, fs, execService);
      const piAgent = result.needsSetup.find((a) => a.id === "pi");
      const config = piAgent?.resolvedSetupConfig;
      if (config?.method !== "composite") {
        throw new Error("expected pi composite setup");
      }
      const installStep = config.steps[0]!;
      if (installStep.method !== "cli") {
        throw new Error("expected pi cli setup step");
      }
      expect(installStep.commands[0]!.command).toBe(piCmd);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("categorizes pi as alreadyConfigured when adapter and Pi-owned config exist", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      configFiles: {
        "/home/test/.pi/agent/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
              lifecycle: "eager",
            },
          },
        }),
        [win32.join("C:\\Users\\test", ".pi", "agent", "mcp.json")]:
          JSON.stringify({
            mcpServers: {
              GitHits: {
                command: "npx",
                args: ["-y", "githits@latest", "mcp", "start"],
              },
            },
          }),
      },
      execResults: {
        [`${lookupCmd} pi`]: {
          exitCode: 0,
          stdout: "/usr/bin/pi\n",
          stderr: "",
        },
        "pi list": {
          exitCode: 0,
          stdout: "npm:pi-mcp-adapter@1.0.0\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.alreadyConfigured.some((a) => a.id === "pi")).toBe(true);
    expect(result.needsSetup.some((a) => a.id === "pi")).toBe(false);
  });

  it("categorizes pi as alreadyConfigured with plain versioned adapter output", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      configFiles: {
        "/home/test/.pi/agent/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
              lifecycle: "eager",
            },
          },
        }),
      },
      execResults: {
        [`${lookupCmd} pi`]: {
          exitCode: 0,
          stdout: "/usr/bin/pi\n",
          stderr: "",
        },
        "pi list": {
          exitCode: 0,
          stdout: "pi-mcp-adapter@1.0.0\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.alreadyConfigured.some((a) => a.id === "pi")).toBe(true);
  });

  it("does not categorize pi as configured for similarly named adapter output", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      configFiles: {
        "/home/test/.pi/agent/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
              lifecycle: "eager",
            },
          },
        }),
      },
      execResults: {
        [`${lookupCmd} pi`]: {
          exitCode: 0,
          stdout: "/usr/bin/pi\n",
          stderr: "",
        },
        "pi list": {
          exitCode: 0,
          stdout: "pi-mcp-adapter-extra\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "pi")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "pi")).toBe(false);
  });
  it("detects opencode from config directory when binary is missing", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    try {
      const { fs, execService } = createScanMocks({
        detectedDirs: ["/home/test/.config/opencode"],
        configFiles: {
          "/home/test/.config/opencode/opencode.json": JSON.stringify({
            mcp: {},
          }),
        },
      });
      const result = await scanAgents(agentDefinitions, fs, execService);
      expect(result.notDetected.some((a) => a.id === "opencode")).toBe(false);
      expect(result.needsSetup.some((a) => a.id === "opencode")).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("detects opencode from desktop app data directory when binary is missing", async () => {
    const originalPlatform = process.platform;
    const originalXdgDataHome = process.env.XDG_DATA_HOME;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    process.env.XDG_DATA_HOME = "/home/test/.local/share";
    try {
      const { fs, execService } = createScanMocks({
        detectedDirs: ["/home/test/.local/share/ai.opencode.desktop"],
      });
      const result = await scanAgents(agentDefinitions, fs, execService);
      expect(result.notDetected.some((a) => a.id === "opencode")).toBe(false);
      expect(result.needsSetup.some((a) => a.id === "opencode")).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalXdgDataHome !== undefined) {
        process.env.XDG_DATA_HOME = originalXdgDataHome;
      } else {
        delete process.env.XDG_DATA_HOME;
      }
    }
  });

  it("detects opencode from desktop app data directory on darwin when binary is missing", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    try {
      const { fs, execService } = createScanMocks({
        detectedDirs: [
          "/home/test/Library/Application Support/ai.opencode.desktop",
        ],
      });
      const result = await scanAgents(agentDefinitions, fs, execService);
      expect(result.notDetected.some((a) => a.id === "opencode")).toBe(false);
      expect(result.needsSetup.some((a) => a.id === "opencode")).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("detects opencode from desktop app data directory on win32 when binary is missing", async () => {
    const originalPlatform = process.platform;
    const originalAppdata = process.env.APPDATA;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    try {
      const opencodeDesktopDir = win32.join(
        "C:\\Users\\test\\AppData\\Roaming",
        "ai.opencode.desktop",
      );
      const { fs, execService } = createScanMocks({
        pathPlatform: "win32",
        detectedDirs: [opencodeDesktopDir],
      });
      const result = await scanAgents(agentDefinitions, fs, execService);
      expect(result.notDetected.some((a) => a.id === "opencode")).toBe(false);
      expect(result.needsSetup.some((a) => a.id === "opencode")).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }
    }
  });

  it("detects Hermes Agent from default config directory when binary is missing", async () => {
    const originalHermesHome = process.env.HERMES_HOME;
    delete process.env.HERMES_HOME;
    try {
      const { fs, execService } = createScanMocks({
        detectedDirs: ["/home/test/.hermes"],
      });
      const result = await scanAgents(agentDefinitions, fs, execService);
      expect(result.notDetected.some((a) => a.id === "hermes-agent")).toBe(
        false,
      );
      expect(result.needsSetup.some((a) => a.id === "hermes-agent")).toBe(true);
    } finally {
      if (originalHermesHome !== undefined) {
        process.env.HERMES_HOME = originalHermesHome;
      }
    }
  });

  it("categorizes Hermes Agent as alreadyConfigured when YAML config has GitHits", async () => {
    const originalHermesHome = process.env.HERMES_HOME;
    delete process.env.HERMES_HOME;
    try {
      const { fs, execService } = createScanMocks({
        detectedDirs: ["/home/test/.hermes"],
        configFiles: {
          "/home/test/.hermes/config.yaml": [
            "mcp_servers:",
            "  GitHits:",
            '    command: "npx"',
            '    args: ["-y", "githits@latest", "mcp", "start"]',
            "",
          ].join("\n"),
        },
      });
      const result = await scanAgents(agentDefinitions, fs, execService);
      expect(
        result.alreadyConfigured.some((a) => a.id === "hermes-agent"),
      ).toBe(true);
      expect(result.needsSetup.some((a) => a.id === "hermes-agent")).toBe(
        false,
      );
    } finally {
      if (originalHermesHome !== undefined) {
        process.env.HERMES_HOME = originalHermesHome;
      }
    }
  });

  it("categorizes undetected agent as notDetected", async () => {
    const { fs, execService } = createScanMocks({ detectedDirs: [] });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.notDetected).toHaveLength(agentDefinitions.length);
    expect(result.needsSetup).toHaveLength(0);
    expect(result.alreadyConfigured).toHaveLength(0);
  });

  it("handles mixed scenario correctly", async () => {
    const lookupCmd = lookupCommandFor();
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.cursor", "/home/test/.codeium/windsurf"],
      configFiles: {
        "/home/test/.cursor/mcp.json": JSON.stringify({
          mcpServers: {
            GitHits: {
              url: "https://mcp.githits.com",
            },
          },
        }),
      },
      execResults: {
        [`${lookupCmd} claude`]: {
          exitCode: 0,
          stdout: "/usr/bin/claude\n",
          stderr: "",
        },
        "claude mcp list": {
          exitCode: 0,
          stdout: "githits: npx -y githits@latest mcp start\n",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    // claude-code: CLI + check matches -> alreadyConfigured
    expect(result.alreadyConfigured.some((a) => a.id === "claude-code")).toBe(
      true,
    );
    // cursor: config-file + configured -> alreadyConfigured
    expect(result.alreadyConfigured.some((a) => a.id === "cursor")).toBe(true);
    // windsurf: config-file + not configured -> needsSetup
    expect(result.needsSetup.some((a) => a.id === "windsurf")).toBe(true);
    // others: notDetected
    expect(result.notDetected.length).toBeGreaterThan(0);
  });

  it("does not detect CLI agents from stale dot-directories when binaries are missing", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: [
        "/home/test/.claude",
        "/home/test/.codex",
        "/home/test/.pi",
        "/home/test/.gemini",
      ],
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.notDetected.some((a) => a.id === "claude-code")).toBe(true);
    expect(result.notDetected.some((a) => a.id === "codex-cli")).toBe(true);
    expect(result.notDetected.some((a) => a.id === "pi")).toBe(true);
    expect(result.notDetected.some((a) => a.id === "gemini-cli")).toBe(true);
    expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(false);
    expect(result.needsSetup.some((a) => a.id === "codex-cli")).toBe(false);
    expect(result.needsSetup.some((a) => a.id === "pi")).toBe(false);
    expect(result.needsSetup.some((a) => a.id === "gemini-cli")).toBe(false);
  });

  /**
   * Generates the 5 comprehensive test cases for a given platform.
   * Platform-dependent paths (VS Code, Claude Desktop) vary; all others are home-relative dotdirs.
   */
  function defineComprehensiveTests(opts: {
    platform: string;
    appDataPrefix: string;
    envSetup?: () => void;
    envTeardown?: () => void;
  }) {
    const { platform, appDataPrefix } = opts;
    const isWin32 = platform === "win32";
    const homeDir = isWin32 ? "C:\\Users\\test" : "/home/test";
    const joinPath = (...segments: string[]) =>
      isWin32 ? win32.join(...segments) : segments.join("/");

    // Platform-independent detect dirs for path-detected agents
    const homeDirs = [
      joinPath(homeDir, ".cursor"),
      joinPath(homeDir, ".codeium", "windsurf"),
      joinPath(homeDir, ".cline"),
      joinPath(homeDir, ".gemini", "antigravity"),
      joinPath(homeDir, ".hermes"),
      joinPath(homeDir, ".config", "zed"),
      joinPath(homeDir, ".junie"),
      joinPath(homeDir, ".qwen"),
      joinPath(homeDir, ".kiro"),
      joinPath(homeDir, ".config", "kilo"),
      joinPath(homeDir, ".factory"),
    ];
    // Platform-dependent detect dirs
    const vscodePath = joinPath(appDataPrefix, "Code");
    const claudeDesktopPath = joinPath(appDataPrefix, "Claude");
    const opencodePath =
      platform === "win32"
        ? joinPath(appDataPrefix, "opencode")
        : joinPath(homeDir, ".config", "opencode");
    const allDetectDirs = [
      ...homeDirs,
      vscodePath,
      claudeDesktopPath,
      opencodePath,
    ];

    // Config files for all config-file agents with GitHits configured
    const allConfiguredFiles: Record<string, string> = {
      [joinPath(homeDir, ".cursor", "mcp.json")]: JSON.stringify({
        mcpServers: {
          GitHits: {
            url: "https://mcp.githits.com",
          },
        },
      }),
      [joinPath(homeDir, ".codeium", "windsurf", "mcp_config.json")]:
        JSON.stringify({
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
              lifecycle: "eager",
            },
          },
        }),
      [joinPath(vscodePath, "User", "mcp.json")]: JSON.stringify({
        servers: {
          GitHits: {
            type: "stdio",
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      [joinPath(
        homeDir,
        ".cline",
        "data",
        "settings",
        "cline_mcp_settings.json",
      )]: JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      [joinPath(claudeDesktopPath, "claude_desktop_config.json")]:
        JSON.stringify({
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        }),
      [joinPath(homeDir, ".pi", "agent", "mcp.json")]: JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
            lifecycle: "eager",
          },
        },
      }),
      [joinPath(homeDir, ".gemini", "config", "mcp_config.json")]:
        JSON.stringify({
          mcpServers: {
            GitHits: {
              command: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        }),
      [joinPath(opencodePath, "opencode.json")]: JSON.stringify({
        mcp: {
          GitHits: {
            type: "local",
            command: ["npx", "-y", "githits@latest", "mcp", "start"],
            enabled: true,
          },
        },
      }),
      [joinPath(homeDir, ".hermes", "config.yaml")]: [
        "mcp_servers:",
        "  GitHits:",
        '    command: "npx"',
        '    args: ["-y", "githits@latest", "mcp", "start"]',
        "",
      ].join("\n"),
      [joinPath(homeDir, ".config", "zed", "settings.json")]: JSON.stringify({
        context_servers: {
          GitHits: {
            source: "custom",
            command: {
              path: "npx",
              args: ["-y", "githits@latest", "mcp", "start"],
            },
          },
        },
      }),
      [joinPath(homeDir, ".junie", "mcp", "mcp.json")]: JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      [joinPath(homeDir, ".qwen", "settings.json")]: JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      [joinPath(homeDir, ".kiro", "settings", "mcp.json")]: JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
      [joinPath(homeDir, ".config", "kilo", "kilo.jsonc")]: JSON.stringify({
        mcp: {
          GitHits: {
            type: "local",
            command: ["npx", "-y", "githits@latest", "mcp", "start"],
            enabled: true,
          },
        },
      }),
      [joinPath(homeDir, ".factory", "mcp.json")]: JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "githits@latest", "mcp", "start"],
          },
        },
      }),
    };

    // Binary detection command varies by platform
    const whichCmd = platform === "win32" ? "where" : "which";

    // Exec results for CLI-like agents reporting configured + binary detection
    const allCliConfigured: Record<string, ExecResult> = {
      [`${whichCmd} claude`]: {
        exitCode: 0,
        stdout: "/usr/bin/claude\n",
        stderr: "",
      },
      "claude mcp list": {
        exitCode: 0,
        stdout: "githits: npx -y githits@latest mcp start\n",
        stderr: "",
      },
      [`${whichCmd} codex`]: {
        exitCode: 0,
        stdout: "/usr/bin/codex\n",
        stderr: "",
      },
      "codex mcp list": {
        exitCode: 0,
        stdout: "githits  npx -y githits@latest mcp start\n",
        stderr: "",
      },
      [`${whichCmd} pi`]: {
        exitCode: 0,
        stdout: "/usr/bin/pi\n",
        stderr: "",
      },
      "pi list": {
        exitCode: 0,
        stdout: "npm:pi-mcp-adapter\n",
        stderr: "",
      },
      [`${whichCmd} gemini`]: {
        exitCode: 0,
        stdout: "/usr/bin/gemini\n",
        stderr: "",
      },
      "gemini mcp list": {
        exitCode: 0,
        stdout:
          "✓ githits: npx -y githits@latest mcp start (stdio) - Connected\n",
        stderr: "",
      },
      [`${whichCmd} opencode`]: {
        exitCode: 0,
        stdout: "/usr/bin/opencode\n",
        stderr: "",
      },
      [`${whichCmd} hermes-agent`]: {
        exitCode: 0,
        stdout: "/usr/bin/hermes-agent\n",
        stderr: "",
      },
      [`${whichCmd} q`]: {
        exitCode: 0,
        stdout: "/usr/bin/q\n",
        stderr: "",
      },
      "q mcp list": {
        exitCode: 0,
        stdout: "githits\n",
        stderr: "",
      },
    };

    describe(`comprehensive all-agents scenarios (${platform})`, () => {
      const pathPlatform = platform === "win32" ? "win32" : "posix";
      const createScenarioScanMocks = (
        scenarioOpts: Parameters<typeof createScanMocks>[0],
      ) => createScanMocks({ ...scenarioOpts, pathPlatform });
      const originalPlatform = process.platform;
      beforeAll(() => {
        Object.defineProperty(process, "platform", {
          value: platform,
          configurable: true,
        });
        opts.envSetup?.();
      });
      afterAll(() => {
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
        opts.envTeardown?.();
      });

      it("all agents configured", async () => {
        const { fs, execService } = createScenarioScanMocks({
          detectedDirs: allDetectDirs,
          configFiles: allConfiguredFiles,
          execResults: allCliConfigured,
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.alreadyConfigured).toHaveLength(19);
        expect(result.needsSetup).toHaveLength(0);
        expect(result.notDetected).toHaveLength(0);
      });

      it("all agents detected but none configured", async () => {
        const unconfiguredFiles: Record<string, string> = {
          [joinPath(homeDir, ".cursor", "mcp.json")]: JSON.stringify({
            mcpServers: {},
          }),
          [joinPath(homeDir, ".codeium", "windsurf", "mcp_config.json")]:
            JSON.stringify({ mcpServers: {} }),
          [joinPath(vscodePath, "User", "mcp.json")]: JSON.stringify({
            servers: {},
          }),
          [joinPath(
            homeDir,
            ".cline",
            "data",
            "settings",
            "cline_mcp_settings.json",
          )]: JSON.stringify({ mcpServers: {} }),
          [joinPath(claudeDesktopPath, "claude_desktop_config.json")]:
            JSON.stringify({ mcpServers: {} }),
          [joinPath(homeDir, ".gemini", "config", "mcp_config.json")]:
            JSON.stringify({ mcpServers: {} }),
          [joinPath(opencodePath, "opencode.json")]: JSON.stringify({
            mcp: {},
          }),
          [joinPath(homeDir, ".hermes", "config.yaml")]: "mcp_servers: {}\n",
          [joinPath(homeDir, ".config", "zed", "settings.json")]:
            JSON.stringify({ context_servers: {} }),
          [joinPath(homeDir, ".junie", "mcp", "mcp.json")]: JSON.stringify({
            mcpServers: {},
          }),
          [joinPath(homeDir, ".qwen", "settings.json")]: JSON.stringify({
            mcpServers: {},
          }),
          [joinPath(homeDir, ".kiro", "settings", "mcp.json")]: JSON.stringify({
            mcpServers: {},
          }),
          [joinPath(homeDir, ".config", "kilo", "kilo.jsonc")]: JSON.stringify({
            mcp: {},
          }),
          [joinPath(homeDir, ".factory", "mcp.json")]: JSON.stringify({
            mcpServers: {},
          }),
        };
        const { fs, execService } = createScenarioScanMocks({
          detectedDirs: allDetectDirs,
          configFiles: unconfiguredFiles,
          execResults: {
            [`${whichCmd} claude`]: {
              exitCode: 0,
              stdout: "/usr/bin/claude\n",
              stderr: "",
            },
            [`${whichCmd} codex`]: {
              exitCode: 0,
              stdout: "/usr/bin/codex\n",
              stderr: "",
            },
            [`${whichCmd} gemini`]: {
              exitCode: 0,
              stdout: "/usr/bin/gemini\n",
              stderr: "",
            },
            [`${whichCmd} pi`]: {
              exitCode: 0,
              stdout: "/usr/bin/pi\n",
              stderr: "",
            },
            [`${whichCmd} opencode`]: {
              exitCode: 0,
              stdout: "/usr/bin/opencode\n",
              stderr: "",
            },
            [`${whichCmd} hermes-agent`]: {
              exitCode: 0,
              stdout: "/usr/bin/hermes-agent\n",
              stderr: "",
            },
            [`${whichCmd} q`]: {
              exitCode: 0,
              stdout: "/usr/bin/q\n",
              stderr: "",
            },
            "q mcp list": { exitCode: 0, stdout: "", stderr: "" },
          },
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.alreadyConfigured).toHaveLength(0);
        expect(result.needsSetup).toHaveLength(19);
        expect(result.notDetected).toHaveLength(0);
      });

      it("no agents detected", async () => {
        const { fs, execService } = createScenarioScanMocks({
          detectedDirs: [],
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.alreadyConfigured).toHaveLength(0);
        expect(result.needsSetup).toHaveLength(0);
        expect(result.notDetected).toHaveLength(19);
      });

      it("mixed: 3 configured, 4 unconfigured, 5 not detected", async () => {
        const { fs, execService } = createScenarioScanMocks({
          detectedDirs: [
            // Configured: cursor, claude-desktop, claude-code
            joinPath(homeDir, ".cursor"),
            claudeDesktopPath,
            // Unconfigured: windsurf, vscode
            joinPath(homeDir, ".codeium", "windsurf"),
            vscodePath,
            // CLI tools are detected via binary checks below
            // Not detected: cline, pi, gemini-cli, google-antigravity, hermes-agent
          ],
          configFiles: {
            [joinPath(homeDir, ".cursor", "mcp.json")]: JSON.stringify({
              mcpServers: {
                GitHits: {
                  url: "https://mcp.githits.com",
                },
              },
            }),
            [joinPath(claudeDesktopPath, "claude_desktop_config.json")]:
              JSON.stringify({
                mcpServers: {
                  GitHits: {
                    command: "npx",
                    args: ["-y", "githits@latest", "mcp", "start"],
                  },
                },
              }),
          },
          execResults: {
            [`${whichCmd} claude`]: {
              exitCode: 0,
              stdout: "/usr/bin/claude\n",
              stderr: "",
            },
            "claude mcp list": {
              exitCode: 0,
              stdout: "githits: npx -y githits@latest mcp start\n",
              stderr: "",
            },
            [`${whichCmd} codex`]: {
              exitCode: 0,
              stdout: "/usr/bin/codex\n",
              stderr: "",
            },
            "codex mcp list": { exitCode: 0, stdout: "", stderr: "" },
            [`${whichCmd} opencode`]: {
              exitCode: 0,
              stdout: "/usr/bin/opencode\n",
              stderr: "",
            },
          },
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.alreadyConfigured).toHaveLength(3);
        expect(result.needsSetup).toHaveLength(4);
        expect(result.notDetected).toHaveLength(12);

        expect(result.alreadyConfigured.map((a) => a.id).sort()).toEqual(
          ["claude-code", "claude-desktop", "cursor"].sort(),
        );
        expect(result.needsSetup.map((a) => a.id).sort()).toEqual(
          ["codex-cli", "opencode", "vscode", "windsurf"].sort(),
        );
        expect(result.notDetected.map((a) => a.id).sort()).toEqual(
          [
            "cline",
            "gemini-cli",
            "google-antigravity",
            "hermes-agent",
            "amazon-q-cli",
            "factory-droid",
            "junie",
            "kilo-code",
            "kiro",
            "pi",
            "qwen-code",
            "zed",
          ].sort(),
        );
      });

      it("CLI agent with ENOENT on check falls to needsSetup", async () => {
        const enoent = Object.assign(new Error("spawn ENOENT"), {
          code: "ENOENT",
        });
        const { fs, execService } = createScenarioScanMocks({
          detectedDirs: [],
          execResults: {
            [`${whichCmd} claude`]: {
              exitCode: 0,
              stdout: "/usr/bin/claude\n",
              stderr: "",
            },
            [`${whichCmd} codex`]: {
              exitCode: 0,
              stdout: "/usr/bin/codex\n",
              stderr: "",
            },
            [`${whichCmd} gemini`]: {
              exitCode: 0,
              stdout: "/usr/bin/gemini\n",
              stderr: "",
            },
            "claude mcp list": enoent,
            "codex mcp list": enoent,
            "gemini mcp list": enoent,
          },
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(
          true,
        );
        expect(result.needsSetup.some((a) => a.id === "codex-cli")).toBe(true);
        expect(result.needsSetup.some((a) => a.id === "gemini-cli")).toBe(true);
        expect(result.alreadyConfigured).toHaveLength(0);
      });

      it("does not treat an extension install as direct stdio configuration", async () => {
        const enoent = Object.assign(new Error("spawn ENOENT"), {
          code: "ENOENT",
        });
        const { fs, execService } = createScenarioScanMocks({
          detectedDirs: [joinPath(homeDir, ".gemini", "extensions", "githits")],
          existingFiles: [
            joinPath(
              homeDir,
              ".gemini",
              "extensions",
              "githits",
              "gemini-extension.json",
            ),
          ],
          execResults: {
            [`${whichCmd} gemini`]: {
              exitCode: 0,
              stdout: "/usr/bin/gemini\n",
              stderr: "",
            },
            "gemini mcp list": enoent,
          },
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(
          result.alreadyConfigured.some((a) => a.id === "gemini-cli"),
        ).toBe(false);
        expect(result.needsSetup.some((a) => a.id === "gemini-cli")).toBe(true);
      });

      it("gemini remote MCP output is not direct stdio configuration", async () => {
        const { fs, execService } = createScenarioScanMocks({
          detectedDirs: [],
          execResults: {
            [`${whichCmd} gemini`]: {
              exitCode: 0,
              stdout: "/usr/bin/gemini\n",
              stderr: "",
            },
            "gemini mcp list": {
              exitCode: 0,
              stdout: "✓ githits: https://mcp.githits.com (http) - Connected\n",
              stderr: "",
            },
          },
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.needsSetup.some((a) => a.id === "gemini-cli")).toBe(true);
      });

      it("gemini ignores incidental MCP output", async () => {
        const { fs, execService } = createScenarioScanMocks({
          detectedDirs: [joinPath(homeDir, ".gemini", "extensions", "githits")],
          existingFiles: [
            joinPath(
              homeDir,
              ".gemini",
              "extensions",
              "githits",
              "gemini-extension.json",
            ),
          ],
          execResults: {
            [`${whichCmd} gemini`]: {
              exitCode: 0,
              stdout: "/usr/bin/gemini\n",
              stderr: "",
            },
            "gemini mcp list": {
              exitCode: 0,
              stdout: "No githits MCP server installed\n",
              stderr: "",
            },
          },
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.needsSetup.some((a) => a.id === "gemini-cli")).toBe(true);
        expect(
          result.alreadyConfigured.some((a) => a.id === "gemini-cli"),
        ).toBe(false);
      });
    });
  }

  // macOS: ~/Library/Application Support/<app>
  defineComprehensiveTests({
    platform: "darwin",
    appDataPrefix: "/home/test/Library/Application Support",
  });

  // Linux: ~/.config/<app>
  defineComprehensiveTests({
    platform: "linux",
    appDataPrefix: "/home/test/.config",
  });

  // Windows: %APPDATA%\<app>
  let originalAppdata: string | undefined;
  defineComprehensiveTests({
    platform: "win32",
    appDataPrefix: "C:\\Users\\test\\AppData\\Roaming",
    envSetup: () => {
      originalAppdata = process.env.APPDATA;
      process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    },
    envTeardown: () => {
      if (originalAppdata !== undefined) {
        process.env.APPDATA = originalAppdata;
      } else {
        delete process.env.APPDATA;
      }
    },
  });
});

describe("buildCheckboxChoices", () => {
  it("marks detected agents as checked", () => {
    const choices = buildCheckboxChoices(agentDefinitions, [
      "claude-code",
      "cursor",
    ]);
    const claudeChoice = choices.find((c) => c.value === "claude-code")!;
    const cursorChoice = choices.find((c) => c.value === "cursor")!;
    const windsurfChoice = choices.find((c) => c.value === "windsurf")!;
    expect(claudeChoice.checked).toBe(true);
    expect(cursorChoice.checked).toBe(true);
    expect(windsurfChoice.checked).toBe(false);
  });

  it("appends (detected) to detected agent names", () => {
    const choices = buildCheckboxChoices(agentDefinitions, ["claude-code"]);
    const claudeChoice = choices.find((c) => c.value === "claude-code")!;
    const cursorChoice = choices.find((c) => c.value === "cursor")!;
    expect(claudeChoice.name).toContain("(detected)");
    expect(cursorChoice.name).not.toContain("(detected)");
  });

  it("returns one choice per agent definition", () => {
    const choices = buildCheckboxChoices(agentDefinitions, []);
    expect(choices).toHaveLength(agentDefinitions.length);
  });
});
