import { z } from "zod";

export type EvalAgent = "claude" | "codex" | "opencode";

export const LUNA_MODEL = "gpt-5.6-luna" as const;
export const LUNA_RATE_SOURCE =
  "https://developers.openai.com/api/docs/models/gpt-5.6-luna" as const;
export const LUNA_RATE_EFFECTIVE_DATE = "2026-08-28" as const;

const LUNA_RATES = {
  uncachedInputUsdPerMillion: 0.2,
  cachedInputUsdPerMillion: 0.02,
  cacheWriteInputUsdPerMillion: 0.25,
  outputUsdPerMillion: 1.2,
} as const;

const nonNegativeInteger = z.number().int().nonnegative();

export const codexProviderUsageSchema = z
  .object({
    input_tokens: nonNegativeInteger,
    cached_input_tokens: nonNegativeInteger,
    cache_write_input_tokens: nonNegativeInteger,
    output_tokens: nonNegativeInteger,
    reasoning_output_tokens: nonNegativeInteger,
  })
  .passthrough();

export type CodexProviderUsage = z.infer<typeof codexProviderUsageSchema>;

export const lunaRateSnapshotSchema = z.object({
  model: z.literal(LUNA_MODEL),
  currency: z.literal("USD"),
  unit: z.literal("per_million_tokens"),
  effectiveDate: z.literal(LUNA_RATE_EFFECTIVE_DATE),
  source: z.literal(LUNA_RATE_SOURCE),
  rates: z.object({
    uncachedInputUsdPerMillion: z.literal(
      LUNA_RATES.uncachedInputUsdPerMillion,
    ),
    cachedInputUsdPerMillion: z.literal(LUNA_RATES.cachedInputUsdPerMillion),
    cacheWriteInputUsdPerMillion: z.literal(
      LUNA_RATES.cacheWriteInputUsdPerMillion,
    ),
    outputUsdPerMillion: z.literal(LUNA_RATES.outputUsdPerMillion),
  }),
});

export type LunaRateSnapshot = z.infer<typeof lunaRateSnapshotSchema>;

const normalizedTokensSchema = z.object({
  uncachedInputTokens: nonNegativeInteger.nullable(),
  cachedInputTokens: nonNegativeInteger.nullable(),
  cacheWriteInputTokens: nonNegativeInteger.nullable(),
  outputTokens: nonNegativeInteger.nullable(),
  reasoningOutputTokens: nonNegativeInteger.nullable(),
});

const costSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("base_rate_estimate"),
    usd: z.number().nonnegative(),
    uncertainty: z.enum([
      "rate_based_estimate",
      "long_context_pricing_not_attributable",
    ]),
    rateSnapshot: lunaRateSnapshotSchema,
  }),
  z.object({
    kind: z.literal("unknown"),
    usd: z.null(),
    uncertainty: z.literal("unknown"),
    rateSnapshot: z.null(),
  }),
]);

export const agentUsageMetricsSchema = z.object({
  schemaVersion: z.literal(1),
  agent: z.enum(["claude", "codex", "opencode"]),
  model: z.string().nullable(),
  providerUsage: codexProviderUsageSchema.nullable(),
  normalizedTokens: normalizedTokensSchema,
  cost: costSchema,
  warnings: z.array(z.string()),
});

export type AgentUsageMetrics = z.infer<typeof agentUsageMetricsSchema>;

export type AgentEvalProcessStatus =
  | "dry-run"
  | "success"
  | "failed"
  | "timeout";
export type AgentEvalFinalStatus = "success" | "failure" | "inconclusive";
export type EvalSurface = "mcp" | "skills";
export type EvalServer = "local" | "published";
export type NormalizedToolStatus =
  | "started"
  | "completed"
  | "failed"
  | "unknown";

export interface PersistedToolCall {
  tool: string;
  server?: string;
  status?: string;
  error?: unknown;
  resultBytes?: number | null;
}

export interface AgentEvalRecordInput {
  workloadId: string;
  requestedModel?: string | null;
  resolvedModel?: string | null;
  agent: EvalAgent;
  agentVersion?: string | null;
  reasoningEffort?: string | null;
  surface: EvalSurface;
  server: EvalServer;
  guidanceProfile?: "descriptors" | "full" | null;
  experimentalTools: boolean;
  publishedPackage?: string | null;
  targetGit: {
    branch?: string | null;
    sha?: string | null;
    dirty?: boolean | null;
  };
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  processStatus: AgentEvalProcessStatus;
  finalStatus?: AgentEvalFinalStatus | null;
  exitCode?: number | null;
  timedOut?: boolean | null;
  usage: AgentUsageMetrics;
  toolCalls: PersistedToolCall[];
  artifacts: Record<string, string>;
}

export interface AgentEvalMetricsInput {
  runId: string;
  startedAt: string;
  completedAt: string;
  records: AgentEvalRecordInput[];
}

const relativeArtifactPathSchema = z
  .string()
  .min(1)
  .refine((value) => {
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
    const segments = value.split(/[\\/]/);
    return segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
  }, "artifact paths must be sanitized relative paths");

const targetGitSchema = z.object({
  branch: z.string().nullable(),
  sha: z.string().nullable(),
  dirty: z.boolean().nullable(),
});

const toolSequenceEntrySchema = z.object({
  tool: z.string(),
  surface: z.enum(["mcp", "cli"]),
  status: z.enum(["started", "completed", "failed", "unknown"]),
});

const toolsMetricsSchema = z.object({
  rawEventCount: nonNegativeInteger,
  logicalCallCount: nonNegativeInteger.nullable(),
  completedCount: nonNegativeInteger,
  failedCount: nonNegativeInteger,
  uniqueTools: z.array(z.string()),
  sequence: z.array(toolSequenceEntrySchema),
  resultBytes: nonNegativeInteger.nullable(),
});

export const agentEvalRecordSchema = z.object({
  workloadId: z.string().min(1),
  requestedModel: z.string().nullable(),
  resolvedModel: z.string().nullable(),
  agent: z.enum(["claude", "codex", "opencode"]),
  agentVersion: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  surface: z.enum(["mcp", "skills"]),
  server: z.enum(["local", "published"]),
  guidanceProfile: z.enum(["descriptors", "full"]).nullable(),
  experimentalTools: z.boolean(),
  publishedPackage: z.string().nullable(),
  targetGit: targetGitSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: nonNegativeInteger.nullable(),
  processStatus: z.enum(["dry-run", "success", "failed", "timeout"]),
  finalStatus: z.enum(["success", "failure", "inconclusive"]).nullable(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean().nullable(),
  usage: agentUsageMetricsSchema,
  tools: toolsMetricsSchema,
  artifacts: z.record(z.string(), relativeArtifactPathSchema),
  warnings: z.array(z.string()),
});

const aggregateMetricSchema = z.number().nonnegative().nullable();
const aggregateIntegerMetricSchema = nonNegativeInteger.nullable();

const aggregateMetricsSchema = z.object({
  workloadCount: nonNegativeInteger,
  succeededCount: nonNegativeInteger,
  failedCount: nonNegativeInteger,
  timedOutCount: nonNegativeInteger,
  durationMs: aggregateIntegerMetricSchema,
  logicalToolCalls: aggregateIntegerMetricSchema,
  uncachedInputTokens: aggregateIntegerMetricSchema,
  cachedInputTokens: aggregateIntegerMetricSchema,
  cacheWriteInputTokens: aggregateIntegerMetricSchema,
  outputTokens: aggregateIntegerMetricSchema,
  reasoningOutputTokens: aggregateIntegerMetricSchema,
  baseRateEstimatedCostUsd: aggregateMetricSchema,
});

export const agentEvalMetricsSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  records: z.array(agentEvalRecordSchema),
  aggregates: aggregateMetricsSchema,
  warnings: z.array(z.string()),
});

export type AgentEvalRecord = z.infer<typeof agentEvalRecordSchema>;
export type AgentEvalMetrics = z.infer<typeof agentEvalMetricsSchema>;

const LONG_CONTEXT_INPUT_LIMIT = 272_000;

const UNKNOWN_TOKENS = {
  uncachedInputTokens: null,
  cachedInputTokens: null,
  cacheWriteInputTokens: null,
  outputTokens: null,
  reasoningOutputTokens: null,
} as const;

function unknownCost(): AgentUsageMetrics["cost"] {
  return {
    kind: "unknown",
    usd: null,
    uncertainty: "unknown",
    rateSnapshot: null,
  };
}

function unknownMetrics(
  agent: EvalAgent,
  model: string | undefined,
  warnings: string[],
): AgentUsageMetrics {
  return agentUsageMetricsSchema.parse({
    schemaVersion: 1,
    agent,
    model: model ?? null,
    providerUsage: null,
    normalizedTokens: UNKNOWN_TOKENS,
    cost: unknownCost(),
    warnings,
  });
}

function lastCodexTerminalUsage(stdout: string): {
  found: boolean;
  value: unknown;
} {
  let found = false;
  let value: unknown;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type !== "turn.completed") continue;
      found = true;
      value = event.usage;
    } catch {
      // Ignore non-JSON lines emitted by the CLI.
    }
  }
  return { found, value };
}

function lunaCost(
  tokens: AgentUsageMetrics["normalizedTokens"],
  longContext: boolean,
): AgentUsageMetrics["cost"] {
  const uncachedInputTokens = tokens.uncachedInputTokens;
  const cachedInputTokens = tokens.cachedInputTokens;
  const cacheWriteInputTokens = tokens.cacheWriteInputTokens;
  const outputTokens = tokens.outputTokens;
  if (
    uncachedInputTokens === null ||
    cachedInputTokens === null ||
    cacheWriteInputTokens === null ||
    outputTokens === null
  ) {
    return unknownCost();
  }
  const usd =
    (uncachedInputTokens * LUNA_RATES.uncachedInputUsdPerMillion +
      cachedInputTokens * LUNA_RATES.cachedInputUsdPerMillion +
      cacheWriteInputTokens * LUNA_RATES.cacheWriteInputUsdPerMillion +
      outputTokens * LUNA_RATES.outputUsdPerMillion) /
    1_000_000;
  return {
    kind: "base_rate_estimate",
    usd,
    uncertainty: longContext
      ? "long_context_pricing_not_attributable"
      : "rate_based_estimate",
    rateSnapshot: {
      model: LUNA_MODEL,
      currency: "USD",
      unit: "per_million_tokens",
      effectiveDate: LUNA_RATE_EFFECTIVE_DATE,
      source: LUNA_RATE_SOURCE,
      rates: LUNA_RATES,
    },
  };
}

function unavailableCodexWarnings(
  model: string | undefined,
  warning: string,
): string[] {
  const warnings = [warning];
  if (model !== LUNA_MODEL) warnings.push("rate_card_not_configured");
  return warnings;
}

/**
 * Adapts one agent JSONL stream into a validated, provider-neutral usage
 * record. Codex usage is sourced from its final turn.completed aggregate.
 */
export function adaptAgentUsage(
  stdout: string,
  agent: EvalAgent,
  model?: string,
): AgentUsageMetrics {
  if (agent !== "codex") {
    return unknownMetrics(agent, model, ["adapter_not_implemented"]);
  }

  const terminal = lastCodexTerminalUsage(stdout);
  if (!terminal.found) {
    return unknownMetrics(
      agent,
      model,
      unavailableCodexWarnings(model, "codex_terminal_usage_missing"),
    );
  }

  const parsed = codexProviderUsageSchema.safeParse(terminal.value);
  if (!parsed.success) {
    return unknownMetrics(
      agent,
      model,
      unavailableCodexWarnings(model, "codex_terminal_usage_invalid"),
    );
  }

  const providerUsage = parsed.data;
  const uncachedInputTokens =
    providerUsage.input_tokens -
    providerUsage.cached_input_tokens -
    providerUsage.cache_write_input_tokens;
  if (
    uncachedInputTokens < 0 ||
    providerUsage.reasoning_output_tokens > providerUsage.output_tokens
  ) {
    return unknownMetrics(
      agent,
      model,
      unavailableCodexWarnings(model, "codex_terminal_usage_invalid"),
    );
  }

  const normalizedTokens = {
    uncachedInputTokens,
    cachedInputTokens: providerUsage.cached_input_tokens,
    cacheWriteInputTokens: providerUsage.cache_write_input_tokens,
    outputTokens: providerUsage.output_tokens,
    reasoningOutputTokens: providerUsage.reasoning_output_tokens,
  };
  const longContext = providerUsage.input_tokens > LONG_CONTEXT_INPUT_LIMIT;
  const warnings: string[] = [];
  let cost = unknownCost();
  if (model === LUNA_MODEL) {
    cost = lunaCost(normalizedTokens, longContext);
    if (longContext) warnings.push("long_context_pricing_not_attributable");
  } else {
    warnings.push("rate_card_not_configured");
  }

  return agentUsageMetricsSchema.parse({
    schemaVersion: 1,
    agent,
    model: model ?? null,
    providerUsage,
    normalizedTokens,
    cost,
    warnings,
  });
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0);
}

function buildAgentEvalRecord(input: AgentEvalRecordInput): AgentEvalRecord {
  const usage = agentUsageMetricsSchema.parse(input.usage);
  const sequence = input.toolCalls.map((call) => ({
    tool: normalizeToolName(call.tool),
    surface:
      call.server === "githits-cli" ? ("cli" as const) : ("mcp" as const),
    status: normalizeToolStatus(call.status, call.error),
  }));
  const warnings = [...usage.warnings];
  if (input.agent !== "codex") {
    warnings.push("tool_logical_count_not_implemented");
  }

  const resultBytes = sumKnown(
    input.toolCalls.map((call) => call.resultBytes ?? null),
  );
  const record = {
    workloadId: input.workloadId,
    requestedModel: input.requestedModel ?? null,
    resolvedModel: input.resolvedModel ?? null,
    agent: input.agent,
    agentVersion: input.agentVersion ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    surface: input.surface,
    server: input.server,
    guidanceProfile: input.guidanceProfile ?? null,
    experimentalTools: input.experimentalTools,
    publishedPackage: input.publishedPackage ?? null,
    targetGit: {
      branch: input.targetGit.branch ?? null,
      sha: input.targetGit.sha ?? null,
      dirty: input.targetGit.dirty ?? null,
    },
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    durationMs: input.durationMs ?? null,
    processStatus: input.processStatus,
    finalStatus: input.finalStatus ?? null,
    exitCode: input.exitCode ?? null,
    timedOut: input.timedOut ?? null,
    usage,
    tools: {
      rawEventCount: input.toolCalls.length,
      logicalCallCount: input.agent === "codex" ? input.toolCalls.length : null,
      completedCount: sequence.filter((call) => call.status === "completed")
        .length,
      failedCount: sequence.filter((call) => call.status === "failed").length,
      uniqueTools: [...new Set(sequence.map((call) => call.tool))].sort(),
      sequence,
      resultBytes,
    },
    artifacts: input.artifacts,
    warnings: uniqueStrings(warnings),
  };
  return agentEvalRecordSchema.parse(record);
}

/**
 * Builds a validated run-level metrics artifact from already-sanitized data.
 * This function intentionally performs no filesystem, process, or git access.
 */
export function buildAgentEvalMetrics(
  input: AgentEvalMetricsInput,
): AgentEvalMetrics {
  const records = input.records.map(buildAgentEvalRecord);
  const aggregates = {
    workloadCount: records.length,
    succeededCount: records.filter(
      (record) => record.processStatus === "success",
    ).length,
    failedCount: records.filter((record) => record.processStatus === "failed")
      .length,
    timedOutCount: records.filter(
      (record) => record.processStatus === "timeout",
    ).length,
    durationMs: sumKnown(records.map((record) => record.durationMs)),
    logicalToolCalls: sumKnown(
      records.map((record) => record.tools.logicalCallCount),
    ),
    uncachedInputTokens: sumKnown(
      records.map(
        (record) => record.usage.normalizedTokens.uncachedInputTokens,
      ),
    ),
    cachedInputTokens: sumKnown(
      records.map((record) => record.usage.normalizedTokens.cachedInputTokens),
    ),
    cacheWriteInputTokens: sumKnown(
      records.map(
        (record) => record.usage.normalizedTokens.cacheWriteInputTokens,
      ),
    ),
    outputTokens: sumKnown(
      records.map((record) => record.usage.normalizedTokens.outputTokens),
    ),
    reasoningOutputTokens: sumKnown(
      records.map(
        (record) => record.usage.normalizedTokens.reasoningOutputTokens,
      ),
    ),
    baseRateEstimatedCostUsd: sumKnown(
      records.map((record) =>
        record.usage.cost.kind === "base_rate_estimate"
          ? record.usage.cost.usd
          : null,
      ),
    ),
  };
  return agentEvalMetricsSchema.parse({
    schemaVersion: 1,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    records,
    aggregates,
    warnings: uniqueStrings(records.flatMap((record) => record.warnings)),
  });
}
