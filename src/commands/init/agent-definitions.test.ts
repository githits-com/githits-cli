import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type { ExecResult } from "../../services/exec-service.js";
import {
  createMockExecService,
  createMockFileSystemService,
} from "../../services/test-helpers.js";
import {
  agentDefinitions,
  buildCheckboxChoices,
  detectAgents,
  scanAgents,
} from "./agent-definitions.js";

describe("agentDefinitions", () => {
  it("defines 10 agents", () => {
    expect(agentDefinitions).toHaveLength(10);
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

describe("detectPaths", () => {
  it("claude-code uses ~/.claude/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    const paths = agent.detectPaths(fs);
    expect(paths).toEqual(["/home/test/.claude"]);
  });

  it("cursor uses ~/.cursor/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "cursor")!;
    const paths = agent.detectPaths(fs);
    expect(paths).toEqual(["/home/test/.cursor"]);
  });

  it("codex-cli uses ~/.codex/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "codex-cli")!;
    const paths = agent.detectPaths(fs);
    expect(paths).toEqual(["/home/test/.codex"]);
  });

  it("windsurf detects via ~/.codeium/windsurf/ directory", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "windsurf")!;
    const paths = agent.detectPaths(fs);
    expect(paths).toEqual(["/home/test/.codeium/windsurf"]);
  });

  it("cline uses ~/.cline/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "cline")!;
    const paths = agent.detectPaths(fs);
    expect(paths).toEqual(["/home/test/.cline"]);
  });

  it("gemini-cli uses ~/.gemini/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "gemini-cli")!;
    const paths = agent.detectPaths(fs);
    expect(paths).toEqual(["/home/test/.gemini"]);
  });

  it("google-antigravity uses ~/.gemini/antigravity/", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "google-antigravity")!;
    const paths = agent.detectPaths(fs);
    expect(paths).toEqual(["/home/test/.gemini/antigravity"]);
  });

  it("opencode has both directory and binary detection", () => {
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
      const agent = agentDefinitions.find((a) => a.id === "opencode")!;
      expect(agent.detectPaths(fs)).toEqual(["/home/test/.config/opencode"]);
      expect(agent.detectBinary).toBeDefined();
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("opencode returns APPDATA path on win32", () => {
    const originalPlatform = process.platform;
    const originalAppdata = process.env.APPDATA;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "C:\\Users\\test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "opencode")!;
      const paths = agent.detectPaths(fs);
      expect(paths).toEqual(["C:\\Users\\test\\AppData\\Roaming/opencode"]);
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
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "C:\\Users\\test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const paths = agent.detectPaths(fs);
      expect(paths).toHaveLength(3);
      expect(paths[0]).toContain("Roaming");
      expect(paths[1]).toContain("Local/Claude");
      expect(paths[2]).toContain("Local/Programs/Claude");
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
      const paths = agent.detectPaths(fs);
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
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "C:\\Users\\test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const paths = agent.detectPaths(fs);
      expect(paths).toHaveLength(3);
      expect(paths[1]).toBe("C:\\Users\\test/AppData/Local/Claude");
      expect(paths[2]).toBe("C:\\Users\\test/AppData/Local/Programs/Claude");
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
        expect(exec.exec).toHaveBeenCalledWith("which", [testCase.binary]);
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
      expect(exec.exec).toHaveBeenCalledWith("where", ["claude"]);
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

  it("all agents use FileSystemService.getHomeDir (not hardcoded)", () => {
    const originalPlatform = process.platform;
    const originalAppdata = process.env.APPDATA;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    delete process.env.APPDATA;
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/custom/home"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      for (const agent of agentDefinitions) {
        const paths = agent.detectPaths(fs);
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
    }
  });
});

describe("getSetupConfig", () => {
  it("claude-code returns CLI setup with plugin install commands", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.commands).toHaveLength(2);
      expect(config.commands[0]!.command).toBe("claude");
      expect(config.commands[0]!.args).toContain("plugin");
      expect(config.commands[0]!.args).toContain("marketplace");
      expect(config.commands[0]!.args).toContain("add");
      expect(config.commands[0]!.args).toContain(
        "githits-com/githits-claude-code-plugin",
      );
      expect(config.commands[1]!.command).toBe("claude");
      expect(config.commands[1]!.args).toContain("plugin");
      expect(config.commands[1]!.args).toContain("install");
      expect(config.commands[1]!.args).toContain("githits@githits-plugins");
    }
  });

  it("cursor returns config-file setup with native url", () => {
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
      expect(config.serverConfig).toHaveProperty("url");
      expect(config.serverConfig).not.toHaveProperty("command");
    }
  });

  it("windsurf returns config-file setup with native serverUrl", () => {
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
      expect(config.serverConfig).toHaveProperty("serverUrl");
      expect(config.serverConfig).not.toHaveProperty("command");
    }
  });

  it("claude-desktop returns config-file setup with mcp-remote", () => {
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
      expect(config.serverConfig).toHaveProperty("command", "npx");
      const args = config.serverConfig.args as string[];
      expect(args).toContain("mcp-remote");
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
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "C:\\Users\\test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const config = agent.getSetupConfig(fs);
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          "C:\\Users\\test\\AppData\\Roaming/Claude/claude_desktop_config.json",
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
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "C:\\Users\\test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      const agent = agentDefinitions.find((a) => a.id === "claude-desktop")!;
      const config = agent.getSetupConfig(fs);
      if (config.method === "config-file") {
        expect(config.configPath).toBe(
          "C:\\Users\\test/AppData/Roaming/Claude/claude_desktop_config.json",
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

  it("codex-cli returns CLI setup with npm/stdio command", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "codex-cli")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.commands).toHaveLength(1);
      expect(config.commands[0]!.command).toBe("codex");
      expect(config.commands[0]!.args).toContain("mcp");
      expect(config.commands[0]!.args).toContain("add");
      expect(config.commands[0]!.args).toContain("githits");
      expect(config.commands[0]!.args).toContain("githits@latest");
    }
  });

  it("vscode returns config-file setup with servers key and http type", () => {
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
          url: "https://mcp.githits.com",
          type: "http",
        });
      }
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("cline returns config-file setup with streamableHttp type", () => {
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
        url: "https://mcp.githits.com",
        type: "streamableHttp",
      });
    }
  });

  it("gemini-cli returns CLI setup with extensions install", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "gemini-cli")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.commands).toHaveLength(1);
      expect(config.commands[0]!.command).toBe("gemini");
      expect(config.commands[0]!.args).toContain("extensions");
      expect(config.commands[0]!.args).toContain("install");
      expect(config.commands[0]!.args).toContain(
        "https://github.com/githits-com/githits-gemini-cli",
      );
    }
  });

  it("google-antigravity returns config-file setup with serverUrl", () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
    });
    const agent = agentDefinitions.find((a) => a.id === "google-antigravity")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("config-file");
    if (config.method === "config-file") {
      expect(config.configPath).toBe(
        "/home/test/.gemini/antigravity/mcp_config.json",
      );
      expect(config.serversKey).toBe("mcpServers");
      expect(config.serverName).toBe("GitHits");
      expect(config.serverConfig).toEqual({
        serverUrl: "https://mcp.githits.com",
      });
    }
  });

  it("opencode returns config-file setup with mcp serversKey and array command", () => {
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

  it("claude-desktop is the only config-file agent using mcp-remote", () => {
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
        if (agent.id === "claude-desktop") {
          expect(config.serverConfig).toHaveProperty("command", "npx");
          const args = config.serverConfig.args as string[];
          expect(args).toContain("mcp-remote");
        } else {
          // No agent other than claude-desktop should use mcp-remote
          const args = config.serverConfig.args;
          if (Array.isArray(args)) {
            expect(args).not.toContain("mcp-remote");
          }
        }
      }
    }
  });

  it("uses GITHITS_MCP_URL env var when set", () => {
    const originalUrl = process.env.GITHITS_MCP_URL;
    process.env.GITHITS_MCP_URL = "https://staging.mcp.example.com";
    try {
      const fs = createMockFileSystemService({
        getHomeDir: mock(() => "/home/test"),
        joinPath: mock((...segments: string[]) => segments.join("/")),
      });
      // Check a config-file agent
      const cursor = agentDefinitions.find((a) => a.id === "cursor")!;
      const cursorConfig = cursor.getSetupConfig(fs);
      if (cursorConfig.method === "config-file") {
        expect(cursorConfig.serverConfig).toHaveProperty(
          "url",
          "https://staging.mcp.example.com",
        );
      }
    } finally {
      if (originalUrl !== undefined) {
        process.env.GITHITS_MCP_URL = originalUrl;
      } else {
        delete process.env.GITHITS_MCP_URL;
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
    expect(detected).toContain("claude-code");
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
    // detectAgents (deprecated) only checks detectPaths, not detectBinary
    // All agents now have detectPaths, so all should be detected
    expect(detected).toHaveLength(agentDefinitions.length);
    expect(detected).toContain("opencode");
  });
});

describe("scanAgents", () => {
  /** Helper to create fs + exec mocks for scan tests */
  function createScanMocks(opts: {
    detectedDirs: string[];
    configFiles?: Record<string, string>;
    execResults?: Record<string, ExecResult | Error>;
  }) {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
      isDirectory: mock(async (path: string) =>
        opts.detectedDirs.includes(path),
      ),
      readFile: mock(async (path: string) => {
        if (opts.configFiles && path in opts.configFiles) {
          return opts.configFiles[path]!;
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }),
    });
    const execService = createMockExecService({
      exec: mock(async (cmd: string, args: string[]) => {
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

  it("categorizes config-file agent as alreadyConfigured when config has GitHits", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.cursor"],
      configFiles: {
        "/home/test/.cursor/mcp.json": JSON.stringify({
          mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
        }),
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.alreadyConfigured.some((a) => a.id === "cursor")).toBe(true);
    expect(result.needsSetup.some((a) => a.id === "cursor")).toBe(false);
  });

  it("categorizes config-file agent as needsSetup when config file is missing", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.cursor"],
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "cursor")).toBe(true);
    expect(result.alreadyConfigured.some((a) => a.id === "cursor")).toBe(false);
  });

  it("categorizes CLI agent as alreadyConfigured when check command matches", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.claude"],
      execResults: {
        "claude plugin list": {
          exitCode: 0,
          stdout: "githits-plugin\nother\n",
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

  it("categorizes CLI agent as needsSetup when check command does not match", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.claude"],
      execResults: {
        "claude plugin list": {
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
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.claude"],
      execResults: {
        "claude plugin list": Object.assign(new Error("spawn ENOENT"), {
          code: "ENOENT",
        }),
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "claude-code")).toBe(true);
  });

  it("detects agent via detectBinary when directory does not exist", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        "which opencode": {
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

  it("detects codex via detectBinary when directory does not exist", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: [],
      execResults: {
        "which codex": {
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

  it("falls back to codex directory detection when binary is not on PATH", async () => {
    const { fs, execService } = createScanMocks({
      detectedDirs: ["/home/test/.codex"],
      execResults: {
        "which codex": {
          exitCode: 1,
          stdout: "",
          stderr: "",
        },
      },
    });
    const result = await scanAgents(agentDefinitions, fs, execService);
    expect(result.needsSetup.some((a) => a.id === "codex-cli")).toBe(true);
    expect(result.notDetected.some((a) => a.id === "codex-cli")).toBe(false);
  });

  it("detects opencode via directory fallback when binary not on PATH", async () => {
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
      expect(result.needsSetup.some((a) => a.id === "opencode")).toBe(true);
      expect(result.notDetected.some((a) => a.id === "opencode")).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
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
    const { fs, execService } = createScanMocks({
      detectedDirs: [
        "/home/test/.claude",
        "/home/test/.cursor",
        "/home/test/.codeium/windsurf",
      ],
      configFiles: {
        "/home/test/.cursor/mcp.json": JSON.stringify({
          mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
        }),
      },
      execResults: {
        "claude plugin list": {
          exitCode: 0,
          stdout: "githits-plugin\n",
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

    // Platform-independent detect dirs (home-relative dotdirs)
    const homeDirs = [
      "/home/test/.claude",
      "/home/test/.cursor",
      "/home/test/.codeium/windsurf",
      "/home/test/.cline",
      "/home/test/.codex",
      "/home/test/.gemini",
      "/home/test/.gemini/antigravity",
    ];
    // Platform-dependent detect dirs
    const vscodePath = `${appDataPrefix}/Code`;
    const claudeDesktopPath = `${appDataPrefix}/Claude`;
    const opencodePath =
      platform === "win32"
        ? `${appDataPrefix}/opencode`
        : "/home/test/.config/opencode";
    const allDetectDirs = [
      ...homeDirs,
      vscodePath,
      claudeDesktopPath,
      opencodePath,
    ];

    // Config files for all config-file agents with GitHits configured
    const allConfiguredFiles: Record<string, string> = {
      "/home/test/.cursor/mcp.json": JSON.stringify({
        mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
      }),
      "/home/test/.codeium/windsurf/mcp_config.json": JSON.stringify({
        mcpServers: { GitHits: { serverUrl: "https://mcp.githits.com" } },
      }),
      [`${vscodePath}/User/mcp.json`]: JSON.stringify({
        servers: { GitHits: { url: "https://mcp.githits.com", type: "http" } },
      }),
      "/home/test/.cline/data/settings/cline_mcp_settings.json": JSON.stringify(
        {
          mcpServers: {
            GitHits: { url: "https://mcp.githits.com", type: "streamableHttp" },
          },
        },
      ),
      [`${claudeDesktopPath}/claude_desktop_config.json`]: JSON.stringify({
        mcpServers: {
          GitHits: {
            command: "npx",
            args: ["-y", "mcp-remote", "https://mcp.githits.com"],
          },
        },
      }),
      "/home/test/.gemini/antigravity/mcp_config.json": JSON.stringify({
        mcpServers: { GitHits: { serverUrl: "https://mcp.githits.com" } },
      }),
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

    // Binary detection command varies by platform
    const whichCmd = platform === "win32" ? "where" : "which";

    // Exec results for all CLI agents reporting configured + binary detection
    const allCliConfigured: Record<string, ExecResult> = {
      "claude plugin list": {
        exitCode: 0,
        stdout: "githits-plugin\n",
        stderr: "",
      },
      "codex mcp list": {
        exitCode: 0,
        stdout: "githits  npx -y githits@latest mcp start\n",
        stderr: "",
      },
      "gemini extensions list": {
        exitCode: 0,
        stdout: "githits-gemini-cli\n",
        stderr: "",
      },
      [`${whichCmd} opencode`]: {
        exitCode: 0,
        stdout: "/usr/bin/opencode\n",
        stderr: "",
      },
    };

    describe(`comprehensive all-agents scenarios (${platform})`, () => {
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
        const { fs, execService } = createScanMocks({
          detectedDirs: allDetectDirs,
          configFiles: allConfiguredFiles,
          execResults: allCliConfigured,
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.alreadyConfigured).toHaveLength(10);
        expect(result.needsSetup).toHaveLength(0);
        expect(result.notDetected).toHaveLength(0);
      });

      it("all agents detected but none configured", async () => {
        const unconfiguredFiles: Record<string, string> = {
          "/home/test/.cursor/mcp.json": JSON.stringify({ mcpServers: {} }),
          "/home/test/.codeium/windsurf/mcp_config.json": JSON.stringify({
            mcpServers: {},
          }),
          [`${vscodePath}/User/mcp.json`]: JSON.stringify({ servers: {} }),
          "/home/test/.cline/data/settings/cline_mcp_settings.json":
            JSON.stringify({ mcpServers: {} }),
          [`${claudeDesktopPath}/claude_desktop_config.json`]: JSON.stringify({
            mcpServers: {},
          }),
          "/home/test/.gemini/antigravity/mcp_config.json": JSON.stringify({
            mcpServers: {},
          }),
          "/home/test/.config/opencode/opencode.json": JSON.stringify({
            mcp: {},
          }),
        };
        const { fs, execService } = createScanMocks({
          detectedDirs: allDetectDirs,
          configFiles: unconfiguredFiles,
          execResults: {
            [`${whichCmd} opencode`]: {
              exitCode: 0,
              stdout: "/usr/bin/opencode\n",
              stderr: "",
            },
          },
        });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.alreadyConfigured).toHaveLength(0);
        expect(result.needsSetup).toHaveLength(10);
        expect(result.notDetected).toHaveLength(0);
      });

      it("no agents detected", async () => {
        const { fs, execService } = createScanMocks({ detectedDirs: [] });
        const result = await scanAgents(agentDefinitions, fs, execService);
        expect(result.alreadyConfigured).toHaveLength(0);
        expect(result.needsSetup).toHaveLength(0);
        expect(result.notDetected).toHaveLength(10);
      });

      it("mixed: 3 configured, 4 unconfigured, 3 not detected", async () => {
        const { fs, execService } = createScanMocks({
          detectedDirs: [
            // Configured: cursor, claude-desktop, claude-code
            "/home/test/.cursor",
            claudeDesktopPath,
            "/home/test/.claude",
            // Unconfigured: windsurf, vscode, codex-cli
            "/home/test/.codeium/windsurf",
            vscodePath,
            "/home/test/.codex",
            // opencode detected via binary (below), not directory
            // Not detected: cline, gemini-cli, google-antigravity
          ],
          configFiles: {
            "/home/test/.cursor/mcp.json": JSON.stringify({
              mcpServers: { GitHits: { url: "https://mcp.githits.com" } },
            }),
            [`${claudeDesktopPath}/claude_desktop_config.json`]: JSON.stringify(
              {
                mcpServers: { GitHits: { command: "npx" } },
              },
            ),
          },
          execResults: {
            "claude plugin list": {
              exitCode: 0,
              stdout: "githits-plugin\n",
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
        expect(result.notDetected).toHaveLength(3);

        expect(result.alreadyConfigured.map((a) => a.id).sort()).toEqual(
          ["claude-code", "claude-desktop", "cursor"].sort(),
        );
        expect(result.needsSetup.map((a) => a.id).sort()).toEqual(
          ["codex-cli", "opencode", "vscode", "windsurf"].sort(),
        );
        expect(result.notDetected.map((a) => a.id).sort()).toEqual(
          ["cline", "gemini-cli", "google-antigravity"].sort(),
        );
      });

      it("CLI agent with ENOENT on check falls to needsSetup", async () => {
        const enoent = Object.assign(new Error("spawn ENOENT"), {
          code: "ENOENT",
        });
        const { fs, execService } = createScanMocks({
          detectedDirs: [
            "/home/test/.claude",
            "/home/test/.codex",
            "/home/test/.gemini",
          ],
          execResults: {
            "claude plugin list": enoent,
            "codex mcp list": enoent,
            "gemini extensions list": enoent,
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

  // Windows: %APPDATA%/<app> (mock joinPath still uses /)
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
