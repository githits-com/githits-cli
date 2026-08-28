import { describe, expect, it } from "bun:test";
import {
  adaptAgentUsage,
  agentEvalMetricsSchema,
  agentUsageMetricsSchema,
  buildAgentEvalMetrics,
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

  it("builds a schema-valid run with identity, tool, and aggregate metrics", () => {
    const firstUsage = adaptAgentUsage(
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
    const secondUsage = adaptAgentUsage(
      codexUsageEvent({
        input_tokens: 200,
        cached_input_tokens: 100,
        cache_write_input_tokens: 20,
        output_tokens: 30,
        reasoning_output_tokens: 5,
      }),
      "codex",
      LUNA_MODEL,
    );
    const metrics = buildAgentEvalMetrics({
      runId: "run-1",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:03.000Z",
      records: [
        {
          workloadId: "pkg-info",
          requestedModel: LUNA_MODEL,
          resolvedModel: LUNA_MODEL,
          agent: "codex",
          agentVersion: "0.150.1",
          reasoningEffort: "low",
          surface: "mcp",
          server: "local",
          guidanceProfile: "descriptors",
          experimentalTools: false,
          publishedPackage: null,
          targetGit: { branch: "main", sha: "abc123", dirty: false },
          startedAt: "2026-08-28T10:00:00.000Z",
          completedAt: "2026-08-28T10:00:01.000Z",
          durationMs: 1000,
          processStatus: "success",
          finalStatus: "success",
          exitCode: 0,
          timedOut: false,
          usage: firstUsage,
          toolCalls: [
            {
              tool: "mcp__githits__pkg_info",
              server: "githits",
              status: "in_progress",
            },
            {
              tool: "githits.pkg_info",
              server: "githits",
              status: "completed",
            },
            {
              tool: "githits.pkg_info",
              server: "githits",
              status: "completed",
            },
            {
              tool: "search",
              server: "githits-cli",
              status: "completed",
              resultBytes: 12,
            },
            {
              tool: "pkg_vulns",
              server: "githits",
              status: "error",
              error: "backend unavailable",
            },
          ],
          artifacts: {
            toolCalls: "workloads/pkg-info/tool-calls.json",
            final: "workloads/pkg-info/final.json",
          },
        },
        {
          workloadId: "docs-search",
          requestedModel: LUNA_MODEL,
          resolvedModel: null,
          agent: "codex",
          agentVersion: null,
          reasoningEffort: "low",
          surface: "mcp",
          server: "local",
          guidanceProfile: "full",
          experimentalTools: false,
          publishedPackage: null,
          targetGit: { branch: null, sha: null, dirty: null },
          startedAt: null,
          completedAt: null,
          durationMs: 2000,
          processStatus: "timeout",
          finalStatus: null,
          exitCode: null,
          timedOut: true,
          usage: secondUsage,
          toolCalls: [
            {
              tool: "docs_search",
              server: "githits",
              status: "completed",
            },
          ],
          artifacts: {},
        },
      ],
    });

    expect(agentEvalMetricsSchema.parse(metrics)).toEqual(metrics);
    expect(metrics.runId).toBe("run-1");
    expect(metrics.records[0]).toMatchObject({
      workloadId: "pkg-info",
      requestedModel: LUNA_MODEL,
      resolvedModel: LUNA_MODEL,
      agentVersion: "0.150.1",
      targetGit: { branch: "main", sha: "abc123", dirty: false },
      processStatus: "success",
      finalStatus: "success",
      durationMs: 1000,
      exitCode: 0,
      timedOut: false,
      artifacts: {
        toolCalls: "workloads/pkg-info/tool-calls.json",
      },
    });
    expect(metrics.records[0]?.tools).toEqual({
      rawEventCount: 5,
      logicalCallCount: 5,
      completedCount: 3,
      failedCount: 1,
      uniqueTools: ["pkg_info", "pkg_vulns", "search"],
      sequence: [
        { tool: "pkg_info", surface: "mcp", status: "started" },
        { tool: "pkg_info", surface: "mcp", status: "completed" },
        { tool: "pkg_info", surface: "mcp", status: "completed" },
        { tool: "search", surface: "cli", status: "completed" },
        { tool: "pkg_vulns", surface: "mcp", status: "failed" },
      ],
      resultBytes: 12,
    });
    expect(metrics.aggregates).toMatchObject({
      workloadCount: 2,
      succeededCount: 1,
      failedCount: 0,
      timedOutCount: 1,
      durationMs: 3000,
      logicalToolCalls: 6,
      uncachedInputTokens: 120,
      cachedInputTokens: 140,
      cacheWriteInputTokens: 40,
      outputTokens: 40,
      reasoningOutputTokens: 9,
      baseRateEstimatedCostUsd: 0.0000848,
    });
  });

  it("excludes unknown usage, cost, and duration from aggregate totals", () => {
    const unknown = buildAgentEvalMetrics({
      runId: "run-unknown",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:01.000Z",
      records: [
        {
          workloadId: "unknown",
          requestedModel: "haiku",
          resolvedModel: null,
          agent: "claude",
          agentVersion: null,
          reasoningEffort: null,
          surface: "mcp",
          server: "local",
          guidanceProfile: "descriptors",
          experimentalTools: false,
          publishedPackage: null,
          targetGit: { branch: null, sha: null, dirty: null },
          startedAt: null,
          completedAt: null,
          durationMs: null,
          processStatus: "failed",
          finalStatus: "failure",
          exitCode: 1,
          timedOut: false,
          usage: adaptAgentUsage("", "claude", "haiku"),
          toolCalls: [],
          artifacts: {},
        },
      ],
    });

    expect(unknown.aggregates.durationMs).toBeNull();
    expect(unknown.aggregates.uncachedInputTokens).toBeNull();
    expect(unknown.aggregates.cachedInputTokens).toBeNull();
    expect(unknown.aggregates.cacheWriteInputTokens).toBeNull();
    expect(unknown.aggregates.outputTokens).toBeNull();
    expect(unknown.aggregates.reasoningOutputTokens).toBeNull();
    expect(unknown.aggregates.baseRateEstimatedCostUsd).toBeNull();
    expect(unknown.aggregates.logicalToolCalls).toBeNull();
  });
});
