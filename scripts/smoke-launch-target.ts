import { statSync } from "node:fs";
import { resolve } from "node:path";

export interface CliLaunchTarget {
  kind: "source" | "built";
  argv: readonly [executable: string, ...baseArgs: string[]];
  cliEntry?: string;
}

export interface ParsedCliLaunchTarget {
  target: CliLaunchTarget;
  remainingArgs: string[];
}

export const SOURCE_CLI_LAUNCH_TARGET: CliLaunchTarget = {
  kind: "source",
  argv: ["bun", "run", "dev"],
};

/** Extracts and validates the shared --cli-entry option without consuming script options. */
export function parseCliLaunchTarget(
  argv: readonly string[],
  cwd = process.cwd(),
): ParsedCliLaunchTarget {
  let cliEntry: string | undefined;
  const remainingArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value !== "--cli-entry") {
      if (value !== undefined) remainingArgs.push(value);
      continue;
    }

    if (cliEntry !== undefined) {
      throw new Error("--cli-entry may only be specified once");
    }
    const entry = argv[index + 1];
    if (!entry || entry.startsWith("--")) {
      throw new Error("--cli-entry requires a file path");
    }
    cliEntry = resolve(cwd, entry);
    index += 1;
  }

  if (cliEntry === undefined) {
    return { target: SOURCE_CLI_LAUNCH_TARGET, remainingArgs };
  }

  let isFile = false;
  try {
    isFile = statSync(cliEntry).isFile();
  } catch {
    // The shared validation error below includes the resolved path.
  }
  if (!isFile) {
    throw new Error(`--cli-entry must reference an existing file: ${cliEntry}`);
  }

  return {
    target: { kind: "built", argv: ["node", cliEntry], cliEntry },
    remainingArgs,
  };
}

export function appendCliArgs(
  target: CliLaunchTarget,
  args: readonly string[],
): string[] {
  return [...target.argv, ...args];
}

export function toStdioLaunch(
  target: CliLaunchTarget,
  args: readonly string[],
): { command: string; args: string[] } {
  const [command, ...baseArgs] = target.argv;
  return { command, args: [...baseArgs, ...args] };
}

export function forwardedCliEntryArgs(target: CliLaunchTarget): string[] {
  return target.cliEntry ? ["--cli-entry", target.cliEntry] : [];
}

export function formatCliLaunchTarget(target: CliLaunchTarget): string {
  return JSON.stringify(target.argv);
}
