import { expect, it } from "bun:test";
import { summarizePrRuns } from "./summarize-pr.js";

function cell(cellId: string, inputTokens: number) {
  return {
    cellId,
    scenario: "full",
    inputTokens,
    cachedInputTokens: 0,
    uncachedInputTokens: inputTokens,
    outputTokens: 0,
    estimatedCostUsd: 0,
    mcpCalls: 0,
    toolErrors: 0,
  };
}

const runs = [
  ...(
    [
      [1, 100],
      [100, 1],
      [2, 2],
    ] as const
  ).map(([a, b]) => ({
    variant: "baseline" as const,
    cells: [cell("full/a", a), cell("full/b", b)],
  })),
  ...[3, 4, 5].map((value) => ({
    variant: "candidate" as const,
    cells: [cell("full/a", value), cell("full/b", value)],
  })),
];

it("distinguishes run-total medians from per-cell medians with rotating outliers", () => {
  const full = summarizePrRuns(runs).find((row) => row.scenario === "full");
  expect(full?.metrics.inputTokens.baseline).toEqual({
    totals: [101, 101, 4],
    medianTotal: 101,
    minTotal: 4,
    maxTotal: 101,
    sumOfCellMedians: 4,
  });
  expect(full?.metrics.inputTokens.candidate.medianTotal).toBe(8);
  expect(full?.metrics.inputTokens.candidate.sumOfCellMedians).toBe(8);
});

it("rejects incomplete repetitions and duplicate or mismatched cell identities", () => {
  expect(() => summarizePrRuns(runs.slice(1))).toThrow("three complete runs");
  const [first, ...rest] = runs;
  if (!first) throw new Error("Missing fixture");
  expect(() =>
    summarizePrRuns([
      { ...first, cells: [cell("full/a", 1), cell("full/a", 2)] },
      ...rest,
    ]),
  ).toThrow("unique and matched");
  expect(() =>
    summarizePrRuns([
      { ...first, cells: [cell("full/a", 1), cell("full/c", 2)] },
      ...rest,
    ]),
  ).toThrow("unique and matched");
});
