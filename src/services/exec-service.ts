import { spawn, spawnSync } from "node:child_process";

interface SpawnCommand {
  command: string;
  args: string[];
  shell?: boolean;
  windowsVerbatimArguments?: boolean;
}

const WINDOWS_CMD_META_CHARS = /([()[\]%!^"`<>&|;, *?])/g;

function escapeWindowsCommand(value: string): string {
  return value.replace(WINDOWS_CMD_META_CHARS, "^$1");
}

function escapeWindowsArgument(value: string): string {
  let arg = `${value}`;
  arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
  return `"${arg}"`.replace(WINDOWS_CMD_META_CHARS, "^$1");
}

function buildWindowsShellCommand(command: string, args: string[]): string {
  return [
    escapeWindowsCommand(command),
    ...args.map(escapeWindowsArgument),
  ].join(" ");
}

function isWindowsCommandNotFound(
  exitCode: number,
  stderr: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === "win32" &&
    exitCode !== 0 &&
    /^\s*'[^']+'\s+is not recognized as an internal or external command,/i.test(
      stderr,
    )
  );
}

function createCommandNotFoundError(command: string): NodeJS.ErrnoException {
  const error = new Error(`spawn ${command} ENOENT`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  error.syscall = "spawn";
  error.path = command;
  return error;
}

/**
 * Windows uses cmd.exe directly so .cmd/.ps1 shims resolve without passing
 * separate args to child_process shell mode, which triggers Node DEP0190.
 */
export function normalizeSpawnCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): SpawnCommand {
  if (platform !== "win32") {
    return { command, args };
  }
  const shellCommand = buildWindowsShellCommand(command, args);
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  };
}

/** Result of executing a CLI command */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** Explicit child-only environment overrides; inherited values remain available. */
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Working directory for the spawned command. */
  cwd?: string;
}

/** Terminal-owning commands return lifecycle information, never captured output. */
export interface InteractiveExecResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface InteractiveExecOptions {
  env?: Record<string, string>;
  cwd?: string;
}

export class ExecTimeoutError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly timeoutMs: number;

  constructor(command: string, args: string[], timeoutMs: number) {
    super(
      `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
    );
    this.name = "ExecTimeoutError";
    this.command = command;
    this.args = args;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Service interface for executing CLI commands.
 * Abstraction allows for easy testing with mock implementations.
 */
export interface ExecService {
  /** Hand the terminal to a native command until it exits. */
  execInteractive(
    command: string,
    args: string[],
    options?: InteractiveExecOptions,
  ): Promise<InteractiveExecResult>;
  /** Execute a command with arguments and return the result */
  exec(
    command: string,
    args: string[],
    options?: ExecOptions,
  ): Promise<ExecResult>;
}

/**
 * Production implementation using node:child_process.spawn.
 * Collects stdout/stderr and resolves with exit code.
 *
 * On Windows, normalizes commands through cmd.exe to resolve native shims.
 * Callers must not pass untrusted input as command or args.
 */
export class ExecServiceImpl implements ExecService {
  async execInteractive(
    command: string,
    args: string[],
    options: InteractiveExecOptions = {},
  ): Promise<InteractiveExecResult> {
    // Ctrl-C reaches the foreground process group. Let the child finish and
    // let the caller report incomplete work before restoring default handling.
    const onInterrupt = (): void => {};
    const wasRaw = process.stdin.isRaw;
    // libuv caches this process's mode; a child can change the shared terminal
    // without updating it. POSIX stty preserves the actual flags, including a
    // user's custom settings, rather than guessing a default terminal mode.
    let terminalSettings: string | undefined;
    if (process.stdin.isTTY && process.platform !== "win32") {
      const snapshot = spawnSync("stty", ["-g"], {
        stdio: ["inherit", "pipe", "ignore"],
        encoding: "utf8",
      });
      if (snapshot.status !== 0 || !snapshot.stdout.trim()) {
        throw new Error("Unable to preserve terminal settings for sign-in");
      }
      terminalSettings = snapshot.stdout.trim();
    }
    process.on("SIGINT", onInterrupt);
    try {
      return await new Promise<InteractiveExecResult>((resolve, reject) => {
        const normalized = normalizeSpawnCommand(command, args);
        const child = spawn(normalized.command, normalized.args, {
          stdio: "inherit",
          env: { ...process.env, ...options.env },
          ...(options.cwd !== undefined && { cwd: options.cwd }),
          ...(normalized.windowsVerbatimArguments !== undefined && {
            windowsVerbatimArguments: normalized.windowsVerbatimArguments,
          }),
        });
        child.once("error", reject);
        child.once("close", (exitCode, signal) =>
          resolve({ exitCode, signal }),
        );
      });
    } finally {
      try {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(Boolean(wasRaw));
          if (terminalSettings !== undefined) {
            const restored = spawnSync("stty", [terminalSettings], {
              stdio: ["inherit", "ignore", "ignore"],
            });
            if (restored.status !== 0) {
              // biome-ignore lint/correctness/noUnsafeFinally: Failed terminal restoration invalidates command completion.
              throw new Error(
                "Unable to restore terminal settings after sign-in",
              );
            }
          }
        }
      } finally {
        process.removeListener("SIGINT", onInterrupt);
      }
    }
  }

  async exec(
    command: string,
    args: string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const spawnCommand = normalizeSpawnCommand(command, args);
      const child = spawn(spawnCommand.command, spawnCommand.args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...options?.env },
        ...(options.cwd !== undefined && { cwd: options.cwd }),
        ...(spawnCommand.shell !== undefined && { shell: spawnCommand.shell }),
        ...(spawnCommand.windowsVerbatimArguments !== undefined && {
          windowsVerbatimArguments: spawnCommand.windowsVerbatimArguments,
        }),
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const settle = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        fn();
      };

      const timeoutMs = options.timeoutMs;
      if (timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          settle(() => {
            child.kill("SIGTERM");
            reject(new ExecTimeoutError(command, args, timeoutMs));
          });
        }, timeoutMs);
      }

      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      child.on("error", (error) => {
        settle(() => reject(error));
      });

      child.on("close", (code) => {
        settle(() => {
          const exitCode = code ?? 1;
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          if (isWindowsCommandNotFound(exitCode, stderr)) {
            reject(createCommandNotFoundError(command));
            return;
          }
          resolve({
            exitCode,
            stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
            stderr,
          });
        });
      });
    });
  }
}
