import { describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
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
import { join } from "node:path";
import {
  type AgentEvalRecordInput,
  adaptAgentUsage,
  buildAgentEvalMetrics,
  LUNA_MODEL,
  unknownAgentUsage,
} from "./agent-eval-metrics.ts";
import { buildRunReportFromMetadata } from "./agent-eval-report.ts";
import {
  AGENT_EVAL_SAFETY_CLASSES,
  AGENT_EVAL_SUITE_MATRIX,
  AGENT_EVAL_SUITE_NAMES,
  AGENT_EVAL_SUITE_USAGE,
  type AgentEvalSuiteArtifact,
  type AgentEvalSuiteManifest,
  type AgentEvalSuiteShardExecutor,
  type AgentEvalSuiteShardOptions,
  type AgentEvalSuiteWorkload,
  agentEvalSuiteArtifactSchema,
  agentEvalSuiteComparisonSchema,
  buildSuiteComparison,
  compareAgentEvalSuitesOffline,
  formatComparisonReport,
  formatSuiteReport,
  loadComparisonArtifact,
  loadImportedSuite,
  loadSuiteManifest,
  parseAgentEvalSuiteCliArgs,
  parseComparisonArtifact,
  parseSuiteArtifact,
  runAgentEvalSuite,
  runAgentEvalSuiteCli,
  runAgentEvalSuitePair,
  selectSuiteWorkloads,
  validateSuiteManifest,
} from "./agent-eval-suite.ts";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeKnownSuiteGit(path: string, targetSha = "target-sha"): void {
  const artifact = JSON.parse(
    readFileSync(path, "utf8"),
  ) as AgentEvalSuiteArtifact;
  artifact.measurementGit = {
    branch: "main",
    sha: "harness-sha",
    dirty: false,
  };
  artifact.targetGit = { branch: "main", sha: targetSha, dirty: false };
  writeJson(path, artifact);
}

const BASE_FIXTURE_ENTRIES: AgentEvalSuiteWorkload[] = [
  {
    id: "stable-a",
    path: "eval/agentic/workloads/stable-a.md",
    safety: "stable",
    suites: ["stable-full"],
  },
  {
    id: "stateful-a",
    path: "eval/agentic/workloads/stateful-a.md",
    safety: "stateful",
    suites: ["stateful-manual"],
  },
  {
    id: "experimental-a",
    path: "eval/agentic/workloads/experimental-a.md",
    safety: "experimental",
    suites: ["experimental"],
  },
];

interface SuiteFixture {
  root: string;
  manifestPath: string;
  workloadsDir: string;
  entries: AgentEvalSuiteWorkload[];
}

interface SuiteExecutionFixture extends SuiteFixture {
  targetRoot: string;
  reportingPath: string;
  schemaPath: string;
}

function createSuiteFixture(
  entries: AgentEvalSuiteWorkload[] = BASE_FIXTURE_ENTRIES,
): SuiteFixture {
  const root = mkdtempSync(join(tmpdir(), "agent-eval-suite-test-"));
  const workloadsDir = join(root, "eval", "agentic", "workloads");
  mkdirSync(workloadsDir, { recursive: true });
  for (const entry of entries) {
    if (
      entry.path.includes("\\") ||
      entry.path.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(entry.path) ||
      entry.path
        .split("/")
        .some(
          (segment) =>
            segment.length === 0 || segment === "." || segment === "..",
        )
    ) {
      continue;
    }
    const path = join(root, entry.path);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `# ${entry.id}\n`);
  }
  const manifestPath = join(root, "eval", "agentic", "suites.json");
  writeJson(join(root, "eval", "agentic", "suites.json"), {
    schemaVersion: 1,
    workloads: entries,
  });
  return { root, manifestPath, workloadsDir, entries };
}

function createSuiteExecutionFixture(
  entries: AgentEvalSuiteWorkload[] = [
    {
      id: "stable-a",
      path: "eval/agentic/workloads/stable-a.md",
      safety: "stable",
      suites: ["stable-full"],
    },
  ],
): SuiteExecutionFixture {
  const fixture = createSuiteFixture(entries);
  const reportingPath = join(fixture.workloadsDir, "REPORTING.md");
  const schemaPath = join(
    fixture.root,
    "eval",
    "agentic",
    "result.schema.json",
  );
  writeFileSync(reportingPath, "# Reporting contract\n");
  writeFileSync(schemaPath, "{}\n");
  const targetRoot = join(fixture.root, "target");
  mkdirSync(join(targetRoot, "skills", "githits-mcp"), { recursive: true });
  mkdirSync(join(targetRoot, "src", "commands", "init"), {
    recursive: true,
  });
  writeFileSync(
    join(targetRoot, "skills", "githits-mcp", "SKILL.md"),
    "# Target skill\n",
  );
  writeFileSync(
    join(targetRoot, "src", "commands", "init", "guidance-assets.ts"),
    'export const GITHITS_GUIDANCE_BLOCK = "Target guidance";\n',
  );
  return { ...fixture, targetRoot, reportingPath, schemaPath };
}

function createPairExecutionFixture(
  entries: AgentEvalSuiteWorkload[] = [
    {
      id: "stable-a",
      path: "eval/agentic/workloads/stable-a.md",
      safety: "stable",
      suites: ["stable-full"],
    },
  ],
): SuiteExecutionFixture {
  const fixture = createSuiteFixture(entries);
  const reportingPath = join(fixture.workloadsDir, "REPORTING.md");
  const schemaPath = join(
    fixture.root,
    "eval",
    "agentic",
    "result.schema.json",
  );
  writeFileSync(reportingPath, "# Reporting contract\n");
  writeFileSync(schemaPath, "{}\n");
  mkdirSync(join(fixture.root, "skills", "githits-mcp"), {
    recursive: true,
  });
  mkdirSync(join(fixture.root, "src", "commands", "init"), {
    recursive: true,
  });
  writeFileSync(
    join(fixture.root, "skills", "githits-mcp", "SKILL.md"),
    "# Target skill\n",
  );
  writeFileSync(
    join(fixture.root, "src", "commands", "init", "guidance-assets.ts"),
    'export const GITHITS_GUIDANCE_BLOCK = "Target guidance";\n',
  );
  return {
    ...fixture,
    targetRoot: fixture.root,
    reportingPath,
    schemaPath,
  };
}

function suiteRecord(
  workloadId: string,
  overrides: Partial<AgentEvalRecordInput> = {},
): AgentEvalRecordInput {
  return {
    workloadId,
    requestedModel: LUNA_MODEL,
    resolvedModel: null,
    agent: "codex",
    agentVersion: "codex-test",
    reasoningEffort: "low",
    surface: "mcp",
    server: "local",
    guidanceProfile: "descriptors",
    experimentalTools: false,
    publishedPackage: null,
    targetGit: { branch: "main", sha: "target-sha", dirty: false },
    startedAt: "2026-08-28T10:00:00.000Z",
    completedAt: "2026-08-28T10:00:01.000Z",
    durationMs: 1000,
    processStatus: "success",
    finalStatus: "success",
    exitCode: 0,
    timedOut: false,
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
    toolCalls: [
      {
        tool: "search",
        server: "githits",
        status: "completed",
      },
    ],
    artifacts: {},
    ...overrides,
  };
}

function writeShardArtifacts(
  options: AgentEvalSuiteShardOptions,
  records: AgentEvalRecordInput[],
  workloadStatuses: Record<string, string> = {},
): void {
  mkdirSync(join(options.outDir, "workloads"), { recursive: true });
  const runMetadata = {
    runId: `run-${options.profile}`,
    startedAt: "2026-08-28T10:00:00.000Z",
    completedAt: "2026-08-28T10:00:02.000Z",
    agent: "codex",
    model: LUNA_MODEL,
    reasoningEffort: "low",
    surface: "mcp",
    server: "local",
    guidanceProfile: options.profile,
    scenario: options.scenario,
    intentProfile: options.intentProfile,
    intentFragmentHash: options.intentFragmentHash,
    dryRun: options.dryRun,
    git: { branch: "main", sha: "target-sha", dirty: false },
    codexVersion: "codex-test",
    workloads: options.workloads.map((workload) => {
      const workloadDir = join(options.outDir, "workloads", workload.id);
      mkdirSync(workloadDir, { recursive: true });
      return {
        id: workload.id,
        status: workloadStatuses[workload.id] ?? "success",
        durationMs:
          records.find((record) => record.workloadId === workload.id)
            ?.durationMs ?? undefined,
        workloadDir,
      };
    }),
  };
  writeJson(join(options.outDir, "run.json"), runMetadata);
  const normalizedRecords = records.map((record) => ({
    ...record,
    scenario: options.scenario,
    guidanceProfile: options.guidanceProfile,
    intentProfile: options.intentProfile,
    intentFragmentHash: options.intentFragmentHash,
  }));
  writeJson(
    join(options.outDir, "metrics.json"),
    buildAgentEvalMetrics({
      runId: runMetadata.runId,
      startedAt: runMetadata.startedAt,
      completedAt: runMetadata.completedAt,
      records: normalizedRecords,
    }),
  );
  writeJson(
    join(options.outDir, "report.json"),
    buildRunReportFromMetadata(options.outDir, runMetadata),
  );
}

async function generatePairSuite(
  fixture: SuiteExecutionFixture,
  outDir: string,
  mutateRecord: (
    record: AgentEvalRecordInput,
    options: AgentEvalSuiteShardOptions,
  ) => AgentEvalRecordInput = (record) => record,
  includeRecord: (
    workload: AgentEvalSuiteWorkload,
    options: AgentEvalSuiteShardOptions,
  ) => boolean = () => true,
  dryRun = true,
  scenarios: readonly ("discovery" | "intent" | "full")[] = [
    "discovery",
    "full",
  ],
  workloadConcurrency = 1,
): Promise<AgentEvalSuiteArtifact> {
  return runAgentEvalSuite({
    suite: "stable-full",
    repoRoot: fixture.root,
    targetRoot: fixture.root,
    outDir,
    manifestPath: fixture.manifestPath,
    workloadsDir: fixture.workloadsDir,
    reportingPath: fixture.reportingPath,
    schemaPath: fixture.schemaPath,
    dryRun,
    workloadConcurrency,
    scenarios,
    shardExecutor: async (options) => {
      writeShardArtifacts(
        options,
        options.workloads
          .filter((workload) => includeRecord(workload, options))
          .map((workload) =>
            mutateRecord(
              suiteRecord(workload.id, { guidanceProfile: options.profile }),
              options,
            ),
          ),
      );
      return { runDir: options.outDir, status: "success" };
    },
  });
}

function copyEntries(): AgentEvalSuiteWorkload[] {
  return structuredClone(BASE_FIXTURE_ENTRIES);
}

function expectFixtureError(
  entries: AgentEvalSuiteWorkload[],
  expected: string,
  mutate?: (fixture: SuiteFixture) => void,
): void {
  const fixture = createSuiteFixture(entries);
  try {
    mutate?.(fixture);
    expect(() =>
      loadSuiteManifest({
        manifestPath: fixture.manifestPath,
        repoRoot: fixture.root,
        workloadsDir: fixture.workloadsDir,
      }),
    ).toThrow(expected);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe("agent eval suites", () => {
  it("loads the checked-in manifest with the exact initial inventory", () => {
    const manifest = loadSuiteManifest();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.workloads).toHaveLength(25);
    expect(
      manifest.workloads.filter((workload) => workload.safety === "stable"),
    ).toHaveLength(21);
    expect(
      manifest.workloads.filter((workload) => workload.safety === "stateful"),
    ).toHaveLength(1);
    expect(
      manifest.workloads.filter(
        (workload) => workload.safety === "experimental",
      ),
    ).toHaveLength(3);

    expect(
      selectSuiteWorkloads(manifest, "canary").map((item) => item.id),
    ).toEqual(["express-router", "package-overview-vulnerabilities"]);
    expect(
      selectSuiteWorkloads(manifest, "smoke").map((item) => item.id),
    ).toEqual([
      "docs-search-followup",
      "express-router",
      "global-example",
      "package-overview-vulnerabilities",
      "package-upgrade-safety",
      "unified-search-investigation",
    ]);
    expect(
      selectSuiteWorkloads(manifest, "stable-full").map((item) => item.id),
    ).toEqual([
      "code-file-navigation",
      "code-files-listing",
      "code-grep-investigation",
      "code-read-window",
      "docs-discovery",
      "docs-search-followup",
      "docs-search-noise",
      "express-router",
      "global-example",
      "opencode-compaction",
      "package-changelog",
      "package-changelog-range",
      "package-dependencies",
      "package-overview-vulnerabilities",
      "package-upgrade-safety",
      "package-vulnerability-filter",
      "package-vulnerability-history",
      "package-vulnerability-rubygems",
      "search-source-ergonomics",
      "site-search-explicit",
      "unified-search-investigation",
    ]);
    expect(
      selectSuiteWorkloads(manifest, "stateful-manual").map((item) => item.id),
    ).toEqual(["githits-onboarding"]);
    expect(
      selectSuiteWorkloads(manifest, "experimental").map((item) => item.id),
    ).toEqual([
      "experimental-code-diff",
      "experimental-resolution-follow-up",
      "experimental-site-resolution-follow-up",
    ]);
    expect(AGENT_EVAL_SUITE_NAMES).toEqual([
      "canary",
      "smoke",
      "stable-full",
      "stateful-manual",
      "experimental",
    ]);
    expect(AGENT_EVAL_SAFETY_CLASSES).toEqual([
      "stable",
      "stateful",
      "experimental",
    ]);
  });

  it("parses strict run, pair, compare, and help CLI forms", () => {
    expect(
      parseAgentEvalSuiteCliArgs([
        "run",
        "--suite",
        "canary",
        "--scenario",
        "discovery",
        "--scenario",
        "intent",
        "--concurrency",
        "3",
        "--dry-run",
        "--out",
        "runs",
        "--target-root",
        "../target",
      ]),
    ).toMatchObject({
      mode: "run",
      suite: "canary",
      scenarios: ["discovery", "intent"],
      workloadConcurrency: 3,
      dryRun: true,
      outDir: "runs",
      targetRoot: "../target",
    });
    expect(
      parseAgentEvalSuiteCliArgs([
        "pair",
        "--suite",
        "smoke",
        "--baseline-root",
        "../main",
      ]),
    ).toMatchObject({
      mode: "pair",
      suite: "smoke",
      baselineRoot: "../main",
      dryRun: false,
    });
    expect(
      parseAgentEvalSuiteCliArgs([
        "compare",
        "--baseline-suite",
        "before/suite.json",
        "--candidate-suite",
        "after/suite.json",
        "--out",
        "comparison",
      ]),
    ).toEqual({
      mode: "compare",
      baselineSuitePath: "before/suite.json",
      candidateSuitePath: "after/suite.json",
      outDir: "comparison",
    });
    expect(parseAgentEvalSuiteCliArgs(["--help"])).toEqual({ mode: "help" });
    expect(
      parseAgentEvalSuiteCliArgs(["run", "--suite", "canary"]),
    ).toMatchObject({ workloadConcurrency: 1 });
    expect(AGENT_EVAL_SUITE_USAGE).toContain(
      "Defaults: canary discovery + intent; other suites intent only.",
    );
    expect(AGENT_EVAL_SUITE_USAGE).toContain(
      "Explicit --scenario values replace defaults; full is opt-in.",
    );

    for (const args of [
      ["run", "--suite", "canary", "--suite", "smoke"],
      ["run", "--suite", "canary", "--baseline-root", "../main"],
      [
        "pair",
        "--suite",
        "canary",
        "--baseline-root",
        "../main",
        "--target-root",
        "../other",
      ],
      [
        "compare",
        "--baseline-suite",
        "before.json",
        "--candidate-suite",
        "after.json",
        "--dry-run",
      ],
      ["compare", "--baseline-suite", "before.json"],
      ["run", "--suite", "not-a-suite"],
      ["run", "--suite", "canary", "--scenario", "bogus"],
      ["run", "--suite", "canary", "--scenario"],
      [
        "run",
        "--suite",
        "canary",
        "--scenario",
        "intent",
        "--scenario",
        "intent",
      ],
      ["run", "--suite", "canary", "--concurrency", "0"],
      ["run", "--suite", "canary", "--concurrency", "-1"],
      ["run", "--suite", "canary", "--concurrency", "1.5"],
      ["run", "--suite", "canary", "--concurrency", "not-a-number"],
      ["run", "--suite", "canary", "--concurrency"],
      ["run", "--suite", "canary", "--unknown"],
      ["--help", "--help"],
    ]) {
      expect(() => parseAgentEvalSuiteCliArgs(args)).toThrow();
    }
  });

  it("routes run, pair, and offline compare commands with artifact paths", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const explicitRunDir = join(candidate.root, "explicit-run");
    const explicitPairDir = join(candidate.root, "explicit-pair");
    const explicitCompareDir = join(candidate.root, "explicit-compare");
    let compareCalls = 0;
    const shardExecutor: AgentEvalSuiteShardExecutor = async (
      options: AgentEvalSuiteShardOptions,
    ) => {
      writeShardArtifacts(
        options,
        options.workloads.map((workload) =>
          suiteRecord(workload.id, { guidanceProfile: options.profile }),
        ),
      );
      return { runDir: options.outDir, status: "success" };
    };
    const runSuite = (options: Parameters<typeof runAgentEvalSuite>[0]) =>
      runAgentEvalSuite({
        ...options,
        targetRoot: candidate.root,
        manifestPath: candidate.manifestPath,
        workloadsDir: candidate.workloadsDir,
        reportingPath: candidate.reportingPath,
        schemaPath: candidate.schemaPath,
        shardExecutor,
      });
    const runText = await runAgentEvalSuiteCli(
      ["run", "--suite", "stable-full", "--dry-run", "--out", explicitRunDir],
      candidate.root,
      { runSuite },
    );
    expect(runText).toContain(
      `suite artifact: ${join(explicitRunDir, "suite.json")}`,
    );
    expect(runText).toContain("Agent eval suite: dry-run stable-full");
    const defaultRunText = await runAgentEvalSuiteCli(
      ["run", "--suite", "stable-full", "--dry-run"],
      candidate.root,
      { runSuite },
    );
    expect(defaultRunText).toContain(
      join(candidate.root, ".agent-eval", "suites"),
    );

    const runPair = (options: Parameters<typeof runAgentEvalSuitePair>[0]) =>
      runAgentEvalSuitePair({
        ...options,
        manifestPath: candidate.manifestPath,
        workloadsDir: candidate.workloadsDir,
        reportingPath: candidate.reportingPath,
        schemaPath: candidate.schemaPath,
        shardExecutor,
      });
    const pairText = await runAgentEvalSuiteCli(
      [
        "pair",
        "--suite",
        "stable-full",
        "--baseline-root",
        baseline.root,
        "--dry-run",
        "--out",
        explicitPairDir,
      ],
      candidate.root,
      { runPair },
    );
    expect(pairText).toContain(
      `baseline suite: ${join(explicitPairDir, "baseline", "suite.json")}`,
    );
    expect(pairText).toContain(
      `candidate suite: ${join(explicitPairDir, "candidate", "suite.json")}`,
    );
    expect(pairText).toContain(
      `comparison: ${join(explicitPairDir, "comparison", "comparison.json")}`,
    );
    const defaultPairText = await runAgentEvalSuiteCli(
      [
        "pair",
        "--suite",
        "stable-full",
        "--baseline-root",
        baseline.root,
        "--dry-run",
      ],
      candidate.root,
      { runPair },
    );
    expect(defaultPairText).toContain(
      join(candidate.root, ".agent-eval", "pairs"),
    );

    const compareText = await runAgentEvalSuiteCli(
      [
        "compare",
        "--baseline-suite",
        join(explicitPairDir, "baseline", "suite.json"),
        "--candidate-suite",
        join(explicitPairDir, "candidate", "suite.json"),
        "--out",
        explicitCompareDir,
      ],
      candidate.root,
      {
        compareOffline: (options) => {
          compareCalls += 1;
          return compareAgentEvalSuitesOffline(options);
        },
      },
    );
    expect(compareCalls).toBe(1);
    expect(compareText).toContain(
      `comparison artifact: ${join(explicitCompareDir, "comparison.json")}`,
    );
    expect(compareText).toContain("Agent eval comparison: offline");
    const defaultCompareText = await runAgentEvalSuiteCli(
      [
        "compare",
        "--baseline-suite",
        join(explicitPairDir, "baseline", "suite.json"),
        "--candidate-suite",
        join(explicitPairDir, "candidate", "suite.json"),
      ],
      candidate.root,
      { compareOffline: compareAgentEvalSuitesOffline },
    );
    expect(defaultCompareText).toContain(
      join(candidate.root, ".agent-eval", "comparisons"),
    );
  });

  it("expands the scenario defaults and explicit full override", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "canary-a",
        path: "eval/agentic/workloads/canary-a.md",
        safety: "stable",
        suites: ["canary", "smoke", "stable-full"],
      },
    ]);
    const capture = async (
      suite: AgentEvalSuiteArtifact["suiteName"],
      scenarios?: readonly ("discovery" | "intent" | "full")[],
    ): Promise<AgentEvalSuiteShardOptions["scenario"][]> => {
      const seen: AgentEvalSuiteShardOptions["scenario"][] = [];
      const outDir = mkdtempSync(
        join(tmpdir(), "agent-eval-scenario-default-"),
      );
      try {
        await runAgentEvalSuite({
          suite,
          repoRoot: fixture.root,
          targetRoot: fixture.targetRoot,
          outDir,
          manifestPath: fixture.manifestPath,
          workloadsDir: fixture.workloadsDir,
          reportingPath: fixture.reportingPath,
          schemaPath: fixture.schemaPath,
          dryRun: true,
          scenarios,
          shardExecutor: async (options) => {
            seen.push(options.scenario);
            writeShardArtifacts(
              options,
              options.workloads.map((workload) => suiteRecord(workload.id)),
            );
            return { runDir: options.outDir, status: "success" };
          },
        });
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
      return seen;
    };
    try {
      expect(await capture("canary")).toEqual(["discovery", "intent"]);
      for (const suite of ["smoke", "stable-full"] as const) {
        expect(await capture(suite)).toEqual(["intent"]);
      }
      expect(await capture("stateful-manual")).toEqual(["intent"]);
      expect(await capture("experimental")).toEqual(["intent"]);
      expect(await capture("stable-full", ["full"])).toEqual(["full"]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("normalizes v1 suite identity without inventing intent", async () => {
    const fixture = createPairExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-v1-"));
    try {
      await generatePairSuite(fixture, outDir);
      const suitePath = join(outDir, "suite.json");
      const current = JSON.parse(readFileSync(suitePath, "utf8")) as {
        [key: string]: unknown;
        matrix: Record<string, unknown>;
        shards: Array<Record<string, unknown>>;
        cells: Array<Record<string, unknown>>;
        workloadConcurrency?: unknown;
      };
      const currentV1 = { ...current };
      delete currentV1.workloadConcurrency;
      const v1 = {
        ...currentV1,
        schemaVersion: 1,
        matrix: {
          agent: current.matrix.agent,
          model: current.matrix.model,
          reasoningEffort: current.matrix.reasoningEffort,
          surface: current.matrix.surface,
          server: current.matrix.server,
          profiles: ["descriptors", "full"],
        },
        shards: current.shards.map(
          ({
            scenario: _scenario,
            guidanceProfile: _guidance,
            intentProfile: _intent,
            intentFragmentHash: _hash,
            agent: _agent,
            model: _model,
            reasoningEffort: _effort,
            ...shard
          }) => shard,
        ),
        cells: current.cells.map(
          ({
            scenario: _scenario,
            guidanceProfile: _guidance,
            intentProfile: _intent,
            intentFragmentHash: _hash,
            agent: _agent,
            model: _model,
            reasoningEffort: _effort,
            ...cell
          }) => ({
            ...cell,
            id: `${cell.profile}/${cell.workloadId}`,
          }),
        ),
      };
      writeJson(suitePath, v1);
      const childMetricsPaths = current.shards.map((shard) =>
        join(outDir, shard.metricsPath as string),
      );
      for (const metricsPath of childMetricsPaths) {
        const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as {
          schemaVersion: number;
          records: Array<Record<string, unknown>>;
        };
        writeJson(metricsPath, {
          ...metrics,
          schemaVersion: 1,
          records: metrics.records.map(
            ({
              scenario: _scenario,
              intentProfile: _intent,
              intentFragmentHash: _hash,
              ...record
            }) => record,
          ),
        });
      }
      const parsed = parseSuiteArtifact(v1);
      expect(parsed.schemaVersion).toBe(3);
      expect(parsed.workloadConcurrency).toBe(1);
      expect(parsed.matrix.scenarios).toEqual(["discovery", "full"]);
      expect(parsed.cells.map((cell) => cell.scenario)).toEqual([
        "discovery",
        "full",
      ]);
      expect(
        parsed.cells.every((cell) => cell.intentProfile === "neutral"),
      ).toBe(true);
      const imported = loadImportedSuite(suitePath);
      expect(imported.shards.discovery.metrics?.schemaVersion).toBe(2);
      expect(imported.shards.full.metrics?.schemaVersion).toBe(2);

      const nullProfile = {
        ...v1,
        shards: v1.shards.map((shard, index) =>
          index === 0 ? { ...shard, profile: null } : shard,
        ),
        cells: v1.cells.map((cell, index) =>
          index === 0
            ? { ...(cell as Record<string, unknown>), profile: null }
            : cell,
        ),
      };
      expect(() => parseSuiteArtifact(nullProfile)).toThrow(
        "Invalid suite artifact",
      );

      const missingProfile = {
        ...v1,
        shards: v1.shards.map((shard, index) => {
          if (index !== 0) return shard;
          const { profile: _profile, ...withoutProfile } = shard;
          return withoutProfile;
        }),
        cells: v1.cells.map((cell, index) => {
          if (index !== 0) return cell;
          const { profile: _profile, ...withoutProfile } = cell as Record<
            string,
            unknown
          >;
          return withoutProfile;
        }),
      };
      expect(() => parseSuiteArtifact(missingProfile)).toThrow(
        "Invalid suite artifact",
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("emits v3 scenario identities and excludes intent hash mismatches from cohorts", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-intent-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-intent-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-intent-output-"));
    try {
      await generatePairSuite(
        baseline,
        baselineOutDir,
        undefined,
        undefined,
        true,
        ["intent"],
      );
      await generatePairSuite(
        candidate,
        candidateOutDir,
        undefined,
        undefined,
        true,
        ["intent"],
      );
      const candidatePath = join(candidateOutDir, "suite.json");
      const candidateArtifact = JSON.parse(
        readFileSync(candidatePath, "utf8"),
      ) as {
        cells: Array<Record<string, unknown>>;
      };
      writeJson(candidatePath, {
        ...candidateArtifact,
        cells: candidateArtifact.cells.map((cell) => ({
          ...cell,
          intentFragmentHash: "0".repeat(64),
        })),
      });
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: candidatePath,
        outputDir,
      });
      expect(comparison.schemaVersion).toBe(2);
      expect(comparison.cells[0]?.scenario).toBe("intent");
      expect(comparison.cells[0]?.intentProfile).toBe("githits");
      expect(comparison.cells[0]?.compatibility).toBe("incompatible");
      expect(comparison.cells[0]?.incompatibilityReason).toBe(
        "intentFragmentHash",
      );
      expect(comparison.aggregates.durationMs.includedCellIds).toEqual([]);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("normalizes v2 workload concurrency and keeps it out of comparison identity", async () => {
    const fixture = createPairExecutionFixture();
    const v2OutDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-v2-"));
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-suite-concurrency-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-suite-concurrency-candidate-"),
    );
    try {
      await generatePairSuite(fixture, v2OutDir);
      const v2Path = join(v2OutDir, "suite.json");
      const v2 = JSON.parse(readFileSync(v2Path, "utf8")) as Record<
        string,
        unknown
      >;
      delete v2.workloadConcurrency;
      v2.schemaVersion = 2;
      const parsedV2 = parseSuiteArtifact(v2);
      expect(parsedV2.schemaVersion).toBe(3);
      expect(parsedV2.workloadConcurrency).toBe(1);

      await generatePairSuite(
        fixture,
        baselineOutDir,
        (record) => ({ ...record, durationMs: 1000 }),
        () => true,
        true,
        ["intent"],
        1,
      );
      await generatePairSuite(
        fixture,
        candidateOutDir,
        (record) => ({ ...record, durationMs: 2000 }),
        () => true,
        true,
        ["intent"],
        2,
      );
      const comparison = buildSuiteComparison(
        loadImportedSuite(join(baselineOutDir, "suite.json")),
        loadImportedSuite(join(candidateOutDir, "suite.json")),
        {
          mode: "offline",
          comparisonId: randomUUID(),
          startedAt: "2026-08-28T10:00:00.000Z",
          completedAt: "2026-08-28T10:00:01.000Z",
        },
      );
      expect(comparison.compatibility.directDeltasSuppressed).toBe(false);
      expect(comparison.aggregates.durationMs.delta).toBe(1000);
      expect(
        comparison.compatibility.dimensions.some(
          (dimension) => dimension.name === "workloadConcurrency",
        ),
      ).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(v2OutDir, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
    }
  });

  it("refuses live stateful CLI runs before execution but routes dry runs", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "stateful-a",
        path: "eval/agentic/workloads/stateful-a.md",
        safety: "stateful",
        suites: ["stateful-manual"],
      },
    ]);
    let executorCalls = 0;
    const runSuite = (options: Parameters<typeof runAgentEvalSuite>[0]) =>
      runAgentEvalSuite({
        ...options,
        targetRoot: fixture.targetRoot,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        shardExecutor: async (shard) => {
          executorCalls += 1;
          writeShardArtifacts(
            shard,
            shard.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: shard.outDir, status: "success" };
        },
      });
    try {
      await expect(
        runAgentEvalSuiteCli(
          ["run", "--suite", "stateful-manual"],
          fixture.root,
          { runSuite },
        ),
      ).rejects.toThrow("dry-run-only");
      expect(executorCalls).toBe(0);
      const output = await runAgentEvalSuiteCli(
        ["run", "--suite", "stateful-manual", "--dry-run"],
        fixture.root,
        { runSuite },
      );
      expect(executorCalls).toBe(1);
      expect(output).toContain("Agent eval suite: dry-run stateful-manual");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("expands suites in deterministic ID and path order", () => {
    const entries = copyEntries();
    entries[0]!.id = "stable-z";
    entries[0]!.path = "eval/agentic/workloads/stable-z.md";
    entries.push({
      id: "stable-a",
      path: "eval/agentic/workloads/stable-a.md",
      safety: "stable",
      suites: ["stable-full"],
    });
    const fixture = createSuiteFixture(entries);
    try {
      const manifest = loadSuiteManifest({
        manifestPath: fixture.manifestPath,
        repoRoot: fixture.root,
        workloadsDir: fixture.workloadsDir,
      });
      expect(
        selectSuiteWorkloads(manifest, "stable-full").map((item) => item.id),
      ).toEqual(["stable-a", "stable-z"]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate IDs and paths", () => {
    const duplicateId = copyEntries();
    duplicateId[1]!.id = duplicateId[0]!.id;
    expectFixtureError(duplicateId, "duplicate workload id");

    const duplicatePath = copyEntries();
    duplicatePath[1]!.path = duplicatePath[0]!.path;
    expectFixtureError(duplicatePath, "duplicate workload path");
  });

  it("rejects unsafe paths, missing files, and unclassified Markdown", () => {
    for (const path of [
      "/tmp/outside.md",
      "../outside.md",
      "eval/agentic/workloads/../outside.md",
      "C:/outside.md",
      "eval\\agentic\\workloads\\outside.md",
    ]) {
      const entries = copyEntries();
      entries[0]!.path = path;
      expectFixtureError(entries, "unsafe workload path");
    }

    const missingManifest = createSuiteFixture();
    try {
      rmSync(missingManifest.manifestPath);
      expect(() =>
        loadSuiteManifest({
          manifestPath: missingManifest.manifestPath,
          repoRoot: missingManifest.root,
          workloadsDir: missingManifest.workloadsDir,
        }),
      ).toThrow("suite manifest not found");
    } finally {
      rmSync(missingManifest.root, { recursive: true, force: true });
    }

    const missing = createSuiteFixture();
    try {
      rmSync(join(missing.root, BASE_FIXTURE_ENTRIES[0]!.path));
      expect(() =>
        loadSuiteManifest({
          manifestPath: missing.manifestPath,
          repoRoot: missing.root,
          workloadsDir: missing.workloadsDir,
        }),
      ).toThrow("manifest workload path is not a discovered workload");
    } finally {
      rmSync(missing.root, { recursive: true, force: true });
    }

    const unclassified = createSuiteFixture();
    try {
      writeFileSync(
        join(unclassified.workloadsDir, "new-workload.md"),
        "# new\n",
      );
      expect(() =>
        loadSuiteManifest({
          manifestPath: unclassified.manifestPath,
          repoRoot: unclassified.root,
          workloadsDir: unclassified.workloadsDir,
        }),
      ).toThrow("discovered workload is unclassified");
      writeFileSync(
        join(unclassified.workloadsDir, "REPORTING.md"),
        "# report\n",
      );
      rmSync(join(unclassified.workloadsDir, "new-workload.md"));
      expect(() =>
        loadSuiteManifest({
          manifestPath: unclassified.manifestPath,
          repoRoot: unclassified.root,
          workloadsDir: unclassified.workloadsDir,
        }),
      ).not.toThrow();
    } finally {
      rmSync(unclassified.root, { recursive: true, force: true });
    }
  });

  it("rejects manifest paths that are not discovered workload Markdown", () => {
    const entries = copyEntries();
    entries[0]!.path = "eval/agentic/not-a-workload.md";
    expectFixtureError(
      entries,
      "manifest workload path is not a discovered workload",
      (fixture) => {
        writeFileSync(join(fixture.root, entries[0]!.path), "# outside\n");
      },
    );
  });

  it("rejects unknown suite names and safety classes", () => {
    const unknownSuite = copyEntries();
    const unknownSuiteEntry = unknownSuite[0] as unknown as Record<
      string,
      unknown
    >;
    unknownSuiteEntry.suites = ["nightly"];
    expectFixtureError(unknownSuite, "Invalid suite manifest");

    const unknownSafety = copyEntries();
    const unknownSafetyEntry = unknownSafety[0] as unknown as Record<
      string,
      unknown
    >;
    unknownSafetyEntry.safety = "unsafe";
    expectFixtureError(unknownSafety, "Invalid suite manifest");
  });

  it("rejects suite nesting and safety membership violations", () => {
    const canaryOutsideSmoke = copyEntries();
    canaryOutsideSmoke[0]!.suites = ["canary", "stable-full"];
    expectFixtureError(
      canaryOutsideSmoke,
      "suite canary must be a subset of smoke",
    );

    const smokeOutsideFull = copyEntries();
    smokeOutsideFull[0]!.suites = ["smoke"];
    expectFixtureError(
      smokeOutsideFull,
      "suite smoke must be a subset of stable-full",
    );

    const nonStableInStable = copyEntries();
    nonStableInStable[1]!.suites = ["stable-full"];
    expectFixtureError(
      nonStableInStable,
      "non-stable workload in stable suite",
    );

    const statefulOutsideManual = copyEntries();
    statefulOutsideManual[1]!.suites = ["stateful-manual", "experimental"];
    expectFixtureError(
      statefulOutsideManual,
      "stateful workload must be in only stateful-manual",
    );

    const experimentalOutsideExperimental = copyEntries();
    experimentalOutsideExperimental[2]!.suites = [
      "experimental",
      "stateful-manual",
    ];
    expectFixtureError(
      experimentalOutsideExperimental,
      "experimental workload must be in only experimental",
    );

    const stableMissingFull = copyEntries();
    stableMissingFull[0]!.suites = ["experimental"];
    expectFixtureError(
      stableMissingFull,
      "stable workload missing stable-full membership",
    );
  });

  it("validates parsed manifests against an explicit fixture root", () => {
    const fixture = createSuiteFixture();
    try {
      const value = {
        schemaVersion: 1,
        workloads: fixture.entries,
      } satisfies AgentEvalSuiteManifest;
      expect(
        validateSuiteManifest(value, {
          repoRoot: fixture.root,
          workloadsDir: fixture.workloadsDir,
        }),
      ).toEqual(value);
      expect(existsSync(fixture.manifestPath)).toBe(true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("runs configured scenario shards concurrently with workloads in order", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "stable-z",
        path: "eval/agentic/workloads/package-changelog-range.md",
        safety: "stable",
        suites: ["stable-full"],
      },
      {
        id: "stable-a",
        path: "eval/agentic/workloads/package-changelog.md",
        safety: "stable",
        suites: ["stable-full"],
      },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-run-"));
    const starts: string[] = [];
    let release!: () => void;
    let notifyStarts!: () => void;
    const startsReady = new Promise<void>((resolve) => {
      notifyStarts = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const artifactPromise = runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        dryRun: true,
        workloadConcurrency: 2,
        scenarios: ["discovery", "intent"],
        shardExecutor: async (options) => {
          expect(options.workloadConcurrency).toBe(2);
          starts.push(options.scenario);
          if (starts.length === 2) notifyStarts();
          await barrier;
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: options.outDir, status: "success" };
        },
      });
      await startsReady;
      expect(starts).toEqual(["discovery", "intent"]);
      release();
      const artifact = await artifactPromise;
      expect(artifact.matrix.agent).toBe(AGENT_EVAL_SUITE_MATRIX.agent);
      expect(artifact.matrix.model).toBe(AGENT_EVAL_SUITE_MATRIX.model);
      expect(artifact.matrix.reasoningEffort).toBe(
        AGENT_EVAL_SUITE_MATRIX.reasoningEffort,
      );
      expect([...artifact.matrix.scenarios]).toEqual(["discovery", "intent"]);
      expect(artifact.workloadConcurrency).toBe(2);
      expect(artifact.selectedWorkloads.map((workload) => workload.id)).toEqual(
        ["stable-a", "stable-z"],
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("records an undefined shard executor result as failed evidence", async () => {
    const fixture = createSuiteExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-undefined-"));
    try {
      const artifact = await runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        dryRun: true,
        shardExecutor: async () => undefined as never,
      });
      expect(artifact.shards).toEqual([
        {
          scenario: "intent",
          profile: "descriptors",
          guidanceProfile: "descriptors",
          intentProfile: "githits",
          intentFragmentHash:
            "b04b96acfd7a89516ab1742d9df914bb6779e952c7df96ac9858785ed40f10d0",
          agent: "codex",
          model: LUNA_MODEL,
          reasoningEffort: "low",
          status: "failed",
          error: "shard executor must return an execution result",
          runPath: null,
          metricsPath: null,
          reportPath: null,
        },
      ]);
      expect(artifact.status).toBe("failed");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("refuses live stateful suites before executors but permits their dry runs", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "stateful-a",
        path: "eval/agentic/workloads/stateful-a.md",
        safety: "stateful",
        suites: ["stateful-manual"],
      },
    ]);
    const liveOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-suite-stateful-"),
    );
    const dryOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-suite-stateful-dry-"),
    );
    let executorCalls = 0;
    try {
      await expect(
        runAgentEvalSuite({
          suite: "stateful-manual",
          repoRoot: fixture.root,
          targetRoot: fixture.targetRoot,
          outDir: liveOutDir,
          manifestPath: fixture.manifestPath,
          workloadsDir: fixture.workloadsDir,
          reportingPath: fixture.reportingPath,
          schemaPath: fixture.schemaPath,
          shardExecutor: async () => {
            executorCalls += 1;
            return { status: "success" };
          },
        }),
      ).rejects.toThrow("dry-run-only");
      expect(executorCalls).toBe(0);

      const artifact = await runAgentEvalSuite({
        suite: "stateful-manual",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir: dryOutDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        dryRun: true,
        shardExecutor: async (options) => {
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: options.outDir, status: "success" };
        },
      });
      expect(artifact.status).toBe("dry-run");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(liveOutDir, { recursive: true, force: true });
      rmSync(dryOutDir, { recursive: true, force: true });
    }
  });

  it("routes the experimental flag only to experimental suite shards", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "experimental-a",
        path: "eval/agentic/workloads/experimental-a.md",
        safety: "experimental",
        suites: ["experimental"],
      },
    ]);
    const outDir = mkdtempSync(
      join(tmpdir(), "agent-eval-suite-experimental-"),
    );
    const flags: boolean[] = [];
    try {
      await runAgentEvalSuite({
        suite: "experimental",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        dryRun: true,
        shardExecutor: async (options) => {
          flags.push(options.experimentalTools);
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: options.outDir, status: "success" };
        },
      });
      expect(flags).toEqual([true]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("rejects knowable suite setup errors before either shard executor", async () => {
    const cases = [
      {
        error: "Result schema not found",
        mutate: (fixture: SuiteExecutionFixture): void => {
          rmSync(fixture.schemaPath);
        },
      },
      {
        error: "Target GitHits skill directory not found",
        mutate: (fixture: SuiteExecutionFixture): void => {
          rmSync(join(fixture.targetRoot, "skills"), {
            recursive: true,
            force: true,
          });
        },
      },
      {
        error: "Target guidance module not found",
        mutate: (fixture: SuiteExecutionFixture): void => {
          rmSync(
            join(
              fixture.targetRoot,
              "src",
              "commands",
              "init",
              "guidance-assets.ts",
            ),
          );
        },
      },
    ];
    for (const { error, mutate } of cases) {
      const fixture = createSuiteExecutionFixture();
      const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-preflight-"));
      let executorCalls = 0;
      try {
        mutate(fixture);
        await expect(
          runAgentEvalSuite({
            suite: "stable-full",
            repoRoot: fixture.root,
            targetRoot: fixture.targetRoot,
            outDir,
            manifestPath: fixture.manifestPath,
            workloadsDir: fixture.workloadsDir,
            reportingPath: fixture.reportingPath,
            schemaPath: fixture.schemaPath,
            shardExecutor: async () => {
              executorCalls += 1;
              return { status: "success" };
            },
          }),
        ).rejects.toThrow(error);
        expect(executorCalls).toBe(0);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
        rmSync(outDir, { recursive: true, force: true });
      }
    }
  });

  it("writes a validated complete suite artifact with portable child references", async () => {
    const fixture = createSuiteExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-complete-"));
    try {
      const artifact = await runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        dryRun: true,
        shardExecutor: async (options) => {
          writeShardArtifacts(
            options,
            options.workloads.map((workload) =>
              suiteRecord(workload.id, { guidanceProfile: options.profile }),
            ),
          );
          return { runDir: options.outDir, status: "success" };
        },
      });
      const loaded = parseSuiteArtifact(
        JSON.parse(readFileSync(join(outDir, "suite.json"), "utf8")),
      );
      expect(agentEvalSuiteArtifactSchema.parse(loaded)).toEqual(artifact);
      expect(artifact.status).toBe("dry-run");
      expect(artifact.shards).toEqual([
        {
          scenario: "intent",
          profile: "descriptors",
          guidanceProfile: "descriptors",
          intentProfile: "githits",
          intentFragmentHash:
            "b04b96acfd7a89516ab1742d9df914bb6779e952c7df96ac9858785ed40f10d0",
          agent: "codex",
          model: LUNA_MODEL,
          reasoningEffort: "low",
          status: "success",
          error: null,
          runPath: "shards/intent/run.json",
          metricsPath: "shards/intent/metrics.json",
          reportPath: "shards/intent/report.json",
        },
      ]);
      expect(() =>
        agentEvalSuiteArtifactSchema.parse({
          ...artifact,
          matrix: { ...artifact.matrix, scenarios: ["bogus"] },
        }),
      ).toThrow();
      expect(() =>
        agentEvalSuiteArtifactSchema.parse({
          ...artifact,
          shards: [artifact.shards[0]],
        }),
      ).not.toThrow();
      expect(() =>
        agentEvalSuiteArtifactSchema.parse({
          ...artifact,
          shards: [artifact.shards[0], artifact.shards[0]],
        }),
      ).not.toThrow();
      expect(formatSuiteReport(artifact)).toContain("callsByTool=");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("keeps a successful sibling when one scenario shard is rejected", async () => {
    const fixture = createSuiteExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-partial-"));
    try {
      const artifact = await runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        scenarios: ["discovery", "full"],
        shardExecutor: async (options) => {
          if (options.profile === "full") throw new Error("full setup failed");
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: options.outDir, status: "success" };
        },
      });
      expect(artifact.status).toBe("partial");
      expect(artifact.shards[0]?.status).toBe("success");
      expect(artifact.shards[1]).toMatchObject({
        status: "failed",
        error: "full setup failed",
      });
      expect(artifact.totals.missingExecutions).toBe(1);
      expect(artifact.missingToolTelemetryCellIds).toEqual(["full/stable-a"]);
      expect(existsSync(join(outDir, "suite.json"))).toBe(true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("accounts for workload failures and missing cells without stopping later workloads", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "stable-a",
        path: "eval/agentic/workloads/stable-a.md",
        safety: "stable",
        suites: ["stable-full"],
      },
      {
        id: "stable-b",
        path: "eval/agentic/workloads/stable-b.md",
        safety: "stable",
        suites: ["stable-full"],
      },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-workloads-"));
    try {
      const artifact = await runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        scenarios: ["discovery", "full"],
        shardExecutor: async (options) => {
          const records = options.workloads
            .filter(
              (workload) =>
                !(options.profile === "full" && workload.id === "stable-b"),
            )
            .map((workload) =>
              suiteRecord(
                workload.id,
                options.profile === "descriptors" && workload.id === "stable-a"
                  ? { processStatus: "failed", finalStatus: "failure" }
                  : {},
              ),
            );
          writeShardArtifacts(
            options,
            records,
            options.profile === "descriptors"
              ? { "stable-a": "failed" }
              : undefined,
          );
          return { runDir: options.outDir, status: "success" };
        },
      });
      expect(artifact.totals.failedExecutions).toBe(1);
      expect(artifact.totals.missingExecutions).toBe(1);
      expect(artifact.totals.successfulExecutions).toBe(2);
      expect(artifact.totals.failedWorkloadCount).toBe(1);
      expect(artifact.totals.missingWorkloadCount).toBe(1);
      expect(artifact.shards[0]).toMatchObject({
        status: "failed",
        error: "one or more child workloads failed",
        runPath: "shards/discovery/run.json",
      });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("hashes exact bytes in stable order and isolates target guidance identity", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "stable-z",
        path: "eval/agentic/workloads/package-changelog-range.md",
        safety: "stable",
        suites: ["stable-full"],
      },
      {
        id: "stable-a",
        path: "eval/agentic/workloads/package-changelog.md",
        safety: "stable",
        suites: ["stable-full"],
      },
    ]);
    const targetRootB = join(fixture.root, "target-b");
    mkdirSync(join(targetRootB, "skills", "githits-mcp"), { recursive: true });
    mkdirSync(join(targetRootB, "src", "commands", "init"), {
      recursive: true,
    });
    writeFileSync(
      join(targetRootB, "skills", "githits-mcp", "SKILL.md"),
      "# Target skill\n",
    );
    writeFileSync(
      join(targetRootB, "src", "commands", "init", "guidance-assets.ts"),
      'export const GITHITS_GUIDANCE_BLOCK = "Different guidance";\n',
    );
    const firstOutDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-hash-a-"));
    const secondOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-suite-hash-b-"),
    );
    const executeWithoutChildren = async (
      targetRoot: string,
      outDir: string,
    ): Promise<AgentEvalSuiteArtifact> =>
      runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        dryRun: true,
        shardExecutor: async () => ({ status: "success" }),
      });
    try {
      const first = await executeWithoutChildren(
        fixture.targetRoot,
        firstOutDir,
      );
      const second = await executeWithoutChildren(targetRootB, secondOutDir);
      expect(first.contentIdentity.workloads.map((item) => item.path)).toEqual([
        "eval/agentic/workloads/package-changelog-range.md",
        "eval/agentic/workloads/package-changelog.md",
      ]);
      const workloadBytes = readFileSync(
        join(fixture.root, "eval/agentic/workloads/package-changelog-range.md"),
      );
      expect(first.contentIdentity.workloads[0]?.sha256).toBe(
        createHash("sha256").update(workloadBytes).digest("hex"),
      );
      expect(first.contentIdentity).toEqual(second.contentIdentity);
      expect(first.targetGuidanceIdentity.guidanceBlock).not.toEqual(
        second.targetGuidanceIdentity.guidanceBlock,
      );
      expect(first.targetGuidanceIdentity.skillFiles).toEqual(
        second.targetGuidanceIdentity.skillFiles,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(firstOutDir, { recursive: true, force: true });
      rmSync(secondOutDir, { recursive: true, force: true });
    }
  });

  it("aggregates token, cost, duration, and logical calls-by-tool totals", async () => {
    const fixture = createSuiteExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-totals-"));
    try {
      const artifact = await runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        scenarios: ["discovery", "full"],
        shardExecutor: async (options) => {
          const record = suiteRecord(options.workloads[0]!.id, {
            durationMs: options.profile === "descriptors" ? 1000 : 2000,
            toolCalls:
              options.profile === "descriptors"
                ? [
                    { tool: "search", server: "githits", status: "started" },
                    { tool: "search", server: "githits", status: "completed" },
                  ]
                : [{ tool: "search", server: "githits", status: "completed" }],
          });
          writeShardArtifacts(options, [record]);
          if (options.profile === "descriptors") {
            const metricsPath = join(options.outDir, "metrics.json");
            const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as {
              records: Array<{
                tools: { sequence: Array<{ tool: string }> };
              }>;
            };
            metrics.records[0]!.tools.sequence[0]!.tool = "githits_search";
            writeJson(metricsPath, metrics);
          }
          return { runDir: options.outDir, status: "success" };
        },
      });
      expect(artifact.cumulativeAgentTimeMs).toBe(3000);
      expect(artifact.tokens).toEqual({
        uncachedInputTokens: 140,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 20,
        outputTokens: 60,
        reasoningOutputTokens: 8,
      });
      expect(artifact.cost.kind).toBe("base_rate_estimate");
      expect(artifact.cost.usd).not.toBeNull();
      expect(artifact.callsByTool).toEqual([
        {
          surface: "mcp",
          tool: "search",
          total: 3,
          started: 1,
          completed: 2,
          failed: 0,
          unknown: 0,
        },
      ]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("marks aggregate calls-by-tool unknown with missing cell IDs", async () => {
    const fixture = createSuiteExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-unknown-"));
    try {
      const artifact = await runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        scenarios: ["discovery", "full"],
        dryRun: true,
        shardExecutor: async (options) => {
          const record = suiteRecord(options.workloads[0]!.id, {
            usage:
              options.profile === "descriptors"
                ? unknownAgentUsage("codex", LUNA_MODEL, "test-unknown")
                : suiteRecord(options.workloads[0]!.id).usage,
          });
          writeShardArtifacts(options, [record]);
          if (options.profile === "descriptors") {
            const metricsPath = join(options.outDir, "metrics.json");
            const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as {
              records: Array<{ tools: { logicalCallCount: number | null } }>;
              aggregates: { logicalToolCalls: number | null };
            };
            metrics.records[0]!.tools.logicalCallCount = null;
            metrics.aggregates.logicalToolCalls = null;
            writeJson(metricsPath, metrics);
          }
          return { runDir: options.outDir, status: "success" };
        },
      });
      expect(artifact.callsByTool).toBeNull();
      expect(artifact.missingToolTelemetryCellIds).toEqual([
        "discovery/stable-a",
      ]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed suite artifacts through the Zod schema", () => {
    expect(() => parseSuiteArtifact({ schemaVersion: 1 })).toThrow(
      "Invalid suite artifact",
    );
    expect(() =>
      agentEvalSuiteArtifactSchema.parse({ schemaVersion: 1 }),
    ).toThrow();
    expect(() => parseComparisonArtifact({ schemaVersion: 1 })).toThrow(
      "Invalid comparison artifact",
    );
  });

  it("assigns each suite artifact a unique UUID execution ID", async () => {
    const fixture = createSuiteExecutionFixture();
    const firstOutDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-id-a-"));
    const secondOutDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-id-b-"));
    const run = (outDir: string): Promise<AgentEvalSuiteArtifact> =>
      runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: fixture.root,
        targetRoot: fixture.targetRoot,
        outDir,
        manifestPath: fixture.manifestPath,
        workloadsDir: fixture.workloadsDir,
        reportingPath: fixture.reportingPath,
        schemaPath: fixture.schemaPath,
        dryRun: true,
        shardExecutor: async (options) => {
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: options.outDir, status: "success" };
        },
      });
    try {
      const first = await run(firstOutDir);
      const second = await run(secondOutDir);
      expect(first.suiteId).not.toBe(second.suiteId);
      expect(first.suiteId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(() => agentEvalSuiteArtifactSchema.parse(first)).not.toThrow();
      expect(first.suiteName).toBe("stable-full");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(firstOutDir, { recursive: true, force: true });
      rmSync(secondOutDir, { recursive: true, force: true });
    }
  });

  it("runs a pair with both roots preflighted and target suites sequential", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-suite-pair-"));
    const events: string[] = [];
    try {
      const result = await runAgentEvalSuitePair({
        suite: "stable-full",
        repoRoot: candidate.root,
        baselineRoot: baseline.root,
        outDir,
        manifestPath: candidate.manifestPath,
        workloadsDir: candidate.workloadsDir,
        reportingPath: candidate.reportingPath,
        schemaPath: candidate.schemaPath,
        dryRun: true,
        scenarios: ["discovery", "full"],
        shardExecutor: async (options) => {
          events.push(`start:${options.targetRoot}`);
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          events.push(`end:${options.targetRoot}`);
          return { runDir: options.outDir, status: "success" };
        },
      });
      const baselineEnds = events
        .map((event, index) => (event === `end:${baseline.root}` ? index : -1))
        .filter((index) => index >= 0);
      const firstCandidateStart = events.indexOf(`start:${candidate.root}`);
      expect(baselineEnds).toHaveLength(2);
      expect(firstCandidateStart).toBeGreaterThan(Math.max(...baselineEnds));
      expect(result.baselineSuitePath).toBe(
        join(outDir, "baseline", "suite.json"),
      );
      expect(result.candidateSuitePath).toBe(
        join(outDir, "candidate", "suite.json"),
      );
      expect(result.comparisonPath).toBe(
        join(outDir, "comparison", "comparison.json"),
      );
      expect(result.comparison.mode).toBe("live-pair");
      expect(loadComparisonArtifact(result.comparisonPath)).toEqual(
        result.comparison,
      );
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("preserves both partial suite artifacts and produces pair comparison evidence", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-pair-partial-"));
    try {
      const result = await runAgentEvalSuitePair({
        suite: "stable-full",
        repoRoot: candidate.root,
        baselineRoot: baseline.root,
        outDir,
        manifestPath: candidate.manifestPath,
        workloadsDir: candidate.workloadsDir,
        reportingPath: candidate.reportingPath,
        schemaPath: candidate.schemaPath,
        dryRun: true,
        scenarios: ["discovery", "full"],
        shardExecutor: async (options) => {
          if (
            options.targetRoot === baseline.root &&
            options.profile === "full"
          ) {
            throw new Error("baseline full rejected");
          }
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: options.outDir, status: "success" };
        },
      });
      expect(result.baselineSuite.status).toBe("partial");
      expect(result.candidateSuite.status).toBe("dry-run");
      expect(existsSync(result.baselineSuitePath)).toBe(true);
      expect(existsSync(result.candidateSuitePath)).toBe(true);
      expect(result.comparison.cells).toHaveLength(2);
      expect(result.comparison.cells).toContainEqual(
        expect.objectContaining({
          id: "full/stable-a",
          beforeStatus: "missing",
          afterStatus: "success",
        }),
      );
      expect(existsSync(result.comparisonPath)).toBe(true);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("rejects pair target setup before starting either target suite", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-pair-preflight-"));
    let executorCalls = 0;
    try {
      rmSync(join(baseline.root, "skills"), { recursive: true, force: true });
      await expect(
        runAgentEvalSuitePair({
          suite: "stable-full",
          repoRoot: candidate.root,
          baselineRoot: baseline.root,
          outDir,
          manifestPath: candidate.manifestPath,
          workloadsDir: candidate.workloadsDir,
          reportingPath: candidate.reportingPath,
          schemaPath: candidate.schemaPath,
          dryRun: true,
          shardExecutor: async () => {
            executorCalls += 1;
            return { status: "success" };
          },
        }),
      ).rejects.toThrow("Target GitHits skill directory not found");
      expect(executorCalls).toBe(0);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("compares imported suites offline through the same structured builder", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-suite-offline-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-suite-offline-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-comparison-"));
    try {
      await generatePairSuite(baseline, baselineOutDir);
      await generatePairSuite(candidate, candidateOutDir);
      const baselineImported = loadImportedSuite(
        join(baselineOutDir, "suite.json"),
      );
      const candidateImported = loadImportedSuite(
        join(candidateOutDir, "suite.json"),
      );
      const pure = buildSuiteComparison(baselineImported, candidateImported, {
        mode: "offline",
        comparisonId: "00000000-0000-4000-8000-000000000001",
        startedAt: "2026-08-28T10:00:00.000Z",
        completedAt: "2026-08-28T10:00:01.000Z",
      });
      const offline = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      expect(agentEvalSuiteComparisonSchema.parse(offline)).toEqual(offline);
      expect(offline.baselineSuite.sha256).toBe(baselineImported.sha256);
      expect(offline.candidateSuite.sha256).toBe(candidateImported.sha256);
      expect(offline.cells).toEqual(pure.cells);
      expect(offline.aggregates).toEqual(pure.aggregates);
      expect(offline.compatibility).toEqual(pure.compatibility);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe or missing imported child references", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-import-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-import-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-import-output-"));
    const outsideDir = mkdtempSync(
      join(tmpdir(), "agent-eval-import-outside-"),
    );
    try {
      await generatePairSuite(baseline, baselineOutDir);
      await generatePairSuite(candidate, candidateOutDir);
      const candidateSuitePath = join(candidateOutDir, "suite.json");
      const original = JSON.parse(readFileSync(candidateSuitePath, "utf8")) as {
        shards: Array<{ runPath: string | null }>;
      };
      const cases = [
        { reference: "../run.json", error: "safe relative path" },
        { reference: "/tmp/run.json", error: "safe relative path" },
        { reference: "shards/full/missing-run.json", error: "not found" },
      ];
      for (const testCase of cases) {
        writeJson(candidateSuitePath, {
          ...original,
          shards: original.shards.map((shard, index) =>
            index === 0 ? { ...shard, runPath: testCase.reference } : shard,
          ),
        });
        expect(() =>
          compareAgentEvalSuitesOffline({
            baselineSuitePath: join(baselineOutDir, "suite.json"),
            candidateSuitePath,
            outputDir,
          }),
        ).toThrow(testCase.error);
      }
      const outsideRun = join(outsideDir, "run.json");
      writeJson(outsideRun, { outside: true });
      const escapedPath = join(candidateOutDir, "escaped-run.json");
      symlinkSync(outsideRun, escapedPath);
      writeJson(candidateSuitePath, {
        ...original,
        shards: original.shards.map((shard, index) =>
          index === 0 ? { ...shard, runPath: "escaped-run.json" } : shard,
        ),
      });
      expect(() =>
        compareAgentEvalSuitesOffline({
          baselineSuitePath: join(baselineOutDir, "suite.json"),
          candidateSuitePath,
          outputDir,
        }),
      ).toThrow("escapes suite directory");
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects report references that permit secondary reads outside their verified parent", async () => {
    const fixture = createPairExecutionFixture();
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-report-parent-"));
    const outsideDir = mkdtempSync(
      join(tmpdir(), "agent-eval-report-outside-"),
    );
    try {
      await generatePairSuite(fixture, outDir);
      const suitePath = join(outDir, "suite.json");
      const original = JSON.parse(readFileSync(suitePath, "utf8")) as {
        shards: Array<{
          runPath: string | null;
          metricsPath: string | null;
          reportPath: string | null;
        }>;
      };
      const descriptorDir = join(outDir, "shards", "discovery");
      const reportDir = join(descriptorDir, "report-dir");
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(
        join(reportDir, "report.json"),
        readFileSync(join(descriptorDir, "report.json")),
      );
      writeJson(suitePath, {
        ...original,
        shards: original.shards.map((shard, index) =>
          index === 0
            ? {
                ...shard,
                reportPath: "shards/discovery/report-dir/report.json",
              }
            : shard,
        ),
      });
      expect(() => loadImportedSuite(suitePath)).toThrow(
        "must share one contained directory",
      );

      const outsideRun = join(outsideDir, "run.json");
      const outsideMetrics = join(outsideDir, "metrics.json");
      writeJson(outsideRun, { outside: true });
      writeJson(outsideMetrics, { outside: true });
      symlinkSync(outsideRun, join(reportDir, "run.json"));
      symlinkSync(outsideMetrics, join(reportDir, "metrics.json"));
      writeJson(suitePath, {
        ...original,
        shards: original.shards.map((shard, index) =>
          index === 0
            ? {
                ...shard,
                runPath: "shards/discovery/report-dir/run.json",
                metricsPath: "shards/discovery/report-dir/metrics.json",
                reportPath: "shards/discovery/report-dir/report.json",
              }
            : shard,
        ),
      });
      expect(() => loadImportedSuite(suitePath)).toThrow(
        "escapes suite directory",
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects inconsistent imported suite workload, cell, and metrics identities", async () => {
    const entries: AgentEvalSuiteWorkload[] = [
      {
        id: "stable-a",
        path: "eval/agentic/workloads/stable-a.md",
        safety: "stable",
        suites: ["stable-full"],
      },
      {
        id: "stable-b",
        path: "eval/agentic/workloads/stable-b.md",
        safety: "stable",
        suites: ["stable-full"],
      },
    ];
    const fixture = createPairExecutionFixture(entries);
    const outDir = mkdtempSync(join(tmpdir(), "agent-eval-import-invariants-"));
    try {
      await generatePairSuite(fixture, outDir);
      const suitePath = join(outDir, "suite.json");
      const original = JSON.parse(readFileSync(suitePath, "utf8")) as {
        selectedWorkloads: AgentEvalSuiteWorkload[];
        contentIdentity: { workloads: Array<Record<string, unknown>> };
        cells: Array<Record<string, unknown>>;
        shards: Array<{ metricsPath: string | null }>;
      };
      const descriptorMetricsPath = join(
        outDir,
        original.shards[0]!.metricsPath!,
      );
      const originalMetrics = JSON.parse(
        readFileSync(descriptorMetricsPath, "utf8"),
      ) as { records: Array<Record<string, unknown>> };
      const suiteCases: Array<{
        name: string;
        artifact: Record<string, unknown>;
        error: string;
      }> = [
        {
          name: "duplicate selected ID",
          artifact: {
            ...original,
            selectedWorkloads: [
              ...original.selectedWorkloads,
              original.selectedWorkloads[0],
            ],
          },
          error: "duplicate selected workload ID",
        },
        {
          name: "duplicate content identity",
          artifact: {
            ...original,
            contentIdentity: {
              ...original.contentIdentity,
              workloads: original.contentIdentity.workloads.map(
                (identity, index) =>
                  index === 1
                    ? {
                        ...identity,
                        path: original.contentIdentity.workloads[0]!.path,
                      }
                    : identity,
              ),
            },
          },
          error: "duplicate workload content identity",
        },
        {
          name: "missing content identity",
          artifact: {
            ...original,
            contentIdentity: {
              ...original.contentIdentity,
              workloads: original.contentIdentity.workloads.slice(0, 1),
            },
          },
          error: "content identities must match selected workloads",
        },
        {
          name: "duplicate cell",
          artifact: {
            ...original,
            cells: original.cells.map((cell, index) =>
              index === 1 ? { ...cell, id: original.cells[0]!.id } : cell,
            ),
          },
          error: "duplicate cell",
        },
        {
          name: "incorrect cell path",
          artifact: {
            ...original,
            cells: original.cells.map((cell, index) =>
              index === 0 ? { ...cell, workloadPath: "wrong.md" } : cell,
            ),
          },
          error: "incorrect workload path",
        },
      ];
      for (const testCase of suiteCases) {
        writeJson(suitePath, testCase.artifact);
        expect(() => loadImportedSuite(suitePath), testCase.name).toThrow(
          testCase.error,
        );
      }

      const metricsCases: Array<{
        name: string;
        records: Array<Record<string, unknown>>;
        cells?: Array<Record<string, unknown>>;
        error: string;
      }> = [
        {
          name: "duplicate metrics workload ID",
          records: [...originalMetrics.records, originalMetrics.records[0]!],
          error: "duplicate discovery metrics workload ID",
        },
        {
          name: "unselected metrics workload ID",
          records: originalMetrics.records.map((record, index) =>
            index === 0 ? { ...record, workloadId: "not-selected" } : record,
          ),
          error: "metrics references unselected workload",
        },
        {
          name: "success cell without metrics record",
          records: [],
          error: "cell status does not match discovery child evidence",
        },
        {
          name: "missing cell with metrics record",
          records: originalMetrics.records,
          cells: original.cells.map((cell, index) =>
            index === 0 ? { ...cell, status: "missing" } : cell,
          ),
          error: "cell status does not match discovery child evidence",
        },
      ];
      for (const testCase of metricsCases) {
        writeJson(suitePath, {
          ...original,
          ...(testCase.cells ? { cells: testCase.cells } : {}),
        });
        writeJson(descriptorMetricsPath, {
          ...originalMetrics,
          records: testCase.records,
        });
        expect(() => loadImportedSuite(suitePath), testCase.name).toThrow(
          testCase.error,
        );
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("suppresses all deltas for reporting or schema identity mismatches", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-content-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-content-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-content-output-"));
    try {
      await generatePairSuite(baseline, baselineOutDir);
      writeFileSync(
        candidate.reportingPath,
        "# Different reporting contract\n",
      );
      await generatePairSuite(candidate, candidateOutDir);
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      expect(comparison.compatibility.directDeltasSuppressed).toBe(true);
      expect(comparison.aggregates.durationMs.delta).toBeNull();
      expect(comparison.aggregates.durationMs.includedCellIds).toEqual([]);
      expect(
        comparison.cells.every((cell) => cell.beforeStatus === "success"),
      ).toBe(true);
      expect(
        comparison.cells.every((cell) => cell.toolSequence.changed === null),
      ).toBe(true);
      expect(comparison.warnings.join("\n")).toContain("reportingContract");
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("suppresses all metric deltas between dry-run and live suite evidence", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(join(tmpdir(), "agent-eval-dry-base-"));
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-live-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-dry-output-"));
    try {
      await generatePairSuite(
        baseline,
        baselineOutDir,
        undefined,
        undefined,
        true,
      );
      await generatePairSuite(
        candidate,
        candidateOutDir,
        undefined,
        undefined,
        false,
      );
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      expect(comparison.compatibility.dimensions).toContainEqual(
        expect.objectContaining({
          name: "dryRun",
          status: "incompatible",
          before: true,
          after: false,
        }),
      );
      expect(comparison.compatibility.compatible).toBe(false);
      expect(comparison.compatibility.directDeltasSuppressed).toBe(true);
      expect(comparison.repositoryOnly).toBe(false);
      expect(comparison.aggregates.durationMs.delta).toBeNull();
      expect(comparison.aggregates.logicalToolCalls.delta).toBeNull();
      expect(comparison.aggregates.tokens.uncachedInputTokens.delta).toBeNull();
      expect(comparison.aggregates.tokens.cachedInputTokens.delta).toBeNull();
      expect(
        comparison.aggregates.tokens.cacheWriteInputTokens.delta,
      ).toBeNull();
      expect(comparison.aggregates.tokens.outputTokens.delta).toBeNull();
      expect(
        comparison.aggregates.tokens.reasoningOutputTokens.delta,
      ).toBeNull();
      expect(comparison.aggregates.costUsd.delta).toBeNull();
      expect(comparison.aggregates.callsByTool.deltas).toBeNull();
      expect(comparison.cells).toHaveLength(2);
      for (const cell of comparison.cells) {
        expect(cell.compatibility).toBe("suppressed");
        expect(cell.durationMs).toBeNull();
        expect(cell.logicalToolCalls).toBeNull();
        expect(cell.tokens.uncachedInputTokens).toBeNull();
        expect(cell.tokens.cachedInputTokens).toBeNull();
        expect(cell.tokens.cacheWriteInputTokens).toBeNull();
        expect(cell.tokens.outputTokens).toBeNull();
        expect(cell.tokens.reasoningOutputTokens).toBeNull();
        expect(cell.costUsd).toBeNull();
        expect(cell.callsByTool).toBeNull();
        expect(cell.toolSequence.changed).toBeNull();
        expect(cell.processStatus.before).toBe("success");
        expect(cell.processStatus.after).toBe("success");
        expect(cell.finalStatus.before).toBe("success");
        expect(cell.finalStatus.after).toBe("success");
      }
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("excludes only workload cells when a workload content hash changes", async () => {
    const entries: AgentEvalSuiteWorkload[] = [
      {
        id: "stable-a",
        path: "eval/agentic/workloads/stable-a.md",
        safety: "stable",
        suites: ["stable-full"],
      },
      {
        id: "stable-b",
        path: "eval/agentic/workloads/stable-b.md",
        safety: "stable",
        suites: ["stable-full"],
      },
    ];
    const baseline = createPairExecutionFixture(entries);
    const candidate = createPairExecutionFixture(entries);
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-workload-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-workload-candidate-"),
    );
    const outputDir = mkdtempSync(
      join(tmpdir(), "agent-eval-workload-output-"),
    );
    try {
      await generatePairSuite(baseline, baselineOutDir);
      writeFileSync(
        join(candidate.root, "eval", "agentic", "workloads", "stable-a.md"),
        "# Changed workload\n",
      );
      await generatePairSuite(candidate, candidateOutDir);
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      expect(comparison.compatibility.directDeltasSuppressed).toBe(false);
      expect(comparison.aggregates.durationMs.includedCellIds).toEqual([
        "discovery/stable-b",
        "full/stable-b",
      ]);
      expect(comparison.aggregates.durationMs.excludedCellIds).toEqual([
        "discovery/stable-a",
        "full/stable-a",
      ]);
      expect(
        comparison.cells
          .filter((cell) => cell.workloadId === "stable-a")
          .every((cell) => cell.compatibility === "incompatible"),
      ).toBe(true);
      expect(
        comparison.cells
          .filter((cell) => cell.workloadId === "stable-a")
          .every((cell) => cell.toolSequence.changed === null),
      ).toBe(true);
      expect(
        comparison.cells
          .filter((cell) => cell.workloadId === "stable-b")
          .every((cell) => cell.compatibility === "compatible"),
      ).toBe(true);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("suppresses ordered tool sequences for result schema mismatches", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-schema-sequence-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-schema-sequence-candidate-"),
    );
    const outputDir = mkdtempSync(
      join(tmpdir(), "agent-eval-schema-sequence-output-"),
    );
    try {
      await generatePairSuite(baseline, baselineOutDir);
      writeFileSync(candidate.schemaPath, '{"changed":true}\n');
      await generatePairSuite(candidate, candidateOutDir);
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      expect(comparison.compatibility.directDeltasSuppressed).toBe(true);
      expect(
        comparison.cells.every((cell) => cell.toolSequence.changed === null),
      ).toBe(true);
      expect(
        comparison.cells.every((cell) => cell.processStatus.changed === false),
      ).toBe(true);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("keeps compatible deltas visible while warning on harness and Codex drift", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-drift-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-drift-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-drift-output-"));
    try {
      await generatePairSuite(baseline, baselineOutDir);
      await generatePairSuite(candidate, candidateOutDir);
      const candidateSuitePath = join(candidateOutDir, "suite.json");
      const candidateArtifact = JSON.parse(
        readFileSync(candidateSuitePath, "utf8"),
      ) as AgentEvalSuiteArtifact & { measurementGit: unknown };
      candidateArtifact.measurementGit = {
        branch: "feature",
        sha: "candidate-sha",
        dirty: true,
      };
      candidateArtifact.codexVersions = ["codex-new"];
      writeJson(candidateSuitePath, candidateArtifact);
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath,
        outputDir,
      });
      expect(comparison.repositoryOnly).toBe(false);
      expect(comparison.compatibility.directDeltasSuppressed).toBe(false);
      expect(comparison.aggregates.durationMs.delta).toBe(0);
      expect(comparison.warnings.join("\n")).toContain("measurementGit");
      expect(comparison.warnings.join("\n")).toContain("codexVersion");
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("treats target guidance changes as comparable repository dimensions", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-guidance-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-guidance-candidate-"),
    );
    const outputDir = mkdtempSync(
      join(tmpdir(), "agent-eval-guidance-output-"),
    );
    try {
      await generatePairSuite(baseline, baselineOutDir);
      writeKnownSuiteGit(join(baselineOutDir, "suite.json"));
      writeFileSync(
        join(candidate.root, "src", "commands", "init", "guidance-assets.ts"),
        'export const GITHITS_GUIDANCE_BLOCK = "Changed target guidance";\n',
      );
      await generatePairSuite(candidate, candidateOutDir);
      writeKnownSuiteGit(join(candidateOutDir, "suite.json"));
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      expect(comparison.repositoryOnly).toBe(true);
      expect(comparison.compatibility.directDeltasSuppressed).toBe(false);
      expect(comparison.aggregates.durationMs.delta).toBe(0);
      const beforeGuidance = loadImportedSuite(
        join(baselineOutDir, "suite.json"),
      ).artifact.targetGuidanceIdentity.guidanceBlock;
      const afterGuidance = loadImportedSuite(
        join(candidateOutDir, "suite.json"),
      ).artifact.targetGuidanceIdentity.guidanceBlock;
      expect(beforeGuidance).not.toEqual(afterGuidance);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("requires clean known Git attribution for repository-only comparisons", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-attribution-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-attribution-candidate-"),
    );
    const outputDir = mkdtempSync(
      join(tmpdir(), "agent-eval-attribution-output-"),
    );
    try {
      await generatePairSuite(baseline, baselineOutDir);
      await generatePairSuite(candidate, candidateOutDir);
      const baselinePath = join(baselineOutDir, "suite.json");
      const candidatePath = join(candidateOutDir, "suite.json");
      writeKnownSuiteGit(baselinePath, "baseline-target");
      writeKnownSuiteGit(candidatePath, "candidate-target");
      const baselineArtifact = JSON.parse(
        readFileSync(baselinePath, "utf8"),
      ) as AgentEvalSuiteArtifact;
      const candidateArtifact = JSON.parse(
        readFileSync(candidatePath, "utf8"),
      ) as AgentEvalSuiteArtifact;
      const cases: Array<{
        label: string;
        baselineGit?: Partial<AgentEvalSuiteArtifact["measurementGit"]>;
        candidateGit?: Partial<AgentEvalSuiteArtifact["measurementGit"]>;
        baselineTarget?: Partial<AgentEvalSuiteArtifact["targetGit"]>;
        candidateTarget?: Partial<AgentEvalSuiteArtifact["targetGit"]>;
      }> = [
        {
          label: "candidate target dirty",
          candidateTarget: { dirty: true },
        },
        {
          label: "both targets dirty",
          baselineTarget: { dirty: true },
          candidateTarget: { dirty: true },
        },
        {
          label: "baseline harness dirty",
          baselineGit: { dirty: true },
        },
        {
          label: "candidate harness dirty state unknown",
          candidateGit: { dirty: null },
        },
        {
          label: "baseline target SHA unavailable",
          baselineTarget: { sha: null },
        },
      ];
      for (const testCase of cases) {
        writeJson(baselinePath, {
          ...baselineArtifact,
          measurementGit: {
            ...baselineArtifact.measurementGit,
            ...testCase.baselineGit,
          },
          targetGit: {
            ...baselineArtifact.targetGit,
            ...testCase.baselineTarget,
          },
        });
        writeJson(candidatePath, {
          ...candidateArtifact,
          measurementGit: {
            ...candidateArtifact.measurementGit,
            ...testCase.candidateGit,
          },
          targetGit: {
            ...candidateArtifact.targetGit,
            ...testCase.candidateTarget,
          },
        });
        const comparison = compareAgentEvalSuitesOffline({
          baselineSuitePath: baselinePath,
          candidateSuitePath: candidatePath,
          outputDir,
        });
        expect(comparison.repositoryOnly, testCase.label).toBe(false);
        expect(comparison.warnings.join("\n"), testCase.label).toContain(
          "repositoryOnly=false",
        );
      }

      writeJson(baselinePath, {
        ...baselineArtifact,
        targetGit: { ...baselineArtifact.targetGit, sha: "target-a" },
      });
      writeJson(candidatePath, {
        ...candidateArtifact,
        targetGit: { ...candidateArtifact.targetGit, sha: "target-b" },
      });
      const cleanTargetComparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: baselinePath,
        candidateSuitePath: candidatePath,
        outputDir,
      });
      expect(cleanTargetComparison.repositoryOnly).toBe(true);
      expect(cleanTargetComparison.warnings.join("\n")).toContain("targetGit");
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("keeps full status cells while excluding one-sided and unknown metric cohorts", async () => {
    const entries: AgentEvalSuiteWorkload[] = [
      {
        id: "stable-a",
        path: "eval/agentic/workloads/stable-a.md",
        safety: "stable",
        suites: ["stable-full"],
      },
      {
        id: "stable-b",
        path: "eval/agentic/workloads/stable-b.md",
        safety: "stable",
        suites: ["stable-full"],
      },
    ];
    const baseline = createPairExecutionFixture(entries);
    const candidate = createPairExecutionFixture(entries);
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-cohort-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-cohort-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-cohort-output-"));
    try {
      await generatePairSuite(baseline, baselineOutDir);
      await generatePairSuite(
        candidate,
        candidateOutDir,
        (record, options) =>
          options.profile === "descriptors" && record.workloadId === "stable-a"
            ? {
                ...record,
                usage: unknownAgentUsage("codex", LUNA_MODEL, "unknown"),
              }
            : record,
        (workload, options) =>
          !(options.profile === "full" && workload.id === "stable-b"),
      );
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      const missingCell = comparison.cells.find(
        (cell) => cell.id === "full/stable-b",
      );
      expect(missingCell).toMatchObject({
        beforeStatus: "success",
        afterStatus: "missing",
        compatibility: "missing",
      });
      const unknownCell = comparison.cells.find(
        (cell) => cell.id === "discovery/stable-a",
      );
      expect(unknownCell?.tokens.uncachedInputTokens?.change).toBe("unknown");
      expect(comparison.aggregates.durationMs.includedCellIds).toEqual([
        "discovery/stable-a",
        "discovery/stable-b",
        "full/stable-a",
      ]);
      expect(
        comparison.aggregates.tokens.uncachedInputTokens.excludedCellIds,
      ).toEqual(["discovery/stable-a", "full/stable-b"]);
      expect(comparison.cells).toHaveLength(4);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("reports per-tool additions, removals, status changes, surface moves, and sequence changes", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-tools-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-tools-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-tools-output-"));
    try {
      await generatePairSuite(baseline, baselineOutDir);
      await generatePairSuite(candidate, candidateOutDir, (record) => ({
        ...record,
        toolCalls: [
          { tool: "search", server: "githits", status: "failed" },
          { tool: "search", server: "githits-cli", status: "completed" },
          { tool: "new_tool", server: "githits", status: "failed" },
        ],
      }));
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      const cell = comparison.cells.find(
        (candidateCell) => candidateCell.id === "discovery/stable-a",
      );
      expect(cell?.toolSequence.changed).toBe(true);
      const deltas = cell?.callsByTool?.deltas ?? [];
      expect(deltas).toEqual([
        {
          surface: "cli",
          tool: "search",
          before: null,
          after: {
            surface: "cli",
            tool: "search",
            total: 1,
            started: 0,
            completed: 1,
            failed: 0,
            unknown: 0,
          },
          delta: {
            total: 1,
            started: 0,
            completed: 1,
            failed: 0,
            unknown: 0,
          },
          percentChange: null,
          change: "added",
        },
        {
          surface: "mcp",
          tool: "new_tool",
          before: null,
          after: {
            surface: "mcp",
            tool: "new_tool",
            total: 1,
            started: 0,
            completed: 0,
            failed: 1,
            unknown: 0,
          },
          delta: {
            total: 1,
            started: 0,
            completed: 0,
            failed: 1,
            unknown: 0,
          },
          percentChange: null,
          change: "added",
        },
        {
          surface: "mcp",
          tool: "search",
          before: {
            surface: "mcp",
            tool: "search",
            total: 1,
            started: 0,
            completed: 1,
            failed: 0,
            unknown: 0,
          },
          after: {
            surface: "mcp",
            tool: "search",
            total: 1,
            started: 0,
            completed: 0,
            failed: 1,
            unknown: 0,
          },
          delta: {
            total: 0,
            started: 0,
            completed: -1,
            failed: 1,
            unknown: 0,
          },
          percentChange: 0,
          change: "changed",
        },
      ]);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("formats comparison identity, aggregates, and cell evidence readably", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-format-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-format-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-format-output-"));
    try {
      await generatePairSuite(baseline, baselineOutDir);
      await generatePairSuite(candidate, candidateOutDir);
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      const formatted = formatComparisonReport(comparison);
      expect(formatted).toContain("dimensions:");
      expect(formatted).toContain("matrix.agent: compatible");
      expect(formatted).toContain("aggregates:");
      expect(formatted).toContain("durationMs: before=");
      expect(formatted).toContain("logicalToolCalls: before=");
      expect(formatted).toContain("tokens.uncachedInputTokens: before=");
      expect(formatted).toContain("costUsd: before=");
      expect(formatted).toContain("callsByTool: before=");
      expect(formatted).toContain(
        "included=2 [discovery/stable-a, full/stable-a]",
      );
      expect(formatted).toContain("cell discovery/stable-a:");
      expect(formatted).toContain("sequence: before=");
      expect(formatted).toContain(
        "processStatus: before=success after=success changed=false",
      );
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("treats inconsistent logical telemetry as unknown in suite and comparison cohorts", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-logical-mismatch-base-"),
    );
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-logical-mismatch-candidate-"),
    );
    const outputDir = mkdtempSync(
      join(tmpdir(), "agent-eval-logical-mismatch-output-"),
    );
    try {
      await generatePairSuite(baseline, baselineOutDir);
      const candidateArtifact = await runAgentEvalSuite({
        suite: "stable-full",
        repoRoot: candidate.root,
        targetRoot: candidate.root,
        outDir: candidateOutDir,
        manifestPath: candidate.manifestPath,
        workloadsDir: candidate.workloadsDir,
        reportingPath: candidate.reportingPath,
        schemaPath: candidate.schemaPath,
        dryRun: true,
        scenarios: ["discovery", "full"],
        shardExecutor: async (options) => {
          writeShardArtifacts(
            options,
            options.workloads.map((workload) =>
              suiteRecord(workload.id, { guidanceProfile: options.profile }),
            ),
          );
          if (options.profile === "descriptors") {
            const metricsPath = join(options.outDir, "metrics.json");
            const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as {
              records: Array<{
                workloadId: string;
                tools: { logicalCallCount: number | null };
              }>;
            };
            const record = metrics.records.find(
              (item) => item.workloadId === "stable-a",
            );
            if (!record) throw new Error("missing mismatch test record");
            record.tools.logicalCallCount = 99;
            writeJson(metricsPath, metrics);
          }
          return { runDir: options.outDir, status: "success" };
        },
      });
      expect(candidateArtifact.callsByTool).toBeNull();
      expect(candidateArtifact.missingToolTelemetryCellIds).toEqual([
        "discovery/stable-a",
      ]);

      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      const descriptorCell = comparison.cells.find(
        (cell) => cell.id === "discovery/stable-a",
      );
      expect(descriptorCell?.callsByTool).toMatchObject({
        before: expect.any(Array),
        after: null,
        deltas: null,
      });
      expect(comparison.aggregates.callsByTool.includedCellIds).toEqual([
        "full/stable-a",
      ]);
      expect(comparison.aggregates.callsByTool.excludedCellIds).toEqual([
        "discovery/stable-a",
      ]);
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("marks zero-baseline numeric changes added with no percentage", async () => {
    const baseline = createPairExecutionFixture();
    const candidate = createPairExecutionFixture();
    const baselineOutDir = mkdtempSync(join(tmpdir(), "agent-eval-zero-base-"));
    const candidateOutDir = mkdtempSync(
      join(tmpdir(), "agent-eval-zero-candidate-"),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "agent-eval-zero-output-"));
    try {
      await generatePairSuite(baseline, baselineOutDir, (record) => ({
        ...record,
        durationMs: 0,
      }));
      await generatePairSuite(candidate, candidateOutDir, (record) => ({
        ...record,
        durationMs: 10,
      }));
      const comparison = compareAgentEvalSuitesOffline({
        baselineSuitePath: join(baselineOutDir, "suite.json"),
        candidateSuitePath: join(candidateOutDir, "suite.json"),
        outputDir,
      });
      expect(comparison.cells[0]?.durationMs).toMatchObject({
        before: 0,
        after: 10,
        delta: 10,
        percentChange: null,
        change: "added",
      });
      expect(comparison.aggregates.durationMs.change).toBe("added");
      expect(comparison.aggregates.durationMs.percentChange).toBeNull();
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(candidate.root, { recursive: true, force: true });
      rmSync(baselineOutDir, { recursive: true, force: true });
      rmSync(candidateOutDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
