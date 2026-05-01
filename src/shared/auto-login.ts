import type {
  LoginDependencies,
  LoginFlowResult,
  LoginOptions,
} from "../commands/login.js";

const AUTO_LOGIN_ELIGIBLE_COMMANDS = new Set([
  "init",
  "example",
  "languages",
  "feedback",
  "search",
  "search-status",
  "code files",
  "code read",
  "code grep",
  "docs list",
  "docs read",
  "pkg info",
  "pkg vulns",
  "pkg deps",
  "pkg changelog",
]);

export interface CommandLike {
  name(): string;
  opts(): Record<string, unknown>;
  parent?: CommandLike | null;
}

export interface AutoLoginBootstrapDependencies {
  createContainer: () => Promise<
    LoginDependencies & { hasValidToken: boolean }
  >;
  loginFlow: (
    options: LoginOptions,
    deps: LoginDependencies,
  ) => Promise<LoginFlowResult>;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

export interface AutoLoginBootstrapResult {
  status: "skipped" | "already-authenticated" | "authenticated" | "failed";
  message?: string;
}

interface AutoLoginRuntime {
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
}

export function getCommandPath(command: CommandLike): string[] {
  const names: string[] = [];
  let current: CommandLike | null | undefined = command;

  while (current) {
    const name = current.name();
    if (name && name !== "githits") {
      names.unshift(name);
    }
    current = current.parent ?? null;
  }

  return names;
}

export function isAutoLoginEligibleCommand(
  command: CommandLike,
  runtime: AutoLoginRuntime = {
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
  },
): boolean {
  const commandPath = getCommandPath(command).join(" ");
  if (commandPath === "init" && command.opts().skipLogin === true) {
    return false;
  }

  if (!AUTO_LOGIN_ELIGIBLE_COMMANDS.has(commandPath)) {
    return false;
  }

  if (!runtime.stdinIsTTY || !runtime.stdoutIsTTY) {
    return false;
  }

  return true;
}

export async function maybeAutoLoginBeforeCommand(
  command: CommandLike,
  deps: AutoLoginBootstrapDependencies,
): Promise<AutoLoginBootstrapResult> {
  if (
    !isAutoLoginEligibleCommand(command, {
      stdinIsTTY: deps.stdinIsTTY ?? Boolean(process.stdin.isTTY),
      stdoutIsTTY: deps.stdoutIsTTY ?? Boolean(process.stdout.isTTY),
    })
  ) {
    return { status: "skipped" };
  }

  const container = await deps.createContainer();
  if (container.hasValidToken) {
    return { status: "already-authenticated" };
  }

  const result = await deps.loginFlow({}, container);
  switch (result.status) {
    case "success":
      return { status: "authenticated", message: result.message };
    case "already_authenticated":
      return { status: "already-authenticated", message: result.message };
    case "failed":
      return { status: "failed", message: result.message };
  }
}
