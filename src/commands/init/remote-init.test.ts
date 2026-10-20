import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  createMockExecService,
  createMockFileSystemService,
  createMockPromptService,
} from "../../services/test-helpers.js";
import { agentDefinitions } from "./agent-definitions.js";
import { GITHITS_SKILL_CATALOG } from "./guidance-assets.js";
import { type InitOptions, initAction, initUninstallAction } from "./init.js";

const MCP_URL = "https://mcp.githits.com";
const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/githits";
const LOCAL = {
  command: "npx",
  args: ["-y", "githits@latest", "mcp", "start"],
};
const CLINE = "/home/remote-test/.cline/data/settings/cline_mcp_settings.json";
const OPEN = "/home/remote-test/.config/opencode/opencode.json";
let log: ReturnType<typeof spyOn>;
let error: ReturnType<typeof spyOn>;
let oldExit: typeof process.exitCode;
beforeEach(() => {
  oldExit = process.exitCode;
  process.exitCode = 0;
  log = spyOn(console, "log").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.exitCode = oldExit;
  log.mockRestore();
  error.mockRestore();
});

function fixture(ids: string[], seed: Record<string, string> = {}) {
  const files = { ...seed };
  const directories = new Set<string>();
  const fs = createMockFileSystemService({
    getHomeDir: () => "/home/remote-test",
    getCwd: () => "/repo",
    joinPath: join,
  });
  for (const agent of agentDefinitions.filter((agent) =>
    ids.includes(agent.id),
  ))
    for (const path of agent.detectPaths?.(fs) ?? []) directories.add(path);
  const skills = new Map<string, string>(
    GITHITS_SKILL_CATALOG.map((skill) => [
      skill.name,
      readFileSync(
        new URL(`../../../skills/${skill.name}/SKILL.md`, import.meta.url),
        "utf8",
      ),
    ]),
  );
  fs.isDirectory = mock(
    async (path: string) => directories.has(path) || path === "/repo",
  );
  fs.exists = mock(
    async (path: string) => path in files || directories.has(path),
  );
  fs.readFile = mock(async (path: string) => {
    if (path in files) return files[path]!;
    // Read only packaged source fixtures; installed destination files must exist in the map.
    const name = path.match(/\/skills\/(githits-[^/]+)\/SKILL\.md$/)?.[1];
    if (name && !path.startsWith("/home/") && !path.startsWith("/repo/")) {
      const source = skills.get(name);
      if (source !== undefined) return source;
    }
    throw Object.assign(new Error("Not found"), { code: "ENOENT" });
  });
  fs.atomicWriteFile = mock(async (path: string, content: string) => {
    files[path] = content;
  });
  fs.writeFile = mock(async (path: string, content: string) => {
    files[path] = content;
  });
  fs.deleteFile = mock(async (path: string) => {
    delete files[path];
  });
  const createLoginDeps = mock(async () => {
    throw new Error("Local auth factory must be explicitly needed");
  });
  const deps = {
    fileSystemService: fs,
    promptService: createMockPromptService(),
    execService: createMockExecService({
      exec: mock(async (command: string, args: string[]) => {
        const binaries: Record<string, string> = {
          "amazon-q-cli": "q",
          "codex-cli": "codex",
          "claude-code": "claude",
          pi: "pi",
        };
        if (
          (command === "which" || command === "where") &&
          ids.some((id) => binaries[id] === args[0])
        )
          return { exitCode: 0, stdout: `/bin/${args[0]}`, stderr: "" };
        if (command === "codex" && args[0] === "--version")
          return { exitCode: 0, stdout: "codex 0.163.0", stderr: "" };
        if (command === "codex" && args[0] === "mcp" && args[1] === "get") {
          const source = files["/home/remote-test/.codex/config.toml"];
          const entry = source
            ? (
                parseToml(source).mcp_servers as Record<
                  string,
                  Record<string, unknown>
                >
              )?.githits
            : undefined;
          return entry
            ? {
                exitCode: 0,
                stdout: JSON.stringify({
                  name: "githits",
                  enabled: entry.enabled !== false,
                  transport: entry.url
                    ? { type: "streamable_http", url: entry.url }
                    : {
                        type: "stdio",
                        command: entry.command,
                        args: entry.args,
                      },
                }),
                stderr: "",
              }
            : {
                exitCode: 1,
                stdout: "",
                stderr: "Error: No MCP server named 'githits' found.",
              };
        }
        if (command === "q" && args[0] === "mcp" && args[1] === "add") {
          files["/home/remote-test/.aws/amazonq/mcp.json"] = JSON.stringify({
            mcpServers: {
              githits: {
                type: "stdio",
                ...LOCAL,
                url: "",
                headers: {},
                oauthScopes: [],
              },
            },
          });
          return { exitCode: 0, stdout: "Added", stderr: "" };
        }
        if (command === "pi" && args[0] === "list")
          return { exitCode: 0, stdout: "pi-mcp-adapter", stderr: "" };
        return { exitCode: 1, stdout: "", stderr: "" };
      }),
    }),
    createLoginDeps,
    isInteractive: true,
  };
  return {
    files,
    fs,
    deps,
    createLoginDeps,
    run: async (options: InitOptions) => {
      log.mockClear();
      await initAction(options, deps);
      return log.mock.calls
        .map((call: unknown[]) => String(call[0] ?? ""))
        .join("\n");
    },
    json: () => JSON.parse(String(log.mock.calls[0]?.[0] ?? "{}")),
  };
}

describe("remote init profile", () => {
  it("defaults interactive setup to hosted MCP and only the MCP skill without local auth", async () => {
    const f = fixture(["cline"]);
    await f.run({});
    expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits).toEqual({
      type: "streamableHttp",
      url: MCP_URL,
    });
    expect(f.deps.promptService.select).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ value: "remote-guided" }),
      ]),
      "remote-guided",
    );
    expect(
      Object.keys(f.files).filter((path) => path.endsWith("/SKILL.md")),
    ).toEqual(["/home/remote-test/.agents/skills/githits-mcp/SKILL.md"]);
    expect(f.createLoginDeps).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
  it("retains the explicit remote selector and no-guidance in staged detect follow-ups", async () => {
    const f = fixture(["cline"]);
    await f.run({
      remote: true,
      guidance: false,
      detectAgents: true,
      json: true,
    });
    const payload = f.json();
    expect(payload.setupProfile).toBe("remote");
    expect(payload.suggestedCommand).toContain("--remote --no-guidance");
    expect(
      payload.agents.find((agent: { id: string }) => agent.id === "cline")
        .transport,
    ).toBe("http");
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(f.createLoginDeps).not.toHaveBeenCalled();
  });
  it("preserves hosted transport on no-selector detection and install, preserving extra CLI skills", async () => {
    const extra = "/home/remote-test/.agents/skills/githits-code/SKILL.md";
    const f = fixture(["cline"], {
      [CLINE]: JSON.stringify({
        mcpServers: {
          GitHits: { type: "streamableHttp", url: MCP_URL, autoApprove: [] },
        },
      }),
      [extra]: "existing CLI guidance",
    });
    await f.run({ detectAgents: true, json: true });
    let payload = f.json();
    expect(payload.setupProfile).toBe("preserve");
    expect(payload.installableIds).toEqual([]);
    expect(payload.suggestedCommand).not.toContain("--remote");
    await f.run({ installAgents: "cline", json: true });
    payload = f.json();
    expect(payload.outcomes[0].status).toBe("already_configured");
    expect(payload.auth.status).toBe("managed_by_host");
    expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits.autoApprove).toEqual(
      [],
    );
    expect(f.files[extra]).toBe("existing CLI guidance");
    expect(f.createLoginDeps).not.toHaveBeenCalled();
  });
  it("preserves hosted transport during no-selector yes reruns", async () => {
    const f = fixture(["cline"], {
      [CLINE]: JSON.stringify({
        mcpServers: { GitHits: { type: "streamableHttp", url: MCP_URL } },
      }),
    });
    await f.run({ yes: true });
    expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits.url).toBe(MCP_URL);
    expect(f.createLoginDeps).not.toHaveBeenCalled();
  });
  it("keeps fresh no-selector staged setup local-first", async () => {
    const f = fixture(["cline"]);
    await f.run({ installAgents: "cline", guidance: false, json: true });
    expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits).toEqual(LOCAL);
    expect(f.createLoginDeps).toHaveBeenCalledTimes(1);
  });
  it("migrates explicit local to remote without local login", async () => {
    const f = fixture(["cline"], {
      [CLINE]: JSON.stringify({
        mcpServers: { GitHits: LOCAL, other: { command: "other" } },
      }),
    });
    await f.run({
      remote: true,
      installAgents: "cline",
      guidance: false,
      json: true,
    });
    expect(JSON.parse(f.files[CLINE]!).mcpServers).toEqual({
      GitHits: { type: "streamableHttp", url: MCP_URL },
      other: { command: "other" },
    });
    expect(f.createLoginDeps).not.toHaveBeenCalled();
    expect(f.json().outcomes[0].status).toBe("success");
  });
  it("migrates explicit remote to local and checks local authentication", async () => {
    const f = fixture(["cline"], {
      [CLINE]: JSON.stringify({
        mcpServers: { GitHits: { type: "streamableHttp", url: MCP_URL } },
      }),
    });
    await f.run({
      local: true,
      installAgents: "cline",
      guidance: false,
      json: true,
    });
    expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits).toEqual(LOCAL);
    expect(f.createLoginDeps).toHaveBeenCalledTimes(1);
  });
  for (const [name, content] of Object.entries({
    malformed: "{",
    disabled: JSON.stringify({
      mcpServers: {
        GitHits: { type: "streamableHttp", url: MCP_URL, disabled: true },
      },
    }),
  })) {
    it(`blocks ${name} configuration before MCP mutation`, async () => {
      const f = fixture(["cline"], { [CLINE]: content });
      await f.run({
        remote: true,
        installAgents: "cline",
        guidance: false,
        json: true,
      });
      expect(f.files[CLINE]).toBe(content);
      expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
      expect(f.createLoginDeps).not.toHaveBeenCalled();
      expect(f.json().outcomes[0].status).toBe("failed");
      expect(process.exitCode).toBe(1);
    });
  }
  for (const order of ["cline,opencode", "opencode,cline"])
    it(`unions mixed preserve profiles on shared skill roots: ${order}`, async () => {
      const f = fixture(["cline", "opencode"], {
        [CLINE]: JSON.stringify({
          mcpServers: { GitHits: { type: "streamableHttp", url: MCP_URL } },
        }),
        [OPEN]: JSON.stringify({
          mcp: {
            GitHits: {
              type: "local",
              command: [LOCAL.command, ...LOCAL.args],
              enabled: true,
            },
          },
        }),
      });
      await f.run({ installAgents: order, json: true });
      expect(
        Object.keys(f.files)
          .filter((path) => path.endsWith("/SKILL.md"))
          .sort(),
      ).toEqual(
        GITHITS_SKILL_CATALOG.map(
          (skill) => `/home/remote-test/.agents/skills/${skill.name}/SKILL.md`,
        ).sort(),
      );
      expect(f.createLoginDeps).not.toHaveBeenCalled();
      const writes = (
        f.fs.atomicWriteFile as ReturnType<typeof mock>
      ).mock.calls.filter((call) =>
        String(call[0]).endsWith("githits-mcp/SKILL.md"),
      );
      expect(writes).toHaveLength(1);
      expect(
        f
          .json()
          .outcomes.every(
            (outcome: { status: string }) =>
              outcome.status === "already_configured",
          ),
      ).toBe(true);
    });
  it("rejects conflicting selectors before detection, auth or writes", async () => {
    const f = fixture(["cline"]);
    await f.run({ remote: true, local: true, detectAgents: true, json: true });
    expect(f.fs.isDirectory).not.toHaveBeenCalled();
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(f.createLoginDeps).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

describe("Desktop directory handoff", () => {
  function expectDesktopDetectHandoff(
    f: ReturnType<typeof fixture>,
    expectedProfile: string,
  ) {
    const payload = f.json();
    const desktop = payload.agents.find(
      (agent: { id: string }) => agent.id === "claude-desktop",
    );

    expect(payload.setupProfile).toBe(expectedProfile);
    expect(payload.manualActionIds).toContain("claude-desktop");
    expect(payload.installableIds).not.toContain("claude-desktop");
    expect(payload.actionableIds).not.toContain("claude-desktop");
    expect(payload.installableIds).toEqual([]);
    expect(payload.actionableIds).toEqual([]);
    expect(payload.suggestedCommand).toBeNull();
    expect(desktop.status).toBe("manual_action_required");
    expect(desktop.manualAction.url).toBe(CLAUDE_DIRECTORY_URL);
    expect(desktop.guidanceStatus).toBe("not_applicable");
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(f.fs.writeFile).not.toHaveBeenCalled();
    expect(f.createLoginDeps).not.toHaveBeenCalled();
    return payload;
  }

  it("reports the directory handoff in explicit remote detect JSON", async () => {
    const f = fixture(["claude-desktop"]);
    await f.run({ remote: true, detectAgents: true, json: true });
    expectDesktopDetectHandoff(f, "remote");
  });

  it("reports the directory handoff in explicit local detect JSON", async () => {
    const f = fixture(["claude-desktop"]);
    await f.run({ local: true, detectAgents: true, json: true });
    expectDesktopDetectHandoff(f, "local");
  });

  it("reports the directory handoff in no-selector detect JSON", async () => {
    const f = fixture(["claude-desktop"]);
    await f.run({ detectAgents: true, json: true });
    expectDesktopDetectHandoff(f, "preserve");
  });

  it("returns a manual outcome for explicit staged Desktop install", async () => {
    const f = fixture(["claude-desktop"]);
    await f.run({
      remote: true,
      installAgents: "claude-desktop",
      guidance: false,
      json: true,
    });
    const payload = f.json();
    const outcome = payload.outcomes.find(
      (entry: { id: string }) => entry.id === "claude-desktop",
    );

    expect(outcome.status).toBe("manual_action_required");
    expect(outcome.manualAction.url).toBe(CLAUDE_DIRECTORY_URL);
    expect(payload.auth.status).toBe("not_applicable");
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(f.fs.writeFile).not.toHaveBeenCalled();
    expect(
      Object.keys(f.files).filter((path) => path.endsWith("/SKILL.md")),
    ).toEqual([]);
    expect(f.createLoginDeps).not.toHaveBeenCalled();
  });

  it("prints the directory handoff interactively and retains legacy local bytes", async () => {
    const f = fixture(["claude-desktop"]);
    const desktop = agentDefinitions.find(
      (agent) => agent.id === "claude-desktop",
    );
    expect(desktop).toBeDefined();
    const legacySetup = desktop!.getSetupConfig(f.fs);
    expect(legacySetup.method).toBe("config-file");
    if (legacySetup.method !== "config-file") {
      throw new Error("Claude Desktop legacy setup must use a config file");
    }
    const legacyBytes = JSON.stringify({
      [legacySetup.serversKey]: {
        [legacySetup.serverName]: legacySetup.serverConfig,
      },
    });
    f.files[legacySetup.configPath] = legacyBytes;

    const output = await f.run({ local: true });
    const normalizedOutput = output.replace(/\s+/g, " ");

    expect(normalizedOutput).toContain(
      `Claude Desktop: connect through the Claude directory: ${CLAUDE_DIRECTORY_URL}`,
    );
    expect(normalizedOutput).toContain(
      "Open this page, choose Connect or Install, and complete sign-in in Claude. Then verify GitHits tools in a new Claude conversation.",
    );
    expect(normalizedOutput).toContain(
      "Existing Claude Desktop local GitHits configuration was retained; legacy cleanup is available through githits uninstall.",
    );
    expect(normalizedOutput).toContain(
      "The connector needs action in Claude; do not retry CLI installation to activate it.",
    );
    expect(normalizedOutput).not.toContain("Already signed in");
    expect(normalizedOutput).not.toContain("GitHits is connected");
    expect(f.files[legacySetup.configPath]).toBe(legacyBytes);
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
    expect(f.fs.writeFile).not.toHaveBeenCalled();
    expect(f.deps.promptService.confirm).not.toHaveBeenCalled();
    expect(f.deps.promptService.confirm3).not.toHaveBeenCalled();
    expect(f.createLoginDeps).not.toHaveBeenCalled();
  });
});

describe("mixed Desktop setup", () => {
  function seedLegacyDesktopConfig(f: ReturnType<typeof fixture>) {
    const desktop = agentDefinitions.find(
      (agent) => agent.id === "claude-desktop",
    );
    if (!desktop) throw new Error("Claude Desktop base definition is missing");
    const setup = desktop.getSetupConfig(f.fs);
    if (setup.method !== "config-file") {
      throw new Error("Claude Desktop legacy setup must use a config file");
    }
    const contents = JSON.stringify({
      [setup.serversKey]: {
        [setup.serverName]: setup.serverConfig,
      },
    });
    f.files[setup.configPath] = contents;
    return { path: setup.configPath, contents };
  }

  async function expectMixedDetection(
    f: ReturnType<typeof fixture>,
    profile: "remote" | "local",
  ) {
    await f.run({
      ...(profile === "remote" ? { remote: true } : { local: true }),
      detectAgents: true,
      guidance: false,
      json: true,
    });
    const payload = f.json();
    const desktop = payload.agents.find(
      (agent: { id: string }) => agent.id === "claude-desktop",
    );

    expect(payload.setupProfile).toBe(profile);
    expect(payload.manualActionIds).toEqual(["claude-desktop"]);
    expect(payload.installableIds).toEqual(["cline"]);
    expect(payload.actionableIds).toEqual(["cline"]);
    expect(payload.suggestedCommand).toContain(
      `--install-agents cline --${profile} --no-guidance`,
    );
    expect(payload.suggestedCommand).not.toContain("claude-desktop");
    expect(desktop.status).toBe("manual_action_required");
    expect(desktop.manualAction.url).toBe(CLAUDE_DIRECTORY_URL);
    expect(desktop.guidanceStatus).toBe("not_applicable");
    expect(f.createLoginDeps).not.toHaveBeenCalled();
    return payload;
  }

  async function installMixedProfile(
    f: ReturnType<typeof fixture>,
    profile: "remote" | "local",
  ) {
    await f.run({
      ...(profile === "remote" ? { remote: true } : { local: true }),
      installAgents: "claude-desktop,cline",
      guidance: false,
      json: true,
    });
    const payload = f.json();
    const desktop = payload.outcomes.find(
      (outcome: { id: string }) => outcome.id === "claude-desktop",
    );
    const cline = payload.outcomes.find(
      (outcome: { id: string }) => outcome.id === "cline",
    );

    expect(payload.outcomes).toHaveLength(2);
    expect(desktop.status).toBe("manual_action_required");
    expect(desktop.manualAction.url).toBe(CLAUDE_DIRECTORY_URL);
    expect(cline.status).toBe("success");
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalledWith(
      expect.stringContaining("claude_desktop_config.json"),
      expect.any(String),
    );
    expect(f.fs.writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining("claude_desktop_config.json"),
      expect.any(String),
    );
    const skillWrites = [
      ...(f.fs.atomicWriteFile as ReturnType<typeof mock>).mock.calls,
      ...(f.fs.writeFile as ReturnType<typeof mock>).mock.calls,
    ].filter((call) => String(call[0]).endsWith("/SKILL.md"));
    expect(skillWrites).toHaveLength(0);
    expect(
      Object.keys(f.files).filter((path) => path.endsWith("/SKILL.md")),
    ).toEqual([]);
    return payload;
  }

  it("keeps Desktop manual and configures Cline remotely when both are selected", async () => {
    const f = fixture(["claude-desktop", "cline"]);
    const legacy = seedLegacyDesktopConfig(f);
    await expectMixedDetection(f, "remote");
    const payload = await installMixedProfile(f, "remote");

    expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits).toEqual({
      type: "streamableHttp",
      url: MCP_URL,
    });
    expect(f.files[legacy.path]).toBe(legacy.contents);
    expect(f.createLoginDeps).not.toHaveBeenCalled();
    expect(payload.auth.status).toBe("managed_by_host");
  });

  it("keeps Desktop manual and configures Cline locally when both are selected", async () => {
    const f = fixture(["claude-desktop", "cline"]);
    const legacy = seedLegacyDesktopConfig(f);
    await expectMixedDetection(f, "local");
    await installMixedProfile(f, "local");

    expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits).toEqual(LOCAL);
    expect(f.files[legacy.path]).toBe(legacy.contents);
    expect(f.createLoginDeps).toHaveBeenCalledTimes(1);
  });

  it("does not hand off unselected Desktop when interactive selection chooses only Cline", async () => {
    const f = fixture(["claude-desktop", "cline"]);
    const legacy = seedLegacyDesktopConfig(f);
    let offeredIds: string[] = [];
    const checkbox = mock(
      async (_message: string, choices: Array<{ value: string }>) => {
        offeredIds = choices.map((choice) => choice.value);
        return ["cline"];
      },
    ) as typeof f.deps.promptService.checkbox;
    f.deps.promptService.checkbox = checkbox;

    const output = await f.run({ remote: true, guidance: false });

    expect(offeredIds).toContain("claude-desktop");
    expect(offeredIds).toContain("cline");
    expect(output).not.toContain(CLAUDE_DIRECTORY_URL);
    expect(output).not.toContain("External action required:");
    expect(output).toContain("1 tool configured.");
    expect(output).not.toContain("2 tools configured.");
    expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits).toEqual({
      type: "streamableHttp",
      url: MCP_URL,
    });
    expect(f.files[legacy.path]).toBe(legacy.contents);
    expect(f.createLoginDeps).not.toHaveBeenCalled();
  });
});

describe("native hosted route regressions", () => {
  it("migrates Q in both explicit directions and preserves serialized remote defaults", async () => {
    const path = "/home/remote-test/.aws/amazonq/mcp.json";
    const f = fixture(["amazon-q-cli"], {
      [path]: JSON.stringify({
        mcpServers: {
          githits: {
            type: "http",
            url: MCP_URL,
            command: "",
            args: [],
            headers: {},
            oauthScopes: [],
            timeout: 60000,
          },
        },
      }),
    });
    await f.run({ installAgents: "amazon-q-cli", guidance: false, json: true });
    expect(f.json().outcomes[0].status).toBe("already_configured");
    expect(f.createLoginDeps).not.toHaveBeenCalled();
    expect(f.fs.atomicWriteFile).not.toHaveBeenCalled();
    await f.run({
      local: true,
      installAgents: "amazon-q-cli",
      guidance: false,
      json: true,
    });
    expect(f.json().outcomes[0].status).toBe("success");
    expect(f.deps.execService.exec).toHaveBeenCalledWith("q", [
      "mcp",
      "add",
      "--name",
      "githits",
      "--force",
      "--command",
      "npx",
      "--args",
      JSON.stringify(LOCAL.args),
    ]);
    f.createLoginDeps.mockClear();
    await f.run({
      remote: true,
      installAgents: "amazon-q-cli",
      guidance: false,
      json: true,
    });
    expect(f.json().outcomes[0].status).toBe("success");
    expect(JSON.parse(f.files[path]!).mcpServers.githits).toEqual({
      type: "http",
      url: MCP_URL,
    });
    expect(f.createLoginDeps).not.toHaveBeenCalled();
  });
  it("writes remote Codex TOML preserving annotations without native add or login", async () => {
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = "";
    try {
      const path = "/home/remote-test/.codex/config.toml";
      const before =
        '# Model note\nmodel = "example" # inline note\n\n# Sibling note\n[mcp_servers.other]\nurl = "https://example.com"\n\n[mcp_servers.githits]\ncommand = "custom"\nargs = ["--pinned"]\n';
      const f = fixture(["codex-cli"], { [path]: before });
      await f.run({
        remote: true,
        installAgents: "codex-cli",
        guidance: false,
        json: true,
      });
      expect(f.json().outcomes[0].status).toBe("success");
      expect(f.files[path]).toStartWith(
        before.slice(0, before.indexOf("[mcp_servers.githits]")),
      );
      expect(
        (parseToml(f.files[path]!).mcp_servers as Record<string, unknown>)
          .githits,
      ).toEqual({ url: MCP_URL });
      expect(f.createLoginDeps).not.toHaveBeenCalled();
      expect(
        (f.deps.execService.exec as ReturnType<typeof mock>).mock.calls.some(
          ([command, args]) =>
            command === "codex" &&
            (args as string[])[0] === "mcp" &&
            ["add", "login"].includes((args as string[])[1]!),
        ),
      ).toBe(false);
      await f.run({ installAgents: "codex-cli", guidance: false, json: true });
      expect(f.json().outcomes[0].status).toBe("already_configured");
      expect(f.createLoginDeps).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });
  it("discloses the shared Claude/Pi project entry in staged detection and before confirmation", async () => {
    const f = fixture(["claude-code", "pi"]);
    await f.run({
      remote: true,
      project: true,
      detectAgents: true,
      guidance: false,
      json: true,
    });
    const p = f.json();
    expect(p.instructions.join(" ")).toContain(
      "changing it affects both hosts",
    );
    expect(
      p.agents.find((agent: { id: string }) => agent.id === "claude-code")
        .sharedConfigNotice,
    ).toContain(".mcp.json");
    let review = "";
    f.deps.promptService.confirm = mock(async (message: string) => {
      if (message.includes("Continue"))
        review = log.mock.calls
          .map((call: unknown[]) => String(call[0] ?? ""))
          .join(" ");
      return true;
    });
    await f.run({ remote: true, project: true, guidance: false });
    expect(review.replace(/\s+/g, " ")).toContain(
      "changing it affects both hosts",
    );
    expect(f.createLoginDeps).not.toHaveBeenCalled();
    expect(JSON.parse(f.files["/repo/.mcp.json"]!).mcpServers.GitHits).toEqual({
      type: "http",
      url: MCP_URL,
    });
  });
  for (const keepGuidance of [false, true])
    it(`remote uninstall retains canonical cleanup policy; keepGuidance=${keepGuidance}`, async () => {
      const extra = "/home/remote-test/.agents/skills/githits-code/SKILL.md";
      const f = fixture(["cline"], { [extra]: "pre-existing CLI skill" });
      await f.run({ remote: true, installAgents: "cline", json: true });
      expect(f.files[extra]).toBe("pre-existing CLI skill");
      await initUninstallAction({ yes: true, keepGuidance }, f.deps);
      expect(JSON.parse(f.files[CLINE]!).mcpServers.GitHits).toBeUndefined();
      expect(extra in f.files).toBe(keepGuidance);
    });
});
