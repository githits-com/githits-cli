import { describe, expect, it } from "bun:test";
import {
  buildCodexConfig,
  buildCodexConfigArgs,
  buildEvalEnv,
  buildMcpConfig,
  collectSecretValues,
  isValidAgentReport,
  parseArgs,
  redactText,
  sanitizedEnvSummary,
} from "./agent-eval.ts";

describe("agent eval harness", () => {
  it("builds local MCP config with explicit repo cwd", () => {
    const config = buildMcpConfig({
      server: "local",
      repoRoot: "/repo/githits-cli",
      publishedPackage: "githits@latest",
    });

    expect(config.mcpServers.githits).toEqual({
      command: "bun",
      args: ["run", "--cwd", "/repo/githits-cli", "dev", "mcp", "start"],
    });
  });

  it("builds published MCP config with pinned package spec", () => {
    const config = buildMcpConfig({
      server: "published",
      repoRoot: "/repo/githits-cli",
      publishedPackage: "githits@0.4.2",
    });

    expect(config.mcpServers.githits).toEqual({
      command: "npx",
      args: ["-y", "githits@0.4.2", "mcp", "start"],
    });
  });

  it("builds Codex TOML config from the same MCP command", () => {
    expect(
      buildCodexConfig({
        server: "local",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@latest",
      }),
    ).toBe(
      '[mcp_servers.githits]\ncommand = "bun"\nargs = ["run","--cwd","/repo/githits-cli","dev","mcp","start"]\n',
    );
  });

  it("builds Codex config override args", () => {
    expect(
      buildCodexConfigArgs({
        server: "published",
        repoRoot: "/repo/githits-cli",
        publishedPackage: "githits@0.4.2",
      }),
    ).toEqual([
      "-c",
      'mcp_servers.githits.command="npx"',
      "-c",
      'mcp_servers.githits.args=["-y","githits@0.4.2","mcp","start"]',
    ]);
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
    const options = parseArgs(
      [
        "--agent",
        "codex",
        "--server",
        "published",
        "--published-package",
        "githits@0.4.2",
        "--workload",
        "eval/agentic/workloads/express-router.md",
        "--timeout",
        "12",
        "--dry-run",
      ],
      "/repo/githits-cli",
    );

    expect(options.agent).toBe("codex");
    expect(options.server).toBe("published");
    expect(options.publishedPackage).toBe("githits@0.4.2");
    expect(options.timeoutSeconds).toBe(12);
    expect(options.dryRun).toBe(true);
    expect(options.workloads).toEqual([
      "/repo/githits-cli/eval/agentic/workloads/express-router.md",
    ]);
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
        githitsToolsUsed: [{ tool: "search", purpose: "find router" }],
        toolIssues: [],
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
});
