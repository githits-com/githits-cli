import { describe, expect, it } from "bun:test";
import { DESCRIPTION } from "../../../packages/mcp/src/tools/quick-start.js";

const WORKLOAD_URL = new URL(
  "./claude-ai-deferred-catalog.md",
  import.meta.url,
);

function renderDeferredCatalogSummary(description: string): string {
  const firstSentence = description.match(/^([^.]*\.)(?:\s|$)/)?.[1];
  if (firstSentence === undefined) {
    throw new Error(
      "quick_start description must start with one complete sentence; no period may appear inside it",
    );
  }

  return firstSentence.length > 79
    ? `${firstSentence.slice(0, 79)}…`
    : firstSentence;
}

describe("claude.ai deferred catalog workload", () => {
  it("uses the rendered production quick_start catalog sentence", async () => {
    const workload = await Bun.file(WORKLOAD_URL).text();
    const quickStartLines = workload
      .split(/\r?\n/)
      .filter((line) => line.startsWith("- GitHits:quick_start — "));

    expect(quickStartLines).toEqual([
      `- GitHits:quick_start — ${renderDeferredCatalogSummary(DESCRIPTION)}`,
    ]);
  });
});
