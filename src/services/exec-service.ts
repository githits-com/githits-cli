import { spawn } from "node:child_process";

interface SpawnCommand {
  command: string;
  args: string[];
  shell?: boolean;
}

function isWindowsAbsolutePath(command: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(command) || command.startsWith("\\\\");
}

/**
 * Windows shell mode splits unquoted command paths on spaces. Absolute shim
 * paths are trusted internal values, so quote only the executable segment.
 */
export function normalizeSpawnCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): SpawnCommand {
  if (platform !== "win32") {
    return { command, args };
  }
  if (isWindowsAbsolutePath(command) && /\s/.test(command)) {
    return {
      command: `"${command.replaceAll('"', '\\"')}"`,
      args,
      shell: true,
    };
  }
  return { command, args, shell: true };
}

/** Result of executing a CLI command */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Service interface for executing CLI commands.
 * Abstraction allows for easy testing with mock implementations.
 */
export interface ExecService {
  /** Execute a command with arguments and return the result */
  exec(command: string, args: string[]): Promise<ExecResult>;
}

/**
 * Production implementation using node:child_process.spawn.
 * Collects stdout/stderr and resolves with exit code.
 *
 * On Windows, uses shell: true to resolve .cmd/.ps1 shims via cmd.exe.
 * Callers must not pass untrusted input as command or args.
 */
export class ExecServiceImpl implements ExecService {
  async exec(command: string, args: string[]): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const spawnCommand = normalizeSpawnCommand(command, args);
      const child = spawn(spawnCommand.command, spawnCommand.args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        ...(spawnCommand.shell !== undefined && { shell: spawnCommand.shell }),
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        });
      });
    });
  }
}
