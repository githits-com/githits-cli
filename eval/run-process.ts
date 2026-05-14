/**
 * Subprocess runner shared across the eval harness drivers. Lifted from
 * the same `Bun.spawn` shape used in `scripts/cli-smoke.ts` and
 * `scripts/mcp-smoke.ts`. Kept minimal — drivers parse stdout themselves.
 */

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  /** Command + args. */
  cmd: readonly string[];
  /** Optional working directory for the subprocess. */
  cwd?: string;
  /** Optional stdin to write before closing. */
  stdin?: string;
  /** Optional env overrides on top of `process.env`. */
  env?: Record<string, string | undefined>;
  /** Optional timeout in ms. If set, the process is killed when exceeded. */
  timeoutMs?: number;
}

export async function runProcess(
  opts: RunProcessOptions,
): Promise<ProcessResult> {
  const proc = Bun.spawn([...opts.cmd], {
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? undefined : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts.env },
  });

  if (opts.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }

  const timeout = opts.timeoutMs
    ? setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // already exited
        }
      }, opts.timeoutMs)
    : undefined;

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function isCommandAvailable(cmd: string): Promise<boolean> {
  const result = await runProcess({ cmd: ["which", cmd], timeoutMs: 2000 });
  return result.exitCode === 0;
}
