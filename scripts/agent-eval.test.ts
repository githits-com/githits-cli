import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  buildClaudeCommand,
  buildCodexCommand,
  buildCodexConfig,
  buildCodexConfigArgs,
  buildEvalEnv,
  buildMcpConfig,
  collectSecretValues,
  extractToolCalls,
  isValidAgentReport,
  parseArgs,
  redactText,
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

  it("passes selected models to agent commands", () => {
    expect(buildClaudeCommand("prompt", "/tmp/mcp.json", "haiku")).toContain(
      "haiku",
    );
    expect(
      buildCodexCommand(
        "prompt",
        "/tmp/work",
        "/tmp/final.txt",
        "/tmp/schema.json",
        {
          server: "local",
          repoRoot: "/repo/githits-cli",
          publishedPackage: "githits@latest",
          model: "gpt-5.4-mini",
        },
      ),
    ).toContain("gpt-5.4-mini");
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
      "/repo/githits-cli",
    );

    expect(options.agent).toBe("codex");
    expect(options.model).toBe("gpt-5.4-mini");
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

    expect(formatted).toContain("before=/before (codex:gpt-5.4-mini/local)");
    expect(formatted).toContain("after=");
    expect(formatted).toContain("(codex/local)");
    expect(formatted).toContain("pkg-vulns status unchanged success");
    expect(formatted).toContain("raw events 0 -> 2");
    expect(formatted).toContain("+pkg_vulns");
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
