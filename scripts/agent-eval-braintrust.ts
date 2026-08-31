import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { AgentEvalRecord } from "./agent-eval-metrics.ts";
import {
  type AgentEvalReport,
  isContainedRelativePath,
  type WorkloadReport,
} from "./agent-eval-report.ts";
import {
  type AgentEvalImportedSuite,
  type AgentEvalSuiteScenario,
  loadImportedSuite,
} from "./agent-eval-suite.ts";

export interface BraintrustSuiteInput {
  label: string;
  suitePath: string;
}

export interface BraintrustRowInput {
  scenario: AgentEvalSuiteScenario;
  workloadId: string;
  workloadPath: string;
  prompt: string;
  promptSha256: string;
}

export interface BraintrustRowOutput {
  cellStatus: string;
  processStatus: string;
  reportStatus: string;
  finalStatus?: string;
  answer?: string;
  confidence?: string;
  discovery?: string;
}

export interface BraintrustRowMetrics {
  [key: string]: unknown;
  agent_duration_ms?: number;
  logical_tool_calls?: number;
  mcp_tool_calls?: number;
  cli_tool_calls?: number;
  tool_calls_started?: number;
  tool_calls_completed?: number;
  tool_calls_failed?: number;
  tool_calls_unknown?: number;
  raw_tool_events?: number;
  uncached_input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  estimated_cost_usd?: number;
}

export interface BraintrustGitIdentity {
  branch: string | null;
  sha: string | null;
  dirty: boolean | null;
}

export interface BraintrustToolStatusCounts {
  started: number;
  completed: number;
  failed: number;
  unknown: number;
}

export interface BraintrustToolCount {
  surface: "mcp" | "cli";
  tool: string;
  total: number;
  statusCounts: BraintrustToolStatusCounts;
}

export interface BraintrustRateSnapshot {
  model: string;
  currency: string;
  unit: string;
  effectiveDate: string;
  source: string;
  rates: {
    uncachedInputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    cacheWriteInputUsdPerMillion: number;
    outputUsdPerMillion: number;
  };
}

export interface BraintrustToolSequenceEntry {
  tool: string;
  surface: "mcp" | "cli";
  status: "started" | "completed" | "failed" | "unknown";
}

export interface BraintrustRowMetadata {
  [key: string]: unknown;
  suiteLabel: string;
  suiteId: string;
  suiteName: string;
  suiteSha256: string;
  cellId: string;
  runId: string;
  scenario: AgentEvalSuiteScenario;
  workloadId: string;
  guidanceProfile: string;
  intentProfile: string;
  intentFragmentHash: string | null;
  agent: string;
  requestedModel: string | null;
  resolvedModel: string | null;
  reasoningEffort: string | null;
  agentVersion: string | null;
  surface: string;
  server: string;
  experimentalTools: boolean;
  targetGit: BraintrustGitIdentity;
  measurementGit: BraintrustGitIdentity;
  reportSchemaVersion: number;
  metricsSchemaVersion: number;
  reportingContractSha256: string;
  resultSchemaSha256: string;
  costKind: string;
  costUncertainty: string;
  rateSnapshot?: BraintrustRateSnapshot;
  warnings: string[];
  validationCategories: string[];
  toolTelemetryKnown: boolean;
  toolSequence?: BraintrustToolSequenceEntry[];
  toolCounts?: BraintrustToolCount[];
}

export interface BraintrustRow {
  input: BraintrustRowInput;
  output: BraintrustRowOutput;
  metrics: BraintrustRowMetrics;
  metadata: BraintrustRowMetadata;
  tags: string[];
  error?: string;
}

export interface BraintrustSuiteSummary {
  label: string;
  suiteId: string;
  suiteName: string;
  suiteSha256: string;
  scenarioCount: number;
  workloadCount: number;
}

export interface BraintrustMappingResult {
  rows: BraintrustRow[];
  suites: BraintrustSuiteSummary[];
}

export interface BraintrustExportOptions {
  project: string;
  experiment: string;
  source: "local" | "github";
  githubRunId?: string;
  githubRunAttempt?: string;
  githubRunUrl?: string;
}

export interface BraintrustRowEvent {
  input: BraintrustRowInput;
  output: BraintrustRowOutput;
  error?: string;
  metrics: BraintrustRowMetrics;
  metadata: BraintrustRowMetadata;
  tags: string[];
}

export interface BraintrustExperimentMetadata {
  [key: string]: unknown;
  source: BraintrustExportOptions["source"];
  githubRunId?: string;
  githubRunAttempt?: string;
  githubRunUrl?: string;
  suites: BraintrustSuiteSummary[];
  targetGit: BraintrustGitIdentity;
  measurementGit: BraintrustGitIdentity;
  suiteSchemaVersion: number;
  reportSchemaVersion: number;
  metricsSchemaVersion: number;
  exporterSchemaVersion: number;
  exporterVersion: string;
}

export interface BraintrustExperimentInit {
  project: string;
  experiment: string;
  update: false;
  metadata: BraintrustExperimentMetadata;
  repoInfo: {
    commit: string | null;
    branch: string | null;
    dirty: boolean | null;
  };
  gitMetadataSettings: {
    collect: "none";
  };
}

export interface BraintrustStartSpanArgs {
  name: string;
  type: "eval";
  event: BraintrustRowEvent;
}

export interface BraintrustSpan {
  end(): void | Promise<void>;
}

export interface BraintrustPublisher {
  startSpan(args: BraintrustStartSpanArgs): BraintrustSpan;
  flush(): Promise<void>;
  permalink(): Promise<string | undefined>;
}

export interface BraintrustExportResult {
  project: string;
  experiment: string;
  url?: string;
  exportedRowCount: number;
}

export interface BraintrustSdkSpan {
  end(): void | number;
}

export interface BraintrustSdkExperiment {
  startSpan(args: BraintrustStartSpanArgs): BraintrustSdkSpan;
  flush(): Promise<void>;
  summarize(options: { summarizeScores: false }): Promise<{
    experimentUrl?: string;
  }>;
}

export interface BraintrustSdk {
  initExperiment(
    project: string,
    options: Omit<BraintrustExperimentInit, "project">,
  ): BraintrustSdkExperiment;
}

const BRAINTRUST_SUITE_SCHEMA_VERSION = 3;
const BRAINTRUST_EXPORTER_SCHEMA_VERSION = 1;
const BRAINTRUST_EXPORTER_VERSION = "1";

interface LoadedBraintrustSuite {
  input: BraintrustSuiteInput;
  suite: AgentEvalImportedSuite;
}

interface SuiteIdentity {
  targetSha: string | null;
  measurementSha: string | null;
  agent: string;
  model: string;
  reasoningEffort: string;
  surface: string;
  server: string;
  reportingContractSha256: string;
  resultSchemaSha256: string;
}

interface PromptArtifact {
  value: string;
  sha256: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Braintrust preflight: ${message}`);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeWarning(value: string): string {
  return value
    .trim()
    .replace(
      /(?:^|[\s:(])\/(?!\/)[^,\s)]+|(?:\/Users\/|\/private\/|\/tmp\/|\/var\/|\/home\/|[A-Za-z]:[\\/])[^,\s)]+/g,
      (match) =>
        match.startsWith("/") ||
        match.startsWith("\\") ||
        /^[A-Za-z]:[\\/]/.test(match)
          ? "<path>"
          : `${match[0]}<path>`,
    );
}

function normalizeSuiteWarning(value: string): string {
  const shardFailure = value.match(/^(.+ shard failed):/);
  return normalizeWarning(shardFailure ? shardFailure[1]! : value);
}

function suiteIdentity(suite: AgentEvalImportedSuite): SuiteIdentity {
  const { artifact } = suite;
  return {
    targetSha: artifact.targetGit.sha,
    measurementSha: artifact.measurementGit.sha,
    agent: artifact.matrix.agent,
    model: artifact.matrix.model,
    reasoningEffort: artifact.matrix.reasoningEffort,
    surface: artifact.matrix.surface,
    server: artifact.matrix.server,
    reportingContractSha256: artifact.contentIdentity.reportingContract.sha256,
    resultSchemaSha256: artifact.contentIdentity.resultSchema.sha256,
  };
}

function assertSameIdentity(
  expected: SuiteIdentity,
  actual: SuiteIdentity,
): void {
  for (const field of [
    "targetSha",
    "measurementSha",
    "agent",
    "model",
    "reasoningEffort",
    "surface",
    "server",
    "reportingContractSha256",
    "resultSchemaSha256",
  ] as const) {
    assert(
      expected[field] === actual[field],
      `mixed ${field} across suite inputs`,
    );
  }
}

function reportWorkloadFor(
  suite: AgentEvalImportedSuite,
  scenario: AgentEvalSuiteScenario,
  workloadId: string,
): {
  record: AgentEvalRecord;
  report: AgentEvalReport;
  workload: WorkloadReport;
} {
  const shard = suite.shards[scenario];
  assert(shard, `missing ${scenario} child shard`);
  assert(shard.metrics, `missing ${scenario} child metrics evidence`);
  assert(shard.report, `missing ${scenario} child report evidence`);
  const record = shard.metrics.records.find(
    (candidate) => candidate.workloadId === workloadId,
  );
  assert(record, `missing ${scenario}/${workloadId} metrics record`);
  const workload = shard.report.workloads.find(
    (candidate) => candidate.id === workloadId,
  );
  assert(workload, `missing ${scenario}/${workloadId} report workload`);
  return { record, report: shard.report, workload };
}

function readPromptArtifact(
  report: AgentEvalReport,
  workload: WorkloadReport,
): PromptArtifact {
  const reference = workload.artifacts.prompt;
  assert(
    typeof reference === "string" &&
      reference.length > 0 &&
      !reference.includes("\\") &&
      isContainedRelativePath(reference),
    "prompt artifact reference is missing or unsafe",
  );
  assert(
    typeof report.runDir === "string" && report.runDir.length > 0,
    "child report run directory is missing",
  );
  try {
    const runDir = realpathSync(resolve(report.runDir));
    const candidate = resolve(runDir, reference);
    assert(
      existsSync(candidate) && statSync(candidate).isFile(),
      "prompt artifact is unreadable",
    );
    const promptPath = realpathSync(candidate);
    const candidateRelative = relative(runDir, promptPath).replaceAll(
      "\\",
      "/",
    );
    assert(
      isContainedRelativePath(candidateRelative),
      "prompt artifact escapes child run directory",
    );
    const bytes = readFileSync(promptPath);
    return {
      value: bytes.toString("utf8"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Braintrust preflight:")
    )
      throw error;
    throw new Error(
      "Braintrust preflight: prompt artifact is missing or unreadable",
    );
  }
}

function toolTelemetry(
  record: AgentEvalRecord,
  workload: WorkloadReport,
): {
  known: boolean;
  sequence: BraintrustToolSequenceEntry[];
  counts: BraintrustToolCount[];
  tags: string[];
  statusCounts: BraintrustToolStatusCounts;
  mcpCalls: number;
  cliCalls: number;
} {
  const sequence = record.tools.sequence;
  const known =
    workload.metrics.callsByTool !== null &&
    record.tools.logicalCallCount !== null &&
    record.tools.logicalCallCount === sequence.length;
  if (!known) {
    return {
      known: false,
      sequence: [],
      counts: [],
      tags: [],
      statusCounts: { started: 0, completed: 0, failed: 0, unknown: 0 },
      mcpCalls: 0,
      cliCalls: 0,
    };
  }
  const statusCounts: BraintrustToolStatusCounts = {
    started: sequence.filter((call) => call.status === "started").length,
    completed: sequence.filter((call) => call.status === "completed").length,
    failed: sequence.filter((call) => call.status === "failed").length,
    unknown: sequence.filter((call) => call.status === "unknown").length,
  };
  const counts = workload.metrics.callsByTool
    ? workload.metrics.callsByTool
        .filter((entry) => entry.total > 0)
        .map((entry) => ({
          surface: entry.surface,
          tool: entry.tool,
          total: entry.total,
          statusCounts: {
            started: entry.started,
            completed: entry.completed,
            failed: entry.failed,
            unknown: entry.unknown,
          },
        }))
        .sort(
          (left, right) =>
            compareStrings(left.surface, right.surface) ||
            compareStrings(left.tool, right.tool),
        )
    : [];
  return {
    known: true,
    sequence: sequence.map((call) => ({
      tool: call.tool,
      surface: call.surface,
      status: call.status,
    })),
    counts,
    tags: counts.map((entry) => `tool:${entry.surface}:${entry.tool}`),
    statusCounts,
    mcpCalls: sequence.filter((call) => call.surface === "mcp").length,
    cliCalls: sequence.filter((call) => call.surface === "cli").length,
  };
}

function knownMetric(
  target: BraintrustRowMetrics,
  key: keyof BraintrustRowMetrics,
  value: number | null | undefined,
): void {
  if (value !== null && value !== undefined) target[key] = value;
}

function rowMetrics(
  record: AgentEvalRecord,
  telemetry: ReturnType<typeof toolTelemetry>,
): BraintrustRowMetrics {
  const metrics: BraintrustRowMetrics = {};
  knownMetric(metrics, "agent_duration_ms", record.durationMs);
  knownMetric(metrics, "raw_tool_events", record.tools.rawEventCount);
  const tokens = record.usage.normalizedTokens;
  knownMetric(metrics, "uncached_input_tokens", tokens.uncachedInputTokens);
  knownMetric(metrics, "cached_input_tokens", tokens.cachedInputTokens);
  knownMetric(
    metrics,
    "cache_write_input_tokens",
    tokens.cacheWriteInputTokens,
  );
  knownMetric(metrics, "output_tokens", tokens.outputTokens);
  knownMetric(metrics, "reasoning_output_tokens", tokens.reasoningOutputTokens);
  knownMetric(metrics, "estimated_cost_usd", record.usage.cost.usd);
  if (telemetry.known) {
    knownMetric(metrics, "logical_tool_calls", record.tools.logicalCallCount);
    knownMetric(metrics, "mcp_tool_calls", telemetry.mcpCalls);
    knownMetric(metrics, "cli_tool_calls", telemetry.cliCalls);
    knownMetric(metrics, "tool_calls_started", telemetry.statusCounts.started);
    knownMetric(
      metrics,
      "tool_calls_completed",
      telemetry.statusCounts.completed,
    );
    knownMetric(metrics, "tool_calls_failed", telemetry.statusCounts.failed);
    knownMetric(metrics, "tool_calls_unknown", telemetry.statusCounts.unknown);
  }
  return metrics;
}

function rowMetadata(
  input: BraintrustSuiteInput,
  suite: AgentEvalImportedSuite,
  scenario: AgentEvalSuiteScenario,
  workloadId: string,
  cellId: string,
  record: AgentEvalRecord,
  report: AgentEvalReport,
  workload: WorkloadReport,
  telemetry: ReturnType<typeof toolTelemetry>,
): BraintrustRowMetadata {
  const cost = record.usage.cost;
  const warnings = uniqueSorted(
    [
      ...suite.artifact.warnings.map(normalizeSuiteWarning),
      ...report.metricsWarnings,
      ...report.warnings,
      ...record.warnings,
      ...workload.metrics.telemetryWarnings,
      ...workload.warnings,
    ]
      .map(normalizeWarning)
      .filter((warning) => warning.length > 0),
  );
  const validationCategories = uniqueSorted(
    workload.validationViolations.map((violation) => violation.category),
  );
  return {
    suiteLabel: input.label,
    suiteId: suite.artifact.suiteId,
    suiteName: suite.artifact.suiteName,
    suiteSha256: suite.sha256,
    cellId,
    runId: suite.shards[scenario]?.metrics?.runId ?? "unknown",
    scenario,
    workloadId,
    guidanceProfile: record.guidanceProfile ?? "unknown",
    intentProfile: record.intentProfile,
    intentFragmentHash: record.intentFragmentHash,
    agent: record.agent,
    requestedModel: record.requestedModel,
    resolvedModel: record.resolvedModel,
    reasoningEffort: record.reasoningEffort,
    agentVersion: record.agentVersion,
    surface: record.surface,
    server: record.server,
    experimentalTools: record.experimentalTools,
    targetGit: {
      branch: suite.artifact.targetGit.branch,
      sha: suite.artifact.targetGit.sha,
      dirty: suite.artifact.targetGit.dirty,
    },
    measurementGit: {
      branch: suite.artifact.measurementGit.branch,
      sha: suite.artifact.measurementGit.sha,
      dirty: suite.artifact.measurementGit.dirty,
    },
    reportSchemaVersion: report.schemaVersion,
    metricsSchemaVersion: suite.shards[scenario]?.metrics?.schemaVersion ?? 0,
    reportingContractSha256:
      suite.artifact.contentIdentity.reportingContract.sha256,
    resultSchemaSha256: suite.artifact.contentIdentity.resultSchema.sha256,
    costKind: cost.kind,
    costUncertainty: cost.uncertainty,
    ...(cost.kind === "base_rate_estimate"
      ? { rateSnapshot: cost.rateSnapshot }
      : {}),
    warnings,
    validationCategories,
    toolTelemetryKnown: telemetry.known,
    ...(telemetry.known
      ? { toolSequence: telemetry.sequence, toolCounts: telemetry.counts }
      : {}),
  };
}

function mapCell(
  input: BraintrustSuiteInput,
  suite: AgentEvalImportedSuite,
  cell: AgentEvalImportedSuite["artifact"]["cells"][number],
): BraintrustRow {
  const { record, report, workload } = reportWorkloadFor(
    suite,
    cell.scenario,
    cell.workloadId,
  );
  assert(
    isContainedRelativePath(cell.workloadPath) &&
      !cell.workloadPath.includes("\\"),
    `workload path is not a safe relative path: ${cell.workloadId}`,
  );
  assert(
    record.agent === suite.artifact.matrix.agent &&
      record.requestedModel === suite.artifact.matrix.model &&
      record.reasoningEffort === suite.artifact.matrix.reasoningEffort &&
      record.surface === suite.artifact.matrix.surface &&
      record.server === suite.artifact.matrix.server,
    `mixed agent/model/reasoning/surface/server identity in ${cell.id}`,
  );
  const prompt = readPromptArtifact(report, workload);
  const telemetry = toolTelemetry(record, workload);
  const final = workload.finalReport;
  const finalStatus = record.finalStatus ?? final?.status;
  const output: BraintrustRowOutput = {
    cellStatus: cell.status,
    processStatus: record.processStatus,
    reportStatus: workload.status,
    ...(finalStatus ? { finalStatus } : {}),
    ...(final?.answer !== undefined ? { answer: final.answer } : {}),
    ...(final?.confidence !== undefined
      ? { confidence: final.confidence }
      : {}),
    ...(workload.discovery ? { discovery: workload.discovery.status } : {}),
  };
  const status =
    cell.status !== "success"
      ? cell.status
      : record.processStatus !== "success"
        ? record.processStatus
        : workload.status !== "success"
          ? workload.status
          : finalStatus && finalStatus !== "success"
            ? finalStatus
            : undefined;
  return {
    input: {
      scenario: cell.scenario,
      workloadId: cell.workloadId,
      workloadPath: cell.workloadPath,
      prompt: prompt.value,
      promptSha256: prompt.sha256,
    },
    output,
    metrics: rowMetrics(record, telemetry),
    metadata: rowMetadata(
      input,
      suite,
      cell.scenario,
      cell.workloadId,
      cell.id,
      record,
      report,
      workload,
      telemetry,
    ),
    tags: telemetry.tags,
    ...(status ? { error: `eval_status:${status}` } : {}),
  };
}

function preflightSuite(
  loaded: LoadedBraintrustSuite,
  expectedIdentity: SuiteIdentity,
  seenCells: Set<string>,
): void {
  const { input, suite } = loaded;
  assert(
    !suite.artifact.dryRun && suite.artifact.status !== "dry-run",
    `suite ${input.label} is a dry-run`,
  );
  assertSameIdentity(expectedIdentity, suiteIdentity(suite));
  for (const cell of suite.artifact.cells) {
    const key = `${cell.scenario}\0${cell.workloadId}`;
    assert(
      !seenCells.has(key),
      `duplicate scenario/workload cell: ${key.replace("\0", "/")}`,
    );
    seenCells.add(key);
  }
}

export function preflightAndMapBraintrustRows(
  inputs: readonly BraintrustSuiteInput[],
): BraintrustMappingResult {
  assert(inputs.length > 0, "at least one suite input is required");
  const labels = new Set<string>();
  const loaded = inputs.map((input) => {
    assert(input.label.length > 0, "suite labels must not be empty");
    assert(!labels.has(input.label), `duplicate suite label: ${input.label}`);
    labels.add(input.label);
    return { input, suite: loadImportedSuite(input.suitePath) };
  });
  const expectedIdentity = suiteIdentity(loaded[0]!.suite);
  const seenCells = new Set<string>();
  for (const item of loaded) preflightSuite(item, expectedIdentity, seenCells);

  const rows = loaded.flatMap(({ input, suite }) =>
    suite.artifact.cells.map((cell) => mapCell(input, suite, cell)),
  );
  rows.sort(
    (left, right) =>
      compareStrings(left.metadata.suiteLabel, right.metadata.suiteLabel) ||
      compareStrings(left.input.scenario, right.input.scenario) ||
      compareStrings(left.input.workloadId, right.input.workloadId),
  );
  return {
    rows,
    suites: loaded
      .map(({ input, suite }) => ({
        label: input.label,
        suiteId: suite.artifact.suiteId,
        suiteName: suite.artifact.suiteName,
        suiteSha256: suite.sha256,
        scenarioCount: suite.artifact.matrix.scenarios.length,
        workloadCount: suite.artifact.selectedWorkloads.length,
      }))
      .sort((left, right) => compareStrings(left.label, right.label)),
  };
}

function rowEvent(row: BraintrustRow): BraintrustRowEvent {
  return {
    input: row.input,
    output: row.output,
    ...(row.error ? { error: row.error } : {}),
    metrics: row.metrics,
    metadata: row.metadata,
    tags: row.tags,
  };
}

export function buildBraintrustExperimentInit(
  mapping: BraintrustMappingResult,
  options: BraintrustExportOptions,
): BraintrustExperimentInit {
  const firstRow = mapping.rows[0];
  assert(firstRow, "cannot build experiment metadata without mapped rows");
  const { metadata } = firstRow;
  const experimentMetadata: BraintrustExperimentMetadata = {
    source: options.source,
    ...(options.githubRunId !== undefined
      ? { githubRunId: options.githubRunId }
      : {}),
    ...(options.githubRunAttempt !== undefined
      ? { githubRunAttempt: options.githubRunAttempt }
      : {}),
    ...(options.githubRunUrl !== undefined
      ? { githubRunUrl: options.githubRunUrl }
      : {}),
    suites: mapping.suites,
    targetGit: metadata.targetGit,
    measurementGit: metadata.measurementGit,
    suiteSchemaVersion: BRAINTRUST_SUITE_SCHEMA_VERSION,
    reportSchemaVersion: metadata.reportSchemaVersion,
    metricsSchemaVersion: metadata.metricsSchemaVersion,
    exporterSchemaVersion: BRAINTRUST_EXPORTER_SCHEMA_VERSION,
    exporterVersion: BRAINTRUST_EXPORTER_VERSION,
  };
  return {
    project: options.project,
    experiment: options.experiment,
    update: false,
    metadata: experimentMetadata,
    repoInfo: {
      commit: metadata.targetGit.sha,
      branch: metadata.targetGit.branch,
      dirty: metadata.targetGit.dirty,
    },
    gitMetadataSettings: { collect: "none" },
  };
}

export async function createBraintrustPublisher(
  init: BraintrustExperimentInit,
  injectedSdk?: BraintrustSdk,
): Promise<BraintrustPublisher> {
  const sdkOptions: Omit<BraintrustExperimentInit, "project"> = {
    experiment: init.experiment,
    update: init.update,
    metadata: init.metadata,
    repoInfo: init.repoInfo,
    gitMetadataSettings: init.gitMetadataSettings,
  };
  let experiment: BraintrustSdkExperiment;
  if (injectedSdk) {
    experiment = injectedSdk.initExperiment(init.project, sdkOptions);
  } else {
    const braintrust = await import("braintrust");
    experiment = braintrust.initExperiment(init.project, sdkOptions);
  }
  return {
    startSpan(args): BraintrustSpan {
      const span = experiment.startSpan(args);
      return {
        end: () => {
          span.end();
        },
      };
    },
    flush: () => experiment.flush(),
    permalink: async () =>
      (await experiment.summarize({ summarizeScores: false })).experimentUrl,
  };
}

export async function publishBraintrustRows(
  mapping: BraintrustMappingResult,
  options: BraintrustExportOptions,
  publisherFactory: (
    init: BraintrustExperimentInit,
  ) =>
    | BraintrustPublisher
    | Promise<BraintrustPublisher> = createBraintrustPublisher,
): Promise<BraintrustExportResult> {
  const init = buildBraintrustExperimentInit(mapping, options);
  const publisher = await publisherFactory(init);
  for (const row of mapping.rows) {
    const span = publisher.startSpan({
      name: row.metadata.cellId,
      type: "eval",
      event: rowEvent(row),
    });
    await span.end();
  }
  await publisher.flush();
  const url = await publisher.permalink();
  return {
    project: options.project,
    experiment: options.experiment,
    ...(url !== undefined ? { url } : {}),
    exportedRowCount: mapping.rows.length,
  };
}
