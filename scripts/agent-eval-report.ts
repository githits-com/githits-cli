import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export type AgentEvalReportMode = "report" | "json" | "compare";
export type NormalizedToolStatus =
  | "started"
  | "completed"
  | "failed"
  | "unknown";

export interface AgentEvalReportOptions {
  mode: AgentEvalReportMode;
  runDir?: string;
  beforeRunDir?: string;
  afterRunDir?: string;
}

export interface AgentEvalRunMetadata {
  agent?: string;
  server?: string;
  dryRun?: boolean;
  git?: Record<string, string | undefined>;
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
  status?: string;
  error?: unknown;
}

export interface ToolCallSummary {
  rawCount: number;
  uniqueTools: string[];
  statusCounts: Record<NormalizedToolStatus, number>;
  errors: string[];
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
  finalReport?: FinalReportSummary;
  warnings: string[];
}

export interface AgentEvalReport {
  schemaVersion: 1;
  status: string;
  agent?: string;
  server?: string;
  dryRun?: boolean;
  git?: Record<string, string | undefined>;
  runDir: string;
  workloads: WorkloadReport[];
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
  return relative(runDir, path) || basename(path);
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
  const claude = trimmed.match(/^mcp__[^_.]+__\.?(.+)$/);
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
        status: typeof record.status === "string" ? record.status : undefined,
        error: record.error,
      },
    ];
  });
}

function buildWorkloadReport(
  runDir: string,
  workload: WorkloadRunMetadata,
): WorkloadReport {
  const workloadDir = workloadDirFor(runDir, workload);
  const paths = {
    toolCalls: join(workloadDir, "tool-calls.json"),
    final: join(workloadDir, "final.json"),
    invalidFinal: join(workloadDir, "invalid-final.json"),
    stderr: join(workloadDir, "stderr.txt"),
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

  const toolCalls = summarizeToolCalls(
    safePaths.toolCalls ? (readToolCalls(safePaths.toolCalls) ?? []) : [],
  );
  const finalReport = summarizeFinalReport(
    safePaths.final ? readJson(safePaths.final) : undefined,
  );
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
    finalReport,
    warnings,
  };
}

export function buildRunReportFromMetadata(
  runDir: string,
  metadata: AgentEvalRunMetadata,
): AgentEvalReport {
  const workloads = metadata.workloads ?? [];
  const ids = new Set<string>();
  const warnings: string[] = [];
  for (const workload of workloads) {
    if (ids.has(workload.id))
      warnings.push(`duplicate workload id in run metadata: ${workload.id}`);
    ids.add(workload.id);
  }
  const reports = workloads.map((workload) =>
    buildWorkloadReport(runDir, workload),
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
    server: metadata.server,
    dryRun: metadata.dryRun,
    git: metadata.git,
    runDir,
    workloads: reports,
    warnings,
  };
}

export function loadRunReport(runDir: string): AgentEvalReport {
  const runPath = join(runDir, "run.json");
  const metadata = readJson(runPath);
  assert(metadata, `run.json not found in ${runDir}`);
  return buildRunReportFromMetadata(runDir, metadata as AgentEvalRunMetadata);
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "n/a";
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatRunReport(report: AgentEvalReport): string {
  const lines = [
    `Agent eval: ${report.status} (${report.agent ?? "unknown"}/${report.server ?? "unknown"}) ${report.runDir}`,
  ];
  for (const workload of report.workloads) {
    const final = workload.finalReport;
    const details = final
      ? ` usefulness=${final.usefulness} confidence=${final.confidence}`
      : "";
    lines.push(
      `${workload.id} ${workload.status} ${formatDuration(workload.durationMs)} uniqueTools=${workload.toolCalls.uniqueTools.length} rawEvents=${workload.toolCalls.rawCount}${details}`,
    );
    const artifacts = [
      workload.artifacts.toolCalls,
      workload.artifacts.final ?? workload.artifacts.invalidFinal,
      workload.artifacts.stderr,
    ].filter(Boolean);
    if (artifacts.length > 0)
      lines.push(`  artifacts: ${artifacts.join(", ")}`);
    for (const warning of workload.warnings)
      lines.push(`  warning: ${warning}`);
  }
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
    ? []
    : [
        "cross-agent comparison: status/event counts are not comparable; showing tool-name presence only",
      ];
  const lines = [
    `Agent eval compare: before=${before.runDir} after=${after.runDir}`,
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
