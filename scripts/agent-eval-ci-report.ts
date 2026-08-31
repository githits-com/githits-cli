import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AgentEvalSuiteArtifact,
  loadSuiteArtifact,
} from "./agent-eval-suite.ts";

export interface AgentEvalCiSuiteInput {
  label: string;
  artifact: AgentEvalSuiteArtifact | null;
  path?: string;
  error?: string;
}

export interface AgentEvalCiReportResult {
  markdown: string;
  failed: boolean;
}

interface AgentEvalCiSuiteAssessment {
  failed: boolean;
  reasons: string[];
}

export interface AgentEvalCiReportOptions {
  suites: readonly AgentEvalCiSuiteInput[];
  runUrl?: string;
}

export interface AgentEvalCiReportCliCommand {
  suites: Array<{ label: string; path: string }>;
  runUrl?: string;
  out: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "unknown" : String(value);
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "unknown";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function formatCost(artifact: AgentEvalSuiteArtifact): string {
  if (artifact.cost.usd === null) {
    return `unknown (${artifact.cost.uncertainty})`;
  }
  return `$${artifact.cost.usd.toFixed(4)} (${artifact.cost.uncertainty})`;
}

function formatTokens(artifact: AgentEvalSuiteArtifact): string {
  const { tokens } = artifact;
  return [
    `in=${formatNumber(tokens.uncachedInputTokens)}`,
    `cached=${formatNumber(tokens.cachedInputTokens)}`,
    `write=${formatNumber(tokens.cacheWriteInputTokens)}`,
    `out=${formatNumber(tokens.outputTokens)}`,
    `reasoning=${formatNumber(tokens.reasoningOutputTokens)}`,
  ].join(" ");
}

function formatIdentity(artifact: AgentEvalSuiteArtifact): string {
  const harness = artifact.measurementGit.sha ?? "unknown";
  return [
    `schema v${artifact.schemaVersion}`,
    `harness ${harness}`,
    `${artifact.matrix.agent}:${artifact.matrix.model}/${artifact.matrix.reasoningEffort}`,
    `${artifact.matrix.surface}/${artifact.matrix.server}`,
  ].join("; ");
}

function formatToolCalls(artifact: AgentEvalSuiteArtifact | null): string[] {
  if (artifact === null) return ["- Tool calls: unknown"];
  if (artifact.callsByTool === null) {
    const missing = artifact.missingToolTelemetryCellIds.length;
    return [
      `- Tool calls: unknown (missing telemetry for ${missing} cell${missing === 1 ? "" : "s"})`,
    ];
  }
  if (artifact.callsByTool.length === 0) return ["- Tool calls: none"];
  const calls = [...artifact.callsByTool].toSorted(
    (left, right) =>
      left.surface.localeCompare(right.surface) ||
      left.tool.localeCompare(right.tool),
  );
  return [
    "- Tool calls:",
    ...calls.map(
      (call) =>
        `  - \`${call.surface}/${call.tool}\`: total ${call.total} (started ${call.started}, completed ${call.completed}, failed ${call.failed}, unknown ${call.unknown})`,
    ),
  ];
}

function invalidWarning(warning: string): boolean {
  return /cli fallback|isolation|validation violation|descriptor profile read guidance|external guidance read|missing (?:required )?(?:evidence|artifact)|required evidence missing|\btimeout(?:ed)?\b/i.test(
    warning,
  );
}

function assessSuite(input: AgentEvalCiSuiteInput): AgentEvalCiSuiteAssessment {
  if (input.artifact === null) {
    return {
      failed: true,
      reasons: [input.error ?? "suite artifact is missing or unparseable"],
    };
  }
  const artifact = input.artifact;
  const reasons: string[] = [];
  if (artifact.status === "partial" || artifact.status === "failed") {
    reasons.push(`suite status is ${artifact.status}`);
  }
  const failedShards = artifact.shards.filter(
    (shard) => shard.status === "failed",
  );
  if (failedShards.length > 0) {
    reasons.push(
      `failed scenario shards: ${failedShards.map((shard) => shard.scenario).join(", ")}`,
    );
  }
  const invalidCells = artifact.cells.filter(
    (cell) => cell.status !== "success",
  );
  if (invalidCells.length > 0) {
    reasons.push(
      `invalid workload cells: ${invalidCells.map((cell) => `${cell.id}=${cell.status}`).join(", ")}`,
    );
  }
  if (
    artifact.totals.failedExecutions > 0 ||
    artifact.totals.missingExecutions > 0 ||
    artifact.totals.unknownExecutions > 0
  ) {
    reasons.push(
      `invalid execution totals: failed=${artifact.totals.failedExecutions} missing=${artifact.totals.missingExecutions} unknown=${artifact.totals.unknownExecutions}`,
    );
  }
  const invalidWarnings = artifact.warnings.filter(invalidWarning);
  reasons.push(
    ...invalidWarnings.map((warning) => `invalid warning: ${warning}`),
  );
  return { failed: reasons.length > 0, reasons };
}

function formatStatus(
  artifact: AgentEvalSuiteArtifact | null,
  failed: boolean,
): string {
  if (failed) return "FAIL";
  if (artifact?.status === "dry-run") return "DRY-RUN";
  return "PASS";
}

function formatSuiteRow(
  input: AgentEvalCiSuiteInput,
  assessment: AgentEvalCiSuiteAssessment,
): string {
  if (input.artifact === null) {
    return `| ${input.label} | FAIL | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unknown | ${input.error ?? "suite artifact is missing or unparseable"} |`;
  }
  const artifact = input.artifact;
  const successful = artifact.totals.successfulExecutions;
  const expected = artifact.totals.expectedExecutions;
  const warnings =
    artifact.warnings.length > 0 ? String(artifact.warnings.length) : "none";
  return `| ${input.label} | ${formatStatus(artifact, assessment.failed)} | ${successful}/${expected} | ${formatDuration(artifact.wallTimeMs)} | ${formatDuration(artifact.cumulativeAgentTimeMs)} | ${formatNumber(artifact.logicalToolCalls)} | ${formatTokens(artifact)} | ${formatCost(artifact)} | ${artifact.workloadConcurrency} | ${artifact.codexVersions.length > 0 ? artifact.codexVersions.join(", ") : "unknown"} | ${warnings} |`;
}

function formatWarnings(
  input: AgentEvalCiSuiteInput,
  assessment: AgentEvalCiSuiteAssessment,
): string[] {
  const warnings = input.artifact?.warnings ?? [];
  const diagnostics = assessment.reasons;
  if (warnings.length === 0 && diagnostics.length === 0) return [];
  return [
    `### ${input.label} warnings`,
    ...warnings.map((warning) => `- ${warning}`),
    ...diagnostics
      .filter((reason) => !warnings.some((warning) => reason.endsWith(warning)))
      .map((reason) => `- ${reason}`),
  ];
}

export function formatAgentEvalCiReport(
  options: AgentEvalCiReportOptions,
): AgentEvalCiReportResult {
  assert(options.suites.length > 0, "at least one suite is required");
  const assessments = options.suites.map(assessSuite);
  const failed = assessments.some((assessment) => assessment.failed);
  const lines = [
    "# Agent eval CI report",
    "",
    ...(options.runUrl
      ? [`Evidence: [workflow run](<${options.runUrl}>)`, ""]
      : []),
    "| Scenario | Status | Cells | Wall time | Cumulative time | Logical calls | Tokens | Cost | Concurrency | Codex CLI | Warnings |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | ---: |",
    ...options.suites.map((suite, index) =>
      formatSuiteRow(suite, assessments[index]!),
    ),
    "",
    ...options.suites.flatMap((suite, index) => [
      `## ${suite.label}`,
      `- Identity: ${suite.artifact ? formatIdentity(suite.artifact) : "unknown"}`,
      ...(suite.artifact
        ? [
            `- Suite status: ${suite.artifact.status}`,
            `- Suite scenarios: ${suite.artifact.matrix.scenarios.join(", ")}`,
            `- Workloads: ${suite.artifact.selectedWorkloads.length}`,
          ]
        : []),
      ...formatToolCalls(suite.artifact),
      ...formatWarnings(suite, assessments[index]!),
      "",
    ]),
  ];
  return { markdown: `${lines.join("\n")}\n`, failed };
}

export function parseAgentEvalCiReportArgs(
  args: readonly string[],
): AgentEvalCiReportCliCommand {
  const suites: Array<{ label: string; path: string }> = [];
  const labels = new Set<string>();
  let runUrl: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    assert(
      flag !== undefined && flag.startsWith("--"),
      `unexpected argument: ${flag}`,
    );
    if (flag === "--suite") {
      const value = args[++index];
      assert(
        value !== undefined && value.length > 0 && !value.startsWith("--"),
        "--suite requires a value",
      );
      const separator = value.indexOf("=");
      assert(
        separator > 0 && separator < value.length - 1,
        "--suite must use <label>=<path>",
      );
      const label = value.slice(0, separator);
      const path = value.slice(separator + 1);
      assert(!labels.has(label), `duplicate suite label: ${label}`);
      labels.add(label);
      suites.push({ label, path });
      continue;
    }
    assert(flag === "--run-url" || flag === "--out", `unknown flag: ${flag}`);
    const value = args[++index];
    assert(
      value !== undefined && value.length > 0 && !value.startsWith("--"),
      `${flag} requires a value`,
    );
    if (flag === "--run-url") {
      assert(runUrl === undefined, "duplicate argument: --run-url");
      runUrl = value;
    } else {
      assert(out === undefined, "duplicate argument: --out");
      out = value;
    }
  }
  assert(suites.length > 0, "at least one --suite is required");
  assert(out !== undefined, "--out requires a value");
  return { suites, ...(runUrl ? { runUrl } : {}), out };
}

export function runAgentEvalCiReportCli(
  args: readonly string[],
): AgentEvalCiReportResult {
  const command = parseAgentEvalCiReportArgs(args);
  const suites = command.suites.map((suite): AgentEvalCiSuiteInput => {
    try {
      return { ...suite, artifact: loadSuiteArtifact(suite.path) };
    } catch (error) {
      return {
        ...suite,
        artifact: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const result = formatAgentEvalCiReport({ suites, runUrl: command.runUrl });
  mkdirSync(dirname(command.out), { recursive: true });
  writeFileSync(command.out, result.markdown);
  return result;
}

async function main(): Promise<void> {
  const result = runAgentEvalCiReportCli(process.argv.slice(2));
  process.stdout.write(result.markdown);
  if (result.failed) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
