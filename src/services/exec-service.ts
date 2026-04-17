import { spawn } from "node:child_process";

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
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        ...(process.platform === "win32" && { shell: true }),
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
