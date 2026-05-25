interface SmokeTiming {
  name: string;
  elapsedMs: number;
}

const smokeTimings: SmokeTiming[] = [];
const smokeStartedAt = Date.now();

function logSmoke(message: string): void {
  process.stderr.write(`[smoke] ${message}\n`);
}

function formatMs(ms: number): string {
  return `${ms}ms`;
}

export function formatCliCommand(args: string[]): string {
  const redacted = [...args];
  for (let index = 0; index < redacted.length - 1; index += 1) {
    if (["--token", "--api-token"].includes(redacted[index] ?? "")) {
      redacted[index + 1] = "<redacted>";
    }
  }
  return `githits ${redacted.join(" ")}`;
}

export function summarizeMcpArgs(args: Record<string, unknown>): string {
  const summary: Record<string, unknown> = {};
  for (const key of [
    "registry",
    "package_name",
    "version",
    "query",
    "language",
    "path",
    "path_prefix",
    "format",
    "limit",
    "lifecycle",
    "advisory_scope",
    "search_ref",
  ]) {
    if (key in args) summary[key] = args[key];
  }
  if ("target" in args) summary.target = args.target;
  return Object.keys(summary).length > 0 ? ` ${JSON.stringify(summary)}` : "";
}

export async function trackSmokeStep<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  logSmoke(`START ${name}`);
  try {
    const result = await fn();
    const elapsedMs = Date.now() - start;
    smokeTimings.push({ name, elapsedMs });
    logSmoke(`END ${name} ${formatMs(elapsedMs)}`);
    return result;
  } catch (error) {
    const elapsedMs = Date.now() - start;
    smokeTimings.push({ name, elapsedMs });
    logSmoke(`FAIL ${name} ${formatMs(elapsedMs)}`);
    throw error;
  }
}

export function printSmokeTimingSummary(): void {
  if (smokeTimings.length === 0) return;
  const totalMs = smokeTimings.reduce(
    (sum, timing) => sum + timing.elapsedMs,
    0,
  );
  logSmoke(
    `Timing summary: ${smokeTimings.length} steps, wall ${formatMs(Date.now() - smokeStartedAt)}, cumulative ${formatMs(totalMs)}`,
  );
  for (const timing of [...smokeTimings]
    .sort((left, right) => right.elapsedMs - left.elapsedMs)
    .slice(0, 10)) {
    logSmoke(`Slowest: ${timing.name} ${formatMs(timing.elapsedMs)}`);
  }
}

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async (_, workerIndex) => {
      for (
        let index = workerIndex;
        index < items.length;
        index += workerCount
      ) {
        await worker(items[index] as T);
      }
    }),
  );
}
