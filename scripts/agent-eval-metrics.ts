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
