import type {
  LoginDependencies,
  LoginFlowResult,
  LoginOptions,
} from "../commands/login.js";
import type { AuthSessionMetadata } from "../services/auth-session-metadata-storage.js";
import { getAuthenticatedCommandMetadata } from "./command-metadata.js";

const AUTH_METADATA_TRUST_WINDOW_MS = 10 * 60 * 1000;

export interface CommandLike {
  name(): string;
  opts(): Record<string, unknown>;
  parent?: CommandLike | null;
}

export interface AutoLoginBootstrapDependencies {
  loadAuthSessionMetadata?: () => Promise<AuthSessionMetadata | null>;
  clearAuthSessionMetadata?: () => Promise<void>;
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
  const metadata = getAuthenticatedCommandMetadata(commandPath);
  if (!metadata?.autoLoginEligible) {
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

  const metadata = await deps.loadAuthSessionMetadata?.();
  if (metadata && isUnexpiredAuthSessionMetadata(metadata, new Date())) {
    return { status: "already-authenticated" };
  }

  const container = await deps.createContainer();
  if (container.hasValidToken) {
    return { status: "already-authenticated" };
  }
  await deps.clearAuthSessionMetadata?.();

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

export function isUnexpiredAuthSessionMetadata(
  metadata: Pick<AuthSessionMetadata, "expiresAt" | "updatedAt">,
  now: Date,
): boolean {
  const updatedAtMs = Date.parse(metadata.updatedAt);
  if (Number.isNaN(updatedAtMs)) return false;
  if (now.getTime() - updatedAtMs > AUTH_METADATA_TRUST_WINDOW_MS) {
    return false;
  }
  if (metadata.expiresAt === null) return true;
  const expiresAtMs = Date.parse(metadata.expiresAt);
  if (Number.isNaN(expiresAtMs)) return false;
  return now.getTime() < expiresAtMs;
}
