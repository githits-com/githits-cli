import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatAgentEvalCiReport,
  parseAgentEvalCiReportArgs,
  runAgentEvalCiReportCli,
} from "./agent-eval-ci-report.ts";
import { LUNA_MODEL } from "./agent-eval-metrics.ts";
import {
  type AgentEvalSuiteArtifact,
  parseSuiteArtifact,
} from "./agent-eval-suite.ts";

const HASH = "a".repeat(64);

function suiteArtifact(
  overrides: Partial<AgentEvalSuiteArtifact> = {},
): AgentEvalSuiteArtifact {
  return parseSuiteArtifact({
    schemaVersion: 3,
    suiteId: randomUUID(),
    suiteName: "canary",
    status: "success",
    dryRun: false,
    startedAt: "2026-08-31T00:00:00.000Z",
    completedAt: "2026-08-31T00:00:01.250Z",
    measurementRoot: "/repo",
    measurementGit: { branch: "main", sha: "harness-sha", dirty: false },
    targetRoot: "/repo",
    targetGit: { branch: "main", sha: "target-sha", dirty: false },
    matrix: {
      agent: "codex",
      model: LUNA_MODEL,
      reasoningEffort: "low",
      surface: "mcp",
      server: "local",
      scenarios: ["discovery"],
    },
    selectedWorkloads: [
      {
        id: "stable-a",
        path: "eval/agentic/workloads/stable-a.md",
        safety: "stable",
      },
    ],
    contentIdentity: {
      workloads: [
        {
          path: "eval/agentic/workloads/stable-a.md",
          sha256: HASH,
          bytes: 10,
        },
      ],
      reportingContract: {
        path: "eval/agentic/workloads/REPORTING.md",
        sha256: HASH,
        bytes: 10,
      },
      resultSchema: {
        path: "eval/agentic/schema.json",
        sha256: HASH,
        bytes: 10,
      },
    },
    targetGuidanceIdentity: {
      skillFiles: [],
      guidanceBlock: { sha256: HASH, bytes: 10 },
    },
    shards: [
      {
        scenario: "discovery",
        profile: "descriptors",
        guidanceProfile: "descriptors",
        intentProfile: "neutral",
        intentFragmentHash: null,
        agent: "codex",
        model: LUNA_MODEL,
        reasoningEffort: "low",
        status: "success",
        error: null,
        runPath: "shards/discovery/run.json",
        metricsPath: "shards/discovery/metrics.json",
        reportPath: "shards/discovery/report.json",
      },
    ],
    cells: [
      {
        id: "discovery/stable-a",
        scenario: "discovery",
        profile: "descriptors",
        guidanceProfile: "descriptors",
        intentProfile: "neutral",
        intentFragmentHash: null,
        agent: "codex",
        model: LUNA_MODEL,
        reasoningEffort: "low",
        workloadId: "stable-a",
        workloadPath: "eval/agentic/workloads/stable-a.md",
        status: "success",
        durationMs: 1_250,
      },
    ],
    wallTimeMs: 1_250,
    cumulativeAgentTimeMs: 1_250,
    workloadConcurrency: 2,
    totals: {
      expectedExecutions: 1,
      observedExecutions: 1,
      successfulExecutions: 1,
      failedExecutions: 0,
      unknownExecutions: 0,
      missingExecutions: 0,
      workloadCount: 1,
      failedWorkloadCount: 0,
      missingWorkloadCount: 0,
    },
    logicalToolCalls: 3,
    tokens: {
      uncachedInputTokens: 100,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 5,
      outputTokens: 30,
      reasoningOutputTokens: 10,
    },
    cost: {
      kind: "base_rate_estimate",
      usd: 0.01234,
      uncertainty: "rate_based_estimate",
    },
    callsByTool: [
      {
        surface: "mcp",
        tool: "z_tool",
        total: 1,
        started: 1,
        completed: 1,
        failed: 0,
        unknown: 0,
      },
      {
        surface: "mcp",
        tool: "a_tool",
        total: 2,
        started: 2,
        completed: 1,
        failed: 1,
        unknown: 0,
      },
    ],
    missingToolTelemetryCellIds: [],
    codexVersions: ["codex 1.2.3"],
    warnings: [],
    ...overrides,
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("agent eval CI report", () => {
  it("formats valid success with identity, metrics, concurrency, and tool counts", () => {
    const result = formatAgentEvalCiReport({
      suites: [{ label: "discovery", artifact: suiteArtifact() }],
    });
    expect(result.failed).toBe(false);
    expect(result.markdown).toContain("| discovery | PASS | 1/1 |");
    expect(result.markdown).toContain("schema v3; harness harness-sha");
    expect(result.markdown).toContain("Concurrency");
    expect(result.markdown).toContain("| 2 |");
    expect(result.markdown).toContain("codex 1.2.3");
    expect(result.markdown).toContain(
      "in=100 cached=20 write=5 out=30 reasoning=10",
    );
    expect(result.markdown).toContain("$0.0123 (rate_based_estimate)");
    expect(result.markdown).toContain("mcp/a_tool");
    expect(result.markdown).toContain(
      "total 2 (started 2, completed 1, failed 1, unknown 0)",
    );
    expect(result.markdown.indexOf("mcp/a_tool")).toBeLessThan(
      result.markdown.indexOf("mcp/z_tool"),
    );
  });

  it("accepts a dry-run with zero discovery calls", () => {
    const result = formatAgentEvalCiReport({
      suites: [
        {
          label: "discovery",
          artifact: suiteArtifact({
            status: "dry-run",
            dryRun: true,
            logicalToolCalls: 0,
            callsByTool: [],
            cumulativeAgentTimeMs: null,
            tokens: {
              uncachedInputTokens: null,
              cachedInputTokens: null,
              cacheWriteInputTokens: null,
              outputTokens: null,
              reasoningOutputTokens: null,
            },
            cost: { kind: "unknown", usd: null, uncertainty: "unknown" },
            codexVersions: [],
            warnings: ["discovery metrics warning: dry_run_no_telemetry"],
          }),
        },
      ],
    });
    expect(result.failed).toBe(false);
    expect(result.markdown).toContain("| discovery | DRY-RUN | 1/1 |");
    expect(result.markdown).toContain("Tool calls: none");
    expect(result.markdown).toContain("dry_run_no_telemetry");
  });

  it("renders unknown tool and token telemetry without failing", () => {
    const result = formatAgentEvalCiReport({
      suites: [
        {
          label: "unknown",
          artifact: suiteArtifact({
            callsByTool: null,
            missingToolTelemetryCellIds: ["discovery/stable-a"],
            logicalToolCalls: null,
            tokens: {
              uncachedInputTokens: null,
              cachedInputTokens: null,
              cacheWriteInputTokens: null,
              outputTokens: null,
              reasoningOutputTokens: null,
            },
            cost: { kind: "unknown", usd: null, uncertainty: "unknown" },
          }),
        },
      ],
    });
    expect(result.failed).toBe(false);
    expect(result.markdown).toContain("Tool calls: unknown");
    expect(result.markdown).toContain("missing telemetry for 1 cell");
    expect(result.markdown).toContain("Logical calls");
  });

  it("shows ordinary warnings but classifies invalid execution warnings as failures", () => {
    const ordinary = formatAgentEvalCiReport({
      suites: [
        {
          label: "ordinary",
          artifact: suiteArtifact({
            warnings: ["long_context_pricing_not_attributable"],
          }),
        },
      ],
    });
    expect(ordinary.failed).toBe(false);
    expect(ordinary.markdown).toContain(
      "long_context_pricing_not_attributable",
    );

    const invalid = formatAgentEvalCiReport({
      suites: [
        {
          label: "invalid",
          artifact: suiteArtifact({
            warnings: [
              "MCP descriptors guidance run used GitHits CLI fallback: search",
              "external guidance read outside isolated workspace: /tmp/host",
            ],
          }),
        },
      ],
    });
    expect(invalid.failed).toBe(true);
    expect(invalid.markdown).toContain("| invalid | FAIL |");
    expect(invalid.markdown).toContain("CLI fallback");
    expect(invalid.markdown).toContain("isolated workspace");
  });

  it("fails partial and failed suites and all non-success workload cells", () => {
    for (const status of ["partial", "failed"] as const) {
      const result = formatAgentEvalCiReport({
        suites: [{ label: status, artifact: suiteArtifact({ status }) }],
      });
      expect(result.failed).toBe(true);
      expect(result.markdown).toContain(`| ${status} | FAIL |`);
    }
    for (const cellStatus of ["failed", "missing", "unknown"] as const) {
      const result = formatAgentEvalCiReport({
        suites: [
          {
            label: cellStatus,
            artifact: suiteArtifact({
              cells: [
                {
                  ...suiteArtifact().cells[0]!,
                  status: cellStatus,
                },
              ],
              totals: {
                ...suiteArtifact().totals,
                successfulExecutions: 0,
                failedExecutions: cellStatus === "failed" ? 1 : 0,
                missingExecutions: cellStatus === "missing" ? 1 : 0,
                unknownExecutions: cellStatus === "unknown" ? 1 : 0,
              },
            }),
          },
        ],
      });
      expect(result.failed).toBe(true);
      expect(result.markdown).toContain(`| ${cellStatus} | FAIL |`);
    }
  });

  it("renders ordered labeled scenarios and an optional run URL without comparison language", () => {
    const result = formatAgentEvalCiReport({
      suites: [
        { label: "discovery", artifact: suiteArtifact() },
        {
          label: "intent",
          artifact: suiteArtifact({ workloadConcurrency: 4 }),
        },
      ],
      runUrl: "https://github.example/runs/1",
    });
    expect(result.markdown.indexOf("| discovery | PASS |")).toBeLessThan(
      result.markdown.indexOf("| intent | PASS |"),
    );
    expect(result.markdown).toContain(
      "[workflow run](<https://github.example/runs/1>)",
    );
    expect(result.markdown).not.toMatch(/baseline|delta/i);
  });

  it("renders a failed diagnostic row for missing or unparseable artifacts", () => {
    const result = formatAgentEvalCiReport({
      suites: [
        {
          label: "missing",
          artifact: null,
          error: "Suite artifact is not valid JSON: unexpected end of input",
        },
      ],
    });
    expect(result.failed).toBe(true);
    expect(result.markdown).toContain("| missing | FAIL | unknown |");
    expect(result.markdown).toContain("unexpected end of input");

    const root = mkdtempSync(join(tmpdir(), "agent-eval-ci-report-invalid-"));
    const artifactPath = join(root, "invalid.json");
    const out = join(root, "summary.md");
    try {
      writeFileSync(artifactPath, "not json\n");
      const cliResult = runAgentEvalCiReportCli([
        "--suite",
        `invalid=${artifactPath}`,
        "--out",
        out,
      ]);
      expect(cliResult.failed).toBe(true);
      expect(readFileSync(out, "utf8")).toContain("not valid JSON");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies explicit missing-required-evidence diagnostics as failures", () => {
    const result = formatAgentEvalCiReport({
      suites: [
        {
          label: "evidence",
          artifact: suiteArtifact({
            warnings: ["missing required evidence: report.json"],
          }),
        },
      ],
    });
    expect(result.failed).toBe(true);
    expect(result.markdown).toContain("| evidence | FAIL |");
  });

  it("validates CLI arguments before reading files", () => {
    expect(() => parseAgentEvalCiReportArgs([])).toThrow(
      "at least one --suite",
    );
    expect(() => parseAgentEvalCiReportArgs(["--out", "summary.md"])).toThrow(
      "at least one --suite",
    );
    expect(() =>
      parseAgentEvalCiReportArgs([
        "--suite",
        "malformed",
        "--out",
        "summary.md",
      ]),
    ).toThrow("<label>=<path>");
    expect(() =>
      parseAgentEvalCiReportArgs([
        "--suite",
        "one=missing.json",
        "--suite",
        "one=other.json",
        "--out",
        "summary.md",
      ]),
    ).toThrow("duplicate suite label");
    expect(() =>
      parseAgentEvalCiReportArgs([
        "--suite",
        "one=missing.json",
        "--unknown",
        "x",
        "--out",
        "summary.md",
      ]),
    ).toThrow("unknown flag");
    expect(() =>
      parseAgentEvalCiReportArgs(["--suite", "one=missing.json", "--out"]),
    ).toThrow("--out requires a value");
  });

  it("writes the report before returning failed for missing suite evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-eval-ci-report-test-"));
    const out = join(root, "nested", "summary.md");
    try {
      const result = runAgentEvalCiReportCli([
        "--suite",
        "missing=missing.json",
        "--out",
        out,
      ]);
      expect(result.failed).toBe(true);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, "utf8")).toContain("| missing | FAIL |");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads ordered suite files and reports a successful dry-run", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-eval-ci-report-files-"));
    const discoveryPath = join(root, "discovery.json");
    const intentPath = join(root, "intent.json");
    const out = join(root, "summary.md");
    try {
      writeJson(discoveryPath, suiteArtifact({ workloadConcurrency: 2 }));
      writeJson(
        intentPath,
        suiteArtifact({
          workloadConcurrency: 4,
          status: "dry-run",
          dryRun: true,
          logicalToolCalls: 0,
          callsByTool: [],
          cumulativeAgentTimeMs: null,
          tokens: {
            uncachedInputTokens: null,
            cachedInputTokens: null,
            cacheWriteInputTokens: null,
            outputTokens: null,
            reasoningOutputTokens: null,
          },
          cost: { kind: "unknown", usd: null, uncertainty: "unknown" },
          codexVersions: [],
        }),
      );
      const result = runAgentEvalCiReportCli([
        "--suite",
        `discovery=${discoveryPath}`,
        "--suite",
        `intent=${intentPath}`,
        "--run-url",
        "https://github.example/runs/1",
        "--out",
        out,
      ]);
      expect(result.failed).toBe(false);
      const markdown = readFileSync(out, "utf8");
      expect(markdown).toContain("| discovery | PASS |");
      expect(markdown).toContain("| intent | DRY-RUN |");
      expect(markdown).toContain("schema v3");
      expect(markdown).toContain("| 2 |");
      expect(markdown).toContain("| 4 |");
      expect(markdown).not.toMatch(/baseline|delta/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
