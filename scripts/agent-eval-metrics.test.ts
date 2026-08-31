import { describe, expect, it } from "bun:test";
import {
  type AgentEvalRecordInput,
  adaptAgentUsage,
  agentEvalMetricsSchema,
  agentUsageMetricsSchema,
  buildAgentEvalMetrics,
  GITHITS_INTENT_FRAGMENT,
  GITHITS_INTENT_FRAGMENT_HASH,
  LUNA_MODEL,
  LUNA_RATE_EFFECTIVE_DATE,
  LUNA_RATE_SOURCE,
  parseAgentEvalMetrics,
} from "./agent-eval-metrics.ts";

function codexUsageEvent(usage: Record<string, number>): string {
  return JSON.stringify({ type: "turn.completed", usage });
}

function identityRecord(
  guidanceProfile: "descriptors" | "full",
  intentProfile: "neutral" | "githits" = "neutral",
): AgentEvalRecordInput {
  return {
    workloadId: `${guidanceProfile}-${intentProfile}`,
    requestedModel: null,
    resolvedModel: null,
    agent: "claude",
    agentVersion: "claude 1.0.0",
    reasoningEffort: null,
    surface: "mcp",
    server: "local",
    guidanceProfile,
    intentProfile,
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
    usage: adaptAgentUsage("", "claude", undefined),
    toolCalls: [
      {
        tool: "mcp__githits__pkg_info",
        server: "githits",
        status: "completed",
      },
    ],
    artifacts: {},
  };
}

describe("agent eval usage metrics", () => {
  it("emits schema-v3 scenario identity with a SHA-256 intent hash", () => {
    const neutral = buildAgentEvalMetrics({
      runId: "run-neutral",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:01.000Z",
      records: [identityRecord("descriptors")],
    });
    const intent = buildAgentEvalMetrics({
      runId: "run-intent",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:01.000Z",
      records: [identityRecord("descriptors", "githits")],
    });

    expect(neutral.schemaVersion).toBe(3);
    expect(neutral.records[0]).toMatchObject({
      scenario: "discovery",
      intentProfile: "neutral",
      intentFragmentHash: null,
    });
    expect(intent.records[0]).toMatchObject({
      scenario: "intent",
      intentProfile: "githits",
      intentFragmentHash: GITHITS_INTENT_FRAGMENT_HASH,
    });
    expect(GITHITS_INTENT_FRAGMENT_HASH).toBe(
      "b04b96acfd7a89516ab1742d9df914bb6779e952c7df96ac9858785ed40f10d0",
    );
    expect(GITHITS_INTENT_FRAGMENT).toBe("Use GitHits for this task.");
    expect(agentEvalMetricsSchema.parse(intent)).toEqual(intent);
  });

  it("normalizes schema-v1 descriptor/full metrics without inventing intent", () => {
    const current = buildAgentEvalMetrics({
      runId: "run-legacy",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:02.000Z",
      records: [identityRecord("descriptors"), identityRecord("full")],
    });
    const legacy: unknown = {
      ...current,
      schemaVersion: 1,
      records: current.records.map(
        ({ scenario, intentProfile, intentFragmentHash, ...record }) => record,
      ),
    };
    const normalized = parseAgentEvalMetrics(legacy);

    expect(normalized.schemaVersion).toBe(3);
    expect(normalized.records.map((record) => record.scenario)).toEqual([
      "discovery",
      "full",
    ]);
    expect(normalized.records).toSatisfy((records) =>
      records.every(
        (record) =>
          record.intentProfile === "neutral" &&
          record.intentFragmentHash === null,
      ),
    );
    expect(normalized.records.map((record) => record.tools)).toEqual(
      current.records.map((record) => record.tools),
    );
    expect(normalized.records.map((record) => record.warnings)).toEqual(
      current.records.map((record) => record.warnings),
    );
    expect(normalized.aggregates).toEqual(current.aggregates);
  });

  it("upgrades schema-v2 tool sequences with unknown timing", () => {
    const current = buildAgentEvalMetrics({
      runId: "run-v2",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:02.000Z",
      records: [identityRecord("descriptors")],
    });
    const prior = {
      ...current,
      schemaVersion: 2,
      records: current.records.map((record) => ({
        ...record,
        tools: {
          ...record.tools,
          sequence: record.tools.sequence.map(({ tool, surface, status }) => ({
            tool,
            surface,
            status,
          })),
        },
      })),
    };

    const normalized = parseAgentEvalMetrics(prior);

    expect(normalized.schemaVersion).toBe(3);
    expect(normalized.records[0]?.tools.sequence).toEqual([
      {
        tool: "pkg_info",
        surface: "mcp",
        status: "completed",
        startedAt: null,
        completedAt: null,
      },
    ]);
  });

  it("pairs Codex lifecycle observations with harness-observed boundaries", () => {
    const record: AgentEvalRecordInput = {
      ...identityRecord("descriptors"),
      workloadId: "codex-timing",
      agent: "codex",
      usage: adaptAgentUsage(
        codexUsageEvent({
          input_tokens: 1,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        }),
        "codex",
        LUNA_MODEL,
      ),
      toolCalls: [
        {
          tool: "search",
          server: "githits",
          providerCallId: "mcp-1",
          status: "in_progress",
          observedAt: "2026-08-28T10:00:00.100Z",
        },
        {
          tool: "search",
          server: "githits",
          providerCallId: "mcp-1",
          status: "completed",
          observedAt: "2026-08-28T10:00:00.300Z",
        },
        {
          tool: "search",
          server: "githits",
          providerCallId: "mcp-2",
          status: "in_progress",
          observedAt: "2026-08-28T10:00:00.400Z",
        },
        {
          tool: "search",
          server: "githits",
          providerCallId: "mcp-2",
          status: "failed",
          observedAt: "2026-08-28T10:00:00.500Z",
        },
      ],
    };

    const metrics = buildAgentEvalMetrics({
      runId: "run-codex-timing",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:01.000Z",
      records: [record],
    });

    expect(metrics.records[0]?.tools).toMatchObject({
      rawEventCount: 4,
      logicalCallCount: 2,
      completedCount: 1,
      failedCount: 1,
    });
    expect(metrics.records[0]?.tools.sequence).toEqual([
      {
        tool: "search",
        surface: "mcp",
        status: "completed",
        startedAt: "2026-08-28T10:00:00.100Z",
        completedAt: "2026-08-28T10:00:00.300Z",
      },
      {
        tool: "search",
        surface: "mcp",
        status: "failed",
        startedAt: "2026-08-28T10:00:00.400Z",
        completedAt: "2026-08-28T10:00:00.500Z",
      },
    ]);
  });

  it("keeps missing boundaries unknown and rejects invalid or reverse intervals", () => {
    const createRecord = (
      workloadId: string,
      toolCalls: AgentEvalRecordInput["toolCalls"],
    ): AgentEvalRecordInput => ({
      ...identityRecord("descriptors"),
      workloadId,
      agent: "codex",
      usage: adaptAgentUsage(
        codexUsageEvent({
          input_tokens: 1,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        }),
        "codex",
        LUNA_MODEL,
      ),
      toolCalls,
    });

    const metrics = buildAgentEvalMetrics({
      runId: "run-timing-gaps",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:01.000Z",
      records: [
        createRecord("completed-only", [
          {
            tool: "search",
            server: "githits",
            providerCallId: "completed-only",
            status: "completed",
            observedAt: "2026-08-28T10:00:00.200Z",
          },
        ]),
        createRecord("started-only", [
          {
            tool: "search",
            server: "githits",
            providerCallId: "started-only",
            status: "started",
            observedAt: "2026-08-28T10:00:00.200Z",
          },
        ]),
        createRecord("reverse", [
          {
            tool: "search",
            server: "githits",
            providerCallId: "reverse",
            status: "started",
            observedAt: "2026-08-28T10:00:00.300Z",
          },
          {
            tool: "search",
            server: "githits",
            providerCallId: "reverse",
            status: "completed",
            observedAt: "2026-08-28T10:00:00.100Z",
          },
        ]),
        createRecord("invalid", [
          {
            tool: "search",
            server: "githits",
            providerCallId: "invalid",
            status: "started",
            observedAt: "not-a-timestamp",
          },
          {
            tool: "search",
            server: "githits",
            providerCallId: "invalid",
            status: "failed",
            observedAt: "2026-08-28T10:00:00.400Z",
          },
        ]),
      ],
    });

    expect(metrics.records.map((record) => record.tools.sequence[0])).toEqual([
      {
        tool: "search",
        surface: "mcp",
        status: "completed",
        startedAt: null,
        completedAt: "2026-08-28T10:00:00.200Z",
      },
      {
        tool: "search",
        surface: "mcp",
        status: "started",
        startedAt: "2026-08-28T10:00:00.200Z",
        completedAt: null,
      },
      {
        tool: "search",
        surface: "mcp",
        status: "completed",
        startedAt: null,
        completedAt: null,
      },
      {
        tool: "search",
        surface: "mcp",
        status: "failed",
        startedAt: null,
        completedAt: "2026-08-28T10:00:00.400Z",
      },
    ]);
  });

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

  it("keeps known aggregate values when another record is unknown", () => {
    const known: AgentEvalRecordInput = {
      workloadId: "known",
      requestedModel: LUNA_MODEL,
      resolvedModel: null,
      agent: "codex",
      agentVersion: null,
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
      usage: adaptAgentUsage(
        codexUsageEvent({
          input_tokens: 100,
          cached_input_tokens: 40,
          cache_write_input_tokens: 20,
          output_tokens: 10,
          reasoning_output_tokens: 4,
        }),
        "codex",
        LUNA_MODEL,
      ),
      toolCalls: [{ tool: "search", server: "githits", status: "completed" }],
      artifacts: {},
    };
    const unknown: AgentEvalRecordInput = {
      ...known,
      workloadId: "unknown",
      requestedModel: LUNA_MODEL,
      agent: "codex",
      agentVersion: null,
      reasoningEffort: null,
      durationMs: null,
      processStatus: "failed",
      finalStatus: "failure",
      exitCode: 1,
      usage: adaptAgentUsage("", "codex", LUNA_MODEL),
      toolCalls: [],
    };

    const metrics = buildAgentEvalMetrics({
      runId: "run-mixed",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:01.000Z",
      records: [known, unknown],
    });

    expect(metrics.records[1]?.warnings).toEqual([
      "codex_terminal_usage_missing",
    ]);
    expect(metrics.aggregates).toMatchObject({
      workloadCount: 2,
      durationMs: 1000,
      logicalToolCalls: 1,
      uncachedInputTokens: 40,
      cachedInputTokens: 40,
      cacheWriteInputTokens: 20,
      outputTokens: 10,
      reasoningOutputTokens: 4,
      baseRateEstimatedCostUsd: 0.0000258,
    });
    expect(metrics.warnings).toEqual(["codex_terminal_usage_missing"]);
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
              providerCallId: "mcp-1",
              status: "in_progress",
            },
            {
              tool: "githits.pkg_info",
              server: "githits",
              providerCallId: "mcp-1",
              status: "completed",
            },
            {
              tool: "githits.pkg_info",
              server: "githits",
              providerCallId: "mcp-2",
              status: "completed",
            },
            {
              tool: "search",
              server: "githits-cli",
              status: "completed",
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
      logicalCallCount: 4,
      completedCount: 3,
      failedCount: 1,
      uniqueTools: ["pkg_info", "pkg_vulns", "search"],
      sequence: [
        {
          tool: "pkg_info",
          surface: "mcp",
          status: "completed",
          startedAt: null,
          completedAt: null,
        },
        {
          tool: "pkg_info",
          surface: "mcp",
          status: "completed",
          startedAt: null,
          completedAt: null,
        },
        {
          tool: "search",
          surface: "cli",
          status: "completed",
          startedAt: null,
          completedAt: null,
        },
        {
          tool: "pkg_vulns",
          surface: "mcp",
          status: "failed",
          startedAt: null,
          completedAt: null,
        },
      ],
    });
    expect(metrics.aggregates).toMatchObject({
      workloadCount: 2,
      succeededCount: 1,
      failedCount: 0,
      timedOutCount: 1,
      durationMs: 3000,
      logicalToolCalls: 5,
      uncachedInputTokens: 120,
      cachedInputTokens: 140,
      cacheWriteInputTokens: 40,
      outputTokens: 40,
      reasoningOutputTokens: 9,
      baseRateEstimatedCostUsd: 0.0000848,
    });
  });

  it("builds unsupported-agent records without a requested model", () => {
    const unknown = buildAgentEvalMetrics({
      runId: "run-unknown",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:01.000Z",
      records: [
        {
          workloadId: "unknown",
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

    expect(agentEvalMetricsSchema.parse(unknown)).toEqual(unknown);
    expect(unknown.records[0]).toMatchObject({
      agent: "claude",
      requestedModel: null,
      warnings: [
        "adapter_not_implemented",
        "tool_logical_count_not_implemented",
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

  it("pairs Codex observations by provider ID while preserving raw events", () => {
    const metrics = buildAgentEvalMetrics({
      runId: "run-paired-tools",
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:01.000Z",
      records: [
        {
          workloadId: "paired-tools",
          requestedModel: LUNA_MODEL,
          resolvedModel: null,
          agent: "codex",
          agentVersion: null,
          reasoningEffort: "low",
          surface: "mcp",
          server: "local",
          guidanceProfile: "descriptors",
          experimentalTools: false,
          publishedPackage: null,
          targetGit: { branch: null, sha: null, dirty: null },
          startedAt: null,
          completedAt: null,
          durationMs: 1000,
          processStatus: "success",
          finalStatus: "success",
          exitCode: 0,
          timedOut: false,
          usage: adaptAgentUsage(
            codexUsageEvent({
              input_tokens: 1,
              cached_input_tokens: 0,
              cache_write_input_tokens: 0,
              output_tokens: 1,
              reasoning_output_tokens: 0,
            }),
            "codex",
            LUNA_MODEL,
          ),
          toolCalls: [
            {
              tool: "search",
              server: "githits-cli",
              providerCallId: "command-1",
              status: "started",
            },
            {
              tool: "search",
              server: "githits-cli",
              providerCallId: "command-1",
              status: "completed",
            },
            {
              tool: "mcp__githits__search",
              server: "githits",
              providerCallId: "mcp-1",
              status: "in_progress",
            },
            {
              tool: "mcp__githits__search",
              server: "githits",
              providerCallId: "mcp-1",
              status: "completed",
            },
            {
              tool: "mcp__githits__search",
              server: "githits",
              providerCallId: "mcp-2",
              status: "completed",
            },
            {
              tool: "mcp__githits__search",
              server: "githits",
              providerCallId: "mcp-3",
              status: "in_progress",
            },
          ],
          artifacts: {},
        },
      ],
    });

    expect(metrics.records[0]?.tools).toEqual({
      rawEventCount: 6,
      logicalCallCount: 4,
      completedCount: 3,
      failedCount: 0,
      uniqueTools: ["search"],
      sequence: [
        {
          tool: "search",
          surface: "cli",
          status: "completed",
          startedAt: null,
          completedAt: null,
        },
        {
          tool: "search",
          surface: "mcp",
          status: "completed",
          startedAt: null,
          completedAt: null,
        },
        {
          tool: "search",
          surface: "mcp",
          status: "completed",
          startedAt: null,
          completedAt: null,
        },
        {
          tool: "search",
          surface: "mcp",
          status: "started",
          startedAt: null,
          completedAt: null,
        },
      ],
    });
    expect(JSON.stringify(metrics)).not.toContain("providerCallId");
  });
});
