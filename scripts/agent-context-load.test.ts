import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createContextInventory,
  extractContextObservation,
  measureContent,
  replayContext,
  summarizeObservedUsage,
} from "./agent-context-load.js";

const inventory = {
  schemaVersion: 1,
  serialization: "githits-content-inventory-v1",
  blocks: { catalog: "abc", skill: "de", definition: "🙂" },
};

describe("context replay", () => {
  it("separates Unicode characters, UTF-16 units and UTF-8 bytes", () => {
    expect(measureContent("aé🙂")).toEqual({
      unicodeCharacters: 3,
      utf16CodeUnits: 4,
      utf8Bytes: 7,
    });
  });

  it("counts deferred loading, retention and removal across model requests", () => {
    const report = replayContext(inventory, {
      schemaVersion: 1,
      description: "deferred tools",
      evidence: "synthetic unit fixture",
      requests: [
        { label: "initial", blocks: ["catalog"] },
        {
          label: "loaded",
          blocks: ["catalog", "skill", "definition"],
          repeat: 3,
        },
        { label: "removed", blocks: ["catalog"] },
      ],
    });
    expect(report.modelRequests).toBe(5);
    expect(report.cumulative).toEqual({
      unicodeCharacters: 24,
      utf16CodeUnits: 27,
      utf8Bytes: 33,
    });
    expect(report.inputTokens).toBeNull();
  });

  it("counts duplicate output admissions rather than silently deduplicating", () => {
    const report = replayContext(inventory, {
      schemaVersion: 1,
      description: "repeated read",
      evidence: "synthetic unit fixture",
      requests: [{ label: "duplicate", blocks: ["skill", "skill"] }],
    });
    expect(report.cumulative.unicodeCharacters).toBe(4);
  });

  it("rejects unknown blocks and invalid request counts", () => {
    const replay = {
      schemaVersion: 1,
      description: "invalid",
      evidence: "synthetic unit fixture",
      requests: [{ label: "missing", blocks: ["missing"] }],
    };
    expect(() => replayContext(inventory, replay)).toThrow(
      "Unknown content block",
    );
    expect(() =>
      replayContext(inventory, {
        ...replay,
        requests: [{ label: "invalid", blocks: [], repeat: 0 }],
      }),
    ).toThrow();
  });

  it("identifies inventory content independently of insertion order", () => {
    const replay = {
      schemaVersion: 1,
      description: "hash",
      evidence: "synthetic unit fixture",
      requests: [{ label: "initial", blocks: [] }],
    };
    const reversed = {
      ...inventory,
      blocks: { definition: "🙂", skill: "de", catalog: "abc" },
    };
    expect(replayContext(inventory, replay).inventorySha256).toBe(
      replayContext(reversed, replay).inventorySha256,
    );
  });

  it("inventories current canonical tools and both bootstrap delivery paths", async () => {
    const current = await createContextInventory();
    expect(current.blocks["skill.file"]).toContain(
      current.blocks["bootstrap.stable"] ?? "missing",
    );
    const grep = JSON.parse(
      current.blocks["tool.code_grep.definition"] ?? "{}",
    );
    expect(grep.inputSchema.properties.target).toBeDefined();
    expect(current.blocks["catalog.prefix80"]).toContain("code_grep:");
  });
});

describe("observed context usage", () => {
  it("does not expose malformed raw transcript text through CLI errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "context-privacy-"));
    try {
      const path = join(directory, "invalid.jsonl");
      await writeFile(path, "private-content-sentinel is not JSON");
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "agent-context-load.ts"),
          "observe",
          "claude",
          path,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).not.toContain("private-content-sentinel");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  it("preserves completed Claude output without inventing per-request allocation", () => {
    const result = extractContextObservation("claude", [
      {
        type: "assistant",
        message: {
          id: "one",
          model: "test",
          usage: {
            input_tokens: 2,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 3,
            output_tokens: 1,
          },
        },
      },
      {
        type: "result",
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 3,
          output_tokens: 41,
        },
      },
    ]);
    expect(result.requests[0]?.output).toBeNull();
    expect(summarizeObservedUsage(result).cumulativeOutput).toBe(41);
  });
  it("deduplicates split Claude message usage and exports no transcript content", () => {
    const message = {
      id: "one",
      model: "test-model",
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 3,
        output_tokens: 4,
      },
      content: [{ type: "text", text: "private-content-sentinel" }],
    };
    const result = extractContextObservation("claude", [
      { type: "assistant", message },
      { type: "assistant", message },
      { type: "assistant", message: { ...message, id: "two" } },
    ]);
    expect(result.requests).toHaveLength(2);
    expect(summarizeObservedUsage(result).cumulativeInput).toBe(30);
    expect(JSON.stringify(result)).not.toContain("private-content-sentinel");
    expect(JSON.stringify(result)).not.toContain('"id"');
  });

  it("extracts native Codex request counters without using cumulative counters", () => {
    const result = extractContextObservation("codex", [
      { type: "turn_context", payload: { model: "configured-model" } },
      { type: "event_msg", payload: { type: "token_count", info: null } },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 1000 },
            last_token_usage: {
              input_tokens: 50,
              cached_input_tokens: 30,
              cache_write_input_tokens: 5,
              output_tokens: 3,
            },
          },
        },
      },
    ]);
    expect(summarizeObservedUsage(result).cumulativeInput).toBe(50);
    expect(summarizeObservedUsage(result).cumulativeUncachedInput).toBe(15);
    expect(() => extractContextObservation("codex", [])).toThrow();
  });
  it("normalizes inclusive and uncached-only inputs without double counting", () => {
    const observation = {
      schemaVersion: 1,
      evidence: "synthetic provider fixture",
      host: "test",
      model: "test",
      inputConvention: "inclusive",
      requests: [
        {
          label: "first",
          input: 100,
          cacheRead: 40,
          cacheWrite: 50,
          output: 5,
        },
        {
          label: "last",
          input: 120,
          cacheRead: 100,
          cacheWrite: 10,
          output: 6,
        },
      ],
    };
    const inclusive = summarizeObservedUsage(observation);
    const additive = summarizeObservedUsage({
      ...observation,
      inputConvention: "uncached-only",
      requests: observation.requests.map((r) => ({ ...r, input: 10 })),
    });
    expect(additive).toEqual(inclusive);
    expect(inclusive.inputGrowth).toBe(20);
    expect(inclusive.cumulativeInput).toBe(220);
    expect(inclusive.cumulativeUncachedInput).toBe(20);
    expect(inclusive.cumulativeOutput).toBe(11);
  });

  it("does not silently treat missing or contradictory usage as zero", () => {
    const observation = {
      schemaVersion: 1,
      evidence: "invalid fixture",
      host: "test",
      model: "test",
      inputConvention: "inclusive",
      requests: [
        { label: "bad", input: 3, cacheRead: 4, cacheWrite: 0, output: 1 },
      ],
    };
    expect(() => summarizeObservedUsage(observation)).toThrow("Cache buckets");
    expect(() =>
      summarizeObservedUsage({
        ...observation,
        terminalOutputTokens: 2,
        requests: [{ ...observation.requests[0], cacheRead: 0 }],
      }),
    ).toThrow("Per-request output does not reconcile");
    expect(() =>
      summarizeObservedUsage({
        ...observation,
        requests: [{ label: "missing" }],
      }),
    ).toThrow();
  });
});
