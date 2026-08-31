import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  type BraintrustBaseExperiment,
  type BraintrustCliResult,
  type BraintrustEndSpanArgs,
  type BraintrustExperimentInit,
  type BraintrustIdentityInput,
  type BraintrustRowEvent,
  type BraintrustSpan,
  type BraintrustSuiteInput,
  btEvalMain,
  buildBraintrustExperimentIdentity,
  buildBraintrustExperimentInit,
  createBraintrustPublisher,
  parseBraintrustArgs,
  preflightAndMapBraintrustRows,
  publishBraintrustRows,
  resolveBraintrustMainExperiment,
  runBraintrustCli,
} from "./agent-eval-braintrust.ts";
import {
  type AgentEvalMetrics,
  type AgentEvalRecordInput,
  adaptAgentUsage,
  buildAgentEvalMetrics,
  LUNA_MODEL,
} from "./agent-eval-metrics.ts";
import { buildRunReportFromMetadata } from "./agent-eval-report.ts";
import {
  type AgentEvalSuiteArtifact,
  type AgentEvalSuiteScenario,
  type AgentEvalSuiteShardOptions,
  runAgentEvalSuite,
} from "./agent-eval-suite.ts";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

interface SuiteFixture {
  root: string;
  suitePath: string;
  shardPath: string;
  workloadDir: string;
}

interface SuiteOptions {
  scenarios?: readonly AgentEvalSuiteScenario[];
  workloadId?: string;
  processStatus?: "success" | "failed" | "timeout";
  toolCalls?: AgentEvalRecordInput["toolCalls"];
  dryRun?: boolean;
}

function createRecord(
  options: AgentEvalSuiteShardOptions,
  workloadId: string,
  suiteOptions: SuiteOptions,
): AgentEvalRecordInput {
  const processStatus = suiteOptions.processStatus ?? "success";
  return {
    workloadId,
    requestedModel: LUNA_MODEL,
    resolvedModel: LUNA_MODEL,
    agent: "codex",
    agentVersion: "codex-test",
    reasoningEffort: "low",
    surface: "mcp",
    server: "local",
    guidanceProfile: options.guidanceProfile,
    scenario: options.scenario,
    intentProfile: options.intentProfile,
    intentFragmentHash: options.intentFragmentHash,
    experimentalTools: false,
    publishedPackage: null,
    targetGit: {
      branch: "main",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      dirty: false,
    },
    startedAt: "2026-08-28T10:00:00.000Z",
    completedAt: "2026-08-28T10:00:01.000Z",
    durationMs: 1000,
    processStatus,
    finalStatus: processStatus === "success" ? "success" : "failure",
    exitCode: processStatus === "success" ? 0 : 1,
    timedOut: processStatus === "timeout",
    usage: adaptAgentUsage(
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 100,
          cached_input_tokens: 20,
          cache_write_input_tokens: 10,
          output_tokens: 30,
          reasoning_output_tokens: 4,
        },
      }),
      "codex",
      LUNA_MODEL,
    ),
    toolCalls: suiteOptions.toolCalls ?? [
      {
        tool: "search",
        server: "githits",
        providerCallId: "search-1",
        status: "started",
        observedAt: "2026-08-28T10:00:00.100Z",
      },
      {
        tool: "search",
        server: "githits",
        providerCallId: "search-1",
        status: "completed",
        observedAt: "2026-08-28T10:00:00.200Z",
      },
      {
        tool: "pkg-info",
        server: "githits-cli",
        providerCallId: "pkg-info-1",
        status: "started",
        observedAt: "2026-08-28T10:00:00.500Z",
      },
    ],
    artifacts: {},
  };
}

async function createSuite(
  suiteOptions: SuiteOptions = {},
): Promise<SuiteFixture> {
  const root = mkdtempSync(join(tmpdir(), "agent-eval-braintrust-suite-"));
  const workloadsDir = join(root, "eval", "agentic", "workloads");
  const workloadId = suiteOptions.workloadId ?? "workload-a";
  const workloadPath = join(workloadsDir, `${workloadId}.md`);
  const reportingPath = join(workloadsDir, "REPORTING.md");
  const schemaPath = join(root, "eval", "agentic", "result.schema.json");
  const manifestPath = join(root, "eval", "agentic", "suites.json");
  const outDir = join(root, "out");
  mkdirSync(workloadsDir, { recursive: true });
  mkdirSync(join(root, "skills", "githits-mcp"), { recursive: true });
  mkdirSync(join(root, "src", "commands", "init"), { recursive: true });
  writeFileSync(workloadPath, `# ${workloadId}\n`);
  writeFileSync(reportingPath, "# Reporting contract\n");
  writeFileSync(schemaPath, "{}\n");
  writeFileSync(
    join(root, "skills", "githits-mcp", "SKILL.md"),
    "# Target skill\n",
  );
  writeFileSync(
    join(root, "src", "commands", "init", "guidance-assets.ts"),
    'export const GITHITS_GUIDANCE_BLOCK = "Target guidance";\n',
  );
  writeJson(manifestPath, {
    schemaVersion: 1,
    workloads: [
      {
        id: workloadId,
        path: `eval/agentic/workloads/${workloadId}.md`,
        safety: "stable",
        suites: ["canary", "smoke", "stable-full"],
      },
    ],
  });

  let shardPath = "";
  let workloadDir = "";
  await runAgentEvalSuite({
    suite: "canary",
    repoRoot: root,
    targetRoot: root,
    outDir,
    manifestPath,
    workloadsDir,
    reportingPath,
    schemaPath,
    dryRun: suiteOptions.dryRun ?? false,
    workloadConcurrency: 1,
    scenarios: suiteOptions.scenarios ?? ["discovery"],
    shardExecutor: async (options) => {
      shardPath = options.outDir;
      workloadDir = join(options.outDir, "workloads", workloadId);
      mkdirSync(workloadDir, { recursive: true });
      const record = createRecord(options, workloadId, suiteOptions);
      writeFileSync(
        join(workloadDir, "prompt.md"),
        `Prompt for ${options.scenario}/${workloadId}.\n`,
      );
      writeJson(join(workloadDir, "tool-calls.json"), record.toolCalls);
      writeJson(join(workloadDir, "final.json"), {
        status:
          suiteOptions.processStatus === "success" ? "success" : "failure",
        answer: `Answer for ${options.scenario}/${workloadId}.`,
        confidence: "high",
      });
      writeFileSync(join(workloadDir, "stderr.txt"), "");
      const runMetadata = {
        runId: `run-${options.scenario}`,
        startedAt: "2026-08-28T10:00:00.000Z",
        completedAt: "2026-08-28T10:00:01.000Z",
        agent: "codex",
        model: LUNA_MODEL,
        reasoningEffort: "low",
        surface: "mcp",
        server: "local",
        guidanceProfile: options.guidanceProfile,
        scenario: options.scenario,
        intentProfile: options.intentProfile,
        intentFragmentHash: options.intentFragmentHash,
        dryRun: options.dryRun,
        codexVersion: "codex-test",
        git: {
          branch: "main",
          sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          dirty: false,
        },
        workloads: [
          {
            id: workloadId,
            status:
              suiteOptions.processStatus === "timeout"
                ? "timeout"
                : suiteOptions.processStatus === "failed"
                  ? "failed"
                  : "success",
            durationMs: 1000,
            workloadDir,
          },
        ],
      };
      writeJson(join(options.outDir, "run.json"), runMetadata);
      writeJson(
        join(options.outDir, "metrics.json"),
        buildAgentEvalMetrics({
          runId: runMetadata.runId,
          startedAt: runMetadata.startedAt,
          completedAt: runMetadata.completedAt,
          records: [record],
        }),
      );
      writeJson(
        join(options.outDir, "report.json"),
        buildRunReportFromMetadata(options.outDir, runMetadata),
      );
      return { runDir: options.outDir, status: "success" };
    },
  });
  mutateJson<AgentEvalSuiteArtifact>(join(outDir, "suite.json"), (artifact) => {
    artifact.targetGit = {
      branch: "main",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      dirty: false,
    };
  });
  return {
    root,
    suitePath: join(outDir, "suite.json"),
    shardPath,
    workloadDir,
  };
}

function suiteInput(label: string, suitePath: string): BraintrustSuiteInput {
  return { label, suitePath };
}

function mutateJson<T>(path: string, mutate: (value: T) => void): void {
  const value = JSON.parse(readFileSync(path, "utf8")) as T;
  mutate(value);
  writeJson(path, value);
}

function mutateSuite(
  fixture: SuiteFixture,
  mutate: (artifact: AgentEvalSuiteArtifact) => void,
): void {
  mutateJson(fixture.suitePath, mutate);
}

function mutateMetrics(
  fixture: SuiteFixture,
  mutate: (metrics: AgentEvalMetrics) => void,
): void {
  mutateJson(join(fixture.shardPath, "metrics.json"), mutate);
}

function firstMetricsRecord(
  metrics: AgentEvalMetrics,
): AgentEvalMetrics["records"][number] {
  const record = metrics.records[0];
  if (!record) {
    throw new Error("test fixture must contain a metrics record");
  }
  return record;
}

function leafSpan(
  end: (args?: BraintrustEndSpanArgs) => void = () => {},
): BraintrustSpan {
  return {
    startSpan() {
      throw new Error("test leaf spans cannot have children");
    },
    end,
  };
}

describe("Braintrust eval row mapping", () => {
  it("keeps stable input identity separate from process identity", async () => {
    const fixture = await createSuite({ scenarios: ["full", "discovery"] });
    const result = preflightAndMapBraintrustRows([
      suiteInput("local", fixture.suitePath),
    ]);

    expect(result.rows.map((row) => row.input.scenario)).toEqual([
      "discovery",
      "full",
    ]);
    expect(Object.keys(result.rows[0]!.input).sort()).toEqual([
      "prompt",
      "promptSha256",
      "scenario",
      "workloadId",
      "workloadPath",
    ]);
    expect(result.rows[0]!.input.workloadPath).toBe(
      "eval/agentic/workloads/workload-a.md",
    );
    expect(result.rows[0]!.metadata.agent).toBe("codex");
    expect(result.rows[0]!.metadata.suiteLabel).toBe("local");
  });

  it("captures exact prompt and answer with a byte hash", async () => {
    const fixture = await createSuite();
    const result = preflightAndMapBraintrustRows([
      suiteInput("canary", fixture.suitePath),
    ]);
    const row = result.rows[0]!;

    expect(row.input.prompt).toBe("Prompt for discovery/workload-a.\n");
    expect(row.input.promptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.output.answer).toBe("Answer for discovery/workload-a.");
    expect(row.output.confidence).toBe("high");
    expect(row.output.discovery).toBeUndefined();
  });

  it("uses the resolved model with a requested-model fallback", async () => {
    const fixture = await createSuite();
    mutateMetrics(fixture, (metrics) => {
      firstMetricsRecord(metrics).resolvedModel = null;
    });
    const row = preflightAndMapBraintrustRows([
      suiteInput("model", fixture.suitePath),
    ]).rows[0]!;

    expect(row.metadata.model).toBe(LUNA_MODEL);
    expect(row.metadata.requestedModel).toBe(LUNA_MODEL);
    expect(row.metadata.resolvedModel).toBeNull();
  });

  it("carries valid recorded span times without fabricating invalid ones", async () => {
    const fixture = await createSuite();
    const expectedStart = Date.parse("2026-08-28T10:00:00.000Z") / 1000;
    const expectedEnd = Date.parse("2026-08-28T10:00:01.000Z") / 1000;
    const validRow = preflightAndMapBraintrustRows([
      suiteInput("valid-times", fixture.suitePath),
    ]).rows[0]!;
    expect(validRow.startTime).toBe(expectedStart);
    expect(validRow.endTime).toBe(expectedEnd);

    mutateMetrics(fixture, (metrics) => {
      const record = firstMetricsRecord(metrics);
      record.startedAt = "not-a-timestamp";
    });
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("invalid-times", fixture.suitePath),
      ]),
    ).toThrow("no valid parent span interval");

    mutateMetrics(fixture, (metrics) => {
      const record = firstMetricsRecord(metrics);
      record.startedAt = "2026-08-28T10:00:02.000Z";
      record.completedAt = "2026-08-28T10:00:01.000Z";
    });
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("reversed-times", fixture.suitePath),
      ]),
    ).toThrow("no valid parent span interval");
  });

  it("orders rows by suite label, scenario, and workload", async () => {
    const zeta = await createSuite({ scenarios: ["full", "discovery"] });
    const alpha = await createSuite({
      scenarios: ["full", "discovery"],
      workloadId: "workload-b",
    });
    const result = preflightAndMapBraintrustRows([
      suiteInput("zeta", zeta.suitePath),
      suiteInput("alpha", alpha.suitePath),
    ]);

    expect(
      result.rows.map(
        (row) =>
          `${row.metadata.suiteLabel}/${row.input.scenario}/${row.input.workloadId}`,
      ),
    ).toEqual([
      "alpha/discovery/workload-b",
      "alpha/full/workload-b",
      "zeta/discovery/workload-a",
      "zeta/full/workload-a",
    ]);
  });

  it("maps every named metric and preserves known zeroes", async () => {
    const fixture = await createSuite();
    const result = preflightAndMapBraintrustRows([
      suiteInput("known", fixture.suitePath),
    ]);
    const metrics = result.rows[0]!.metrics;
    expect(metrics).toMatchObject({
      duration: 1,
      mcp_tool_calls: 1,
      cli_tool_calls: 1,
      tool_calls_started: 1,
      tool_calls_completed: 1,
      tool_calls_unknown: 0,
      raw_tool_events: 3,
      prompt_tokens: 100,
      prompt_cached_tokens: 20,
      prompt_cache_creation_tokens: 10,
      completion_tokens: 30,
      completion_reasoning_tokens: 4,
      tokens: 130,
    });
    expect(metrics.estimated_cost).toBeGreaterThan(0);
    expect(metrics).not.toHaveProperty("tool_calls");
    expect(metrics).not.toHaveProperty("tool_errors");
    for (const removedMetric of [
      "agent_duration_ms",
      "logical_tool_calls",
      "tool_calls_failed",
      "uncached_input_tokens",
      "cached_input_tokens",
      "cache_write_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "estimated_cost_usd",
    ]) {
      expect(Object.keys(metrics)).not.toContain(removedMetric);
    }

    const zero = await createSuite({ toolCalls: [] });
    const zeroRow = preflightAndMapBraintrustRows([
      suiteInput("zero", zero.suitePath),
    ]).rows[0]!;
    expect(zeroRow.toolSpans).toEqual([]);
    expect(zeroRow.metrics.mcp_tool_calls).toBe(0);
    expect(zeroRow.metrics.cli_tool_calls).toBe(0);
    expect(zeroRow.metrics.tool_calls_started).toBe(0);
    expect(zeroRow.metrics.tool_calls_completed).toBe(0);
    expect(zeroRow.metrics.tool_calls_unknown).toBe(0);
    expect(zeroRow.metadata.toolCounts).toEqual([]);
    expect(zeroRow.tags).toEqual([]);
  });

  it("rejects tool-bearing rows with unknown logical telemetry", async () => {
    const fixture = await createSuite();
    mutateMetrics(fixture, (metrics) => {
      const record = firstMetricsRecord(metrics);
      record.tools.logicalCallCount = null;
      record.usage.providerUsage = null;
      record.usage.normalizedTokens.uncachedInputTokens = null;
      record.usage.normalizedTokens.cachedInputTokens = null;
      record.usage.normalizedTokens.cacheWriteInputTokens = null;
      record.usage.normalizedTokens.outputTokens = null;
      record.usage.normalizedTokens.reasoningOutputTokens = null;
      record.usage.cost = {
        kind: "unknown",
        usd: null,
        uncertainty: "unknown",
        rateSnapshot: null,
      };
      metrics.aggregates.logicalToolCalls = null;
    });
    expect(() =>
      preflightAndMapBraintrustRows([suiteInput("unknown", fixture.suitePath)]),
    ).toThrow("tool-bearing row has unknown logical telemetry");
  });

  it("rejects raw tool events without a logical tool sequence", async () => {
    const fixture = await createSuite({ toolCalls: [] });
    mutateMetrics(fixture, (metrics) => {
      const record = firstMetricsRecord(metrics);
      record.tools.rawEventCount = 1;
    });

    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("raw-events-without-sequence", fixture.suitePath),
      ]),
    ).toThrow("tool-bearing row has empty logical tool sequence");
  });

  it("maps ordered tool sequence, per-tool counts, and tags", async () => {
    const fixture = await createSuite();
    const row = preflightAndMapBraintrustRows([
      suiteInput("tools", fixture.suitePath),
    ]).rows[0]!;

    expect(row.metadata.toolSequence).toEqual([
      {
        tool: "search",
        surface: "mcp",
        status: "completed",
        startedAt: "2026-08-28T10:00:00.100Z",
        completedAt: "2026-08-28T10:00:00.200Z",
      },
      {
        tool: "pkg-info",
        surface: "cli",
        status: "started",
        startedAt: "2026-08-28T10:00:00.500Z",
        completedAt: null,
      },
    ]);
    expect(row.metadata.toolCounts).toEqual([
      {
        surface: "cli",
        tool: "pkg-info",
        total: 1,
        statusCounts: { started: 1, completed: 0, failed: 0, unknown: 0 },
      },
      {
        surface: "mcp",
        tool: "search",
        total: 1,
        statusCounts: { started: 0, completed: 1, failed: 0, unknown: 0 },
      },
    ]);
    expect(row.toolSpans).toEqual([
      {
        name: "search",
        type: "tool",
        event: {
          input: { tool: "search", surface: "mcp" },
          output: { status: "completed" },
          metadata: {
            tool: "search",
            surface: "mcp",
            timingSource: "harness_stdout_observed",
          },
          metrics: {
            duration:
              Date.parse("2026-08-28T10:00:00.200Z") / 1000 -
              Date.parse("2026-08-28T10:00:00.100Z") / 1000,
          },
        },
        startTime: Date.parse("2026-08-28T10:00:00.100Z") / 1000,
        endTime: Date.parse("2026-08-28T10:00:00.200Z") / 1000,
      },
      {
        name: "pkg-info",
        type: "tool",
        event: {
          input: { tool: "pkg-info", surface: "cli" },
          output: { status: "started" },
          metadata: {
            tool: "pkg-info",
            surface: "cli",
            timingSource: "harness_stdout_observed",
          },
        },
        startTime: Date.parse("2026-08-28T10:00:00.500Z") / 1000,
      },
    ]);
    expect(row.tags).toEqual(["tool:cli:pkg-info", "tool:mcp:search"]);
  });

  it("maps failed tools to native child errors without raw payloads", async () => {
    const fixture = await createSuite({
      toolCalls: [
        {
          tool: "search",
          server: "githits",
          providerCallId: "failed-search",
          status: "started",
          observedAt: "2026-08-28T10:00:00.200Z",
        },
        {
          tool: "search",
          server: "githits",
          providerCallId: "failed-search",
          status: "failed",
          observedAt: "2026-08-28T10:00:00.400Z",
          error: { message: "provider details" },
        },
      ],
    });
    const row = preflightAndMapBraintrustRows([
      suiteInput("failed-tool", fixture.suitePath),
    ]).rows[0]!;

    expect(row.toolSpans).toEqual([
      {
        name: "search",
        type: "tool",
        event: {
          input: { tool: "search", surface: "mcp" },
          output: { status: "failed" },
          metadata: {
            tool: "search",
            surface: "mcp",
            timingSource: "harness_stdout_observed",
          },
          metrics: {
            duration:
              Date.parse("2026-08-28T10:00:00.400Z") / 1000 -
              Date.parse("2026-08-28T10:00:00.200Z") / 1000,
          },
          error: "tool_status:failed",
        },
        startTime: Date.parse("2026-08-28T10:00:00.200Z") / 1000,
        endTime: Date.parse("2026-08-28T10:00:00.400Z") / 1000,
      },
    ]);
    expect(JSON.stringify(row.toolSpans)).not.toContain("provider details");
  });

  it("preserves zero duration for equal observed boundaries", async () => {
    const fixture = await createSuite({
      toolCalls: [
        {
          tool: "search",
          server: "githits",
          providerCallId: "equal-completed",
          status: "started",
          observedAt: "2026-08-28T10:00:00.200Z",
        },
        {
          tool: "search",
          server: "githits",
          providerCallId: "equal-completed",
          status: "completed",
          observedAt: "2026-08-28T10:00:00.200Z",
        },
        {
          tool: "pkg-info",
          server: "githits-cli",
          providerCallId: "equal-failed",
          status: "started",
          observedAt: "2026-08-28T10:00:00.200Z",
        },
        {
          tool: "pkg-info",
          server: "githits-cli",
          providerCallId: "equal-failed",
          status: "failed",
          observedAt: "2026-08-28T10:00:00.200Z",
        },
      ],
    });
    const row = preflightAndMapBraintrustRows([
      suiteInput("equal-boundaries", fixture.suitePath),
    ]).rows[0]!;

    expect(row.toolSpans.map((span) => span.event.metrics?.duration)).toEqual([
      0, 0,
    ]);
    expect(row.toolSpans.map((span) => span.startTime)).toEqual([
      Date.parse("2026-08-28T10:00:00.200Z") / 1000,
      Date.parse("2026-08-28T10:00:00.200Z") / 1000,
    ]);
  });

  it("rejects incomplete, invalid, reverse, and outside-parent tool intervals", async () => {
    const cases: ReadonlyArray<{
      name: string;
      toolCalls: AgentEvalRecordInput["toolCalls"];
      message: string;
    }> = [
      {
        name: "missing-start",
        toolCalls: [
          {
            tool: "search",
            server: "githits",
            providerCallId: "missing-start",
            status: "completed",
            observedAt: "2026-08-28T10:00:00.200Z",
          },
        ],
        message: "no valid observed start time",
      },
      {
        name: "missing-completion",
        toolCalls: [
          {
            tool: "search",
            server: "githits",
            providerCallId: "missing-completion",
            status: "started",
            observedAt: "2026-08-28T10:00:00.200Z",
          },
          {
            tool: "search",
            server: "githits",
            providerCallId: "missing-completion",
            status: "completed",
          },
        ],
        message: "no valid observed completion time",
      },
      {
        name: "reverse",
        toolCalls: [
          {
            tool: "search",
            server: "githits",
            providerCallId: "reverse",
            status: "started",
            observedAt: "2026-08-28T10:00:00.400Z",
          },
          {
            tool: "search",
            server: "githits",
            providerCallId: "reverse",
            status: "completed",
            observedAt: "2026-08-28T10:00:00.200Z",
          },
        ],
        message: "no valid observed start time",
      },
      {
        name: "outside-start",
        toolCalls: [
          {
            tool: "search",
            server: "githits",
            providerCallId: "outside-start",
            status: "started",
            observedAt: "2026-08-28T09:59:59.900Z",
          },
          {
            tool: "search",
            server: "githits",
            providerCallId: "outside-start",
            status: "completed",
            observedAt: "2026-08-28T10:00:00.200Z",
          },
        ],
        message: "starts outside the parent span interval",
      },
      {
        name: "outside-end",
        toolCalls: [
          {
            tool: "search",
            server: "githits",
            providerCallId: "outside-end",
            status: "started",
            observedAt: "2026-08-28T10:00:00.200Z",
          },
          {
            tool: "search",
            server: "githits",
            providerCallId: "outside-end",
            status: "completed",
            observedAt: "2026-08-28T10:00:01.100Z",
          },
        ],
        message: "ends outside the parent span interval",
      },
      {
        name: "unknown-status",
        toolCalls: [
          {
            tool: "search",
            server: "githits",
            providerCallId: "unknown-status",
            status: "unknown",
            observedAt: "2026-08-28T10:00:00.200Z",
          },
        ],
        message: "has unknown status",
      },
    ];

    for (const testCase of cases) {
      const fixture = await createSuite({ toolCalls: testCase.toolCalls });
      const map = () =>
        preflightAndMapBraintrustRows([
          suiteInput(testCase.name, fixture.suitePath),
        ]);
      expect(map).toThrow("Braintrust preflight: discovery/workload-a:");
      expect(map).toThrow(testCase.message);
    }

    const invalid = await createSuite();
    mutateMetrics(invalid, (metrics) => {
      const sequence = firstMetricsRecord(metrics).tools.sequence;
      sequence[0]!.startedAt = "not-a-timestamp";
    });
    expect(() =>
      preflightAndMapBraintrustRows([suiteInput("invalid", invalid.suitePath)]),
    ).toThrow();
  });

  it("accepts legacy zero-tool suites and rejects legacy tool timing gaps", async () => {
    const downgrade = (fixture: SuiteFixture, version: 1 | 2): void => {
      mutateJson<Record<string, unknown>>(
        join(fixture.shardPath, "metrics.json"),
        (metrics) => {
          metrics.schemaVersion = version;
          const records = metrics.records as Array<Record<string, unknown>>;
          for (const record of records) {
            const tools = record.tools as Record<string, unknown>;
            tools.sequence = (
              tools.sequence as Array<Record<string, unknown>>
            ).map(({ tool, surface, status }) => ({ tool, surface, status }));
          }
        },
      );
    };

    for (const version of [1, 2] as const) {
      const zero = await createSuite({ toolCalls: [] });
      downgrade(zero, version);
      const zeroRow = preflightAndMapBraintrustRows([
        suiteInput(`legacy-zero-${version}`, zero.suitePath),
      ]).rows[0]!;
      expect(zeroRow.toolSpans).toEqual([]);

      const toolBearing = await createSuite();
      downgrade(toolBearing, version);
      expect(() =>
        preflightAndMapBraintrustRows([
          suiteInput(`legacy-tools-${version}`, toolBearing.suitePath),
        ]),
      ).toThrow("no valid observed start time");
    }
  });

  it("adds a status-only error for failed cells", async () => {
    const fixture = await createSuite({ processStatus: "failed" });
    mutateSuite(fixture, (artifact) => {
      artifact.warnings = ["discovery shard failed: provider secret details"];
    });
    const row = preflightAndMapBraintrustRows([
      suiteInput("failed", fixture.suitePath),
    ]).rows[0]!;

    expect(row.output.cellStatus).toBe("failed");
    expect(row.output.processStatus).toBe("failed");
    expect(row.error).toBe("eval_status:failed");
    expect(JSON.stringify(row)).not.toContain("provider");
  });

  it("keeps metadata allowlisted and warnings free of local roots", async () => {
    const fixture = await createSuite();
    mutateMetrics(fixture, (metrics) => {
      firstMetricsRecord(metrics).warnings = [
        "provider warning at /tmp/private-output",
      ];
    });
    const row = preflightAndMapBraintrustRows([
      suiteInput("allowlisted", fixture.suitePath),
    ]).rows[0]!;
    const metadataText = JSON.stringify(row.metadata);

    expect(metadataText).not.toContain(fixture.root);
    expect(metadataText).not.toContain("stderr");
    expect(metadataText).not.toContain("stdout");
    expect(metadataText).not.toContain(
      "provider warning at /tmp/private-output",
    );
    expect(metadataText).toContain("provider warning at <path>");
    expect(row.metadata.reportingContractSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.metadata.resultSchemaSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.metadata.measurementGit).toEqual({
      branch: null,
      sha: null,
      dirty: null,
    });
  });

  it("uses the suite target Git identity over a record mismatch", async () => {
    const fixture = await createSuite();
    mutateSuite(fixture, (artifact) => {
      artifact.targetGit = {
        branch: "main",
        sha: "suite-target",
        dirty: false,
      };
    });
    mutateMetrics(fixture, (metrics) => {
      firstMetricsRecord(metrics).targetGit = {
        branch: "feature",
        sha: "record-target",
        dirty: true,
      };
    });

    const row = preflightAndMapBraintrustRows([
      suiteInput("target", fixture.suitePath),
    ]).rows[0]!;

    expect(row.metadata.targetGit).toEqual({
      branch: "main",
      sha: "suite-target",
      dirty: false,
    });
  });

  it("labels a non-success record final status when final evidence is absent", async () => {
    const fixture = await createSuite();
    mutateMetrics(fixture, (metrics) => {
      firstMetricsRecord(metrics).finalStatus = "failure";
    });
    rmSync(join(fixture.workloadDir, "final.json"));

    const row = preflightAndMapBraintrustRows([
      suiteInput("final-status", fixture.suitePath),
    ]).rows[0]!;

    expect(row.output.finalStatus).toBe("failure");
    expect(row.output.answer).toBeUndefined();
    expect(row.error).toBe("eval_status:failure");
  });

  it("rejects dry runs, duplicate labels, duplicate cells, and mixed identities", async () => {
    const normal = await createSuite();
    const dryRun = await createSuite({ dryRun: true });
    expect(() =>
      preflightAndMapBraintrustRows([suiteInput("dry", dryRun.suitePath)]),
    ).toThrow("dry-run");
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("same", normal.suitePath),
        suiteInput("same", normal.suitePath),
      ]),
    ).toThrow("duplicate suite label");
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("one", normal.suitePath),
        suiteInput("two", normal.suitePath),
      ]),
    ).toThrow("duplicate scenario/workload cell");

    const identityCases = [
      [
        "targetGit",
        (artifact: AgentEvalSuiteArtifact) =>
          (artifact.targetGit.sha = "different-target"),
      ],
      [
        "measurementGit",
        (artifact: AgentEvalSuiteArtifact) =>
          (artifact.measurementGit.sha = "different-measurement"),
      ],
      [
        "reportingContractSha256",
        (artifact: AgentEvalSuiteArtifact) =>
          (artifact.contentIdentity.reportingContract.sha256 = "a".repeat(64)),
      ],
      [
        "resultSchemaSha256",
        (artifact: AgentEvalSuiteArtifact) =>
          (artifact.contentIdentity.resultSchema.sha256 = "b".repeat(64)),
      ],
    ] as const;
    for (const [name, mutate] of identityCases) {
      const other = await createSuite();
      mutateSuite(other, mutate);
      expect(() =>
        preflightAndMapBraintrustRows([
          suiteInput("base", normal.suitePath),
          suiteInput(name, other.suitePath),
        ]),
      ).toThrow("mixed");
    }
  });

  it("rejects mixed child agent identity", async () => {
    const normal = await createSuite();
    const other = await createSuite({ workloadId: "workload-b" });
    mutateMetrics(other, (metrics) => {
      firstMetricsRecord(metrics).agent = "claude";
    });
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("base", normal.suitePath),
        suiteInput("other", other.suitePath),
      ]),
    ).toThrow("mixed agent/model/reasoning/surface/server identity");
  });

  it("rejects missing child evidence and unsafe prompts", async () => {
    const missingRecord = await createSuite();
    mutateMetrics(missingRecord, (metrics) => {
      metrics.records = [];
    });
    mutateSuite(missingRecord, (artifact) => {
      artifact.cells[0]!.status = "missing";
    });
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("missing-record", missingRecord.suitePath),
      ]),
    ).toThrow("metrics record");

    const missingWorkload = await createSuite();
    mutateJson<{ workloads: unknown[] }>(
      join(missingWorkload.shardPath, "run.json"),
      (run) => {
        run.workloads = [];
      },
    );
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("missing-workload", missingWorkload.suitePath),
      ]),
    ).toThrow("report workload");

    const missingPrompt = await createSuite();
    rmSync(join(missingPrompt.workloadDir, "prompt.md"));
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("missing-prompt", missingPrompt.suitePath),
      ]),
    ).toThrow("prompt artifact");

    const unsafePrompt = await createSuite();
    const outsidePrompt = join(unsafePrompt.root, "outside-prompt.md");
    writeFileSync(outsidePrompt, "outside\n");
    rmSync(join(unsafePrompt.workloadDir, "prompt.md"));
    symlinkSync(outsidePrompt, join(unsafePrompt.workloadDir, "prompt.md"));
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("unsafe-prompt", unsafePrompt.suitePath),
      ]),
    ).toThrow("prompt artifact");

    const missingMetrics = await createSuite();
    rmSync(join(missingMetrics.shardPath, "metrics.json"));
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("missing-metrics", missingMetrics.suitePath),
      ]),
    ).toThrow("metrics.json");
  });

  it("accepts failed cells when their evidence is complete", async () => {
    const fixture = await createSuite({ processStatus: "failed" });
    const result = preflightAndMapBraintrustRows([
      suiteInput("partial", fixture.suitePath),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.output.cellStatus).toBe("failed");
    expect(result.rows[0]!.input.prompt).toContain("Prompt for");
  });

  it("rejects a suite input that contributes no workload cells", async () => {
    const fixture = await createSuite();
    mutateSuite(fixture, (artifact) => {
      artifact.selectedWorkloads = [];
      artifact.contentIdentity.workloads = [];
      artifact.cells = [];
    });
    mutateMetrics(fixture, (metrics) => {
      metrics.records = [];
    });

    expect(() =>
      preflightAndMapBraintrustRows([suiteInput("empty", fixture.suitePath)]),
    ).toThrow("suite empty has no workload cells");
  });

  it("rejects invalid workload paths before exposing local roots", async () => {
    const fixture = await createSuite();
    mutateSuite(fixture, (artifact) => {
      artifact.cells[0]!.workloadPath = "/private/workload.md";
    });
    expect(() =>
      preflightAndMapBraintrustRows([
        suiteInput("invalid-path", fixture.suitePath),
      ]),
    ).toThrow("workload path");
  });
});

describe("Braintrust experiment identity", () => {
  it("builds stable channel-aware experiment identity", () => {
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    expect(
      buildBraintrustExperimentIdentity({
        source: "github",
        channel: "main",
        branch: "main",
        sha,
        githubRunId: "123",
        githubRunAttempt: "2",
      }),
    ).toEqual({
      source: "github",
      channel: "main",
      branch: "main",
      sha,
      experiment: "main-r123-a2",
      tags: ["source:github", "channel:main", "branch:main", `sha:${sha}`],
    });
    expect(
      buildBraintrustExperimentIdentity({
        source: "github",
        channel: "pr",
        branch: "Feature/One",
        sha,
        pullRequestNumber: "456",
        githubRunId: "123",
        githubRunAttempt: "2",
      }).experiment,
    ).toBe("pr-456-r123-a2");
    expect(
      buildBraintrustExperimentIdentity({
        source: "local",
        channel: "local",
        branch: "Feature/One & two",
        sha,
        now: new Date("2026-08-31T20:24:22.123Z"),
      }).experiment,
    ).toBe("local-feature-one-two-20260831T202422123Z-abcdef12");

    const invalid: BraintrustIdentityInput[] = [
      {
        source: "github",
        channel: "local",
        branch: "main",
        sha,
        githubRunId: "123",
        githubRunAttempt: "2",
      },
      {
        source: "github",
        channel: "main",
        branch: "feature",
        sha,
        githubRunId: "123",
        githubRunAttempt: "2",
      },
      {
        source: "github",
        channel: "pr",
        branch: "feature",
        sha,
        githubRunId: "123",
        githubRunAttempt: "2",
      },
      {
        source: "github",
        channel: "main",
        branch: "main",
        sha,
        githubRunId: "not-numeric",
        githubRunAttempt: "2",
      },
      {
        source: "local",
        channel: "local",
        branch: null,
        sha,
      },
      {
        source: "local",
        channel: "local",
        branch: "main",
        sha: null,
      },
    ];
    for (const input of invalid)
      expect(() => buildBraintrustExperimentIdentity(input)).toThrow();
  });
});

describe("Braintrust main baseline resolution", () => {
  it("resolves the latest valid main experiment across pages", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `first-${index}`,
      name: `other-${index}`,
      metadata: { channel: "pr" },
    }));
    const secondPage = [
      {
        id: "invalid-main-name",
        name: "main-r123",
        metadata: { channel: "main" },
      },
      {
        id: "latest-main",
        name: "main-r123-a2",
        metadata: { channel: "main" },
      },
    ];
    const requests: unknown[] = [];
    const sdk: import("./agent-eval-braintrust.ts").BraintrustSdk = {
      async login() {
        return {
          apiConn() {
            return {
              async get_json(objectType, params) {
                requests.push({ objectType, params });
                return requests.length === 1
                  ? { objects: firstPage }
                  : { objects: secondPage };
              },
            };
          },
        };
      },
      initExperiment() {
        throw new Error("initialization must not occur during resolution");
      },
    };

    await expect(
      resolveBraintrustMainExperiment("project", sdk),
    ).resolves.toEqual({
      id: "latest-main",
      name: "main-r123-a2",
    });
    expect(requests).toEqual([
      {
        objectType: "v1/experiment",
        params: { project_name: "project", limit: "100" },
      },
      {
        objectType: "v1/experiment",
        params: {
          project_name: "project",
          limit: "100",
          starting_after: "first-99",
        },
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain("metadata");
  });
});

describe("Braintrust baseline precedence", () => {
  it("enforces main baseline bootstrap and explicit local precedence", async () => {
    const fixture = await createSuite();
    const mapping = preflightAndMapBraintrustRows([
      suiteInput("baseline", fixture.suitePath),
    ]);
    const makePublisher =
      (initSeen: BraintrustExperimentInit[]) =>
      (init: BraintrustExperimentInit) => {
        initSeen.push(init);
        return {
          startSpan() {
            return {
              startSpan() {
                return leafSpan();
              },
              end() {},
            };
          },
          async flush() {},
          async permalink() {
            return undefined;
          },
        };
      };
    const resolver = async () => null;
    await expect(
      publishBraintrustRows(
        mapping,
        {
          project: "project",
          source: "github",
          channel: "pr",
          branch: "feature",
          sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          pullRequestNumber: "456",
          githubRunId: "123",
          githubRunAttempt: "2",
        },
        makePublisher([]),
        resolver,
      ),
    ).rejects.toThrow("no main Braintrust baseline");

    await expect(
      publishBraintrustRows(
        mapping,
        {
          project: "project",
          source: "local",
          channel: "local",
          branch: "main",
          sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          now: new Date("2026-08-31T20:24:22.123Z"),
        },
        makePublisher([]),
        resolver,
      ),
    ).rejects.toThrow("no main Braintrust baseline");

    const mainInit: BraintrustExperimentInit[] = [];
    await publishBraintrustRows(
      mapping,
      {
        project: "project",
        source: "github",
        channel: "main",
        branch: "main",
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        githubRunId: "123",
        githubRunAttempt: "2",
      },
      makePublisher(mainInit),
      resolver,
    );
    expect(mainInit[0]).toBeDefined();
    expect(mainInit[0]).not.toHaveProperty("baseExperimentId");
    expect(mainInit[0]!.experiment).toBe("main-r123-a2");

    const localInit: BraintrustExperimentInit[] = [];
    await publishBraintrustRows(
      mapping,
      {
        project: "project",
        source: "local",
        channel: "local",
        branch: "main",
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        experiment: "local-explicit",
        baseExperiment: "main-r10-a1",
      },
      makePublisher(localInit),
      async () => {
        throw new Error("base discovery must be skipped");
      },
    );
    expect(localInit[0]!.baseExperiment).toBe("main-r10-a1");
  });
});

describe("Braintrust publisher boundary", () => {
  it("builds exact allowlisted experiment initialization options", async () => {
    const fixture = await createSuite();
    const mapping = preflightAndMapBraintrustRows([
      suiteInput("github", fixture.suitePath),
    ]);
    const init = buildBraintrustExperimentInit(mapping, {
      project: "githits-cli-agent-evals",
      source: "github",
      channel: "main",
      branch: "main",
      githubRunId: "123",
      githubRunAttempt: "2",
      githubRunUrl:
        "https://github.com/githits-com/githits-cli/actions/runs/123",
    });

    expect(init).toEqual({
      project: "githits-cli-agent-evals",
      experiment: "main-r123-a2",
      update: false,
      tags: [
        "source:github",
        "channel:main",
        "branch:main",
        "sha:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
      metadata: {
        source: "github",
        channel: "main",
        branch: "main",
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        githubRunId: "123",
        githubRunAttempt: "2",
        githubRunUrl:
          "https://github.com/githits-com/githits-cli/actions/runs/123",
        suites: mapping.suites,
        targetGit: mapping.rows[0]!.metadata.targetGit,
        measurementGit: mapping.rows[0]!.metadata.measurementGit,
        suiteSchemaVersion: mapping.suites[0]!.suiteSchemaVersion,
        reportSchemaVersion: mapping.rows[0]!.metadata.reportSchemaVersion,
        metricsSchemaVersion: mapping.rows[0]!.metadata.metricsSchemaVersion,
        exporterSchemaVersion: 2,
        exporterVersion: "2",
      },
      repoInfo: {
        commit: mapping.rows[0]!.metadata.targetGit.sha,
        branch: mapping.rows[0]!.metadata.targetGit.branch,
        dirty: mapping.rows[0]!.metadata.targetGit.dirty,
      },
      gitMetadataSettings: { collect: "none" },
    });
    expect(JSON.stringify(init)).not.toContain(fixture.root);
  });

  it("uses the mapped suite schema version for experiment metadata", async () => {
    const fixture = await createSuite();
    const mapping = preflightAndMapBraintrustRows([
      suiteInput("provenance", fixture.suitePath),
    ]);
    mapping.suites[0]!.suiteSchemaVersion = 37;

    const init = buildBraintrustExperimentInit(mapping, {
      project: "githits-cli-agent-evals",
      experiment: "provenance-test",
      source: "local",
    });

    expect(init.metadata.suiteSchemaVersion).toBe(37);
  });

  it("starts and ends rows in order with exact event fields", async () => {
    const fixture = await createSuite({ scenarios: ["full", "discovery"] });
    const mapping = preflightAndMapBraintrustRows([
      suiteInput("ordered", fixture.suitePath),
    ]);
    const calls: string[] = [];
    const events: unknown[] = [];
    const startTimes: Array<number | undefined> = [];
    const endTimes: Array<number | undefined> = [];
    const toolEndTimes: Array<number | undefined> = [];
    const result = await publishBraintrustRows(
      mapping,
      {
        project: "githits-cli-agent-evals",
        experiment: "local-test",
        source: "local",
      },
      async (init) => {
        calls.push(`init:${init.project}/${init.experiment}`);
        return {
          startSpan(args) {
            calls.push(`start:${args.name}`);
            events.push(args.event);
            startTimes.push(args.startTime);
            expect(args.type).toBe("eval");
            expect(Object.keys(args).sort()).toEqual([
              "event",
              "name",
              "startTime",
              "type",
            ]);
            return {
              startSpan(childArgs) {
                calls.push(`tool-start:${childArgs.name}`);
                return leafSpan((endArgs) => {
                  toolEndTimes.push(endArgs?.endTime);
                  calls.push(`tool-end:${childArgs.name}`);
                });
              },
              end(endArgs) {
                endTimes.push(endArgs?.endTime);
                calls.push(`end:${args.name}`);
              },
            };
          },
          async flush() {
            calls.push("flush");
          },
          async permalink() {
            calls.push("permalink");
            return "https://braintrust.dev/experiment/local-test";
          },
        };
      },
    );

    expect(calls).toEqual([
      "init:githits-cli-agent-evals/local-test",
      "start:discovery/workload-a",
      "tool-start:search",
      "tool-end:search",
      "tool-start:pkg-info",
      "end:discovery/workload-a",
      "start:full/workload-a",
      "tool-start:search",
      "tool-end:search",
      "tool-start:pkg-info",
      "end:full/workload-a",
      "flush",
      "permalink",
    ]);
    const expectedStart = Date.parse("2026-08-28T10:00:00.000Z") / 1000;
    const expectedEnd = Date.parse("2026-08-28T10:00:01.000Z") / 1000;
    const expectedSearchEnd = Date.parse("2026-08-28T10:00:00.200Z") / 1000;
    expect(startTimes).toEqual([expectedStart, expectedStart]);
    expect(endTimes).toEqual([expectedEnd, expectedEnd]);
    expect(toolEndTimes).toEqual([expectedSearchEnd, expectedSearchEnd]);
    expect(
      (events as Array<Record<string, unknown>>).map((event) =>
        Object.keys(event).sort(),
      ),
    ).toEqual([
      ["input", "metadata", "metrics", "output", "tags"],
      ["input", "metadata", "metrics", "output", "tags"],
    ]);
    expect(
      (events as Array<Record<string, unknown>>).some(
        (event) => "scores" in event || "expected" in event || "id" in event,
      ),
    ).toBe(false);
    expect(result).toEqual({
      project: "githits-cli-agent-evals",
      experiment: "local-test",
      url: "https://braintrust.dev/experiment/local-test",
      exportedRowCount: 2,
      baseExperiment: null,
    });
    expect(JSON.stringify(result)).not.toContain(fixture.root);
    expect(JSON.stringify(result)).not.toContain("Prompt for");
    expect(JSON.stringify(result)).not.toContain("Answer for");
  });

  it("uses the pinned SDK span and initialization contracts", async () => {
    const fixture = await createSuite();
    const mapping = preflightAndMapBraintrustRows([
      suiteInput("sdk", fixture.suitePath),
    ]);
    const init = buildBraintrustExperimentInit(mapping, {
      project: "githits-cli-agent-evals",
      experiment: "sdk-test",
      source: "local",
    });
    const calls: string[] = [];
    const sdk: import("./agent-eval-braintrust.ts").BraintrustSdk = {
      initExperiment(project, options) {
        calls.push(`init:${project}`);
        expect(options).toEqual({
          experiment: "sdk-test",
          update: false,
          tags: [
            "source:local",
            "channel:local",
            "branch:main",
            "sha:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ],
          metadata: init.metadata,
          repoInfo: init.repoInfo,
          gitMetadataSettings: { collect: "none" },
        });
        return {
          startSpan(args) {
            calls.push(`start:${args.name}`);
            expect(args.type).toBe("eval");
            expect(args.startTime).toBe(
              Date.parse("2026-08-28T10:00:00.000Z") / 1000,
            );
            expect(Object.keys(args.event).sort()).toEqual([
              "input",
              "metadata",
              "metrics",
              "output",
              "tags",
            ]);
            return {
              startSpan(childArgs) {
                calls.push(`tool-start:${childArgs.name}`);
                return {
                  startSpan() {
                    throw new Error("test leaf spans cannot have children");
                  },
                  end() {
                    calls.push(`tool-end:${childArgs.name}`);
                    return 0;
                  },
                };
              },
              end(endArgs) {
                expect(endArgs).toEqual({
                  endTime: Date.parse("2026-08-28T10:00:01.000Z") / 1000,
                });
                calls.push(`end:${args.name}`);
                return 0;
              },
            };
          },
          async flush() {
            calls.push("flush");
          },
          async summarize(options) {
            calls.push(`summary:${options.summarizeScores}`);
            return { experimentUrl: "https://braintrust.dev/experiment/sdk" };
          },
        };
      },
    };
    const result = await publishBraintrustRows(
      mapping,
      {
        project: "githits-cli-agent-evals",
        experiment: "sdk-test",
        source: "local",
      },
      (publisherInit) => createBraintrustPublisher(publisherInit, sdk),
    );

    expect(calls).toEqual([
      "init:githits-cli-agent-evals",
      "start:discovery/workload-a",
      "tool-start:search",
      "tool-end:search",
      "tool-start:pkg-info",
      "end:discovery/workload-a",
      "flush",
      "summary:false",
    ]);
    expect(result.url).toBe("https://braintrust.dev/experiment/sdk");
  });

  it("pins and reports the actual Braintrust base experiment", async () => {
    const fixture = await createSuite();
    const mapping = preflightAndMapBraintrustRows([
      suiteInput("readback", fixture.suitePath),
    ]);
    const calls: string[] = [];
    const sdk: import("./agent-eval-braintrust.ts").BraintrustSdk = {
      initExperiment(project, options) {
        calls.push(`init:${project}`);
        expect(options.baseExperimentId).toBe("main-id");
        return {
          startSpan() {
            return {
              startSpan() {
                return {
                  startSpan() {
                    throw new Error("unexpected nested span");
                  },
                  end() {
                    return 0;
                  },
                };
              },
              end() {
                return 0;
              },
            };
          },
          async flush() {
            calls.push("flush");
          },
          async fetchBaseExperiment() {
            calls.push("fetch-base");
            return {
              id: "main-id",
              name: "main-r10-a1",
              unused: "must-not-be-exported",
            } as unknown as BraintrustBaseExperiment;
          },
          async summarize(options) {
            calls.push(`summary:${options.summarizeScores}`);
            return {
              experimentUrl: "https://braintrust.dev/experiment/readback",
            };
          },
        };
      },
    };
    const result = await publishBraintrustRows(
      mapping,
      {
        project: "project",
        source: "local",
        channel: "local",
        branch: "main",
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        experiment: "local-readback",
        baseExperimentId: "main-id",
      },
      (init) => createBraintrustPublisher(init, sdk),
    );

    expect(calls).toEqual([
      "init:project",
      "flush",
      "fetch-base",
      "summary:false",
    ]);
    expect(result).toMatchObject({
      experiment: "local-readback",
      url: "https://braintrust.dev/experiment/readback",
      baseExperiment: { id: "main-id", name: "main-r10-a1" },
    });
    expect(JSON.stringify(result)).not.toContain("aaaaaaaa");
  });

  it("exports only a generated status error for failed rows", async () => {
    const fixture = await createSuite({ processStatus: "failed" });
    const mapping = preflightAndMapBraintrustRows([
      suiteInput("failed-row", fixture.suitePath),
    ]);
    let event: BraintrustRowEvent | undefined;
    await publishBraintrustRows(
      mapping,
      {
        project: "githits-cli-agent-evals",
        experiment: "failed-row-test",
        source: "local",
      },
      () => ({
        startSpan(args) {
          event = args.event;
          return {
            startSpan() {
              return leafSpan();
            },
            end() {},
          };
        },
        async flush() {},
        async permalink() {
          return undefined;
        },
      }),
    );

    expect(event).toBeDefined();
    expect(Object.keys(event!).sort()).toEqual([
      "error",
      "input",
      "metadata",
      "metrics",
      "output",
      "tags",
    ]);
    expect(event!.error).toBe("eval_status:failed");
    expect("scores" in event!).toBe(false);
    expect("expected" in event!).toBe(false);
    expect("id" in event!).toBe(false);
  });

  it("does not retry a failed row and does not flush partial exports", async () => {
    const fixture = await createSuite({ scenarios: ["discovery", "full"] });
    const mapping = preflightAndMapBraintrustRows([
      suiteInput("failure", fixture.suitePath),
    ]);
    const calls: string[] = [];
    await expect(
      publishBraintrustRows(
        mapping,
        {
          project: "githits-cli-agent-evals",
          experiment: "failure-test",
          source: "local",
        },
        () => ({
          startSpan(args) {
            calls.push(`start:${args.name}`);
            return {
              startSpan(childArgs) {
                calls.push(`tool-start:${childArgs.name}`);
                return leafSpan(() => calls.push(`tool-end:${childArgs.name}`));
              },
              end() {
                calls.push(`end:${args.name}`);
                throw new Error("publisher failure");
              },
            };
          },
          async flush() {
            calls.push("flush");
          },
          async permalink() {
            calls.push("permalink");
            return "https://braintrust.dev/should-not-be-used";
          },
        }),
      ),
    ).rejects.toThrow("publisher failure");
    expect(calls).toEqual([
      "start:discovery/workload-a",
      "tool-start:search",
      "tool-end:search",
      "tool-start:pkg-info",
      "end:discovery/workload-a",
    ]);
  });
});

describe("Braintrust CLI wrapper", () => {
  it("parses local defaults and a stable injected timestamp", () => {
    const options = parseBraintrustArgs(
      ["--suite", "canary=out/suite.json"],
      new Date("2026-08-31T12:34:56.000Z"),
    );

    expect(options).toEqual({
      suites: [{ label: "canary", suitePath: "out/suite.json" }],
      project: "githits-cli-agent-evals",
      source: "local",
      channel: "local",
      validateOnly: false,
    });
  });

  it("parses explicit GitHub identity and result options", () => {
    const options = parseBraintrustArgs([
      "--suite",
      "daily=out/suite.json",
      "--project",
      "custom-project",
      "--source",
      "github",
      "--channel",
      "main",
      "--branch",
      "main",
      "--run-id",
      "123",
      "--run-attempt",
      "2",
      "--run-url",
      "https://github.com/githits-com/githits-cli/actions/runs/123",
      "--result-out",
      "out/result.json",
      "--validate-only",
    ]);

    expect(options).toEqual({
      suites: [{ label: "daily", suitePath: "out/suite.json" }],
      project: "custom-project",
      source: "github",
      channel: "main",
      branch: "main",
      githubRunId: "123",
      githubRunAttempt: "2",
      githubRunUrl:
        "https://github.com/githits-com/githits-cli/actions/runs/123",
      resultOut: "out/result.json",
      validateOnly: true,
    });
  });

  it("rejects malformed, duplicate, unknown, and incoherent options", () => {
    const invalidArguments: readonly (readonly string[])[] = [
      [],
      ["--suite", "missing-separator"],
      ["--suite", "=out/suite.json"],
      ["--suite", "missing-path="],
      ["--suite", "same=one.json", "--suite", "same=two.json"],
      ["--suite", "one=one.json", "--unknown"],
      ["--suite", "one=one.json", "--project"],
      ["--suite", "one=one.json", "--project", "one", "--project", "two"],
      ["--suite", "one=one.json", "--source", "other"],
      ["--suite", "one=one.json", "--run-id", "123"],
      [
        "--suite",
        "one=one.json",
        "--source",
        "github",
        "--run-id",
        "123",
        "--run-attempt",
        "1",
        "--run-url",
        "not-a-url",
        "--experiment",
        "github-123-1",
      ],
      [
        "--suite",
        "one=one.json",
        "--source",
        "github",
        "--run-id",
        "123",
        "--run-attempt",
        "1",
        "--run-url",
        "https://github.com/example/repo/actions/runs/123",
      ],
      [
        "--suite",
        "one=one.json",
        "--source",
        "github",
        "--experiment",
        "github-123-1",
        "--run-id",
        "123",
        "--run-attempt",
        "1",
      ],
    ];
    for (const args of invalidArguments) {
      expect(() => parseBraintrustArgs(args)).toThrow();
    }
  });

  it("maps and reports validate-only without credentials or a publisher", async () => {
    const fixture = await createSuite();
    const resultPath = join(fixture.root, "validate-result.json");
    let publisherCalled = false;
    const printed: string[] = [];
    const result = await runBraintrustCli(
      [
        "--suite",
        `canary=${fixture.suitePath}`,
        "--result-out",
        resultPath,
        "--validate-only",
      ],
      {
        env: {},
        publisherFactory: () => {
          publisherCalled = true;
          throw new Error("publisher must not be called");
        },
        print: (line) => printed.push(line),
      },
    );

    expect(publisherCalled).toBe(false);
    expect(result).toMatchObject({
      schemaVersion: 1,
      mode: "validate-only",
      project: "githits-cli-agent-evals",
      rowCount: 1,
    });
    expect(result.url).toBeUndefined();
    expect(JSON.parse(printed[0]!) as BraintrustCliResult).toEqual(result);
    const resultText = readFileSync(resultPath, "utf8");
    expect(JSON.parse(resultText) as BraintrustCliResult).toEqual(result);
    expect(resultText).not.toContain(fixture.root);
    expect(resultText).not.toContain("Prompt for");
    expect(resultText).not.toContain("Answer for");
  });

  it("completes all preflight before checking the API key or publisher", async () => {
    let keyRead = false;
    let publisherCalled = false;
    const environment: Readonly<Record<string, string | undefined>> = {
      get BRAINTRUST_API_KEY() {
        keyRead = true;
        return "dummy-secret";
      },
    };
    let failure: unknown;
    try {
      await runBraintrustCli(
        ["--suite", "missing=/does/not/exist/suite.json"],
        {
          env: environment,
          publisherFactory: () => {
            publisherCalled = true;
            throw new Error("publisher must not be called");
          },
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(keyRead).toBe(false);
    expect(publisherCalled).toBe(false);
  });

  it("rejects network mode without a key without exposing credential text", async () => {
    const fixture = await createSuite();
    const resultPath = join(fixture.root, "missing-key-result.json");
    const printed: string[] = [];
    let failure: unknown;
    try {
      await runBraintrustCli(
        ["--suite", `canary=${fixture.suitePath}`, "--result-out", resultPath],
        {
          env: { BRAINTRUST_API_KEY: undefined },
          publisherFactory: () => {
            throw new Error("publisher must not be called");
          },
          print: (line) => printed.push(line),
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("BRAINTRUST_API_KEY is required");
    expect(String(failure)).not.toContain("dummy-secret");
    expect(printed).toEqual([]);
    expect(existsSync(resultPath)).toBe(false);
  });

  it("delegates network export and writes only the safe result", async () => {
    const fixture = await createSuite();
    const resultPath = join(fixture.root, "export-result.json");
    const calls: string[] = [];
    const printed: string[] = [];
    const result = await runBraintrustCli(
      [
        "--suite",
        `canary=${fixture.suitePath}`,
        "--experiment",
        "local-export",
        "--base-experiment",
        "main-r1-a1",
        "--result-out",
        resultPath,
      ],
      {
        env: { BRAINTRUST_API_KEY: "dummy-secret" },
        baseResolver: async () => {
          throw new Error("base discovery must be skipped");
        },
        publisherFactory: async (init) => {
          calls.push(`init:${init.project}/${init.experiment}`);
          return {
            startSpan(args) {
              calls.push(`start:${args.name}`);
              return {
                startSpan(childArgs) {
                  calls.push(`tool-start:${childArgs.name}`);
                  return leafSpan(() =>
                    calls.push(`tool-end:${childArgs.name}`),
                  );
                },
                end() {
                  calls.push(`end:${args.name}`);
                },
              };
            },
            async flush() {
              calls.push("flush");
            },
            async permalink() {
              calls.push("permalink");
              return "https://braintrust.dev/experiment/local-export";
            },
          };
        },
        print: (line) => printed.push(line),
      },
    );

    expect(calls).toEqual([
      "init:githits-cli-agent-evals/local-export",
      "start:discovery/workload-a",
      "tool-start:search",
      "tool-end:search",
      "tool-start:pkg-info",
      "end:discovery/workload-a",
      "flush",
      "permalink",
    ]);
    expect(result).toEqual({
      schemaVersion: 1,
      mode: "export",
      project: "githits-cli-agent-evals",
      experiment: "local-export",
      rowCount: 1,
      suites: result.suites,
      url: "https://braintrust.dev/experiment/local-export",
      baseExperiment: null,
    });
    expect(JSON.parse(printed[0]!) as BraintrustCliResult).toEqual(result);
    const resultText = readFileSync(resultPath, "utf8");
    expect(JSON.parse(resultText) as BraintrustCliResult).toEqual(result);
    expect(resultText).not.toContain("dummy-secret");
    expect(resultText).not.toContain(fixture.root);
    expect(resultText).not.toContain("Prompt for");
    expect(resultText).not.toContain("Answer for");
  });

  it("propagates export failures without writing a success result or retrying", async () => {
    const fixture = await createSuite();
    const resultPath = join(fixture.root, "failed-result.json");
    const calls: string[] = [];
    await expect(
      runBraintrustCli(
        [
          "--suite",
          `canary=${fixture.suitePath}`,
          "--base-experiment",
          "main-r1-a1",
          "--result-out",
          resultPath,
        ],
        {
          env: { BRAINTRUST_API_KEY: "dummy-secret" },
          baseResolver: async () => null,
          publisherFactory: () => ({
            startSpan(args) {
              calls.push(`start:${args.name}`);
              return {
                startSpan(childArgs) {
                  calls.push(`tool-start:${childArgs.name}`);
                  return leafSpan(() =>
                    calls.push(`tool-end:${childArgs.name}`),
                  );
                },
                end() {
                  calls.push(`end:${args.name}`);
                  throw new Error("network export failed");
                },
              };
            },
            async flush() {
              calls.push("flush");
            },
            async permalink() {
              calls.push("permalink");
              return "https://braintrust.dev/should-not-be-used";
            },
          }),
        },
      ),
    ).rejects.toThrow("network export failed");
    expect(calls).toEqual([
      "start:discovery/workload-a",
      "tool-start:search",
      "tool-end:search",
      "tool-start:pkg-info",
      "end:discovery/workload-a",
    ]);
    expect(existsSync(resultPath)).toBe(false);
  });

  it("exposes the official no-argument btEvalMain entrypoint", () => {
    expect(typeof btEvalMain).toBe("function");
    expect(btEvalMain.length).toBe(0);
    expect(typeof runBraintrustCli).toBe("function");
  });
});

interface WorkflowStepContract {
  name?: string;
  id?: string;
  if?: string;
  "continue-on-error"?: boolean;
  run?: string;
  env?: Record<string, string>;
}

interface WorkflowContract {
  jobs: Record<string, { steps: WorkflowStepContract[] }>;
}

function readAgentEvalWorkflow(): WorkflowContract {
  const workflowPath = resolve(
    process.cwd(),
    ".github",
    "workflows",
    "agent-evals.yml",
  );
  return parseYaml(readFileSync(workflowPath, "utf8")) as WorkflowContract;
}

function readSummarySteps(workflow: WorkflowContract): WorkflowStepContract[] {
  const summaryJob = workflow.jobs.summary;
  if (!summaryJob) {
    throw new Error("agent-evals workflow must define a summary job");
  }
  return summaryJob.steps;
}

function githubExpression(name: string): string {
  return `$${"{"}{ ${name} }}`;
}

describe("Agent eval workflow Braintrust integration", () => {
  it("exports after reporting and aggregates final stage failures", () => {
    const workflow = readAgentEvalWorkflow();
    const summarySteps = readSummarySteps(workflow);
    const reportIndex = summarySteps.findIndex((step) => step.id === "report");
    const braintrustIndex = summarySteps.findIndex(
      (step) => step.id === "braintrust",
    );
    const finalIndex = summarySteps.findIndex(
      (step) => step.name === "Finalize agent eval status",
    );
    const report = summarySteps[reportIndex];
    const braintrust = summarySteps[braintrustIndex];
    const finalize = summarySteps[finalIndex];

    expect(reportIndex).toBeGreaterThanOrEqual(0);
    expect(braintrustIndex).toBeGreaterThan(reportIndex);
    expect(finalIndex).toBeGreaterThan(braintrustIndex);
    expect(report?.["continue-on-error"]).toBe(true);
    expect(braintrust).toMatchObject({
      id: "braintrust",
      if: "always()",
      "continue-on-error": true,
    });
    expect(finalize).toMatchObject({
      if: "always()",
    });
    expect(finalize?.run).toContain("SCENARIO_RESULT");
    expect(finalize?.run).toContain("REPORT_OUTCOME");
    expect(finalize?.run).toContain("BRAINTRUST_OUTCOME");
    expect(finalize?.run).toContain("scenario=");
    expect(finalize?.run).toContain("report=");
    expect(finalize?.run).toContain("braintrust=");
    expect(finalize?.run).toContain("exit 1");
  });

  it("uses the direct exporter command with one narrowly scoped secret", () => {
    const workflow = readAgentEvalWorkflow();
    const summarySteps = readSummarySteps(workflow);
    const braintrust = summarySteps.find((step) => step.id === "braintrust");
    const run = braintrust?.run ?? "";

    expect(run).toContain("bun run agent:e2e:braintrust");
    expect(run).toContain(
      '--suite discovery="$RUNNER_TEMP/agent-eval-artifacts/discovery/suite.json"',
    );
    expect(run).toContain(
      '--suite intent="$RUNNER_TEMP/agent-eval-artifacts/intent/suite.json"',
    );
    expect(run).toContain('--project "githits-cli-agent-evals"');
    const githubRunId = githubExpression("github.run_id");
    const githubRunAttempt = githubExpression("github.run_attempt");
    const githubRepository = githubExpression("github.repository");
    expect(run).toContain(
      `--experiment "github-${githubRunId}-${githubRunAttempt}"`,
    );
    expect(run).toContain("--source github");
    expect(run).toContain(`--run-id "${githubRunId}"`);
    expect(run).toContain(`--run-attempt "${githubRunAttempt}"`);
    expect(run).toContain(
      `--run-url "https://github.com/${githubRepository}/actions/runs/${githubRunId}"`,
    );
    expect(run).toContain('--result-out "$RESULT_OUT"');
    expect(run).toContain("result.url");
    expect(run).toContain("GITHUB_STEP_SUMMARY");
    expect(run).not.toContain("bt eval");

    const allSteps = Object.values(workflow.jobs).flatMap((job) => job.steps);
    const braintrustApiKey = githubExpression("secrets.BRAINTRUST_API_KEY");
    const runnerTemp = githubExpression("runner.temp");
    const secretBindings = allSteps.flatMap((step) =>
      Object.values(step.env ?? {}).filter((value) =>
        value.includes("secrets.BRAINTRUST_API_KEY"),
      ),
    );
    expect(secretBindings).toEqual([braintrustApiKey]);
    expect(braintrust?.env).toEqual({
      BRAINTRUST_API_KEY: braintrustApiKey,
      RESULT_OUT: `${runnerTemp}/agent-eval-braintrust-result.json`,
    });

    const finalize = summarySteps.find(
      (step) => step.name === "Finalize agent eval status",
    );
    expect(finalize?.env).toEqual({
      SCENARIO_RESULT: githubExpression("needs.scenario.result"),
      REPORT_OUTCOME: githubExpression("steps.report.outcome"),
      BRAINTRUST_OUTCOME: githubExpression("steps.braintrust.outcome"),
    });
    expect(Object.values(finalize?.env ?? {}).join(" ")).not.toContain(
      "secrets.",
    );
  });
});
