import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import type {
  AgentEvalMetrics,
  AgentEvalRecord,
} from "./agent-eval-metrics.ts";
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
  duration?: number;
  mcp_tool_calls?: number;
  cli_tool_calls?: number;
  tool_calls_started?: number;
  tool_calls_completed?: number;
  tool_calls_unknown?: number;
  raw_tool_events?: number;
  prompt_tokens?: number;
  prompt_cached_tokens?: number;
  prompt_cache_creation_tokens?: number;
  completion_tokens?: number;
  completion_reasoning_tokens?: number;
  tokens?: number;
  estimated_cost?: number;
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
  startedAt: string | null;
  completedAt: string | null;
}

export interface BraintrustToolSpanEvent {
  input: {
    tool: string;
    surface: "mcp" | "cli";
  };
  output: {
    status: "started" | "completed" | "failed";
  };
  metadata: {
    tool: string;
    surface: "mcp" | "cli";
    timingSource: "harness_stdout_observed";
  };
  metrics?: {
    duration: number;
  };
  error?: "tool_status:failed";
}

export interface BraintrustToolSpanStartArgs {
  name: string;
  type: "tool";
  event: BraintrustToolSpanEvent;
  startTime: number;
}

export interface BraintrustToolSpanDescriptor
  extends BraintrustToolSpanStartArgs {
  endTime?: number;
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
  model: string | null;
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
  toolSpans: BraintrustToolSpanDescriptor[];
  startTime?: number;
  endTime?: number;
  error?: string;
}

export interface BraintrustSuiteSummary {
  label: string;
  suiteId: string;
  suiteName: string;
  suiteSha256: string;
  suiteSchemaVersion: number;
  scenarioCount: number;
  workloadCount: number;
}

export interface BraintrustMappingResult {
  rows: BraintrustRow[];
  suites: BraintrustSuiteSummary[];
}

export interface BraintrustExportOptions {
  project: string;
  experiment?: string;
  source: "local" | "github";
  channel?: "local" | "main" | "pr";
  branch?: string | null;
  sha?: string | null;
  pullRequestNumber?: string;
  baseExperiment?: string;
  baseExperimentId?: string;
  now?: Date;
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
  channel?: "local" | "main" | "pr";
  branch?: string;
  sha?: string;
  pullRequestNumber?: string;
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
  baseExperiment?: string;
  baseExperimentId?: string;
  tags?: string[];
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
  startTime?: number;
}

export interface BraintrustEndSpanArgs {
  endTime?: number;
}

export interface BraintrustSpan {
  startSpan(args: BraintrustToolSpanStartArgs): BraintrustSpan;
  end(args?: BraintrustEndSpanArgs): void | Promise<void>;
}

export interface BraintrustBaseExperiment {
  id: string;
  name: string;
}

function safeBaseExperiment(value: unknown): BraintrustBaseExperiment | null {
  if (value === null) return null;
  assert(
    typeof value === "object" && value !== null,
    "Braintrust base experiment response is invalid",
  );
  const candidate = value as { id?: unknown; name?: unknown };
  assert(
    typeof candidate.id === "string" &&
      candidate.id.length > 0 &&
      typeof candidate.name === "string" &&
      candidate.name.length > 0,
    "Braintrust base experiment response is invalid",
  );
  return { id: candidate.id, name: candidate.name };
}

export interface BraintrustPublisher {
  startSpan(args: BraintrustStartSpanArgs): BraintrustSpan;
  flush(): Promise<void>;
  permalink(): Promise<string | undefined>;
  fetchBaseExperiment(): Promise<BraintrustBaseExperiment | null>;
}

export interface BraintrustExportResult {
  project: string;
  experiment: string;
  url?: string;
  exportedRowCount: number;
  baseExperiment: BraintrustBaseExperiment | null;
}

export interface BraintrustCliOptions extends BraintrustExportOptions {
  suites: BraintrustSuiteInput[];
  resultOut?: string;
  validateOnly: boolean;
}

export interface BraintrustCliResult {
  schemaVersion: 2;
  mode: "validate-only" | "export";
  project: string;
  experiment: string;
  rowCount: number;
  suites: BraintrustSuiteSummary[];
  url?: string;
  baseExperiment: BraintrustBaseExperiment | null;
}

export interface BraintrustCliRuntime {
  now?: () => Date;
  env?: Readonly<Record<string, string | undefined>>;
  publisherFactory?: BraintrustPublisherFactory;
  baseResolver?: (project: string) => Promise<BraintrustBaseExperiment | null>;
  writeFile?: (path: string, contents: string) => void;
  print?: (line: string) => void;
}

export type BraintrustPublisherFactory = (
  init: BraintrustExperimentInit,
) => BraintrustPublisher | Promise<BraintrustPublisher>;

export interface BraintrustSdkSpan {
  startSpan(args: BraintrustToolSpanStartArgs): BraintrustSdkSpan;
  end(args?: BraintrustEndSpanArgs): number;
}

export interface BraintrustSdkExperiment {
  startSpan(args: BraintrustStartSpanArgs): BraintrustSdkSpan;
  flush(): Promise<void>;
  summarize(options: { summarizeScores: false }): Promise<{
    experimentUrl?: string;
  }>;
  fetchBaseExperiment(): Promise<BraintrustBaseExperiment | null>;
}

export interface BraintrustSdkApiConnection {
  get_json(
    objectType: string,
    params?: Record<string, string | string[] | undefined>,
    retries?: number,
  ): Promise<unknown>;
}

export interface BraintrustSdkState {
  apiConn(): BraintrustSdkApiConnection;
}

export interface BraintrustSdk {
  login?(): Promise<BraintrustSdkState>;
  initExperiment(
    project: string,
    options: Omit<BraintrustExperimentInit, "project">,
  ): BraintrustSdkExperiment;
}

const BRAINTRUST_EXPORTER_SCHEMA_VERSION = 2;
const BRAINTRUST_EXPORTER_VERSION = "2";

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

export type BraintrustChannel = "local" | "main" | "pr";

export interface BraintrustExperimentIdentity {
  source: BraintrustExportOptions["source"];
  channel: BraintrustChannel;
  branch: string;
  sha: string;
  pullRequestNumber?: string;
  experiment: string;
  tags: string[];
}

export interface BraintrustIdentityInput {
  source: BraintrustExportOptions["source"];
  channel?: BraintrustChannel;
  branch: string | null | undefined;
  sha: string | null | undefined;
  pullRequestNumber?: string;
  githubRunId?: string;
  githubRunAttempt?: string;
  experiment?: string;
  now?: Date;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Braintrust preflight: ${message}`);
}

function assertNonEmptyIdentity(
  value: string | null | undefined,
  field: string,
): string {
  assert(
    typeof value === "string" && value.trim().length > 0,
    `${field} is required`,
  );
  return value;
}

function assertPositiveInteger(
  value: string | undefined,
  field: string,
): string {
  assert(
    typeof value === "string" && /^[1-9]\d*$/.test(value),
    `${field} must be a positive integer`,
  );
  return value;
}

function branchSlug(branch: string): string {
  const slug = branch.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  assert(
    slug.length > 0,
    "branch must contain an ASCII alphanumeric character",
  );
  return slug.toLowerCase();
}

function buildIdentityTags(identity: {
  source: BraintrustExportOptions["source"];
  channel: BraintrustChannel;
  branch: string;
  sha: string;
  pullRequestNumber?: string;
}): string[] {
  return [
    `source:${identity.source}`,
    `channel:${identity.channel}`,
    `branch:${identity.branch}`,
    `sha:${identity.sha}`,
    ...(identity.pullRequestNumber !== undefined
      ? [`pr:${identity.pullRequestNumber}`]
      : []),
  ];
}

export function buildBraintrustExperimentIdentity(
  input: BraintrustIdentityInput,
): BraintrustExperimentIdentity {
  const channel =
    input.channel ?? (input.source === "local" ? "local" : "main");
  assert(
    (input.source === "local" && channel === "local") ||
      (input.source === "github" && (channel === "main" || channel === "pr")),
    `source ${input.source} is incompatible with channel ${channel}`,
  );
  const branch = assertNonEmptyIdentity(input.branch, "branch");
  const sha = assertNonEmptyIdentity(input.sha, "SHA");

  let experiment: string;
  const identity = {
    source: input.source,
    channel,
    branch,
    sha,
    ...(input.pullRequestNumber !== undefined
      ? { pullRequestNumber: input.pullRequestNumber }
      : {}),
  };
  if (input.source === "github") {
    assert(
      input.experiment === undefined,
      "--experiment is only permitted for local exports",
    );
    const runId = assertPositiveInteger(input.githubRunId, "GitHub run ID");
    const attempt = assertPositiveInteger(
      input.githubRunAttempt,
      "GitHub run attempt",
    );
    if (channel === "main") {
      assert(branch === "main", "GitHub main channel requires branch main");
      assert(
        input.pullRequestNumber === undefined,
        "GitHub main channel must not have a pull-request number",
      );
      experiment = `main-r${runId}-a${attempt}`;
    } else {
      const pullRequestNumber = assertPositiveInteger(
        input.pullRequestNumber,
        "pull-request number",
      );
      experiment = `pr-${pullRequestNumber}-r${runId}-a${attempt}`;
    }
  } else {
    assert(
      input.pullRequestNumber === undefined &&
        input.githubRunId === undefined &&
        input.githubRunAttempt === undefined,
      "GitHub identity fields require source github",
    );
    const now = input.now ?? new Date();
    assert(!Number.isNaN(now.getTime()), "current time is invalid");
    experiment =
      input.experiment ??
      `local-${branchSlug(branch)}-${now
        .toISOString()
        .replace(/[^0-9A-Za-z]/g, "")}-${sha.slice(0, 8)}`;
    assertNonEmptyIdentity(experiment, "experiment");
  }
  return {
    ...identity,
    experiment,
    tags: buildIdentityTags(identity),
  };
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
  const shardFailure = value.match(/^(.+ shard failed):/)?.[1];
  return normalizeWarning(shardFailure ?? value);
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
  metrics: AgentEvalMetrics;
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
  return { metrics: shard.metrics, record, report: shard.report, workload };
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
      startedAt: call.startedAt,
      completedAt: call.completedAt,
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
  knownMetric(
    metrics,
    "duration",
    record.durationMs === null ? null : record.durationMs / 1000,
  );
  knownMetric(metrics, "raw_tool_events", record.tools.rawEventCount);
  const providerUsage = record.usage.providerUsage;
  if (providerUsage) {
    knownMetric(metrics, "prompt_tokens", providerUsage.input_tokens);
    knownMetric(
      metrics,
      "prompt_cached_tokens",
      providerUsage.cached_input_tokens,
    );
    knownMetric(
      metrics,
      "prompt_cache_creation_tokens",
      providerUsage.cache_write_input_tokens,
    );
    knownMetric(metrics, "completion_tokens", providerUsage.output_tokens);
    knownMetric(
      metrics,
      "completion_reasoning_tokens",
      providerUsage.reasoning_output_tokens,
    );
    knownMetric(
      metrics,
      "tokens",
      providerUsage.input_tokens + providerUsage.output_tokens,
    );
  }
  knownMetric(metrics, "estimated_cost", record.usage.cost.usd);
  if (telemetry.known) {
    knownMetric(metrics, "mcp_tool_calls", telemetry.mcpCalls);
    knownMetric(metrics, "cli_tool_calls", telemetry.cliCalls);
    knownMetric(metrics, "tool_calls_started", telemetry.statusCounts.started);
    knownMetric(
      metrics,
      "tool_calls_completed",
      telemetry.statusCounts.completed,
    );
    knownMetric(metrics, "tool_calls_unknown", telemetry.statusCounts.unknown);
  }
  return metrics;
}

function recordedSpanTimes(record: AgentEvalRecord): {
  startTime?: number;
  endTime?: number;
} {
  if (record.startedAt === null || record.completedAt === null) return {};
  const startTime = Date.parse(record.startedAt) / 1000;
  const endTime = Date.parse(record.completedAt) / 1000;
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime < startTime
  ) {
    return {};
  }
  return { startTime, endTime };
}

function observedUnixSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  return milliseconds / 1000;
}

function buildToolSpanDescriptors(
  record: AgentEvalRecord,
  telemetry: ReturnType<typeof toolTelemetry>,
  parentTimes: { startTime?: number; endTime?: number },
  cellId: string,
): BraintrustToolSpanDescriptor[] {
  const withCell = (message: string): string => `${cellId}: ${message}`;
  const toolBearing =
    record.tools.rawEventCount > 0 || telemetry.sequence.length > 0;
  if (!telemetry.known) {
    assert(
      !toolBearing,
      withCell("tool-bearing row has unknown logical telemetry"),
    );
    return [];
  }
  if (telemetry.sequence.length === 0) {
    assert(
      record.tools.rawEventCount === 0,
      withCell("tool-bearing row has empty logical tool sequence"),
    );
    return [];
  }
  assert(
    parentTimes.startTime !== undefined && parentTimes.endTime !== undefined,
    withCell("tool-bearing row has no valid parent span interval"),
  );
  const parentStart = parentTimes.startTime;
  const parentEnd = parentTimes.endTime;

  return telemetry.sequence.map((call, index) => {
    const startTime = observedUnixSeconds(call.startedAt);
    const endTime = observedUnixSeconds(call.completedAt);
    assert(
      call.status !== "unknown",
      withCell(`tool call ${index + 1} has unknown status`),
    );
    assert(
      startTime !== undefined,
      withCell(`tool call ${index + 1} has no valid observed start time`),
    );
    assert(
      startTime >= parentStart && startTime <= parentEnd,
      withCell(
        `tool call ${index + 1} starts outside the parent span interval`,
      ),
    );
    if (call.status === "started") {
      assert(
        call.completedAt === null,
        withCell(`started tool call ${index + 1} has a terminal observed time`),
      );
    } else {
      assert(
        endTime !== undefined,
        withCell(
          `terminal tool call ${index + 1} has no valid observed completion time`,
        ),
      );
      assert(
        endTime >= startTime,
        withCell(`tool call ${index + 1} has a reverse observed interval`),
      );
      assert(
        endTime >= parentStart && endTime <= parentEnd,
        withCell(
          `tool call ${index + 1} ends outside the parent span interval`,
        ),
      );
    }
    const event: BraintrustToolSpanEvent = {
      input: { tool: call.tool, surface: call.surface },
      output: { status: call.status },
      metadata: {
        tool: call.tool,
        surface: call.surface,
        timingSource: "harness_stdout_observed",
      },
      ...(endTime !== undefined
        ? { metrics: { duration: endTime - startTime } }
        : {}),
      ...(call.status === "failed" ? { error: "tool_status:failed" } : {}),
    };
    return {
      name: call.tool,
      type: "tool",
      event,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
    };
  });
}

function rowMetadata(
  input: BraintrustSuiteInput,
  suite: AgentEvalImportedSuite,
  scenario: AgentEvalSuiteScenario,
  workloadId: string,
  cellId: string,
  metrics: AgentEvalMetrics,
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
    runId: metrics.runId,
    scenario,
    workloadId,
    guidanceProfile: record.guidanceProfile ?? "unknown",
    intentProfile: record.intentProfile,
    intentFragmentHash: record.intentFragmentHash,
    agent: record.agent,
    model: record.resolvedModel ?? record.requestedModel,
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
    metricsSchemaVersion: metrics.schemaVersion,
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
  const { metrics, record, report, workload } = reportWorkloadFor(
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
  const spanTimes = recordedSpanTimes(record);
  const toolSpans = buildToolSpanDescriptors(
    record,
    telemetry,
    spanTimes,
    cell.id,
  );
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
      metrics,
      record,
      report,
      workload,
      telemetry,
    ),
    tags: telemetry.tags,
    toolSpans,
    ...spanTimes,
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
  assert(
    suite.artifact.cells.length > 0,
    `suite ${input.label} has no workload cells`,
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
  const firstLoaded = loaded[0];
  assert(firstLoaded, "at least one suite input is required");
  const expectedIdentity = suiteIdentity(firstLoaded.suite);
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
        suiteSchemaVersion: suite.artifact.schemaVersion,
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
  const firstSuite = mapping.suites[0];
  assert(firstSuite, "cannot build experiment metadata without mapped suites");
  const { metadata } = firstRow;
  const branch =
    options.branch !== undefined
      ? options.branch
      : options.source === "github"
        ? null
        : metadata.targetGit.branch;
  const sha = options.sha !== undefined ? options.sha : metadata.targetGit.sha;
  if (options.source === "local") {
    assert(
      options.githubRunId === undefined &&
        options.githubRunAttempt === undefined &&
        options.githubRunUrl === undefined,
      "GitHub run fields require source github",
    );
  }
  const identity = buildBraintrustExperimentIdentity({
    source: options.source,
    channel: options.channel,
    branch,
    sha,
    pullRequestNumber: options.pullRequestNumber,
    githubRunId: options.githubRunId,
    githubRunAttempt: options.githubRunAttempt,
    experiment: options.experiment,
    now: options.now,
  });
  if (options.baseExperiment !== undefined) {
    assert(
      options.source === "local",
      "explicit base experiment is only permitted for local exports",
    );
    assertNonEmptyIdentity(options.baseExperiment, "base experiment");
  }
  if (
    options.baseExperiment === undefined &&
    options.baseExperimentId !== undefined
  ) {
    assertNonEmptyIdentity(options.baseExperimentId, "base experiment ID");
  }
  const experimentMetadata: BraintrustExperimentMetadata = {
    source: identity.source,
    channel: identity.channel,
    branch: identity.branch,
    sha: identity.sha,
    ...(identity.pullRequestNumber !== undefined
      ? { pullRequestNumber: identity.pullRequestNumber }
      : {}),
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
    suiteSchemaVersion: firstSuite.suiteSchemaVersion,
    reportSchemaVersion: metadata.reportSchemaVersion,
    metricsSchemaVersion: metadata.metricsSchemaVersion,
    exporterSchemaVersion: BRAINTRUST_EXPORTER_SCHEMA_VERSION,
    exporterVersion: BRAINTRUST_EXPORTER_VERSION,
  };
  return {
    project: options.project,
    experiment: identity.experiment,
    update: false,
    ...(options.baseExperiment !== undefined
      ? { baseExperiment: options.baseExperiment }
      : {}),
    ...(options.baseExperiment === undefined &&
    options.baseExperimentId !== undefined
      ? { baseExperimentId: options.baseExperimentId }
      : {}),
    tags: identity.tags,
    metadata: experimentMetadata,
    repoInfo: {
      commit: identity.sha,
      branch: identity.branch,
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
    ...(init.baseExperiment !== undefined
      ? { baseExperiment: init.baseExperiment }
      : {}),
    ...(init.baseExperimentId !== undefined
      ? { baseExperimentId: init.baseExperimentId }
      : {}),
    tags: init.tags,
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
  const wrapSpan = (span: BraintrustSdkSpan): BraintrustSpan => ({
    startSpan: (args) => wrapSpan(span.startSpan(args)),
    end: (endArgs) => {
      span.end(endArgs);
    },
  });
  return {
    startSpan(args): BraintrustSpan {
      return wrapSpan(experiment.startSpan(args));
    },
    flush: () => experiment.flush(),
    permalink: async () =>
      (await experiment.summarize({ summarizeScores: false })).experimentUrl,
    fetchBaseExperiment: async () =>
      safeBaseExperiment(await experiment.fetchBaseExperiment()),
  };
}

const BRAINTRUST_EXPERIMENT_PAGE_SIZE = "100";

interface BraintrustListedExperiment {
  id: string;
  name: string;
  metadata?: Record<string, unknown> | null;
}

function listedExperiments(value: unknown): BraintrustListedExperiment[] {
  assert(
    typeof value === "object" && value !== null && "objects" in value,
    "Braintrust experiment list response is invalid",
  );
  const objects = (value as { objects?: unknown }).objects;
  assert(
    Array.isArray(objects),
    "Braintrust experiment list response is invalid",
  );
  return objects.map((candidate) => {
    assert(
      typeof candidate === "object" && candidate !== null,
      "Braintrust experiment list item is invalid",
    );
    const item = candidate as {
      id?: unknown;
      name?: unknown;
      metadata?: unknown;
    };
    assert(
      typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.name === "string",
      "Braintrust experiment list item is invalid",
    );
    return {
      id: item.id,
      name: item.name,
      ...(item.metadata !== undefined
        ? {
            metadata: (item.metadata ?? null) as Record<string, unknown> | null,
          }
        : {}),
    };
  });
}

export async function resolveBraintrustMainExperiment(
  project: string,
  injectedSdk?: BraintrustSdk,
): Promise<BraintrustBaseExperiment | null> {
  const sdk =
    injectedSdk ?? ((await import("braintrust")) as unknown as BraintrustSdk);
  assert(typeof sdk.login === "function", "Braintrust login is unavailable");
  const state = await sdk.login();
  const api = state.apiConn();
  let startingAfter: string | undefined;
  while (true) {
    const page = listedExperiments(
      await api.get_json(
        "v1/experiment",
        {
          project_name: project,
          limit: BRAINTRUST_EXPERIMENT_PAGE_SIZE,
          ...(startingAfter !== undefined
            ? { starting_after: startingAfter }
            : {}),
        },
        0,
      ),
    );
    for (const experiment of page) {
      if (
        experiment.metadata?.channel === "main" &&
        /^main-r\d+-a\d+$/.test(experiment.name)
      ) {
        return safeBaseExperiment(experiment);
      }
    }
    if (page.length < Number(BRAINTRUST_EXPERIMENT_PAGE_SIZE)) return null;
    const final = page[page.length - 1];
    assert(final, "Braintrust experiment list page is empty");
    startingAfter = final.id;
  }
}

export async function publishBraintrustRows(
  mapping: BraintrustMappingResult,
  options: BraintrustExportOptions,
  publisherFactory: BraintrustPublisherFactory = createBraintrustPublisher,
  baseResolver?: (project: string) => Promise<BraintrustBaseExperiment | null>,
): Promise<BraintrustExportResult> {
  let resolvedOptions = options;
  const channel =
    options.channel ?? (options.source === "local" ? "local" : "main");
  if (options.baseExperiment !== undefined) {
    cliAssert(
      options.source === "local",
      "explicit base experiment is only permitted for local exports",
    );
  } else if (
    options.baseExperimentId === undefined &&
    baseResolver !== undefined
  ) {
    const base = safeBaseExperiment(await baseResolver(options.project));
    cliAssert(
      base !== null || channel === "main",
      `no main Braintrust baseline exists for ${channel} export`,
    );
    resolvedOptions = {
      ...options,
      ...(base !== null ? { baseExperimentId: base.id } : {}),
    };
  }
  const init = buildBraintrustExperimentInit(mapping, resolvedOptions);
  const publisher = await publisherFactory(init);
  for (const row of mapping.rows) {
    const span = publisher.startSpan({
      name: row.metadata.cellId,
      type: "eval",
      event: rowEvent(row),
      ...(row.startTime !== undefined ? { startTime: row.startTime } : {}),
    });
    for (const toolSpan of row.toolSpans) {
      const child = span.startSpan({
        name: toolSpan.name,
        type: toolSpan.type,
        event: toolSpan.event,
        startTime: toolSpan.startTime,
      });
      if (toolSpan.endTime !== undefined) {
        await child.end({ endTime: toolSpan.endTime });
      }
    }
    await span.end(
      row.endTime !== undefined ? { endTime: row.endTime } : undefined,
    );
  }
  await publisher.flush();
  const baseExperiment = await publisher.fetchBaseExperiment();
  const url = await publisher.permalink();
  return {
    project: resolvedOptions.project,
    experiment: init.experiment,
    ...(url !== undefined ? { url } : {}),
    exportedRowCount: mapping.rows.length,
    baseExperiment,
  };
}

const DEFAULT_BRAINTRUST_PROJECT = "githits-cli-agent-evals";

function cliAssert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Braintrust CLI: ${message}`);
}

function readCliValue(
  argv: readonly string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const value = argv[index + 1];
  cliAssert(
    value !== undefined && value.trim().length > 0 && !value.startsWith("--"),
    `${flag} requires a value`,
  );
  return { value, nextIndex: index + 1 };
}

function parseSuiteInput(value: string): BraintrustSuiteInput {
  const separator = value.indexOf("=");
  cliAssert(
    separator > 0 && separator < value.length - 1,
    "--suite requires <label>=<suite.json>",
  );
  const label = value.slice(0, separator);
  const suitePath = value.slice(separator + 1);
  cliAssert(label.trim().length > 0, "suite label must not be empty");
  cliAssert(suitePath.trim().length > 0, "suite path must not be empty");
  return { label, suitePath };
}

function validateRunUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Braintrust CLI: --run-url must be an HTTP(S) URL");
  }
  cliAssert(
    url.protocol === "http:" || url.protocol === "https:",
    "--run-url must be an HTTP(S) URL",
  );
}

export function parseBraintrustArgs(
  argv: readonly string[],
  now: Date = new Date(),
): BraintrustCliOptions {
  cliAssert(!Number.isNaN(now.getTime()), "current time is invalid");
  const suites: BraintrustSuiteInput[] = [];
  const seenSuiteLabels = new Set<string>();
  const seenFlags = new Set<string>();
  let project = DEFAULT_BRAINTRUST_PROJECT;
  let experiment: string | undefined;
  let source: BraintrustExportOptions["source"] = "local";
  let channel: BraintrustChannel | undefined;
  let branch: string | null | undefined;
  let pullRequestNumber: string | undefined;
  let baseExperiment: string | undefined;
  let githubRunId: string | undefined;
  let githubRunAttempt: string | undefined;
  let githubRunUrl: string | undefined;
  let resultOut: string | undefined;
  let validateOnly = false;
  let experimentWasExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) {
      cliAssert(false, `unknown argument: ${flag ?? ""}`);
    }
    if (flag === "--validate-only") {
      cliAssert(!seenFlags.has(flag), `duplicate argument: ${flag}`);
      seenFlags.add(flag);
      validateOnly = true;
      continue;
    }

    cliAssert(
      flag === "--suite" ||
        flag === "--project" ||
        flag === "--experiment" ||
        flag === "--source" ||
        flag === "--channel" ||
        flag === "--branch" ||
        flag === "--pr-number" ||
        flag === "--base-experiment" ||
        flag === "--run-id" ||
        flag === "--run-attempt" ||
        flag === "--run-url" ||
        flag === "--result-out",
      `unknown flag: ${flag}`,
    );
    const parsed = readCliValue(argv, index, flag);
    index = parsed.nextIndex;

    if (flag === "--suite") {
      const suite = parseSuiteInput(parsed.value);
      cliAssert(
        !seenSuiteLabels.has(suite.label),
        `duplicate suite label: ${suite.label}`,
      );
      seenSuiteLabels.add(suite.label);
      suites.push(suite);
      continue;
    }

    cliAssert(!seenFlags.has(flag), `duplicate argument: ${flag}`);
    seenFlags.add(flag);
    switch (flag) {
      case "--project":
        project = parsed.value;
        break;
      case "--experiment":
        experiment = parsed.value;
        experimentWasExplicit = true;
        break;
      case "--source":
        cliAssert(
          parsed.value === "local" || parsed.value === "github",
          "--source must be local or github",
        );
        source = parsed.value;
        break;
      case "--channel":
        cliAssert(
          parsed.value === "local" ||
            parsed.value === "main" ||
            parsed.value === "pr",
          "--channel must be local, main, or pr",
        );
        channel = parsed.value;
        break;
      case "--branch":
        branch = parsed.value;
        break;
      case "--pr-number":
        pullRequestNumber = parsed.value;
        break;
      case "--base-experiment":
        baseExperiment = parsed.value;
        break;
      case "--run-id":
        githubRunId = parsed.value;
        break;
      case "--run-attempt":
        githubRunAttempt = parsed.value;
        break;
      case "--run-url":
        githubRunUrl = parsed.value;
        validateRunUrl(parsed.value);
        break;
      case "--result-out":
        resultOut = parsed.value;
        break;
    }
  }

  cliAssert(suites.length > 0, "at least one --suite is required");
  const hasGithubMetadata =
    githubRunId !== undefined ||
    githubRunAttempt !== undefined ||
    githubRunUrl !== undefined;
  if (source === "local") {
    cliAssert(!hasGithubMetadata, "GitHub run fields require --source github");
    cliAssert(
      channel === undefined || channel === "local",
      "local source requires local channel",
    );
    cliAssert(
      pullRequestNumber === undefined,
      "pull-request number requires a GitHub pull-request channel",
    );
  } else {
    cliAssert(
      githubRunId !== undefined &&
        githubRunAttempt !== undefined &&
        githubRunUrl !== undefined,
      "--source github requires --run-id, --run-attempt, and --run-url",
    );
    cliAssert(
      !experimentWasExplicit,
      "--experiment is only permitted for local exports",
    );
    cliAssert(
      typeof branch === "string" && branch.trim().length > 0,
      "GitHub source requires --branch",
    );
    cliAssert(
      channel === "main" || channel === "pr",
      "GitHub source requires --channel main or pr",
    );
    if (channel === "pr") {
      cliAssert(
        pullRequestNumber !== undefined && /^[1-9]\d*$/.test(pullRequestNumber),
        "pull-request channel requires a positive numeric --pr-number",
      );
    } else {
      cliAssert(
        pullRequestNumber === undefined,
        "main channel must not have --pr-number",
      );
    }
    cliAssert(
      baseExperiment === undefined,
      "--base-experiment is only permitted for local exports",
    );
  }

  return {
    suites,
    project,
    source,
    channel: channel ?? (source === "local" ? "local" : "main"),
    ...(experiment !== undefined ? { experiment } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(pullRequestNumber !== undefined ? { pullRequestNumber } : {}),
    ...(baseExperiment !== undefined ? { baseExperiment } : {}),
    ...(githubRunId !== undefined ? { githubRunId } : {}),
    ...(githubRunAttempt !== undefined ? { githubRunAttempt } : {}),
    ...(githubRunUrl !== undefined ? { githubRunUrl } : {}),
    ...(resultOut !== undefined ? { resultOut } : {}),
    validateOnly,
  };
}

function hasBraintrustApiKey(runtime: BraintrustCliRuntime): boolean {
  const environment = runtime.env ?? process.env;
  return (
    typeof environment.BRAINTRUST_API_KEY === "string" &&
    environment.BRAINTRUST_API_KEY.length > 0
  );
}

function buildCliResult(
  mode: BraintrustCliResult["mode"],
  options: BraintrustCliOptions,
  mapping: BraintrustMappingResult,
  experiment: string,
  url: string | undefined,
  baseExperiment: BraintrustBaseExperiment | null,
): BraintrustCliResult {
  return {
    schemaVersion: 2,
    mode,
    project: options.project,
    experiment,
    rowCount: mapping.rows.length,
    suites: mapping.suites,
    ...(url !== undefined ? { url } : {}),
    baseExperiment,
  };
}

function writeCliResult(
  path: string,
  result: BraintrustCliResult,
  writeFile: (path: string, contents: string) => void,
): void {
  writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
}

export async function runBraintrustCli(
  argv: readonly string[],
  runtime: BraintrustCliRuntime = {},
): Promise<BraintrustCliResult> {
  const now = runtime.now?.() ?? new Date();
  const parsedOptions = parseBraintrustArgs(argv, now);
  const mapping = preflightAndMapBraintrustRows(parsedOptions.suites);
  const options: BraintrustCliOptions = { ...parsedOptions, now };
  const init = buildBraintrustExperimentInit(mapping, options);
  let result: BraintrustCliResult;
  if (options.validateOnly) {
    result = buildCliResult(
      "validate-only",
      options,
      mapping,
      init.experiment,
      undefined,
      null,
    );
  } else {
    cliAssert(
      hasBraintrustApiKey(runtime),
      "BRAINTRUST_API_KEY is required for network export",
    );
    const exported = await publishBraintrustRows(
      mapping,
      options,
      runtime.publisherFactory,
      runtime.baseResolver ??
        ((project) => resolveBraintrustMainExperiment(project)),
    );
    result = buildCliResult(
      "export",
      options,
      mapping,
      exported.experiment,
      exported.url,
      exported.baseExperiment,
    );
  }
  if (options.resultOut !== undefined) {
    writeCliResult(
      options.resultOut,
      result,
      runtime.writeFile ?? ((path, contents) => writeFileSync(path, contents)),
    );
  }
  (runtime.print ?? ((line) => process.stdout.write(`${line}\n`)))(
    JSON.stringify(result),
  );
  return result;
}

export async function btEvalMain(): Promise<void> {
  await runBraintrustCli(process.argv.slice(2));
}

if (import.meta.main) {
  btEvalMain().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
