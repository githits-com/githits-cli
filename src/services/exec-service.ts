import { spawn } from "node:child_process";

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
  timeoutMs?: number;
  /** Working directory for the spawned command. */
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
 * On Windows, uses shell: true to resolve .cmd/.ps1 shims via cmd.exe.
 * Callers must not pass untrusted input as command or args.
 */
export class ExecServiceImpl implements ExecService {
  async exec(
    command: string,
    args: string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const spawnCommand = normalizeSpawnCommand(command, args);
      const child = spawn(spawnCommand.command, spawnCommand.args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
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
