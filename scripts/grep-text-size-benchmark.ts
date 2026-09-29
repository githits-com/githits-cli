import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseGrepResult } from "../packages/core-internal/src/services/grep-service.js";
import mixed100 from "../packages/mcp/src/shared/fixtures/grep-text/mixed-100.json";
import repository100 from "../packages/mcp/src/shared/fixtures/grep-text/repository-100.json";
import { formatGrepText } from "../packages/mcp/src/shared/grep-text.js";

interface BenchmarkCase {
  name: string;
  input: unknown;
  beforeBytes: number;
}

interface BenchmarkResult {
  case: string;
  matches: number;
  beforeBytes: number;
  afterBytes: number;
  afterLines: number;
  byteReductionPercent: number;
}

const cases: BenchmarkCase[] = [
  { name: "mixed-100", input: mixed100, beforeBytes: 23509 },
  { name: "repository-100", input: repository100, beforeBytes: 19487 },
];

async function main(): Promise<void> {
  const outputDir = parseOutputDirectory(process.argv.slice(2));
  if (outputDir) await mkdir(outputDir, { recursive: true });

  const results: BenchmarkResult[] = [];
  for (const benchmarkCase of cases) {
    const parsed = parseGrepResult(benchmarkCase.input);
    const rendered = `${formatGrepText(parsed, {
      useColors: false,
      width: 80,
      syntax: "cli",
    })}\n`;
    if (outputDir)
      await writeFile(join(outputDir, `${benchmarkCase.name}.txt`), rendered);

    const afterBytes = Buffer.byteLength(rendered, "utf8");
    const reduction = (1 - afterBytes / benchmarkCase.beforeBytes) * 100;
    results.push({
      case: benchmarkCase.name,
      matches: parsed.totalMatches,
      beforeBytes: benchmarkCase.beforeBytes,
      afterBytes,
      afterLines: countNewlines(rendered),
      byteReductionPercent: Number(reduction.toFixed(1)),
    });
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  const belowBudget = results.filter(
    (result) => (1 - result.afterBytes / result.beforeBytes) * 100 < 65,
  );
  if (belowBudget.length > 0) {
    for (const result of belowBudget)
      process.stderr.write(
        `${result.case} byte reduction is below the 65% minimum\n`,
      );
    process.exitCode = 1;
  }
}

function parseOutputDirectory(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--output-dir" && args[1])
    return resolve(args[1]);
  throw new Error("Usage: grep-text-size-benchmark [--output-dir <path>]");
}

function countNewlines(value: string): number {
  return value.match(/\n/g)?.length ?? 0;
}

await main();
