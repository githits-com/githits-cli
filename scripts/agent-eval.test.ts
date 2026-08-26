import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  GITHITS_GUIDANCE_BLOCK,
  GITHITS_GUIDANCE_MARKER,
} from "../src/commands/init/guidance-assets.ts";
import {
  buildClaudeCommand,
  buildCodexCommand,
  buildCodexConfig,
  buildCodexConfigArgs,
  buildEvalEnv,
  buildMcpConfig,
  buildOpenCodeCommand,
  buildOpenCodeConfig,
  buildOpenCodeSkillsConfig,
  collectSecretValues,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  extractDiscoveryEvents,
  extractToolCalls,
  isolateOpenCodeSkills,
  isValidAgentReport,
  parseArgs,
  prepareFullGuidanceWorkspace,
  prepareSkillsWorkspace,
  redactText,
  runAgentEval,
  runWithTimeout,
  sanitizedEnvSummary,
} from "./agent-eval.ts";
import {
  assertUniqueWorkloadIds,
  buildRunReportFromMetadata,
  compareReports,
  formatCompareReport,
  formatRunReport,
  isContainedRelativePath,
  normalizeToolName,
  normalizeToolStatus,
  parseReportArgs,
  summarizeFinalReport,
  summarizeToolCalls,
} from "./agent-eval-report.ts";
import {
  buildClaudeSessionCommand,
  buildCodexSessionCommand,
  buildOpenCodeSessionCommand,
  parseSessionArgs,
  prepareAgentSession,
} from "./agent-session.ts";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createRunFixture(status = "success"): string {
  const runDir = mkdtempSync(join(tmpdir(), "agent-eval-test-"));
  const workloadDir = join(runDir, "workloads", "pkg-vulns");
  mkdirSync(workloadDir, { recursive: true });
  writeJson(join(workloadDir, "tool-calls.json"), [
    { agent: "codex", tool: "pkg_vulns", status: "in_progress" },
    { agent: "codex", tool: "pkg_vulns", status: "completed" },
  ]);
  writeJson(join(workloadDir, "final.json"), {
    status: "success",
    answer: "No active vulnerabilities.",
    toolIssues: [],
    expectedToolUse: ["mcp__githits__pkg_vulns"],
    unexpectedToolUse: [],
    instructionIssues: ["Package aliases were unclear"],
    githitsUsefulness: "helped",
    githitsUsefulnessReason: "It returned advisory details.",
    confidence: "high",
  });
  writeFileSync(join(workloadDir, "stderr.txt"), "");
  writeJson(join(runDir, "run.json"), {
    agent: "codex",
    server: "local",
    dryRun: false,
    workloads: [
      {
        id: "pkg-vulns",
        status,
        durationMs: 1234,
        workloadDir,
      },
    ],
  });
  return runDir;
}

describe("agent eval harness", () => {
  const localOptions = {
    server: "local" as const,
    repoRoot: "/repo/githits-cli",
    publishedPackage: "githits@latest",
  };

  it("builds local MCP config with explicit repo cwd", () => {
    const config = buildMcpConfig(
      {
        server: "local",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@latest",
      },
      {},
    );

    expect(config.mcpServers.githits).toEqual({
      command: "bun",
      args: ["run", "--cwd", "/repo/githits-cli", "dev", "mcp", "start"],
    });
  });

  it("keeps MCP server configuration identical across guidance profiles", () => {
    expect(
      buildMcpConfig({ ...localOptions, guidanceProfile: "descriptors" })
        .mcpServers.githits.args,
    ).not.toContain("--instruction-mode");
    expect(
      buildMcpConfig({ ...localOptions, guidanceProfile: "full" }).mcpServers
        .githits.args,
    ).not.toContain("--instruction-mode");
  });

  it("defaults automated Codex evals to Luna with high reasoning", () => {
    const options = parseArgs(["--agent", "codex", "--dry-run"], "/repo");
    expect(options.model).toBe(DEFAULT_CODEX_MODEL);
    expect(options.reasoningEffort).toBe(DEFAULT_CODEX_REASONING_EFFORT);
    expect(options.guidanceProfile).toBe("descriptors");
  });

  it("preserves explicit Codex model and reasoning overrides", () => {
    const options = parseArgs(
      [
        "--agent",
        "codex",
        "--model",
        "gpt-custom",
        "--reasoning-effort",
        "ultra",
        "--dry-run",
      ],
      "/repo",
    );
    expect(options.model).toBe("gpt-custom");
    expect(options.reasoningEffort).toBe("ultra");
  });

  it("rejects invalid guidance and reasoning combinations before launch", () => {
    expect(() =>
      parseArgs(
        ["--guidance-profile", "full", "--server", "published"],
        "/repo",
      ),
    ).toThrow("requires --surface mcp --server local");
    expect(() =>
      parseArgs(["--surface", "skills", "--guidance-profile", "full"], "/repo"),
    ).toThrow("cannot be used with --surface skills");
    expect(() => parseArgs(["--reasoning-effort", "high"], "/repo")).toThrow(
      "requires --agent codex",
    );
  });

  it("adds the Codex reasoning effort as a TOML override", () => {
    const options = {
      ...localOptions,
      reasoningEffort: "high" as const,
    };
    expect(buildCodexConfig(options)).toContain(
      'model_reasoning_effort = "high"',
    );
    expect(buildCodexConfigArgs(options)).toContain(
      'model_reasoning_effort="high"',
    );
  });

  it("preserves ordinary subprocess completion", async () => {
    const before = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
    };
    const result = await runWithTimeout(
      [process.execPath, "-e", "process.stdout.write('complete')"],
      process.cwd(),
      {},
      5,
    );

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("complete");
    expect(process.listenerCount("SIGINT")).toBe(before.sigint);
    expect(process.listenerCount("SIGTERM")).toBe(before.sigterm);
  });

  it("kills a timed-out POSIX subprocess process group", async () => {
    if (process.platform === "win32") return;

    const root = mkdtempSync(join(tmpdir(), "agent-eval-timeout-"));
    const scriptPath = join(root, "descendant.sh");
    const before = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
    };
    writeFileSync(
      scriptPath,
      '#!/bin/sh\nprintf "READY\\n"\n( trap "printf \\"DESCENDANT_STOPPED\\\\n\\"; exit 0" TERM INT; while :; do sleep 1; done ) &\ntrap "printf \\"PARENT_STOPPED\\\\n\\"; exit 0" TERM INT\nwhile :; do sleep 1; done\n',
    );

    try {
      const result = await runWithTimeout(["sh", scriptPath], root, {}, 0.2);

      expect(result.timedOut).toBe(true);
      expect(result.stdout).toContain("READY");
      expect(result.stdout).toContain("DESCENDANT_STOPPED");
      expect(result.stdout).toContain("PARENT_STOPPED");
      expect(process.listenerCount("SIGINT")).toBe(before.sigint);
      expect(process.listenerCount("SIGTERM")).toBe(before.sigterm);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds published MCP config with pinned package spec", () => {
    const config = buildMcpConfig(
      {
        server: "published",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@0.4.2",
      },
      {},
    );

    expect(config.mcpServers.githits).toEqual({
      command: "npx",
      args: ["-y", "githits@0.4.2", "mcp", "start"],
    });
  });

  it("builds Codex TOML config from the same MCP command", () => {
    expect(
      buildCodexConfig(
        {
          server: "local",
          repoRoot: "/repo/githits-cli",
          publishedPackage: "githits@latest",
        },
        {},
      ),
    ).toBe(
      '[mcp_servers.githits]\ncommand = "bun"\nargs = ["run","--cwd","/repo/githits-cli","dev","mcp","start"]\n',
    );
  });

  it("builds Codex config override args", () => {
    expect(
      buildCodexConfigArgs(
        {
          server: "published",
          repoRoot: "/repo/githits-cli",
          publishedPackage: "githits@0.4.2",
        },
        {},
      ),
    ).toEqual([
      "-c",
      'mcp_servers.githits.command="npx"',
      "-c",
      'mcp_servers.githits.args=["-y","githits@0.4.2","mcp","start"]',
    ]);
  });

  it("builds OpenCode project config from the same MCP command", () => {
    expect(
      buildOpenCodeConfig(
        {
          server: "local",
          repoRoot: "/repo/githits-cli",
          publishedPackage: "githits@latest",
        },
        {},
      ),
    ).toEqual({
      permission: {
        task: "deny",
      },
      mcp: {
        githits: {
          type: "local",
          command: [
            "bun",
            "run",
            "--cwd",
            "/repo/githits-cli",
            "dev",
            "mcp",
            "start",
          ],
          enabled: true,
          timeout: 90_000,
        },
      },
    });
  });

  it("denies OpenCode task delegation in skills mode", () => {
    expect(buildOpenCodeSkillsConfig()).toEqual({
      permission: {
        task: "deny",
      },
    });
  });

  it("adds the hidden experimental flag to every local MCP launch vector", () => {
    const options = { ...localOptions, experimentalTools: true };
    expect(buildMcpConfig(options).mcpServers.githits.args).toEqual([
      "run",
      "--cwd",
      "/repo/githits-cli",
      "dev",
      "mcp",
      "start",
      "--experimental-tools",
    ]);
    expect(buildCodexConfig(options)).toContain(
      'args = ["run","--cwd","/repo/githits-cli","dev","mcp","start","--experimental-tools"]',
    );
    expect(buildCodexConfigArgs(options)).toContain(
      'mcp_servers.githits.args=["run","--cwd","/repo/githits-cli","dev","mcp","start","--experimental-tools"]',
    );
    expect(buildOpenCodeConfig(options).mcp?.githits?.command).toEqual([
      "bun",
      "run",
      "--cwd",
      "/repo/githits-cli",
      "dev",
      "mcp",
      "start",
      "--experimental-tools",
    ]);
  });

  it("keeps published and unflagged launch vectors unchanged", () => {
    expect(
      buildMcpConfig({ ...localOptions, experimentalTools: false }),
    ).toEqual(buildMcpConfig(localOptions));
    expect(
      buildMcpConfig({
        server: "published",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@0.4.2",
        experimentalTools: true,
      }).mcpServers.githits.args,
    ).toEqual(["-y", "githits@0.4.2", "mcp", "start"]);
  });

  it("embeds non-secret backend override env in MCP configs", () => {
    const env = {
      GITHITS_API_URL: "https://api-dev.githits.com",
      PKGSEER_URL: "https://pkgseer-backend-dev.fly.dev",
      GITHITS_API_TOKEN: "secret-token",
    };

    const mcpConfig = buildMcpConfig(
      {
        server: "local",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@latest",
      },
      env,
    );
    expect(mcpConfig.mcpServers.githits.env).toEqual({
      GITHITS_API_URL: "https://api-dev.githits.com",
      PKGSEER_URL: "https://pkgseer-backend-dev.fly.dev",
    });

    expect(
      buildCodexConfigArgs(
        {
          server: "local",
          repoRoot: "/repo/githits-cli",
          publishedPackage: "githits@latest",
        },
        env,
      ),
    ).toContain(
      'mcp_servers.githits.env.PKGSEER_URL="https://pkgseer-backend-dev.fly.dev"',
    );
  });

  it("passes selected models to agent commands", () => {
    expect(
      buildClaudeCommand("prompt", "/tmp/mcp.json", "haiku", "mcp"),
    ).toContain("haiku");
    expect(
      buildCodexCommand(
        "prompt",
        "/tmp/work",
        "/tmp/final.txt",
        "/tmp/schema.json",
        {
          server: "local",
          surface: "mcp",
          repoRoot: "/repo/githits-cli",
          publishedPackage: "githits@latest",
          model: "gpt-5.4-mini",
        },
      ),
    ).toContain("gpt-5.4-mini");
    expect(
      buildOpenCodeCommand("prompt", "/tmp/work", {
        model: "anthropic/claude-sonnet-4-5",
      }),
    ).toContain("anthropic/claude-sonnet-4-5");
  });

  it("runs Codex evals without interactive approval prompts", () => {
    const command = buildCodexCommand(
      "prompt",
      "/tmp/work",
      "/tmp/final.txt",
      "/tmp/schema.json",
      {
        server: "local",
        surface: "mcp",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@latest",
      },
    );

    expect(command).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(command).not.toContain("--sandbox");
  });

  it("runs OpenCode evals in JSON mode without interactive approvals", () => {
    const command = buildOpenCodeCommand("prompt", "/tmp/work", {});

    expect(command).toContain("run");
    expect(command).toContain("--format");
    expect(command).toContain("json");
    expect(command).toContain("--dangerously-skip-permissions");
    expect(command).toContain("--dir");
    expect(command).toContain("/tmp/work");
  });

  it("excludes Codex user config, rules, and plugin skills", () => {
    const command = buildCodexCommand(
      "prompt",
      "/tmp/work",
      "/tmp/final.txt",
      "/tmp/schema.json",
      {
        server: "local",
        surface: "mcp",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@latest",
      },
    );

    expect(command).toContain("--ignore-user-config");
    expect(command).toContain("--ignore-rules");
    expect(command.filter((arg) => arg === "--ignore-rules")).toHaveLength(1);
    expect(command).toContain('mcp_servers.githits.command="bun"');
  });

  it("builds agent commands without GitHits MCP config in skills mode", () => {
    const claude = buildClaudeCommand(
      "prompt",
      "/tmp/empty-mcp.json",
      undefined,
      "skills",
    );
    expect(claude).toContain("--mcp-config");
    expect(claude).toContain("/tmp/empty-mcp.json");
    expect(claude).toContain("--strict-mcp-config");
    expect(claude).not.toContain("--disable-slash-commands");
    expect(claude).toContain("--setting-sources");

    const codex = buildCodexCommand(
      "prompt",
      "/tmp/work",
      "/tmp/final.txt",
      "/tmp/schema.json",
      {
        server: "local",
        surface: "skills",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@latest",
        reasoningEffort: "high",
      },
    );
    expect(codex).not.toContain("mcp_servers.githits.command");
    expect(codex).not.toContain("--ignore-rules");
    expect(codex).toContain("--ignore-user-config");
    expect(codex).toContain('model_reasoning_effort="high"');
  });

  it("builds interactive Claude, Codex, and OpenCode session commands", () => {
    const claudeOptions = parseSessionArgs(
      ["--agent", "claude", "--surface", "skills", "--model", "haiku"],
      "/repo/githits-cli",
    );
    expect(buildClaudeSessionCommand(claudeOptions, "/tmp/mcp.json")).toEqual([
      "claude",
      "--mcp-config",
      "/tmp/mcp.json",
      "--strict-mcp-config",
      "--setting-sources",
      "project",
      "--model",
      "haiku",
    ]);

    const codexOptions = parseSessionArgs(
      ["--agent", "codex", "--surface", "mcp", "--bypass-permissions"],
      "/repo/githits-cli",
    );
    const codexCommand = buildCodexSessionCommand(codexOptions);
    expect(codexCommand).toContain("mcp_servers={}");
    expect(codexCommand).toContain('mcp_servers.githits.command="bun"');
    expect(codexCommand).not.toContain("--ignore-rules");
    expect(codexCommand).toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );

    const codexSkillsOptions = parseSessionArgs(
      ["--agent", "codex", "--surface", "skills"],
      "/repo/githits-cli",
    );
    const codexSkillsCommand = buildCodexSessionCommand(codexSkillsOptions);
    expect(codexSkillsCommand).toContain("--ignore-user-config");

    const openCodeOptions = parseSessionArgs(
      [
        "--agent",
        "opencode",
        "--surface",
        "mcp",
        "--bypass-permissions",
        "--prompt",
        "hello",
      ],
      "/repo/githits-cli",
    );
    const openCodeCommand = buildOpenCodeSessionCommand(openCodeOptions);
    expect(openCodeCommand).toContain("opencode");
    expect(openCodeCommand).toContain("--dangerously-skip-permissions");
    expect(openCodeCommand).toContain("hello");
  });

  it("keeps guidance profiles out of skills sessions and preserves explicit session effort", () => {
    const skillsOptions = parseSessionArgs(
      ["--agent", "codex", "--surface", "skills", "--reasoning-effort", "low"],
      "/repo/githits-cli",
    );
    expect(skillsOptions.guidanceProfile).toBeUndefined();
    expect(skillsOptions.reasoningEffort).toBe("low");
    expect(buildCodexSessionCommand(skillsOptions)).toContain(
      'model_reasoning_effort="low"',
    );
    expect(() =>
      parseSessionArgs(
        ["--surface", "skills", "--guidance-profile", "full"],
        "/repo/githits-cli",
      ),
    ).toThrow("cannot be used with --surface skills");
  });

  it("prepares full guidance with canonical text and preserves existing files", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-full-guidance-"));
    const existing = "Project instructions\n\n";
    writeFileSync(join(workspaceDir, "CLAUDE.md"), existing);
    writeFileSync(join(workspaceDir, "AGENTS.md"), existing);
    try {
      const installation = prepareFullGuidanceWorkspace(
        {
          server: "local",
          repoRoot: process.cwd(),
          publishedPackage: "githits@latest",
        },
        workspaceDir,
      );
      expect(installation.instructionPaths).toEqual([
        join(workspaceDir, "CLAUDE.md"),
        join(workspaceDir, "AGENTS.md"),
      ]);
      for (const instructionPath of installation.instructionPaths) {
        const content = readFileSync(instructionPath, "utf8");
        expect(content).toContain("Project instructions");
        expect(content).toContain(GITHITS_GUIDANCE_MARKER);
        expect(content).toContain(GITHITS_GUIDANCE_BLOCK);
      }
      expect(installation.skillInstallation.installedDirs).toContain(
        join(workspaceDir, "skills"),
      );
      expect(
        existsSync(join(workspaceDir, "skills", "githits-mcp", "SKILL.md")),
      ).toBe(true);
      expect(existsSync(join(workspaceDir, "skills", "githits-package"))).toBe(
        false,
      );
      expect(existsSync(join(workspaceDir, "skills", "githits-code"))).toBe(
        false,
      );
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("reports a missing source skills directory before reading it", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-missing-skills-"));
    const repoRoot = join(rootDir, "repo");
    const workspaceDir = join(rootDir, "workspace");
    mkdirSync(repoRoot);
    try {
      expect(() =>
        prepareSkillsWorkspace(
          {
            server: "local",
            repoRoot,
            publishedPackage: "githits@latest",
          },
          workspaceDir,
        ),
      ).toThrow(`Skills directory not found: ${join(repoRoot, "skills")}`);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("reports a missing requested skill before copying it", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-missing-skill-"));
    const repoRoot = join(rootDir, "repo");
    const workspaceDir = join(rootDir, "workspace");
    mkdirSync(join(repoRoot, "skills"), { recursive: true });
    try {
      expect(() =>
        prepareFullGuidanceWorkspace(
          {
            server: "local",
            repoRoot,
            publishedPackage: "githits@latest",
          },
          workspaceDir,
        ),
      ).toThrow(
        `Skill source not found: ${join(repoRoot, "skills", "githits-mcp")}`,
      );
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("prepares a full Claude session with project guidance and strict MCP", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-session-full-"));
    try {
      const options = parseSessionArgs(
        [
          "--guidance-profile",
          "full",
          "--workspace",
          workspaceDir,
          "--dry-run",
        ],
        process.cwd(),
      );
      const prepared = prepareAgentSession(options);
      expect(prepared.command).toContain("--strict-mcp-config");
      expect(prepared.command).toContain("--setting-sources");
      expect(prepared.command).toContain("project");
      expect(prepared.command).not.toContain("--disable-slash-commands");
      expect(prepared.guidanceInstallation?.instructionPaths).toContain(
        join(workspaceDir, "CLAUDE.md"),
      );
      const session = JSON.parse(
        readFileSync(
          join(workspaceDir, ".agent-session", "session.json"),
          "utf8",
        ),
      );
      expect(session.guidanceProfile).toBe("full");
      expect(session.guidanceInstallation.instructionPaths).toContain(
        join(workspaceDir, "AGENTS.md"),
      );
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("accepts the experimental flag only for local MCP sessions", () => {
    const options = parseSessionArgs(
      ["--experimental-tools", "--dry-run"],
      "/repo/githits-cli",
    );
    expect(options.experimentalTools).toBe(true);

    expect(() =>
      parseSessionArgs(
        ["--experimental-tools", "--server", "published"],
        "/repo/githits-cli",
      ),
    ).toThrow("--experimental-tools requires --surface mcp --server local");
    expect(() =>
      parseSessionArgs(
        ["--experimental-tools", "--surface", "skills"],
        "/repo/githits-cli",
      ),
    ).toThrow("--experimental-tools requires --surface mcp --server local");
  });

  it("persists the enabled flag in interactive session artifacts", () => {
    for (const agent of ["claude", "codex", "opencode"] as const) {
      const workspaceDir = mkdtempSync(
        join(tmpdir(), `agent-session-experimental-${agent}-`),
      );
      try {
        const prepared = prepareAgentSession({
          agent,
          surface: "mcp",
          server: "local",
          experimentalTools: true,
          workspaceDir,
          repoRoot: process.cwd(),
          publishedPackage: "githits@latest",
          dryRun: true,
          bypassPermissions: false,
        });
        const session = JSON.parse(
          readFileSync(
            join(workspaceDir, ".agent-session", "session.json"),
            "utf8",
          ),
        );
        expect(session.experimentalTools).toBe(true);
        expect(session.command).toEqual(prepared.command);
        expect(readFileSync(prepared.mcpConfigPath, "utf8")).toContain(
          "--experimental-tools",
        );
        if (agent === "opencode") {
          expect(
            readFileSync(join(workspaceDir, "opencode.json"), "utf8"),
          ).toContain("--experimental-tools");
        }
      } finally {
        rmSync(workspaceDir, { recursive: true, force: true });
      }
    }
  });

  it("prepares an interactive skills workspace", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-session-test-"));
    const prepared = prepareAgentSession({
      agent: "claude",
      surface: "skills",
      server: "local",
      experimentalTools: false,
      workspaceDir,
      repoRoot: process.cwd(),
      publishedPackage: "githits@latest",
      dryRun: true,
      bypassPermissions: false,
    });

    expect(prepared.skillInstallation?.installedDirs).toContain(
      join(workspaceDir, "skills"),
    );
    expect(readFileSync(prepared.mcpConfigPath, "utf8")).toContain(
      '"mcpServers": {}',
    );
    expect(existsSync(join(workspaceDir, "opencode.json"))).toBe(false);
  });

  it("writes OpenCode project config only for OpenCode sessions", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-session-test-"));

    prepareAgentSession({
      agent: "opencode",
      surface: "mcp",
      server: "local",
      experimentalTools: false,
      workspaceDir,
      repoRoot: process.cwd(),
      publishedPackage: "githits@latest",
      dryRun: true,
      bypassPermissions: false,
    });

    expect(readFileSync(join(workspaceDir, "opencode.json"), "utf8")).toContain(
      '"timeout": 90000',
    );
    expect(readFileSync(join(workspaceDir, "opencode.json"), "utf8")).toContain(
      '"task": "deny"',
    );
  });

  it("denies task delegation for OpenCode skills sessions", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-session-test-"));
    try {
      prepareAgentSession({
        agent: "opencode",
        surface: "skills",
        server: "local",
        experimentalTools: false,
        workspaceDir,
        repoRoot: process.cwd(),
        publishedPackage: "githits@latest",
        dryRun: true,
        bypassPermissions: false,
      });

      expect(
        JSON.parse(readFileSync(join(workspaceDir, "opencode.json"), "utf8")),
      ).toEqual({
        permission: {
          task: "deny",
        },
      });
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite existing OpenCode project config", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-session-test-"));
    const openCodeConfigPath = join(workspaceDir, "opencode.json");
    const claudeInstructionsPath = join(workspaceDir, "CLAUDE.md");
    const agentsInstructionsPath = join(workspaceDir, "AGENTS.md");
    const skillSentinelPath = join(workspaceDir, "skills", "sentinel.txt");
    writeFileSync(openCodeConfigPath, "existing config\n");
    writeFileSync(claudeInstructionsPath, "existing Claude guidance\n");
    writeFileSync(agentsInstructionsPath, "existing agent guidance\n");
    mkdirSync(join(workspaceDir, "skills"), { recursive: true });
    writeFileSync(skillSentinelPath, "existing skill\n");

    expect(() =>
      prepareAgentSession({
        agent: "opencode",
        surface: "mcp",
        server: "local",
        guidanceProfile: "full",
        experimentalTools: false,
        workspaceDir,
        repoRoot: process.cwd(),
        publishedPackage: "githits@latest",
        dryRun: true,
        bypassPermissions: false,
      }),
    ).toThrow("Refusing to overwrite existing OpenCode config");
    expect(readFileSync(openCodeConfigPath, "utf8")).toBe("existing config\n");
    expect(readFileSync(claudeInstructionsPath, "utf8")).toBe(
      "existing Claude guidance\n",
    );
    expect(readFileSync(agentsInstructionsPath, "utf8")).toBe(
      "existing agent guidance\n",
    );
    expect(readFileSync(skillSentinelPath, "utf8")).toBe("existing skill\n");
    expect(existsSync(join(workspaceDir, ".agent-session"))).toBe(false);
  });

  it("preserves unrelated skills when preparing a reused workspace", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-session-test-"));
    const unrelatedSkillPath = join(
      workspaceDir,
      "skills",
      "unrelated",
      "SKILL.md",
    );
    mkdirSync(join(workspaceDir, "skills", "unrelated"), {
      recursive: true,
    });
    writeFileSync(unrelatedSkillPath, "unrelated skill");
    try {
      prepareAgentSession({
        agent: "claude",
        surface: "skills",
        server: "local",
        experimentalTools: false,
        workspaceDir,
        repoRoot: process.cwd(),
        publishedPackage: "githits@latest",
        dryRun: true,
        bypassPermissions: false,
      });

      expect(readFileSync(unrelatedSkillPath, "utf8")).toBe("unrelated skill");
      expect(
        existsSync(join(workspaceDir, "skills", "githits-code", "SKILL.md")),
      ).toBe(true);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("refuses full guidance skill conflicts before mutating the session workspace", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-session-test-"));
    const conflictPath = join(
      workspaceDir,
      "skills",
      "githits-mcp",
      "SKILL.md",
    );
    const claudeInstructionsPath = join(workspaceDir, "CLAUDE.md");
    const agentsInstructionsPath = join(workspaceDir, "AGENTS.md");
    mkdirSync(join(workspaceDir, "skills", "githits-mcp"), {
      recursive: true,
    });
    writeFileSync(conflictPath, "existing GitHits-looking skill");
    writeFileSync(claudeInstructionsPath, "existing Claude guidance\n");
    writeFileSync(agentsInstructionsPath, "existing agent guidance\n");
    try {
      expect(() =>
        prepareAgentSession({
          agent: "claude",
          surface: "mcp",
          server: "local",
          guidanceProfile: "full",
          experimentalTools: false,
          workspaceDir,
          repoRoot: process.cwd(),
          publishedPackage: "githits@latest",
          dryRun: true,
          bypassPermissions: false,
        }),
      ).toThrow("existing GitHits skill path");
      expect(readFileSync(conflictPath, "utf8")).toBe(
        "existing GitHits-looking skill",
      );
      expect(readFileSync(claudeInstructionsPath, "utf8")).toBe(
        "existing Claude guidance\n",
      );
      expect(readFileSync(agentsInstructionsPath, "utf8")).toBe(
        "existing agent guidance\n",
      );
      expect(existsSync(join(workspaceDir, ".agent-session"))).toBe(false);
      expect(existsSync(join(workspaceDir, ".agent-eval-bin"))).toBe(false);
      expect(existsSync(join(workspaceDir, ".opencode"))).toBe(false);
      expect(existsSync(join(workspaceDir, ".agents"))).toBe(false);
      expect(existsSync(join(workspaceDir, ".claude"))).toBe(false);
      expect(existsSync(join(workspaceDir, ".codex"))).toBe(false);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("refuses an existing CLI shim before mutating skill roots", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "agent-session-test-"));
    const shimPath = join(
      workspaceDir,
      ".agent-eval-bin",
      process.platform === "win32" ? "githits.cmd" : "githits",
    );
    mkdirSync(join(workspaceDir, ".agent-eval-bin"), { recursive: true });
    writeFileSync(shimPath, "existing shim\n");
    try {
      expect(() =>
        prepareAgentSession({
          agent: "claude",
          surface: "skills",
          server: "local",
          experimentalTools: false,
          workspaceDir,
          repoRoot: process.cwd(),
          publishedPackage: "githits@latest",
          dryRun: true,
          bypassPermissions: false,
        }),
      ).toThrow("existing GitHits CLI shim");
      expect(readFileSync(shimPath, "utf8")).toBe("existing shim\n");
      expect(existsSync(join(workspaceDir, "skills"))).toBe(false);
      expect(existsSync(join(workspaceDir, ".agent-session"))).toBe(false);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("preserves normal Claude and GitHits auth environment while filtering unrelated vars", () => {
    const env = buildEvalEnv({
      PATH: "/bin",
      HOME: "/real-home",
      RANDOM_SECRET: "should-not-pass",
      GITHITS_AUTH_STORAGE: "keychain",
      GITHITS_API_TOKEN: "secret-token",
      GITHITS_CODE_NAV_URL: "http://localhost:7070",
    });

    expect(env.HOME).toBe("/real-home");
    expect(env.GITHITS_AUTH_STORAGE).toBe("keychain");
    expect(env.GITHITS_API_TOKEN).toBe("secret-token");
    expect(env.GITHITS_CODE_NAV_URL).toBe("http://localhost:7070");
    expect(env.RANDOM_SECRET).toBeUndefined();
  });

  it("isolates OpenCode from external and Claude Code skills", () => {
    const env = buildEvalEnv({
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "0",
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "0",
    });
    isolateOpenCodeSkills(env);
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS).toBe("1");
  });

  it("redacts secret values from environment summary", () => {
    const summary = sanitizedEnvSummary({
      HOME: "/tmp/eval-home",
      USERPROFILE: "/tmp/eval-home",
      XDG_CONFIG_HOME: "/tmp/eval-home/.config",
      APPDATA: "/tmp/eval-home/AppData/Roaming",
      GITHITS_API_TOKEN: "secret-token",
      GITHITS_CODE_NAV_URL: "http://localhost:7070",
      GITHITS_AUTH_STORAGE: "keychain",
    });

    expect(summary.GITHITS_API_TOKEN).toBe("<redacted>");
    expect(summary.GITHITS_CODE_NAV_URL).toBe("http://localhost:7070");
    expect(summary.GITHITS_AUTH_STORAGE).toBe("keychain");
    expect(summary.HOME).toBe("<inherited>");
  });

  it("parses repeatable workloads and dry-run options", () => {
    const repoRoot = join(tmpdir(), "githits-cli");
    const options = parseArgs(
      [
        "--agent",
        "opencode",
        "--server",
        "published",
        "--surface",
        "skills",
        "--model",
        "gpt-5.4-mini",
        "--published-package",
        "githits@0.4.2",
        "--workload",
        "eval/agentic/workloads/express-router.md",
        "--timeout",
        "12",
        "--dry-run",
      ],
      repoRoot,
    );

    expect(options.agent).toBe("opencode");
    expect(options.model).toBe("gpt-5.4-mini");
    expect(options.server).toBe("published");
    expect(options.surface).toBe("skills");
    expect(options.publishedPackage).toBe("githits@0.4.2");
    expect(options.timeoutSeconds).toBe(12);
    expect(options.dryRun).toBe(true);
    expect(options.workloads).toEqual([
      resolve(repoRoot, "eval/agentic/workloads/express-router.md"),
    ]);
  });

  it("accepts the experimental flag only for local MCP evals", () => {
    const repoRoot = join(tmpdir(), "githits-cli");
    const options = parseArgs(["--experimental-tools", "--dry-run"], repoRoot);
    expect(options.experimentalTools).toBe(true);
    expect(options.surface).toBe("mcp");
    expect(options.server).toBe("local");

    expect(() =>
      parseArgs(["--experimental-tools", "--server", "published"], repoRoot),
    ).toThrow("--experimental-tools requires --surface mcp --server local");
    expect(() =>
      parseArgs(["--experimental-tools", "--surface", "skills"], repoRoot),
    ).toThrow("--experimental-tools requires --surface mcp --server local");
  });

  it("persists the enabled flag without probing agent versions during dry runs", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-override-"));
    let availabilityProbeCalls = 0;
    let versionProbeCalls = 0;
    try {
      const options = parseArgs(
        [
          "--experimental-tools",
          "--dry-run",
          "--out",
          outDir,
          "--workload",
          "eval/agentic/workloads/express-router.md",
        ],
        process.cwd(),
      );
      await runAgentEval(options, {
        assertAgentAvailable: () => {
          availabilityProbeCalls += 1;
          return Promise.resolve();
        },
        collectAgentVersions: () => {
          versionProbeCalls += 1;
          return Promise.resolve([
            "stub-claude-version",
            "stub-codex-version",
            "stub-opencode-version",
          ]);
        },
      });
      const run = JSON.parse(readFileSync(join(outDir, "run.json"), "utf8"));
      const workloadDir = join(outDir, "workloads", "express-router");
      const dryRun = JSON.parse(
        readFileSync(join(workloadDir, "dry-run.json"), "utf8"),
      );
      const mcp = JSON.parse(
        readFileSync(join(workloadDir, "mcp.json"), "utf8"),
      );
      const openCode = JSON.parse(
        readFileSync(join(workloadDir, "opencode.json"), "utf8"),
      );
      expect(run.experimentalTools).toBe(true);
      expect(run.claudeVersion).toBeUndefined();
      expect(run.codexVersion).toBeUndefined();
      expect(run.opencodeVersion).toBeUndefined();
      expect(availabilityProbeCalls).toBe(0);
      expect(versionProbeCalls).toBe(0);
      expect(dryRun.experimentalTools).toBe(true);
      expect(mcp.mcpServers.githits.args).toContain("--experimental-tools");
      expect(
        readFileSync(join(workloadDir, "codex-config.toml"), "utf8"),
      ).toContain("--experimental-tools");
      expect(openCode.mcp.githits.command).toContain("--experimental-tools");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("writes profile-specific dry-run configs and artifacts", async () => {
    for (const profile of ["descriptors", "full"] as const) {
      const outDir = mkdtempSync(join(tmpdir(), `agent-eval-${profile}-`));
      try {
        const options = parseArgs(
          [
            "--guidance-profile",
            profile,
            "--dry-run",
            "--out",
            outDir,
            "--workload",
            "eval/agentic/workloads/express-router.md",
          ],
          process.cwd(),
        );
        await runAgentEval(options);
        const workloadDir = join(outDir, "workloads", "express-router");
        const mcp = JSON.parse(
          readFileSync(join(workloadDir, "mcp.json"), "utf8"),
        );
        const dryRun = JSON.parse(
          readFileSync(join(workloadDir, "dry-run.json"), "utf8"),
        );
        const run = JSON.parse(readFileSync(join(outDir, "run.json"), "utf8"));
        expect(run.guidanceProfile).toBe(profile);
        expect(dryRun.guidanceProfile).toBe(profile);
        expect(
          readFileSync(join(workloadDir, "discovery-events.json"), "utf8"),
        ).toContain('"status": "not_observed"');
        if (profile === "descriptors") {
          expect(mcp.mcpServers.githits.args).not.toContain(
            "--instruction-mode",
          );
          expect(existsSync(join(workloadDir, "skill-installation.json"))).toBe(
            false,
          );
          expect(
            existsSync(join(workloadDir, "guidance-installation.json")),
          ).toBe(false);
        } else {
          expect(mcp.mcpServers.githits.args).not.toContain(
            "--instruction-mode",
          );
          const guidance = JSON.parse(
            readFileSync(
              join(workloadDir, "guidance-installation.json"),
              "utf8",
            ),
          );
          expect(guidance.instructionPaths).toHaveLength(2);
          expect(existsSync(join(workloadDir, "skill-installation.json"))).toBe(
            true,
          );
        }
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    }
  });

  it("uses injected agent probes for live run metadata", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-probes-"));
    const availabilityProbes: string[] = [];
    let versionProbeCalls = 0;
    try {
      const options = parseArgs(["--out", outDir], process.cwd());
      options.workloads = [];
      await runAgentEval(options, {
        assertAgentAvailable: (agent) => {
          availabilityProbes.push(agent);
          return Promise.resolve();
        },
        collectAgentVersions: () => {
          versionProbeCalls += 1;
          return Promise.resolve([
            "stub-claude-version",
            "stub-codex-version",
            "stub-opencode-version",
          ]);
        },
      });

      const run = JSON.parse(readFileSync(join(outDir, "run.json"), "utf8"));
      expect(availabilityProbes).toEqual(["claude"]);
      expect(versionProbeCalls).toBe(1);
      expect(run.claudeVersion).toBe("stub-claude-version");
      expect(run.codexVersion).toBe("stub-codex-version");
      expect(run.opencodeVersion).toBe("stub-opencode-version");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("redacts secret values from persisted text", () => {
    const secrets = collectSecretValues({
      GITHITS_API_TOKEN: "secret-token-value",
      ANTHROPIC_API_KEY: "anthropic-secret-value",
      GITHITS_CODE_NAV_URL: "http://localhost:7070",
    });

    expect(
      redactText(
        "token=secret-token-value key=anthropic-secret-value",
        secrets,
      ),
    ).toBe("token=<redacted> key=<redacted>");
  });

  it("validates final agent report shape", () => {
    expect(
      isValidAgentReport({
        status: "success",
        answer: "Router lives in lib/router/index.js.",
        toolIssues: [],
        expectedToolUse: ["code_read"],
        unexpectedToolUse: [],
        instructionIssues: [],
        githitsUsefulness: "helped",
        githitsUsefulnessReason: "It located source evidence.",
        confidence: "high",
      }),
    ).toBe(true);

    expect(
      isValidAgentReport({ status: "success", answer: "missing fields" }),
    ).toBe(false);
  });

  it("extracts Codex MCP tool calls from JSONL events", () => {
    const calls = extractToolCalls(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "githits",
          tool: "code_read",
          status: "completed",
          arguments: { path: "index.js" },
        },
      })}\n`,
      "codex",
    );

    expect(calls).toEqual([
      {
        agent: "codex",
        server: "githits",
        tool: "code_read",
        status: "completed",
        arguments: { path: "index.js" },
      },
    ]);
  });

  it("extracts Claude MCP tool calls from verbose stream events", () => {
    const calls = extractToolCalls(
      `${JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__githits__pkg_info",
              input: { registry: "npm", package_name: "express" },
            },
          ],
        },
      })}\n`,
      "claude",
    );

    expect(calls).toEqual([
      {
        agent: "claude",
        server: "githits",
        tool: "pkg_info",
        status: "started",
        arguments: { registry: "npm", package_name: "express" },
      },
    ]);
  });

  it("extracts Claude ToolSearch events separately from MCP calls", () => {
    const stdout = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "ToolSearch",
              id: "search-1",
              input: { query: "package vulnerabilities" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "search-1",
              content: "GitHits:pkg_vulns",
            },
          ],
        },
      }),
    ].join("\n");
    expect(extractToolCalls(stdout, "claude")).toEqual([]);
    expect(extractDiscoveryEvents(stdout, "claude")).toEqual({
      status: "observed",
      events: [
        {
          type: "request",
          tool: "ToolSearch",
          toolUseId: "search-1",
          query: { query: "package vulnerabilities" },
        },
        {
          type: "result",
          tool: "ToolSearch",
          toolUseId: "search-1",
          result: "GitHits:pkg_vulns",
        },
      ],
    });
    expect(extractDiscoveryEvents(stdout, "codex")).toEqual({
      status: "not_exposed",
      events: [],
    });
  });

  it("marks Claude discovery as not observed when ToolSearch is absent", () => {
    expect(extractDiscoveryEvents("", "claude")).toEqual({
      status: "not_observed",
      events: [],
    });
  });

  it("extracts OpenCode MCP tool calls from JSON events", () => {
    const calls = extractToolCalls(
      `${JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "githits_pkg_info",
          state: {
            status: "completed",
            input: { registry: "npm", package_name: "express" },
          },
        },
      })}\n`,
      "opencode",
    );

    expect(calls).toEqual([
      {
        agent: "opencode",
        server: "githits",
        tool: "pkg_info",
        status: "completed",
        arguments: { registry: "npm", package_name: "express" },
        error: undefined,
      },
    ]);
  });

  it("classifies OpenCode JSON error envelopes as failed tool calls", () => {
    const calls = extractToolCalls(
      `${JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "githits_search",
          state: {
            status: "completed",
            input: { query: "safeParse", target: "npm:zod" },
            output: JSON.stringify({
              error: "Filters not supported by any selected source",
              code: "INVALID_ARGUMENT",
              retryable: false,
            }),
          },
        },
      })}\n`,
      "opencode",
    );

    expect(calls[0]?.tool).toBe("search");
    expect(calls[0]?.status).toBe("completed");
    expect(calls[0]?.error).toEqual({
      error: "Filters not supported by any selected source",
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
    expect(normalizeToolStatus(calls[0]?.status, calls[0]?.error)).toBe(
      "failed",
    );
  });

  it("extracts GitHits CLI calls from skill-surface shell commands", () => {
    const calls = extractToolCalls(
      `${JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: {
                command:
                  "githits pkg vulns npm:lodash@4.17.20 --severity high --json",
              },
            },
          ],
        },
      })}\n${JSON.stringify({
        item: {
          type: "function_call",
          arguments: {
            command:
              "npx -y githits@latest code read npm:express lib/router/index.js --lines 1-80",
          },
        },
      })}\n${JSON.stringify({
        item: {
          type: "function_call",
          arguments: {
            command:
              "bun run --cwd /repo/githits-cli dev pkg info npm:express --json",
          },
        },
      })}\n`,
      "claude",
      "skills",
    );

    expect(calls.map((call) => call.tool)).toEqual([
      "pkg_vulns",
      "code_read",
      "pkg_info",
    ]);
    expect(calls[0]?.server).toBe("githits-cli");
  });

  it("extracts CLI fallback from full MCP Codex runs only", () => {
    const stdout = [
      JSON.stringify({
        item: {
          type: "command_execution",
          command: "githits search opencode",
        },
      }),
      JSON.stringify({
        item: {
          type: "mcp_tool_call",
          server: "githits",
          tool: "code_read",
          status: "completed",
          arguments: { path: "packages/opencode/src/session/compaction.ts" },
        },
      }),
    ].join("\n");
    expect(extractToolCalls(stdout, "codex", "mcp", "full")).toEqual([
      {
        agent: "codex",
        server: "githits-cli",
        tool: "search",
        status: "started",
        arguments: { command: "githits search opencode" },
      },
      {
        agent: "codex",
        server: "githits",
        tool: "code_read",
        status: "completed",
        arguments: { path: "packages/opencode/src/session/compaction.ts" },
      },
    ]);
    expect(extractToolCalls(stdout, "codex", "mcp", "descriptors")).toEqual([
      {
        agent: "codex",
        server: "githits",
        tool: "code_read",
        status: "completed",
        arguments: { path: "packages/opencode/src/session/compaction.ts" },
      },
    ]);
  });

  it("ignores non-MCP Claude tool calls", () => {
    const calls = extractToolCalls(
      `${JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "ToolSearch",
              input: { query: "pkg_vulns" },
            },
          ],
        },
      })}\n`,
      "claude",
    );

    expect(calls).toEqual([]);
  });

  it("normalizes tool names and statuses for reports", () => {
    expect(normalizeToolName("mcp__githits__pkg_vulns")).toBe("pkg_vulns");
    expect(normalizeToolName("mcp__githits__.pkg_vulns")).toBe("pkg_vulns");
    expect(normalizeToolName("githits.pkg_vulns")).toBe("pkg_vulns");
    expect(normalizeToolName("pkg_vulns")).toBe("pkg_vulns");
    expect(normalizeToolStatus("in_progress")).toBe("started");
    expect(normalizeToolStatus("completed")).toBe("completed");
    expect(normalizeToolStatus(undefined)).toBe("unknown");
    expect(normalizeToolStatus("completed", "boom")).toBe("failed");
  });

  it("rejects escaped relative paths across platforms", () => {
    expect(isContainedRelativePath("workloads/pkg/tool-calls.json")).toBe(true);
    expect(isContainedRelativePath("../outside/tool-calls.json")).toBe(false);
    expect(isContainedRelativePath("/outside/tool-calls.json")).toBe(false);
    expect(isContainedRelativePath("D:\\outside\\tool-calls.json")).toBe(false);
  });

  it("summarizes raw tool calls without hiding duplicate status events", () => {
    const summary = summarizeToolCalls([
      { tool: "mcp__githits__pkg_vulns", status: "in_progress" },
      { tool: "pkg_vulns", status: "completed" },
      { tool: "pkg_info", status: "failed", error: { message: "bad" } },
    ]);

    expect(summary.rawCount).toBe(3);
    expect(summary.uniqueTools).toEqual(["pkg_info", "pkg_vulns"]);
    expect(summary.statusCounts).toEqual({
      started: 1,
      completed: 1,
      failed: 1,
      unknown: 0,
    });
    expect(summary.errors[0]).toContain("bad");
  });

  it("summarizes final reports without treating expected tools as actual calls", () => {
    const summary = summarizeFinalReport({
      status: "success",
      githitsUsefulness: "helped",
      githitsUsefulnessReason: "useful",
      confidence: "high",
      expectedToolUse: ["mcp__githits__pkg_vulns"],
      unexpectedToolUse: ["mcp__githits__.pkg_info"],
      toolIssues: ["issue", { tool: "pkg_vulns", issue: "unclear range" }],
      instructionIssues: ["instruction"],
    });

    expect(summary?.expectedToolUse).toEqual(["pkg_vulns"]);
    expect(summary?.unexpectedToolUse).toEqual(["pkg_info"]);
    expect(summary?.toolIssues).toEqual(["issue", "pkg_vulns: unclear range"]);
  });

  it("builds a portable run report from persisted artifacts", () => {
    const runDir = createRunFixture();
    const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
    const report = buildRunReportFromMetadata(runDir, run);

    expect(report.schemaVersion).toBe(1);
    expect(report.workloads[0]?.artifacts.toolCalls).toBe(
      "workloads/pkg-vulns/tool-calls.json",
    );
    expect(report.workloads[0]?.toolCalls.rawCount).toBe(2);
    expect(report.workloads[0]?.finalReport?.instructionIssues).toEqual([
      "Package aliases were unclear",
    ]);
    const formatted = formatRunReport(report);
    expect(formatted).toContain(
      "pkg-vulns success 1.2s uniqueTools=1 rawEvents=2",
    );
    expect(formatted).toContain(
      `Reopen summary: bun run agent:e2e:report ${runDir}`,
    );
    expect(formatted).toContain(
      "Inspect raw calls: workloads/pkg-vulns/tool-calls.json",
    );
  });

  it("warns when a full MCP run uses CLI fallback", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-eval-cli-fallback-"));
    const workloadDir = join(runDir, "workloads", "fallback");
    mkdirSync(workloadDir, { recursive: true });
    writeJson(join(workloadDir, "tool-calls.json"), [
      {
        agent: "codex",
        server: "githits-cli",
        tool: "search",
        status: "started",
      },
    ]);
    writeFileSync(join(workloadDir, "stderr.txt"), "");
    const report = buildRunReportFromMetadata(runDir, {
      agent: "codex",
      surface: "mcp",
      guidanceProfile: "full",
      workloads: [{ id: "fallback", status: "failed", workloadDir }],
    });
    expect(report.workloads[0]?.warnings).toContain(
      "MCP full guidance run used GitHits CLI fallback: search",
    );
    expect(formatRunReport(report)).toContain("CLI fallback");
  });

  it("reports discovery status and artifact path", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-eval-discovery-report-"));
    const workloadDir = join(runDir, "workloads", "discovery");
    mkdirSync(workloadDir, { recursive: true });
    writeJson(join(workloadDir, "tool-calls.json"), []);
    writeJson(join(workloadDir, "discovery-events.json"), {
      status: "not_observed",
      events: [],
    });
    writeFileSync(join(workloadDir, "stderr.txt"), "");
    const report = buildRunReportFromMetadata(runDir, {
      agent: "claude",
      surface: "mcp",
      guidanceProfile: "descriptors",
      workloads: [{ id: "discovery", status: "success", workloadDir }],
    });
    expect(report.workloads[0]?.discovery).toEqual({
      status: "not_observed",
      eventCount: 0,
    });
    expect(report.workloads[0]?.artifacts.discoveryEvents).toBe(
      "workloads/discovery/discovery-events.json",
    );
    expect(formatRunReport(report)).toContain("discovery=not_observed");
    expect(report.warnings).toContain(
      "Claude subscription runs may auto-discover global CLAUDE.md; descriptors/full profile evidence is diagnostic, not instruction-isolated",
    );
  });

  it("warns that Claude guidance-profile comparisons are diagnostic", () => {
    const before = buildRunReportFromMetadata("/before", {
      agent: "claude",
      surface: "mcp",
      guidanceProfile: "descriptors",
      workloads: [],
    });
    const after = buildRunReportFromMetadata("/after", {
      agent: "claude",
      surface: "mcp",
      guidanceProfile: "descriptors",
      workloads: [],
    });

    expect(compareReports(before, after).warnings).toContain(
      "Claude subscription runs may auto-discover global CLAUDE.md; descriptors/full profile evidence is diagnostic, not instruction-isolated",
    );
  });

  it("warns that Codex guidance-profile runs and comparisons are diagnostic", () => {
    const before = buildRunReportFromMetadata("/before", {
      agent: "codex",
      surface: "mcp",
      guidanceProfile: "descriptors",
      workloads: [],
    });
    const after = buildRunReportFromMetadata("/after", {
      agent: "codex",
      surface: "mcp",
      guidanceProfile: "descriptors",
      workloads: [],
    });
    const warning =
      "Codex loads global $CODEX_HOME/AGENTS.md when present; descriptors/full profile evidence is diagnostic, not instruction-isolated";

    expect(before.warnings).toContain(warning);
    expect(compareReports(before, after).warnings).toContain(warning);
  });

  it("reports no MCP guidance profile for skills runs", () => {
    const report = buildRunReportFromMetadata("/skills", {
      agent: "codex",
      model: "gpt-5.6-luna",
      surface: "skills",
      workloads: [],
    });
    expect(report.guidanceProfile).toBeUndefined();
    expect(formatRunReport(report)).toContain("profile=n/a");
  });

  it("reports missing artifacts for dry-run workloads without crashing", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-eval-dry-run-test-"));
    const report = buildRunReportFromMetadata(runDir, {
      agent: "claude",
      server: "local",
      dryRun: true,
      workloads: [{ id: "express-router", status: "dry-run" }],
    });

    expect(report.status).toBe("dry-run");
    expect(report.workloads[0]?.missingArtifacts).toContain("tool-calls.json");
    expect(formatRunReport(report)).toContain("express-router dry-run");
  });

  it("does not read workload artifacts outside the run directory", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-eval-safe-test-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "agent-eval-outside-test-"));
    mkdirSync(join(runDir, "workloads", "safe"), { recursive: true });
    writeJson(join(outsideDir, "tool-calls.json"), [
      { tool: "pkg_vulns", status: "completed" },
    ]);
    const report = buildRunReportFromMetadata(runDir, {
      workloads: [{ id: "safe", status: "success", workloadDir: outsideDir }],
    });

    expect(report.workloads[0]?.toolCalls.rawCount).toBe(0);
    expect(report.workloads[0]?.missingArtifacts).toContain("tool-calls.json");
  });

  it("does not let workload ids traverse outside the run directory", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-eval-id-safe-test-"));
    const outsideDir = join(runDir, "..", "outside-workload");
    mkdirSync(outsideDir, { recursive: true });
    writeJson(join(outsideDir, "tool-calls.json"), [
      { tool: "pkg_vulns", status: "completed" },
    ]);
    const report = buildRunReportFromMetadata(runDir, {
      workloads: [{ id: "../outside-workload", status: "success" }],
    });

    expect(report.workloads[0]?.toolCalls.rawCount).toBe(0);
    expect(report.workloads[0]?.warnings[0]).toContain(
      "invalid workload id ignored",
    );
  });

  it("does not follow workload artifact symlinks outside the run directory", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-eval-symlink-test-"));
    const outsideDir = mkdtempSync(
      join(tmpdir(), "agent-eval-symlink-outside-"),
    );
    mkdirSync(join(runDir, "workloads"), { recursive: true });
    writeJson(join(outsideDir, "tool-calls.json"), [
      { tool: "pkg_vulns", status: "completed" },
    ]);
    symlinkSync(outsideDir, join(runDir, "workloads", "symlinked"));
    const report = buildRunReportFromMetadata(runDir, {
      workloads: [{ id: "symlinked", status: "success" }],
    });

    expect(report.workloads[0]?.toolCalls.rawCount).toBe(0);
    expect(report.workloads[0]?.warnings[0]).toContain(
      "artifact path outside run directory ignored",
    );
  });

  it("warns only on actual-use self-report drift", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-eval-drift-test-"));
    const workloadDir = join(runDir, "workloads", "drift");
    mkdirSync(workloadDir, { recursive: true });
    writeJson(join(workloadDir, "tool-calls.json"), [
      { tool: "pkg_vulns", status: "completed" },
    ]);
    writeJson(join(workloadDir, "final.json"), {
      status: "success",
      githitsUsefulness: "helped",
      githitsUsefulnessReason: "useful",
      confidence: "high",
      expectedToolUse: ["pkg_info"],
      unexpectedToolUse: ["docs_read"],
      toolIssues: [],
      instructionIssues: [],
    });
    writeFileSync(join(workloadDir, "stderr.txt"), "");
    const report = buildRunReportFromMetadata(runDir, {
      workloads: [{ id: "drift", status: "success", workloadDir }],
    });

    expect(report.workloads[0]?.warnings).toEqual([
      "self-report drift: unexpectedToolUse not present in raw calls: docs_read",
    ]);
  });

  it("does not treat fallback descriptions as self-report drift", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-eval-fallback-test-"));
    const workloadDir = join(runDir, "workloads", "fallback");
    mkdirSync(workloadDir, { recursive: true });
    writeJson(join(workloadDir, "tool-calls.json"), [
      { tool: "pkg_vulns", status: "completed" },
    ]);
    writeJson(join(workloadDir, "final.json"), {
      status: "success",
      githitsUsefulness: "helped",
      githitsUsefulnessReason: "useful",
      confidence: "high",
      expectedToolUse: [],
      unexpectedToolUse: ["web search fallback for public corroboration"],
      toolIssues: [],
      instructionIssues: [],
    });
    writeFileSync(join(workloadDir, "stderr.txt"), "");
    const report = buildRunReportFromMetadata(runDir, {
      workloads: [{ id: "fallback", status: "success", workloadDir }],
    });

    expect(report.workloads[0]?.warnings).toEqual([]);
  });

  it("parses report CLI modes and rejects invalid combinations", () => {
    expect(parseReportArgs(["/run"])).toEqual({
      mode: "report",
      runDir: "/run",
    });
    expect(parseReportArgs(["--json", "/run"])).toEqual({
      mode: "json",
      runDir: "/run",
    });
    expect(parseReportArgs(["--compare", "/before", "/after"])).toEqual({
      mode: "compare",
      beforeRunDir: "/before",
      afterRunDir: "/after",
    });
    expect(() => parseReportArgs(["--json"])).toThrow(
      "--json requires exactly one run directory",
    );
    expect(() => parseReportArgs(["/one", "/two"])).toThrow(
      "report mode accepts exactly one run directory",
    );
  });

  it("compares same-agent reports with aggregate status counts", () => {
    const before = buildRunReportFromMetadata("/before", {
      agent: "codex",
      model: "gpt-5.4-mini",
      server: "local",
      workloads: [{ id: "pkg-vulns", status: "success" }],
    });
    const afterRunDir = createRunFixture();
    const after = buildRunReportFromMetadata(
      afterRunDir,
      JSON.parse(readFileSync(join(afterRunDir, "run.json"), "utf8")),
    );
    const formatted = formatCompareReport(compareReports(before, after));

    expect(formatted).toContain(
      "before=/before (codex:gpt-5.4-mini/mcp/local)",
    );
    expect(formatted).toContain("after=");
    expect(formatted).toContain("(codex/mcp/local)");
    expect(formatted).toContain("pkg-vulns status unchanged success");
    expect(formatted).toContain("raw events 0 -> 2");
    expect(formatted).toContain("+pkg_vulns");
  });

  it("warns when same-agent comparison metadata differs", () => {
    const before = buildRunReportFromMetadata("/before", {
      agent: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      surface: "mcp",
      guidanceProfile: "descriptors",
      workloads: [],
    });
    const after = buildRunReportFromMetadata("/after", {
      agent: "codex",
      model: "gpt-custom",
      reasoningEffort: "low",
      surface: "mcp",
      guidanceProfile: "full",
      workloads: [],
    });
    const comparison = compareReports(before, after);
    expect(comparison.warnings).toEqual([
      "guidance profile differs: descriptors -> full",
      "model differs: gpt-5.6-luna -> gpt-custom",
      "reasoning effort differs: high -> low",
      "Codex loads global $CODEX_HOME/AGENTS.md when present; descriptors/full profile evidence is diagnostic, not instruction-isolated",
    ]);
    expect(formatCompareReport(comparison)).toContain(
      "profile=descriptors effort=high",
    );
    expect(formatCompareReport(comparison)).toContain(
      "profile=full effort=low",
    );
  });

  it("degrades cross-agent comparisons to tool-name presence", () => {
    const before = buildRunReportFromMetadata("/before", {
      agent: "claude",
      workloads: [{ id: "pkg-vulns", status: "success" }],
    });
    const after = buildRunReportFromMetadata("/after", {
      agent: "codex",
      workloads: [{ id: "pkg-vulns", status: "success" }],
    });
    const formatted = formatCompareReport(compareReports(before, after));

    expect(formatted).toContain("cross-agent comparison");
    expect(formatted).not.toContain("raw events");
  });

  it("fails fast on duplicate workload ids", () => {
    expect(() =>
      assertUniqueWorkloadIds(["/a/tasks/pkg.md", "/b/other/pkg.md"]),
    ).toThrow('Duplicate workload id "pkg"');
  });

  it("keeps workload selection docs in sync", () => {
    const repoRoot = process.cwd();
    const workloadsDir = join(repoRoot, "eval", "agentic", "workloads");
    const readme = readFileSync(
      join(repoRoot, "eval", "agentic", "README.md"),
      "utf8",
    );
    const workloadFiles = readdirSync(workloadsDir)
      .filter((file) => file.endsWith(".md") && file !== "REPORTING.md")
      .sort();
    const missing = workloadFiles.filter(
      (file) => !readme.includes(`\`${file}\``),
    );

    expect(missing).toEqual([]);
    expect(workloadFiles.map((file) => basename(file))).toContain(
      "package-overview-vulnerabilities.md",
    );
  });
});
