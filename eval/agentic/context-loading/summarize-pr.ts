import { readFile } from "node:fs/promises";

const METRICS = [
  "inputTokens",
  "cachedInputTokens",
  "uncachedInputTokens",
  "outputTokens",
  "estimatedCostUsd",
  "mcpCalls",
  "toolErrors",
] as const;
type Metric = (typeof METRICS)[number];
interface Cell extends Record<Metric, number> {
  cellId: string;
  scenario: string;
}
interface Run {
  variant: "baseline" | "candidate";
  cells: Cell[];
}

interface MetricSummary {
  totals: number[];
  medianTotal: number;
  minTotal: number;
  maxTotal: number;
  sumOfCellMedians: number;
}
interface ScenarioSummary {
  scenario: string;
  metrics: Record<
    Metric,
    { baseline: MetricSummary; candidate: MetricSummary }
  >;
}

function median(values: number[]): number {
  const [, middle] = [...values].sort((a, b) => a - b);
  if (values.length !== 3 || middle === undefined) {
    throw new Error("Expected three values for a median");
  }
  return middle;
}

/** Reproduce descriptive three-run summaries from the sanitized PR observations. */
export function summarizePrRuns(runs: Run[]): ScenarioSummary[] {
  const cohorts = {
    baseline: runs.filter((run) => run.variant === "baseline"),
    candidate: runs.filter((run) => run.variant === "candidate"),
  };
  const first = runs.find((run) => run.variant === "baseline");
  if (
    !first ||
    cohorts.baseline.length !== 3 ||
    cohorts.candidate.length !== 3
  ) {
    throw new Error("Expected three complete runs per condition");
  }
  const cellIds = first.cells.map((cell) => cell.cellId).sort();
  for (const run of runs) {
    const ids = run.cells.map((cell) => cell.cellId).sort();
    if (
      new Set(ids).size !== ids.length ||
      JSON.stringify(ids) !== JSON.stringify(cellIds)
    ) {
      throw new Error("Run cell identities must be unique and matched");
    }
  }
  return ["discovery", "intent", "full"].map((scenario) => {
    const metrics = Object.fromEntries(
      METRICS.map((metric) => {
        const summarize = (cohort: Run[]): MetricSummary => {
          const totals = cohort.map((run) =>
            run.cells
              .filter((cell) => cell.scenario === scenario)
              .reduce((sum, cell) => sum + cell[metric], 0),
          );
          const perCellMedians = first.cells
            .filter((cell) => cell.scenario === scenario)
            .map((cell) =>
              median(
                cohort.flatMap((run) =>
                  run.cells
                    .filter((item) => item.cellId === cell.cellId)
                    .map((item) => item[metric]),
                ),
              ),
            );
          return {
            totals,
            medianTotal: median(totals),
            minTotal: Math.min(...totals),
            maxTotal: Math.max(...totals),
            sumOfCellMedians: perCellMedians.reduce(
              (sum, value) => sum + value,
              0,
            ),
          };
        };
        return [
          metric,
          {
            baseline: summarize(cohorts.baseline),
            candidate: summarize(cohorts.candidate),
          },
        ];
      }),
    ) as ScenarioSummary["metrics"];
    return { scenario, metrics };
  });
}

if (import.meta.main) {
  const path = process.argv[2];
  if (process.argv.length !== 3 || !path) {
    throw new Error("Usage: summarize-pr.ts <sanitized-observations.json>");
  }
  const observations = JSON.parse(await readFile(path, "utf8")) as {
    runs: Run[];
  };
  process.stdout.write(
    `${JSON.stringify(summarizePrRuns(observations.runs), null, 2)}\n`,
  );
}
