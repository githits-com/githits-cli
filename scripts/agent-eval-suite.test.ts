import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
  type AgentEvalSuiteArtifact,
  type AgentEvalSuiteManifest,
  type AgentEvalSuiteShardOptions,
  type AgentEvalSuiteWorkload,
  agentEvalSuiteArtifactSchema,
  formatSuiteReport,
  loadSuiteManifest,
  parseSuiteArtifact,
  runAgentEvalSuite,
  selectSuiteWorkloads,
  validateSuiteManifest,
} from "./agent-eval-suite.ts";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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
  writeJson(
    join(options.outDir, "metrics.json"),
    buildAgentEvalMetrics({
      runId: runMetadata.runId,
      startedAt: runMetadata.startedAt,
      completedAt: runMetadata.completedAt,
      records,
    }),
  );
  writeJson(
    join(options.outDir, "report.json"),
    buildRunReportFromMetadata(options.outDir, runMetadata),
  );
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

  it("runs the fixed two-profile matrix concurrently with workloads in order", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "stable-z",
        path: "eval/agentic/workloads/stable-z.md",
        safety: "stable",
        suites: ["stable-full"],
      },
      {
        id: "stable-a",
        path: "eval/agentic/workloads/stable-a.md",
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
        shardExecutor: async (options) => {
          starts.push(options.profile);
          if (starts.length === 2) notifyStarts();
          await barrier;
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: options.outDir };
        },
      });
      await startsReady;
      expect(starts).toEqual(["descriptors", "full"]);
      release();
      const artifact = await artifactPromise;
      expect(artifact.matrix.agent).toBe(AGENT_EVAL_SUITE_MATRIX.agent);
      expect(artifact.matrix.model).toBe(AGENT_EVAL_SUITE_MATRIX.model);
      expect(artifact.matrix.reasoningEffort).toBe(
        AGENT_EVAL_SUITE_MATRIX.reasoningEffort,
      );
      expect([...artifact.matrix.profiles]).toEqual([
        ...AGENT_EVAL_SUITE_MATRIX.profiles,
      ]);
      expect(artifact.selectedWorkloads.map((workload) => workload.id)).toEqual(
        ["stable-a", "stable-z"],
      );
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
            return undefined;
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
          return { runDir: options.outDir };
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
          return { runDir: options.outDir };
        },
      });
      expect(flags).toEqual([true, true]);
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
              return undefined;
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
          return { runDir: options.outDir };
        },
      });
      const loaded = parseSuiteArtifact(
        JSON.parse(readFileSync(join(outDir, "suite.json"), "utf8")),
      );
      expect(agentEvalSuiteArtifactSchema.parse(loaded)).toEqual(artifact);
      expect(artifact.status).toBe("dry-run");
      expect(artifact.shards).toEqual([
        {
          profile: "descriptors",
          status: "success",
          error: null,
          runPath: "shards/descriptors/run.json",
          metricsPath: "shards/descriptors/metrics.json",
          reportPath: "shards/descriptors/report.json",
        },
        {
          profile: "full",
          status: "success",
          error: null,
          runPath: "shards/full/run.json",
          metricsPath: "shards/full/metrics.json",
          reportPath: "shards/full/report.json",
        },
      ]);
      expect(formatSuiteReport(artifact)).toContain("callsByTool=");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("keeps a successful sibling when one profile shard is rejected", async () => {
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
        shardExecutor: async (options) => {
          if (options.profile === "full") throw new Error("full setup failed");
          writeShardArtifacts(
            options,
            options.workloads.map((workload) => suiteRecord(workload.id)),
          );
          return { runDir: options.outDir };
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
          return { runDir: options.outDir };
        },
      });
      expect(artifact.totals.failedExecutions).toBe(1);
      expect(artifact.totals.missingExecutions).toBe(1);
      expect(artifact.totals.successfulExecutions).toBe(2);
      expect(artifact.totals.failedWorkloadCount).toBe(1);
      expect(artifact.totals.missingWorkloadCount).toBe(1);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("hashes exact bytes in stable order and isolates target guidance identity", async () => {
    const fixture = createSuiteExecutionFixture([
      {
        id: "stable-z",
        path: "eval/agentic/workloads/stable-z.md",
        safety: "stable",
        suites: ["stable-full"],
      },
      {
        id: "stable-a",
        path: "eval/agentic/workloads/stable-a.md",
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
        shardExecutor: async () => undefined,
      });
    try {
      const first = await executeWithoutChildren(
        fixture.targetRoot,
        firstOutDir,
      );
      const second = await executeWithoutChildren(targetRootB, secondOutDir);
      expect(first.contentIdentity.workloads.map((item) => item.path)).toEqual([
        "eval/agentic/workloads/stable-a.md",
        "eval/agentic/workloads/stable-z.md",
      ]);
      const workloadBytes = readFileSync(
        join(fixture.root, "eval/agentic/workloads/stable-a.md"),
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
          return { runDir: options.outDir };
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
          return { runDir: options.outDir };
        },
      });
      expect(artifact.callsByTool).toBeNull();
      expect(artifact.missingToolTelemetryCellIds).toEqual([
        "descriptors/stable-a",
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
  });
});
