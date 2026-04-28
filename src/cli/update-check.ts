import type {
  UpdateCheckNotice,
  UpdateCheckService,
} from "../services/index.js";
import { formatUpdateNotice, shouldRunUpdateCheck } from "../services/index.js";

export interface UpdateCheckTask {
  promise: Promise<UpdateCheckNotice | undefined>;
  abort: () => void;
}

export interface UpdateCheckOutput {
  write(chunk: string): unknown;
}

export function startUpdateCheckTask(
  service: UpdateCheckService,
): UpdateCheckTask {
  const controller = new AbortController();
  return {
    promise: service.checkForUpdate(controller.signal),
    abort: () => controller.abort(),
  };
}

export function startUpdateCheckTaskForInvocation(options: {
  args: string[];
  env: Record<string, string | undefined>;
  stderrIsTTY: boolean;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  createService: () => UpdateCheckService;
}): UpdateCheckTask | undefined {
  if (
    !shouldRunUpdateCheck({
      args: options.args,
      env: options.env,
      stderrIsTTY: options.stderrIsTTY,
      stdinIsTTY: options.stdinIsTTY,
      stdoutIsTTY: options.stdoutIsTTY,
    })
  ) {
    return undefined;
  }

  return startUpdateCheckTask(options.createService());
}

export async function runWithUpdateCheckFlush<T>(
  action: () => Promise<T>,
  task: UpdateCheckTask | undefined,
  options: {
    stderr: UpdateCheckOutput;
    timeoutMs?: number;
  },
): Promise<T> {
  try {
    return await action();
  } finally {
    await flushUpdateCheckNotice(task, options);
  }
}

export async function flushUpdateCheckNotice(
  task: UpdateCheckTask | undefined,
  options: {
    stderr: UpdateCheckOutput;
    timeoutMs?: number;
  },
): Promise<void> {
  if (!task) {
    return;
  }

  const timeoutMs = options.timeoutMs ?? 50;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const result = await Promise.race([task.promise, timeoutPromise]);
  if (timeout) {
    clearTimeout(timeout);
  }

  if (result === "timeout") {
    task.abort();
    return;
  }

  if (!result) {
    return;
  }

  options.stderr.write(`${formatUpdateNotice(result)}\n`);
}
