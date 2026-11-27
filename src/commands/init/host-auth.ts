import { posix, win32 } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { colorize } from "@githits/mcp/internal";
import { ExitPromptError } from "@inquirer/core";
import type { ExecOptions, ExecService } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/filesystem-service.js";
import type { PromptService } from "../../services/prompt-service.js";
import type { AgentDefinition, InitSetupScope } from "./agent-definitions.js";
import {
  type HostAuthStatus,
  parseClaudeAuthStatus,
  parseCodexAuthStatus,
  parseNamedAuthStatus,
} from "./host-auth-status.js";
import { wrapInitProse } from "./setup-format.js";

interface NativeAuth {
  command: string;
  login: string[];
  help: string[];
  status: string[];
  parse: (output: string) => HostAuthStatus;
  family: "claude" | "codex" | "named";
}

interface AuthTarget {
  agent: AgentDefinition;
  native: NativeAuth;
  status: HostAuthStatus;
}

export interface HostAuthDependencies {
  execService: ExecService;
  fileSystemService: FileSystemService;
  promptService: PromptService;
}

export interface HostAuthResult {
  /** Only unresolved hosts, with capability-appropriate human instructions. */
  remaining: AgentDefinition[];
  authenticatedIds: string[];
  cancelled: boolean;
}

/** Native commands belong to init's host adapter, not its instruction renderer. */
function nativeAuth(
  agent: AgentDefinition,
  scope: InitSetupScope,
): NativeAuth | undefined {
  const command = agent.resolvedSetupContext?.command;
  switch (agent.id) {
    case "claude-code":
      if (scope === "project") return undefined;
      return {
        command: command ?? "claude",
        help: ["mcp", "--help"],
        login: ["mcp", "login", "githits"],
        status: ["mcp", "get", "githits"],
        parse: parseClaudeAuthStatus,
        family: "claude",
      };
    case "codex-cli":
      return {
        command: command ?? "codex",
        help: ["mcp", "--help"],
        login: ["mcp", "login", "githits"],
        status: ["mcp", "list", "--json"],
        parse: parseCodexAuthStatus,
        family: "codex",
      };
    case "kilo-code":
    case "opencode":
      return {
        command: command ?? (agent.id === "opencode" ? "opencode" : "kilo"),
        help: ["mcp", "auth", "--help"],
        login: ["mcp", "auth", "GitHits"],
        status: ["mcp", "auth", "list"],
        parse: parseNamedAuthStatus,
        family: "named",
      };
  }
}

/** Isolating cwd must not move homes configured relative to the original cwd. */
function childEnvironment(fs: FileSystemService): Record<string, string> {
  const paths = process.platform === "win32" ? win32 : posix;
  const env: Record<string, string> = {};
  for (const key of [
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_DIR",
  ]) {
    const value = process.env[key];
    if (value) env[key] = paths.resolve(fs.getCwd(), value);
  }
  return env;
}

async function claudeManaged(fs: FileSystemService): Promise<boolean> {
  const file =
    process.platform === "darwin"
      ? "/Library/Application Support/ClaudeCode/managed-mcp.json"
      : process.platform === "win32"
        ? win32.join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "ClaudeCode",
            "managed-mcp.json",
          )
        : "/etc/claude-code/managed-mcp.json";
  try {
    return await fs.exists(file);
  } catch {
    return true;
  }
}

/** Probe failures are unknown; native configuration output never reaches logging. */
async function probe(
  exec: ExecService,
  native: NativeAuth,
  context: ExecOptions,
): Promise<HostAuthStatus> {
  try {
    const result = await exec.exec(native.command, native.status, {
      ...context,
      timeoutMs: 10_000,
    });
    return result.exitCode === 0 ? native.parse(result.stdout) : "unknown";
  } catch {
    return "unknown";
  }
}

async function supportsAuth(
  exec: ExecService,
  native: NativeAuth,
  context: ExecOptions,
): Promise<boolean> {
  try {
    const result = await exec.exec(native.command, native.help, {
      ...context,
      timeoutMs: 5_000,
    });
    if (result.exitCode !== 0) return false;
    const help = stripVTControlCharacters(`${result.stdout}\n${result.stderr}`);
    // Never run `auth list` when a CLI could interpret `list` as a server name.
    if (native.family === "named") {
      return (
        /^\s*(?:kilo|opencode) mcp auth (?:list|ls)\b/m.test(help) &&
        /^\s*(?:kilo|opencode) mcp auth\s+\[name\]/m.test(help)
      );
    }
    return (
      /^\s*login(?:\s|$)/m.test(help) &&
      (native.family === "claude" || /^\s*list(?:\s|$)/m.test(help))
    );
  } catch {
    return false;
  }
}

function commandText(native: NativeAuth): string {
  // Executable discovery can return an absolute path containing spaces.
  const command = /[\s"']/.test(native.command)
    ? JSON.stringify(native.command)
    : native.command;
  return [command, ...native.login].join(" ");
}

/** Complete selected hosted sign-ins with explicit consent for every command. */
export async function runHostAuthentication(
  agents: AgentDefinition[],
  scope: InitSetupScope,
  deps: HostAuthDependencies,
  useColors: boolean,
): Promise<HostAuthResult> {
  const unique = [
    ...new Map(agents.map((agent) => [agent.id, agent])).values(),
  ];
  const result: HostAuthResult = {
    remaining: [...unique],
    authenticatedIds: [],
    cancelled: false,
  };
  const {
    execService: exec,
    fileSystemService: fs,
    promptService: prompts,
  } = deps;
  if (!unique.some((agent) => nativeAuth(agent, scope))) return result;
  let isolated: string | undefined;
  const prose = (line: string): void => {
    for (const wrapped of wrapInitProse(line, process.stdout.columns))
      console.log(wrapped);
  };
  try {
    if (scope === "user")
      isolated = await fs.createTempDir("githits-init-auth-");
    const context: ExecOptions = {
      cwd: isolated ?? fs.getCwd(),
      env: childEnvironment(fs),
    };
    const targets: AuthTarget[] = [];
    for (const agent of unique) {
      const native = nativeAuth(agent, scope);
      if (!native || (native.family === "claude" && (await claudeManaged(fs))))
        continue;
      if (!(await supportsAuth(exec, native, context))) continue;
      if (native.family === "claude") {
        result.remaining = result.remaining.map((entry) =>
          entry.id === agent.id
            ? {
                ...entry,
                remoteInstructions: [`Run \`${commandText(native)}\`.`],
              }
            : entry,
        );
      }
      targets.push({
        agent,
        native,
        status: await probe(exec, native, context),
      });
    }
    if (!targets.length) return result;
    console.log(`\n  ${colorize("Sign in to GitHits", "bold", useColors)}\n`);
    for (const target of targets) {
      const label =
        target.status === "authenticated"
          ? "Already signed in"
          : target.status === "required"
            ? "Sign-in required"
            : "Sign-in status could not be checked";
      prose(`  ${target.agent.name}: ${label}`);
      if (target.status === "authenticated")
        result.authenticatedIds.push(target.agent.id);
    }
    result.remaining = result.remaining.filter(
      (agent) => !result.authenticatedIds.includes(agent.id),
    );
    const required = targets.filter((target) => target.status === "required");
    console.log();
    if (!required.length) return result;
    const choice = await prompts.select(
      "  Complete sign-in now?",
      [
        {
          name: "Sign in now",
          value: "sign_in",
          description: "Review and run each sign-in command.",
        },
        {
          name: "Show instructions",
          value: "instructions",
          description: "Finish sign-in yourself.",
        },
      ],
      "sign_in",
    );
    if (choice !== "sign_in") return result;
    for (const target of required) {
      console.log(`\n  ${colorize(target.agent.name, "bold", useColors)}`);
      console.log(`    ${commandText(target.native)}\n`);
      const action = await prompts.select(
        "  Run this command?",
        [
          { name: "Run command", value: "run" },
          { name: "Skip this tool", value: "skip" },
        ],
        "run",
      );
      if (action !== "run") continue;
      let completed = false;
      try {
        const run = await exec.execInteractive(
          target.native.command,
          target.native.login,
          context,
        );
        if (run.signal !== null || run.exitCode === 130) {
          result.cancelled = true;
          break;
        }
        completed = run.exitCode === 0;
      } catch {
        /* Native errors may contain configuration values; report only the outcome. */
      }
      const status = await probe(exec, target.native, context);
      if (completed && status === "authenticated") {
        result.authenticatedIds.push(target.agent.id);
        result.remaining = result.remaining.filter(
          (agent) => agent.id !== target.agent.id,
        );
        prose(`  ${target.agent.name}: Signed in.`);
      } else {
        prose(
          `  ${target.agent.name}: Sign-in is incomplete. Instructions follow below.`,
        );
      }
    }
    return result;
  } catch (error) {
    if (error instanceof ExitPromptError) result.cancelled = true;
    // Optional auth must not hide successful setup; all unresolved hosts stay manual.
    return result;
  } finally {
    if (result.cancelled)
      prose("\n  Sign-in cancelled. Your GitHits configuration is saved.");
    if (isolated) {
      try {
        await fs.deleteDirIfEmpty(isolated);
      } catch {
        /* Host-owned files are not ours to delete. */
      }
    }
  }
}
