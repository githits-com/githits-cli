import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  type AgentEvalMetrics,
  type AgentEvalRecord,
  type AgentUsageMetrics,
  agentEvalMetricsSchema,
} from "./agent-eval-metrics.ts";

export type AgentEvalReportMode = "report" | "json" | "compare";

const CLAUDE_PROFILE_ISOLATION_WARNING =
  "Claude subscription runs may auto-discover global CLAUDE.md; descriptors/full profile evidence is diagnostic, not instruction-isolated";
const CODEX_PROFILE_ISOLATION_WARNING =
  "Codex loads global $CODEX_HOME/AGENTS.md when present; descriptors/full profile evidence is diagnostic, not instruction-isolated";

function profileIsolationWarning(
  agent: string | undefined,
): string | undefined {
  if (agent === "claude") return CLAUDE_PROFILE_ISOLATION_WARNING;
  if (agent === "codex") return CODEX_PROFILE_ISOLATION_WARNING;
  return undefined;
}
export type NormalizedToolStatus =
  | "started"
  | "completed"
  | "failed"
  | "unknown";
export type DiscoveryObservation = "observed" | "not_observed" | "not_exposed";

export interface AgentEvalReportOptions {
  mode: AgentEvalReportMode;
  runDir?: string;
  beforeRunDir?: string;
  afterRunDir?: string;
}

export interface AgentEvalGitMetadata {
  branch?: string | null;
  sha?: string | null;
  dirty?: boolean | null;
}

export interface AgentEvalRunMetadata {
  runId?: string;
  agent?: string;
  model?: string;
  reasoningEffort?: string;
  surface?: string;
  server?: string;
  guidanceProfile?: string;
  dryRun?: boolean;
  git?: AgentEvalGitMetadata;
  workloads?: WorkloadRunMetadata[];
}

export interface WorkloadRunMetadata {
  id: string;
  status: string;
  durationMs?: number;
  exitCode?: number;
  timedOut?: boolean;
  workloadDir?: string;
}

export interface ExtractedToolCallForReport {
  tool: string;
  server?: string;
  status?: string;
  error?: unknown;
}

export interface ToolCallSummary {
  rawCount: number;
  uniqueTools: string[];
  statusCounts: Record<NormalizedToolStatus, number>;
  errors: string[];
}

export interface WorkloadMetricsReport {
  normalizedTokens: AgentUsageMetrics["normalizedTokens"];
  cost: Pick<AgentUsageMetrics["cost"], "kind" | "usd" | "uncertainty">;
  logicalToolCount: number | null;
  mcpCallCount: number | null;
  cliCallCount: number | null;
  telemetryWarnings: string[];
}

export interface AgentEvalAggregateMetricsReport {
  workloadCount: number;
  succeededCount: number;
  failedCount: number;
  timedOutCount: number;
  durationMs: number | null;
  logicalToolCalls: number | null;
  uncachedInputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  baseRateEstimatedCostUsd: number | null;
}

export interface DiscoverySummary {
  status: DiscoveryObservation;
  eventCount: number;
}

export interface FinalReportSummary {
  status: string;
  usefulness: string;
  usefulnessReason: string;
  confidence: string;
  expectedToolUse: string[];
  unexpectedToolUse: string[];
  toolIssues: string[];
  instructionIssues: string[];
}

export interface WorkloadReport {
  id: string;
  status: string;
  durationMs?: number;
  exitCode?: number;
  timedOut?: boolean;
  artifacts: Record<string, string>;
  missingArtifacts: string[];
  toolCalls: ToolCallSummary;
  metrics: WorkloadMetricsReport;
  discovery?: DiscoverySummary;
  finalReport?: FinalReportSummary;
  warnings: string[];
}

export interface AgentEvalReport {
  schemaVersion: 1;
  status: string;
  agent?: string;
  model?: string;
  reasoningEffort?: string;
  surface?: string;
  server?: string;
  guidanceProfile?: string;
  dryRun?: boolean;
  git?: AgentEvalGitMetadata;
  runDir: string;
  workloads: WorkloadReport[];
  metrics: AgentEvalAggregateMetricsReport;
  metricsWarnings: string[];
  warnings: string[];
}

export interface AgentEvalCompareReport {
  beforeRunDir: string;
  afterRunDir: string;
  sameAgent: boolean;
  warnings: string[];
  workloads: string[];
  lines: string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toolIssueArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    if (typeof item === "string") return [item];
    const record = asRecord(item);
    if (
      record &&
      typeof record.tool === "string" &&
      typeof record.issue === "string"
    ) {
      return [`${record.tool}: ${record.issue}`];
    }
    return [];
  });
}

function looksLikeToolName(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value);
}

function isSafeWorkloadId(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    value !== ".." &&
    !value.includes("..")
  );
}

function relativeArtifact(runDir: string, path: string): string {
  return (relative(runDir, path) || basename(path)).replaceAll("\\", "/");
}

export function isContainedRelativePath(relativePath: string): boolean {
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath) &&
    !/^[A-Za-z]:[\\/]/.test(relativePath)
  );
}

function realPathInsideRun(runDir: string, path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const realRunDir = realpathSync(runDir);
  const realPath = realpathSync(path);
  const relativePath = relative(realRunDir, realPath);
  if (!isContainedRelativePath(relativePath)) return undefined;
  return realPath;
}

interface LoadedMetrics {
  value?: AgentEvalMetrics;
  warnings: string[];
}

function unknownWorkloadMetrics(warning: string): WorkloadMetricsReport {
  return {
    normalizedTokens: {
      uncachedInputTokens: null,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
    },
    cost: { kind: "unknown", usd: null, uncertainty: "unknown" },
    logicalToolCount: null,
    mcpCallCount: null,
    cliCallCount: null,
    telemetryWarnings: [warning],
  };
}

function workloadMetricsFromRecord(
  record: AgentEvalRecord,
): WorkloadMetricsReport {
  return {
    normalizedTokens: record.usage.normalizedTokens,
    cost: {
      kind: record.usage.cost.kind,
      usd: record.usage.cost.usd,
      uncertainty: record.usage.cost.uncertainty,
    },
    logicalToolCount: record.tools.logicalCallCount,
    mcpCallCount: record.tools.sequence.filter((call) => call.surface === "mcp")
      .length,
    cliCallCount: record.tools.sequence.filter((call) => call.surface === "cli")
      .length,
    telemetryWarnings: record.warnings,
  };
}

function unknownAggregateMetrics(
  workloads: WorkloadRunMetadata[],
): AgentEvalAggregateMetricsReport {
  return {
    workloadCount: workloads.length,
    succeededCount: workloads.filter(
      (workload) => workload.status === "success",
    ).length,
    failedCount: workloads.filter((workload) => workload.status === "failed")
      .length,
    timedOutCount: workloads.filter((workload) => workload.status === "timeout")
      .length,
    durationMs: null,
    logicalToolCalls: null,
    uncachedInputTokens: null,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    baseRateEstimatedCostUsd: null,
  };
}

function loadRunMetrics(runDir: string, expectedRunId?: string): LoadedMetrics {
  const metricsPath = join(runDir, "metrics.json");
  if (!existsSync(metricsPath)) {
    return {
      warnings: [
        "metrics.json missing; normalized usage, cost, and logical tool metrics are unknown",
      ],
    };
  }

  let safePath: string | undefined;
  try {
    safePath = realPathInsideRun(runDir, metricsPath);
  } catch {
    safePath = undefined;
  }
  if (!safePath) {
    return {
      warnings: [
        "metrics.json path outside run directory ignored; normalized usage, cost, and logical tool metrics are unknown",
      ],
    };
  }

  let value: unknown;
  try {
    value = readJson(safePath);
  } catch {
    return {
      warnings: [
        "metrics.json invalid; normalized usage, cost, and logical tool metrics are unknown",
      ],
    };
  }
  const parsed = agentEvalMetricsSchema.safeParse(value);
  if (!parsed.success) {
    return {
      warnings: [
        "metrics.json invalid; normalized usage, cost, and logical tool metrics are unknown",
      ],
    };
  }
  if (expectedRunId !== undefined && parsed.data.runId !== expectedRunId) {
    return {
      warnings: [
        "metrics.json runId mismatch; normalized usage, cost, and logical tool metrics are unknown",
      ],
    };
  }
  return { value: parsed.data, warnings: [] };
}

export function parseReportArgs(argv: string[]): AgentEvalReportOptions {
  if (argv.length === 0) {
    throw new Error(
      "Usage: bun run agent:e2e:report [--json] <runDir> | --compare <beforeRunDir> <afterRunDir>",
    );
  }
  if (argv[0] === "--json") {
    assert(argv.length === 2, "--json requires exactly one run directory");
    return { mode: "json", runDir: argv[1] };
  }
  if (argv[0] === "--compare") {
    assert(
      argv.length === 3,
      "--compare requires before and after run directories",
    );
    return { mode: "compare", beforeRunDir: argv[1], afterRunDir: argv[2] };
  }
  assert(!argv[0]?.startsWith("--"), `Unknown argument: ${argv[0]}`);
  assert(argv.length === 1, "report mode accepts exactly one run directory");
  return { mode: "report", runDir: argv[0] };
}

export function normalizeToolName(name: string): string {
  const trimmed = name.trim();
  const claude = trimmed.match(/^mcp__.+__\.?(.+)$/);
  if (claude?.[1]) return claude[1].replace(/^\./, "");
  const dotted = trimmed.match(/^mcp__[^.]+\.([^\s]+)$/);
  if (dotted?.[1]) return dotted[1];
  return trimmed.replace(/^githits[_.-]/, "");
}

export function normalizeToolStatus(
  status: string | undefined,
  error?: unknown,
): NormalizedToolStatus {
  if (error !== undefined && error !== null) return "failed";
  if (!status) return "unknown";
  const normalized = status.toLowerCase().replace(/[\s-]/g, "_");
  if (["completed", "success", "succeeded", "done"].includes(normalized)) {
    return "completed";
  }
  if (["failed", "failure", "error", "errored"].includes(normalized)) {
    return "failed";
  }
  if (["started", "in_progress", "running", "pending"].includes(normalized)) {
    return "started";
  }
  return "unknown";
}

export function summarizeToolCalls(
  calls: ExtractedToolCallForReport[],
): ToolCallSummary {
  const statusCounts: Record<NormalizedToolStatus, number> = {
    started: 0,
    completed: 0,
    failed: 0,
    unknown: 0,
  };
  const tools = new Set<string>();
  const errors: string[] = [];
  for (const call of calls) {
    tools.add(normalizeToolName(call.tool));
    const status = normalizeToolStatus(call.status, call.error);
    statusCounts[status] += 1;
    if (call.error !== undefined && call.error !== null) {
      errors.push(
        typeof call.error === "string"
          ? call.error
          : JSON.stringify(call.error),
      );
    }
  }
  return {
    rawCount: calls.length,
    uniqueTools: [...tools].sort(),
    statusCounts,
    errors,
  };
}

export function summarizeFinalReport(
  report: unknown,
): FinalReportSummary | undefined {
  const record = asRecord(report);
  if (!record) return undefined;
  return {
    status: typeof record.status === "string" ? record.status : "unknown",
    usefulness:
      typeof record.githitsUsefulness === "string"
        ? record.githitsUsefulness
        : "unknown",
    usefulnessReason:
      typeof record.githitsUsefulnessReason === "string"
        ? record.githitsUsefulnessReason
        : "",
    confidence:
      typeof record.confidence === "string" ? record.confidence : "unknown",
    expectedToolUse: stringArray(record.expectedToolUse).map(normalizeToolName),
    unexpectedToolUse: stringArray(record.unexpectedToolUse).map(
      normalizeToolName,
    ),
    toolIssues: toolIssueArray(record.toolIssues),
    instructionIssues: stringArray(record.instructionIssues),
  };
}

export function workloadIdFromPath(workloadPath: string): string {
  return basename(workloadPath).replace(/\.[^.]+$/, "");
}

export function assertUniqueWorkloadIds(workloads: string[]): void {
  const seen = new Map<string, string>();
  for (const workload of workloads) {
    const id = workloadIdFromPath(workload);
    const previous = seen.get(id);
    if (previous) {
      throw new Error(
        `Duplicate workload id "${id}" from ${previous} and ${workload}`,
      );
    }
    seen.set(id, workload);
  }
}

function workloadDirFor(runDir: string, workload: WorkloadRunMetadata): string {
  const safeId = isSafeWorkloadId(workload.id) ? workload.id : "__invalid__";
  const defaultDir = join(runDir, "workloads", safeId);
  if (!workload.workloadDir) return defaultDir;
  const resolvedRunDir = resolve(runDir);
  const resolvedWorkloadDir = resolve(workload.workloadDir);
  const relativePath = relative(resolvedRunDir, resolvedWorkloadDir);
  if (!isContainedRelativePath(relativePath)) return defaultDir;
  return resolvedWorkloadDir;
}

function readToolCalls(path: string): ExtractedToolCallForReport[] | undefined {
  const value = readJson(path);
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item): ExtractedToolCallForReport[] => {
    const record = asRecord(item);
    if (!record || typeof record.tool !== "string") return [];
    return [
      {
        tool: record.tool,
        server: typeof record.server === "string" ? record.server : undefined,
        status: typeof record.status === "string" ? record.status : undefined,
        error: record.error,
      },
    ];
  });
}

function readDiscovery(path: string): DiscoverySummary | undefined {
  const record = asRecord(readJson(path));
  if (!record) return undefined;
  const status = record.status;
  if (
    status !== "observed" &&
    status !== "not_observed" &&
    status !== "not_exposed"
  ) {
    return undefined;
  }
  return {
    status,
    eventCount: Array.isArray(record.events) ? record.events.length : 0,
  };
}

function buildWorkloadReport(
  runDir: string,
  workload: WorkloadRunMetadata,
  fallbackGuidanceProfile: string | undefined,
  metricsRecord: AgentEvalRecord | undefined,
  metricsWarning: string | undefined,
): WorkloadReport {
  const workloadDir = workloadDirFor(runDir, workload);
  const paths = {
    toolCalls: join(workloadDir, "tool-calls.json"),
    final: join(workloadDir, "final.json"),
    invalidFinal: join(workloadDir, "invalid-final.json"),
    stderr: join(workloadDir, "stderr.txt"),
    skillInstallation: join(workloadDir, "skill-installation.json"),
    guidanceInstallation: join(workloadDir, "guidance-installation.json"),
    discoveryEvents: join(workloadDir, "discovery-events.json"),
  };
  const artifacts: Record<string, string> = {};
  const missingArtifacts: string[] = [];
  const unsafeArtifacts: string[] = [];
  const safePaths: Partial<Record<keyof typeof paths, string>> = {};
  for (const [name, path] of Object.entries(paths)) {
    const safePath = realPathInsideRun(runDir, path);
    if (safePath) {
      safePaths[name as keyof typeof paths] = safePath;
      artifacts[name] = relativeArtifact(runDir, path);
    } else if (existsSync(path)) {
      unsafeArtifacts.push(`${name}: ${path}`);
    }
  }
  if (!artifacts.toolCalls) missingArtifacts.push("tool-calls.json");
  if (!artifacts.final && !artifacts.invalidFinal)
    missingArtifacts.push("final.json");
  if (!artifacts.stderr) missingArtifacts.push("stderr.txt");

  const persistedToolCalls = safePaths.toolCalls
    ? (readToolCalls(safePaths.toolCalls) ?? [])
    : [];
  const toolCalls = summarizeToolCalls(persistedToolCalls);
  const finalReport = summarizeFinalReport(
    safePaths.final ? readJson(safePaths.final) : undefined,
  );
  const discovery = safePaths.discoveryEvents
    ? readDiscovery(safePaths.discoveryEvents)
    : undefined;
  const warnings: string[] = [];
  if (!isSafeWorkloadId(workload.id)) {
    warnings.push(
      `invalid workload id ignored for artifact paths: ${workload.id}`,
    );
  }
  for (const unsafe of unsafeArtifacts) {
    warnings.push(`artifact path outside run directory ignored: ${unsafe}`);
  }
  if (missingArtifacts.length > 0 && workload.status === "success") {
    warnings.push(
      `success workload is missing artifacts: ${missingArtifacts.join(", ")}`,
    );
  }
  if (fallbackGuidanceProfile) {
    const cliFallbackTools = [
      ...new Set(
        persistedToolCalls
          .filter((call) => call.server === "githits-cli")
          .map((call) => normalizeToolName(call.tool)),
      ),
    ].sort();
    if (cliFallbackTools.length > 0) {
      warnings.push(
        `MCP ${fallbackGuidanceProfile} guidance run used GitHits CLI fallback: ${cliFallbackTools.join(", ")}`,
      );
    }
  }
  const metrics = metricsRecord
    ? workloadMetricsFromRecord(metricsRecord)
    : unknownWorkloadMetrics(
        metricsWarning ??
          "metrics record missing; normalized usage, cost, and logical tool metrics are unknown",
      );
  if (finalReport) {
    const rawTools = new Set(toolCalls.uniqueTools);
    const drift = finalReport.unexpectedToolUse.filter(
      (tool) => looksLikeToolName(tool) && !rawTools.has(tool),
    );
    if (drift.length > 0) {
      warnings.push(
        `self-report drift: unexpectedToolUse not present in raw calls: ${drift.join(", ")}`,
      );
    }
  }

  return {
    id: workload.id,
    status: workload.status,
    durationMs: workload.durationMs,
    exitCode: workload.exitCode,
    timedOut: workload.timedOut,
    artifacts,
    missingArtifacts,
    toolCalls,
    metrics,
    discovery,
    finalReport,
    warnings,
  };
}

export function buildRunReportFromMetadata(
  runDir: string,
  metadata: AgentEvalRunMetadata,
): AgentEvalReport {
  const workloads = metadata.workloads ?? [];
  const workloadIds = new Set<string>();
  const duplicateWorkloadIds = new Set<string>();
  const warnings: string[] = [];
  for (const workload of workloads) {
    if (workloadIds.has(workload.id)) {
      duplicateWorkloadIds.add(workload.id);
      warnings.push(`duplicate workload id in run metadata: ${workload.id}`);
    }
    workloadIds.add(workload.id);
  }
  const loadedMetrics = loadRunMetrics(runDir, metadata.runId);
  const metrics = loadedMetrics.value;
  const metricsByWorkloadId = new Map<string, AgentEvalRecord>();
  const duplicateMetricIds = new Set<string>();
  const metricsMatchingWarnings: string[] = [];
  if (metrics) {
    for (const record of metrics.records) {
      if (duplicateMetricIds.has(record.workloadId)) continue;
      if (metricsByWorkloadId.has(record.workloadId)) {
        duplicateMetricIds.add(record.workloadId);
        metricsByWorkloadId.delete(record.workloadId);
        metricsMatchingWarnings.push(
          `duplicate metrics record for workload: ${record.workloadId}`,
        );
        continue;
      }
      metricsByWorkloadId.set(record.workloadId, record);
    }
    for (const workloadId of metricsByWorkloadId.keys()) {
      if (!workloadIds.has(workloadId)) {
        metricsMatchingWarnings.push(
          `metrics record has no matching workload: ${workloadId}`,
        );
      }
    }
    for (const workload of workloads) {
      if (duplicateMetricIds.has(workload.id)) continue;
      if (!metricsByWorkloadId.has(workload.id)) {
        metricsMatchingWarnings.push(
          `metrics record missing for workload: ${workload.id}`,
        );
      }
    }
  }
  const metricWarnings = [
    ...loadedMetrics.warnings,
    ...(metrics?.warnings ?? []),
    ...metricsMatchingWarnings,
  ];
  warnings.push(...metricWarnings);
  const isolationWarning = profileIsolationWarning(metadata.agent);
  if (
    isolationWarning &&
    metadata.surface === "mcp" &&
    ["descriptors", "full"].includes(metadata.guidanceProfile ?? "descriptors")
  ) {
    warnings.push(isolationWarning);
  }
  const reports = workloads.map((workload) =>
    buildWorkloadReport(
      runDir,
      workload,
      metadata.surface === "mcp"
        ? (metadata.guidanceProfile ?? "descriptors")
        : undefined,
      duplicateWorkloadIds.has(workload.id)
        ? undefined
        : metricsByWorkloadId.get(workload.id),
      metrics
        ? duplicateMetricIds.has(workload.id)
          ? `duplicate metrics records; metrics for ${workload.id} are unknown`
          : metricsByWorkloadId.has(workload.id)
            ? undefined
            : `metrics record missing for workload: ${workload.id}`
        : loadedMetrics.warnings[0],
    ),
  );
  const status = reports.some((workload) =>
    ["failed", "timeout"].includes(workload.status),
  )
    ? "failed"
    : metadata.dryRun
      ? "dry-run"
      : "success";
  return {
    schemaVersion: 1,
    status,
    agent: metadata.agent,
    model: metadata.model,
    reasoningEffort: metadata.reasoningEffort,
    surface: metadata.surface,
    server: metadata.server,
    guidanceProfile: metadata.guidanceProfile,
    dryRun: metadata.dryRun,
    git: metadata.git,
    runDir,
    workloads: reports,
    metrics: metrics?.aggregates ?? unknownAggregateMetrics(workloads),
    metricsWarnings: metricWarnings,
    warnings,
  };
}

export function loadRunReport(runDir: string): AgentEvalReport {
  const runPath = join(runDir, "run.json");
  const metadata = readJson(runPath);
  assert(metadata, `run.json not found in ${runDir}`);
  return buildRunReportFromMetadata(runDir, metadata as AgentEvalRunMetadata);
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === undefined) return "n/a";
  if (ms === null) return "unknown";
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatMetricValue(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

function formatWorkloadMetrics(metrics: WorkloadMetricsReport): string {
  const tokens = metrics.normalizedTokens;
  return [
    `tokens=uncachedInput=${formatMetricValue(tokens.uncachedInputTokens)}`,
    `cachedInput=${formatMetricValue(tokens.cachedInputTokens)}`,
    `cacheWriteInput=${formatMetricValue(tokens.cacheWriteInputTokens)}`,
    `output=${formatMetricValue(tokens.outputTokens)}`,
    `reasoning(detail)=${formatMetricValue(tokens.reasoningOutputTokens)}`,
    `cost=${metrics.cost.kind}`,
    `costUsd=${formatMetricValue(metrics.cost.usd)}`,
    `costUncertainty=${metrics.cost.uncertainty}`,
    `logicalCalls=${formatMetricValue(metrics.logicalToolCount)}`,
    `mcpCalls=${formatMetricValue(metrics.mcpCallCount)}`,
    `cliCalls=${formatMetricValue(metrics.cliCallCount)}`,
  ].join(" ");
}

function formatAggregateMetrics(
  metrics: AgentEvalAggregateMetricsReport,
): string {
  return [
    `aggregate workloads=${metrics.workloadCount}`,
    `succeeded=${metrics.succeededCount}`,
    `failed=${metrics.failedCount}`,
    `timedOut=${metrics.timedOutCount}`,
    `duration=${formatDuration(metrics.durationMs)}`,
    `logicalCalls=${formatMetricValue(metrics.logicalToolCalls)}`,
    `tokens=uncachedInput=${formatMetricValue(metrics.uncachedInputTokens)}`,
    `cachedInput=${formatMetricValue(metrics.cachedInputTokens)}`,
    `cacheWriteInput=${formatMetricValue(metrics.cacheWriteInputTokens)}`,
    `output=${formatMetricValue(metrics.outputTokens)}`,
    `reasoning(detail)=${formatMetricValue(metrics.reasoningOutputTokens)}`,
    `baseRateCostUsd=${formatMetricValue(metrics.baseRateEstimatedCostUsd)}`,
  ].join(" ");
}

export function formatRunReport(report: AgentEvalReport): string {
  const profile =
    report.surface === "skills"
      ? "n/a"
      : (report.guidanceProfile ?? "descriptors");
  const lines = [
    `Agent eval: ${report.status} (${report.agent ?? "unknown"}${report.model ? `:${report.model}` : ""}/${report.surface ?? "mcp"}/${report.server ?? "unknown"}) profile=${profile}${report.reasoningEffort ? ` effort=${report.reasoningEffort}` : ""} ${report.runDir}`,
  ];
  for (const workload of report.workloads) {
    const final = workload.finalReport;
    const details = final
      ? ` usefulness=${final.usefulness} confidence=${final.confidence}`
      : "";
    lines.push(
      `${workload.id} ${workload.status} ${formatDuration(workload.durationMs)} uniqueTools=${workload.toolCalls.uniqueTools.length} rawEvents=${workload.toolCalls.rawCount} ${formatWorkloadMetrics(workload.metrics)}${workload.discovery ? ` discovery=${workload.discovery.status}` : ""}${details}`,
    );
    const artifacts = [
      workload.artifacts.toolCalls,
      workload.artifacts.final ?? workload.artifacts.invalidFinal,
      workload.artifacts.stderr,
      workload.artifacts.skillInstallation,
      workload.artifacts.guidanceInstallation,
      workload.artifacts.discoveryEvents,
    ].filter(Boolean);
    if (artifacts.length > 0)
      lines.push(`  artifacts: ${artifacts.join(", ")}`);
    for (const warning of workload.metrics.telemetryWarnings)
      lines.push(`  metrics warning: ${warning}`);
    for (const warning of workload.warnings)
      lines.push(`  warning: ${warning}`);
  }
  lines.push(formatAggregateMetrics(report.metrics));
  for (const warning of report.warnings) lines.push(`Warning: ${warning}`);
  const issues = report.workloads.flatMap((workload) => {
    const final = workload.finalReport;
    if (!final) return [];
    return [
      ...final.toolIssues.map((issue) => `${workload.id} tool: ${issue}`),
      ...final.instructionIssues.map(
        (issue) => `${workload.id} instruction: ${issue}`,
      ),
    ];
  });
  if (issues.length > 0) {
    lines.push("Issues:");
    for (const issue of issues) lines.push(`- ${issue}`);
  }
  lines.push("Next:");
  lines.push(`- Reopen summary: bun run agent:e2e:report ${report.runDir}`);
  lines.push(
    `- Compare with baseline: bun run agent:e2e:report --compare <baselineRunDir> ${report.runDir}`,
  );
  const firstWorkload = report.workloads.find(
    (workload) => workload.artifacts.toolCalls,
  );
  if (firstWorkload?.artifacts.toolCalls) {
    lines.push(`- Inspect raw calls: ${firstWorkload.artifacts.toolCalls}`);
  }
  return `${lines.join("\n")}\n`;
}

function diffStrings(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return [
    ...after.filter((item) => !beforeSet.has(item)).map((item) => `+${item}`),
    ...before.filter((item) => !afterSet.has(item)).map((item) => `-${item}`),
  ];
}

function formatStatusCounts(summary: ToolCallSummary): string {
  return Object.entries(summary.statusCounts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}=${count}`)
    .join(" ");
}

function formatRunLabel(
  report: Pick<
    AgentEvalReport,
    | "agent"
    | "model"
    | "surface"
    | "server"
    | "guidanceProfile"
    | "reasoningEffort"
  >,
): string {
  return `${report.agent ?? "unknown"}${report.model ? `:${report.model}` : ""}/${report.surface ?? "mcp"}/${report.server ?? "unknown"}`;
}

function formatRunContext(report: AgentEvalReport): string {
  const profile =
    report.surface === "skills"
      ? "n/a"
      : (report.guidanceProfile ?? "descriptors");
  return `profile=${profile}${report.reasoningEffort ? ` effort=${report.reasoningEffort}` : ""}`;
}

function effectiveGuidanceProfile(report: AgentEvalReport): string | undefined {
  return report.surface === "skills"
    ? undefined
    : (report.guidanceProfile ?? "descriptors");
}

function compareMetadataWarnings(
  before: AgentEvalReport,
  after: AgentEvalReport,
): string[] {
  if (before.agent !== after.agent) return [];
  const warnings: string[] = [];
  const beforeProfile = effectiveGuidanceProfile(before);
  const afterProfile = effectiveGuidanceProfile(after);
  if (beforeProfile !== afterProfile) {
    warnings.push(
      `guidance profile differs: ${beforeProfile ?? "n/a"} -> ${afterProfile ?? "n/a"}`,
    );
  }
  if (before.model !== after.model) {
    warnings.push(
      `model differs: ${before.model ?? "unspecified"} -> ${after.model ?? "unspecified"}`,
    );
  }
  if (before.reasoningEffort !== after.reasoningEffort) {
    warnings.push(
      `reasoning effort differs: ${before.reasoningEffort ?? "unspecified"} -> ${after.reasoningEffort ?? "unspecified"}`,
    );
  }
  const isolationWarning = profileIsolationWarning(before.agent);
  if (
    isolationWarning &&
    [before, after].some(
      (report) =>
        report.surface === "mcp" &&
        ["descriptors", "full"].includes(
          report.guidanceProfile ?? "descriptors",
        ),
    )
  ) {
    warnings.push(isolationWarning);
  }
  return warnings;
}

export function compareReports(
  before: AgentEvalReport,
  after: AgentEvalReport,
): AgentEvalCompareReport {
  const beforeMap = new Map(
    before.workloads.map((workload) => [workload.id, workload]),
  );
  const afterMap = new Map(
    after.workloads.map((workload) => [workload.id, workload]),
  );
  const ids = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  const sameAgent = before.agent === after.agent;
  const warnings = sameAgent
    ? compareMetadataWarnings(before, after)
    : [
        "cross-agent comparison: status/event counts are not comparable; showing tool-name presence only",
      ];
  const lines = [
    `Agent eval compare: before=${before.runDir} (${formatRunLabel(before)}) ${formatRunContext(before)} after=${after.runDir} (${formatRunLabel(after)}) ${formatRunContext(after)}`,
    ...warnings.map((warning) => `Warning: ${warning}`),
  ];
  for (const id of ids) {
    const left = beforeMap.get(id);
    const right = afterMap.get(id);
    if (!left) {
      lines.push(`${id} missing in before`);
      continue;
    }
    if (!right) {
      lines.push(`${id} missing in after`);
      continue;
    }
    const status =
      left.status === right.status
        ? `unchanged ${right.status}`
        : `${left.status} -> ${right.status}`;
    lines.push(`${id} status ${status}`);
    const toolDiff = diffStrings(
      left.toolCalls.uniqueTools,
      right.toolCalls.uniqueTools,
    );
    if (sameAgent) {
      lines.push(
        `  tools: raw events ${left.toolCalls.rawCount} -> ${right.toolCalls.rawCount}; statuses ${formatStatusCounts(left.toolCalls)} -> ${formatStatusCounts(right.toolCalls)}${toolDiff.length > 0 ? `; ${toolDiff.join(", ")}` : ""}`,
      );
    } else if (toolDiff.length > 0) {
      lines.push(`  tools: ${toolDiff.join(", ")}`);
    }
    const instructionDiff = diffStrings(
      left.finalReport?.instructionIssues ?? [],
      right.finalReport?.instructionIssues ?? [],
    );
    if (instructionDiff.length > 0)
      lines.push(`  instructionIssues: ${instructionDiff.join(", ")}`);
    const toolIssueDiff = diffStrings(
      left.finalReport?.toolIssues ?? [],
      right.finalReport?.toolIssues ?? [],
    );
    if (toolIssueDiff.length > 0)
      lines.push(`  toolIssues: ${toolIssueDiff.join(", ")}`);
  }
  return {
    beforeRunDir: before.runDir,
    afterRunDir: after.runDir,
    sameAgent,
    warnings,
    workloads: ids,
    lines,
  };
}

export function formatCompareReport(report: AgentEvalCompareReport): string {
  return `${report.lines.join("\n")}\n`;
}

export function writeReportJson(runDir: string, report: AgentEvalReport): void {
  writeFileSync(
    join(runDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

export async function runReportCli(argv: string[]): Promise<void> {
  const options = parseReportArgs(argv);
  if (options.mode === "compare") {
    assert(
      options.beforeRunDir && options.afterRunDir,
      "compare requires two run directories",
    );
    const before = loadRunReport(options.beforeRunDir);
    const after = loadRunReport(options.afterRunDir);
    console.log(formatCompareReport(compareReports(before, after)).trimEnd());
    return;
  }
  assert(options.runDir, "report requires a run directory");
  const report = loadRunReport(options.runDir);
  writeReportJson(options.runDir, report);
  if (options.mode === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatRunReport(report).trimEnd());
  }
}

if (import.meta.main) {
  runReportCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
