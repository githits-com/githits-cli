import { describe, expect, it, mock } from "bun:test";
import { createMockFileSystemService } from "../../services/test-helpers.js";
import {
  type AgentDefinition,
  agentDefinitions,
  buildCheckboxChoices,
  detectAgents,
} from "./agent-definitions.js";

describe("agentDefinitions", () => {
  it("defines 5 agents", () => {
    expect(agentDefinitions).toHaveLength(5);
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

  it("all agents use FileSystemService.getHomeDir (not hardcoded)", () => {
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
  });
});

describe("getSetupConfig", () => {
  it("claude-code returns CLI setup with claude command", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "claude-code")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.command).toBe("claude");
      expect(config.args).toContain("mcp");
      expect(config.args).toContain("add");
      expect(config.args).toContain("--transport");
      expect(config.args).toContain("http");
      expect(config.args).toContain("GitHits");
      expect(config.args).toContain("--scope");
      expect(config.args).toContain("user");
    }
  });

  it("cursor returns config-file setup targeting mcp.json", () => {
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
      expect(config.serverConfig).toHaveProperty("command", "npx");
    }
  });

  it("claude-desktop returns config-file setup", () => {
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

  it("codex-cli returns CLI setup with codex command", () => {
    const fs = createMockFileSystemService();
    const agent = agentDefinitions.find((a) => a.id === "codex-cli")!;
    const config = agent.getSetupConfig(fs);
    expect(config.method).toBe("cli");
    if (config.method === "cli") {
      expect(config.command).toBe("codex");
      expect(config.args).toContain("mcp");
      expect(config.args).toContain("add");
      expect(config.args).toContain("GitHits");
    }
  });

  it("windsurf returns config-file setup targeting ~/.codeium/windsurf/mcp_config.json", () => {
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
    }
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

  it("config-file agents use mcp-remote with getMcpUrl()", () => {
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
        expect(config.serverConfig).toHaveProperty("command", "npx");
        const args = config.serverConfig.args as string[];
        expect(args).toContain("mcp-remote");
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
        const args = cursorConfig.serverConfig.args as string[];
        expect(args).toContain("https://staging.mcp.example.com");
      }
      // Check a CLI agent
      const claude = agentDefinitions.find((a) => a.id === "claude-code")!;
      const claudeConfig = claude.getSetupConfig(fs);
      if (claudeConfig.method === "cli") {
        expect(claudeConfig.args).toContain("https://staging.mcp.example.com");
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

  it("returns all ids when all agents detected", async () => {
    const fs = createMockFileSystemService({
      getHomeDir: mock(() => "/home/test"),
      joinPath: mock((...segments: string[]) => segments.join("/")),
      isDirectory: mock(() => Promise.resolve(true)),
    });
    const detected = await detectAgents(agentDefinitions, fs);
    expect(detected).toHaveLength(agentDefinitions.length);
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
