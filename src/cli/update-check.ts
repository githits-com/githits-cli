import type {
  RequiredUpdateNotice,
  UpdateCheckNotice,
  UpdateCheckService,
} from "../services/index.js";
import {
  formatRequiredUpdateNotice,
  formatUpdateNotice,
  shouldRunRequiredUpdateEnforcement,
  shouldRunUpdateCheck,
} from "../services/index.js";

export interface UpdateCheckTask {
  promise: Promise<UpdateCheckNotice | undefined>;
  abort: () => void;
}

export interface RequiredUpdateRefreshTask {
  promise: Promise<void>;
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

export function startRequiredUpdateRefreshTask(
  service: UpdateCheckService,
): RequiredUpdateRefreshTask {
  const controller = new AbortController();
  return {
    promise: service.refreshRequiredUpdateStatus(controller.signal),
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

export function startRequiredUpdateRefreshTaskForInvocation(options: {
  args: string[];
  env: Record<string, string | undefined>;
  createService: () => UpdateCheckService;
}): RequiredUpdateRefreshTask | undefined {
  if (
    !shouldRunRequiredUpdateEnforcement({
      args: options.args,
      env: options.env,
    })
  ) {
    return undefined;
  }

  return startRequiredUpdateRefreshTask(options.createService());
}

export async function enforceCachedRequiredUpdateForInvocation(options: {
  args: string[];
  env: Record<string, string | undefined>;
  createService: () => UpdateCheckService;
  stderr: UpdateCheckOutput;
  exit: (code: number) => never;
}): Promise<void> {
  if (
    !shouldRunRequiredUpdateEnforcement({
      args: options.args,
      env: options.env,
    })
  ) {
    return;
  }

  const notice = await options.createService().getRequiredUpdateNotice();
  if (!notice) {
    return;
  }

  if (isJsonInvocation(options.args)) {
    options.stderr.write(`${JSON.stringify(requiredUpdateEnvelope(notice))}\n`);
  } else {
    options.stderr.write(`${formatRequiredUpdateNotice(notice)}\n`);
  }
  options.exit(1);
}

export async function runWithUpdateCheckFlush<T>(
  action: () => Promise<T>,
  task: UpdateCheckTask | undefined,
  options: {
    stderr: UpdateCheckOutput;
    timeoutMs?: number;
    requiredUpdateRefreshTask?: RequiredUpdateRefreshTask;
  },
): Promise<T> {
  try {
    return await action();
  } finally {
    await flushRequiredUpdateRefresh(options.requiredUpdateRefreshTask, {
      timeoutMs: options.timeoutMs,
    });
    await flushUpdateCheckNotice(task, options);
  }
}

export async function flushRequiredUpdateRefresh(
  task: RequiredUpdateRefreshTask | undefined,
  options: { timeoutMs?: number } = {},
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

function isJsonInvocation(args: string[]): boolean {
  return args.includes("--json");
}

function requiredUpdateEnvelope(notice: RequiredUpdateNotice): {
  error: string;
  code: "UPDATE_REQUIRED";
  retryable: false;
  details: {
    currentVersion: string;
    latestKnownVersion?: string;
    updateCommand: string;
    reason: string;
  };
} {
  return {
    error: `Update required: ${notice.reason}`,
    code: "UPDATE_REQUIRED",
    retryable: false,
    details: {
      currentVersion: notice.currentVersion,
      ...(notice.latestKnownVersion
        ? { latestKnownVersion: notice.latestKnownVersion }
        : {}),
      updateCommand: notice.updateCommand,
      reason: notice.reason,
    },
  };
}
