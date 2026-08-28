import { describe, expect, it } from "bun:test";
import {
  adaptAgentUsage,
  agentUsageMetricsSchema,
  LUNA_MODEL,
  LUNA_RATE_EFFECTIVE_DATE,
  LUNA_RATE_SOURCE,
} from "./agent-eval-metrics.ts";

function codexUsageEvent(usage: Record<string, number>): string {
  return JSON.stringify({ type: "turn.completed", usage });
}

describe("agent eval usage metrics", () => {
  it("normalizes inclusive Luna usage and does not double-count reasoning", () => {
    const metrics = adaptAgentUsage(
      codexUsageEvent({
        input_tokens: 100,
        cached_input_tokens: 40,
        cache_write_input_tokens: 20,
        output_tokens: 10,
        reasoning_output_tokens: 4,
      }),
      "codex",
      LUNA_MODEL,
    );

    expect(metrics.normalizedTokens).toEqual({
      uncachedInputTokens: 40,
      cachedInputTokens: 40,
      cacheWriteInputTokens: 20,
      outputTokens: 10,
      reasoningOutputTokens: 4,
    });
    expect(metrics.cost.kind).toBe("base_rate_estimate");
    if (metrics.cost.kind !== "base_rate_estimate") return;
    expect(metrics.cost.usd).toBeCloseTo(0.0000258, 12);
    expect(metrics.cost.usd).not.toBeCloseTo(0.0000306, 12);
    expect(metrics.cost.rateSnapshot).toMatchObject({
      model: LUNA_MODEL,
      effectiveDate: LUNA_RATE_EFFECTIVE_DATE,
      source: LUNA_RATE_SOURCE,
    });
    expect(metrics.warnings).toEqual([]);
    expect(agentUsageMetricsSchema.parse(metrics)).toEqual(metrics);
  });

  it("uses the last terminal Codex aggregate", () => {
    const metrics = adaptAgentUsage(
      [
        codexUsageEvent({
          input_tokens: 100,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 10,
          reasoning_output_tokens: 2,
        }),
        codexUsageEvent({
          input_tokens: 200,
          cached_input_tokens: 100,
          cache_write_input_tokens: 20,
          output_tokens: 30,
          reasoning_output_tokens: 5,
        }),
      ].join("\n"),
      "codex",
      LUNA_MODEL,
    );

    expect(metrics.providerUsage?.input_tokens).toBe(200);
    expect(metrics.normalizedTokens.uncachedInputTokens).toBe(80);
  });

  it("marks input above the long-context boundary as unattributable", () => {
    const metrics = adaptAgentUsage(
      codexUsageEvent({
        input_tokens: 272_001,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      }),
      "codex",
      LUNA_MODEL,
    );

    expect(metrics.cost.kind).toBe("base_rate_estimate");
    expect(metrics.cost.uncertainty).toBe(
      "long_context_pricing_not_attributable",
    );
    expect(metrics.warnings).toContain("long_context_pricing_not_attributable");

    const atBoundary = adaptAgentUsage(
      codexUsageEvent({
        input_tokens: 272_000,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      }),
      "codex",
      LUNA_MODEL,
    );
    expect(atBoundary.warnings).not.toContain(
      "long_context_pricing_not_attributable",
    );
  });

  it("returns unknown usage for missing and invalid Codex telemetry", () => {
    const missing = adaptAgentUsage(
      '{"type":"turn.started"}',
      "codex",
      LUNA_MODEL,
    );
    expect(missing.normalizedTokens.uncachedInputTokens).toBeNull();
    expect(missing.cost.usd).toBeNull();
    expect(missing.warnings).toContain("codex_terminal_usage_missing");

    const invalid = adaptAgentUsage(
      codexUsageEvent({
        input_tokens: -1,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      }),
      "codex",
      LUNA_MODEL,
    );
    expect(invalid.normalizedTokens.outputTokens).toBeNull();
    expect(invalid.warnings).toContain("codex_terminal_usage_invalid");
  });

  it("keeps unsupported agents and unconfigured Codex models explicitly unknown", () => {
    const claude = adaptAgentUsage("", "claude", "haiku");
    expect(claude.normalizedTokens.outputTokens).toBeNull();
    expect(claude.cost.kind).toBe("unknown");
    expect(claude.warnings).toEqual(["adapter_not_implemented"]);

    const opencode = adaptAgentUsage("", "opencode", "some-model");
    expect(opencode.warnings).toEqual(["adapter_not_implemented"]);

    const otherModel = adaptAgentUsage(
      codexUsageEvent({
        input_tokens: 10,
        cached_input_tokens: 5,
        cache_write_input_tokens: 0,
        output_tokens: 2,
        reasoning_output_tokens: 1,
      }),
      "codex",
      "gpt-5.4-mini",
    );
    expect(otherModel.normalizedTokens.uncachedInputTokens).toBe(5);
    expect(otherModel.cost.kind).toBe("unknown");
    expect(otherModel.warnings).toContain("rate_card_not_configured");
  });
});
