import { randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import {
  GITHITS_GUIDANCE_BLOCK,
  GITHITS_GUIDANCE_MARKER,
} from "../src/commands/init/guidance-assets.ts";
import { mergeManagedBlock } from "../src/commands/init/setup-handlers.ts";
import {
  type AgentEvalFinalStatus,
  type AgentEvalMetrics,
  type AgentEvalRecordInput,
  adaptAgentUsage,
  buildAgentEvalMetrics,
  type PersistedToolCall,
  unknownAgentUsage,
} from "./agent-eval-metrics.ts";
import {
  assertUniqueWorkloadIds,
  buildRunReportFromMetadata,
  formatRunReport,
  workloadIdFromPath,
  writeReportJson,
} from "./agent-eval-report.ts";

export type AgentName = "claude" | "codex" | "opencode";
export type ServerMode = "local" | "published";
export type EvalSurface = "mcp" | "skills";
export type GuidanceProfile = "descriptors" | "full";
export type CodexReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";
export const DEFAULT_CODEX_MODEL = "gpt-5.6-luna";
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "high";
type RunStatus = "dry-run" | "success" | "failed" | "timeout";

export interface AgentEvalOptions {
  agent: AgentName;
  model?: string;
  surface: EvalSurface;
  server: ServerMode;
  guidanceProfile?: GuidanceProfile;
  reasoningEffort?: CodexReasoningEffort;
  experimentalTools: boolean;
  workloads: string[];
  outDir: string;
  timeoutSeconds: number;
  publishedPackage: string;
  dryRun: boolean;
  repoRoot: string;
  targetRoot: string;
  schemaPath: string;
  reportingPath: string;
}

interface AgentEvalDependencies {
  baseEnv?: NodeJS.ProcessEnv;
  runCommand?: typeof runWithTimeout;
  assertAgentAvailable(agent: AgentName): Promise<void>;
  collectAgentVersions(): Promise<
    [string | undefined, string | undefined, string | undefined]
  >;
}

export interface McpServerConfig {
  mcpServers: {
    githits: {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
}

export interface OpenCodeConfig {
  permission?: {
    task: "deny";
  };
  mcp?: {
    githits?: {
      type: "local";
      command: string[];
      environment?: Record<string, string>;
      enabled: true;
      timeout: number;
    };
  };
}

interface WorkloadRunMetadata {
  id: string;
  path: string;
  status: RunStatus;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  startedAt?: string;
  completedAt?: string;
  finalStatus?: AgentEvalFinalStatus;
  command: string[];
  workspaceDir: string;
  workloadDir: string;
  toolCallCount?: number;
  isolation?: WorkloadIsolationMetadata;
  validationViolations?: EvalValidationViolation[];
  experimentalTools: boolean;
  skillInstallation?: SkillInstallationMetadata | EvalSkillInstallationMetadata;
  guidanceInstallation?:
    | GuidanceInstallationMetadata
    | EvalGuidanceInstallationMetadata;
}

export interface GitMetadata {
  branch: string | null;
  sha: string | null;
  dirty: boolean | null;
}

export interface CommandProbeResult {
  stdout: string;
  exitCode: number;
}

export type CommandProbe = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<CommandProbeResult | undefined>;

interface WorkloadRunExecution {
  metadata: WorkloadRunMetadata;
  stdout?: string;
  toolCalls: PersistedToolCall[];
  artifacts: Record<string, string>;
}

export interface AgentEvalMetricsExecutionInput
  extends Omit<AgentEvalRecordInput, "usage"> {
  stdout?: string;
  dryRun: boolean;
}

export interface AgentEvalMetricsRunInput {
  runId: string;
  startedAt: string;
  completedAt: string;
  records: AgentEvalMetricsExecutionInput[];
}

const MCP_CONFIG_ENV_KEYS = [
  "GITHITS_API_URL",
  "GITHITS_MCP_URL",
  "GITHITS_CODE_NAV_URL",
  "PKGSEER_URL",
  "GITHITS_AUTH_STORAGE",
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "APPDATA",
] as const;

interface ExtractedToolCall {
  agent: AgentName;
  server?: string;
  tool: string;
  providerCallId?: string;
  status?: string;
  arguments?: unknown;
  error?: unknown;
}

export type DiscoveryObservation = "observed" | "not_observed" | "not_exposed";

export interface DiscoveryEvent {
  type: "request" | "result";
  tool: "ToolSearch";
  toolUseId?: string;
  query?: unknown;
  result?: unknown;
}

export interface DiscoveryArtifact {
  status: DiscoveryObservation;
  events: DiscoveryEvent[];
}

interface SkillInstallationMetadataBase {
  sourceDir: string;
  installedDirs: string[];
  cliShim?: string;
  cliMode?: ServerMode;
}

export interface SkillInstallationMetadata
  extends SkillInstallationMetadataBase {
  cliShim: string;
  cliMode: ServerMode;
}

export interface EvalSkillInstallationMetadata
  extends SkillInstallationMetadataBase {}

export interface GuidanceInstallationMetadata {
  instructionPaths: string[];
  skillInstallation: SkillInstallationMetadata;
}

export interface EvalGuidanceInstallationMetadata {
  instructionPaths: string[];
  skillInstallation: EvalSkillInstallationMetadata;
}

interface SkillWorkspacePlan extends SkillInstallationMetadataBase {
  sourceChildren: string[];
}

export interface WorkloadIsolationMetadata {
  root: "<ephemeral>";
  workspace: "workspace";
  home: "home";
  userprofile: "home";
  xdgConfigHome: "config";
  appdata: "appdata";
  temp: "tmp";
}

export type EvalValidationViolation =
  | { category: "external-guidance-read"; path: string }
  | { category: "descriptor-guidance-read"; path: string }
  | { category: "mcp-cli-fallback"; tool: string };

/**
 * Per-workload disposable execution roots. The creator owns directory setup;
 * the caller owns cleanup of `rootDir` after the workload exits.
 */
export interface WorkloadIsolation {
  rootDir: string;
  workspaceDir: string;
  env: Record<string, string>;
  metadata: WorkloadIsolationMetadata;
}

interface ProjectGuidancePlan {
  instructionPaths: string[];
  writes: Array<{ path: string; content: string }>;
}

const PASSTHROUGH_ENV_KEYS = [
  "GITHITS_API_URL",
  "GITHITS_MCP_URL",
  "GITHITS_CODE_NAV_URL",
  "PKGSEER_URL",
  "GITHITS_API_TOKEN",
  "GITHITS_AUTH_STORAGE",
] as const;

const BASE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "APPDATA",
  "CODEX_HOME",
  "USER",
  "LOGNAME",
  "USERNAME",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "LANG",
  "LC_ALL",
  "SECURITYSESSIONID",
  "XPC_FLAGS",
  "XPC_SERVICE_NAME",
  "__CF_USER_TEXT_ENCODING",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

const SECRET_PATTERN = /(TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL)/i;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function defaultOutDir(repoRoot: string): string {
  return join(repoRoot, ".agent-eval", "runs", timestamp());
}

type TargetRootOptions = Pick<AgentEvalOptions, "repoRoot"> & {
  targetRoot?: string;
};

function effectiveTargetRoot(options: TargetRootOptions): string {
  return options.targetRoot ?? options.repoRoot;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  assert(
    Number.isInteger(parsed) && parsed > 0,
    `${flag} must be a positive integer`,
  );
  return parsed;
}

export function parseArgs(
  argv: string[],
  repoRoot = process.cwd(),
): AgentEvalOptions {
  const options: AgentEvalOptions = {
    agent: "claude",
    surface: "mcp",
    server: "local",
    guidanceProfile: undefined,
    experimentalTools: false,
    workloads: [],
    outDir: defaultOutDir(repoRoot),
    timeoutSeconds: 300,
    publishedPackage: "githits@latest",
    dryRun: false,
    repoRoot,
    targetRoot: repoRoot,
    schemaPath: join(repoRoot, "eval", "agentic", "result.schema.json"),
    reportingPath: join(
      repoRoot,
      "eval",
      "agentic",
      "workloads",
      "REPORTING.md",
    ),
  };

  let guidanceProfileExplicit = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--agent": {
        const value = argv[++i];
        assert(
          value === "claude" || value === "codex" || value === "opencode",
          "--agent must be claude, codex, or opencode",
        );
        options.agent = value;
        break;
      }
      case "--server": {
        const value = argv[++i];
        assert(
          value === "local" || value === "published",
          "--server must be local or published",
        );
        options.server = value;
        break;
      }
      case "--surface": {
        const value = argv[++i];
        assert(
          value === "mcp" || value === "skills",
          "--surface must be mcp or skills",
        );
        options.surface = value;
        break;
      }
      case "--model": {
        const value = argv[++i];
        assert(value, "--model requires a model name");
        options.model = value;
        break;
      }
      case "--guidance-profile": {
        const value = argv[++i];
        assert(
          value === "descriptors" || value === "full",
          "--guidance-profile must be descriptors or full",
        );
        options.guidanceProfile = value;
        guidanceProfileExplicit = true;
        break;
      }
      case "--reasoning-effort": {
        const value = argv[++i];
        assert(
          value === "minimal" ||
            value === "low" ||
            value === "medium" ||
            value === "high" ||
            value === "xhigh" ||
            value === "max" ||
            value === "ultra",
          "--reasoning-effort must be minimal, low, medium, high, xhigh, max, or ultra",
        );
        options.reasoningEffort = value;
        break;
      }
      case "--workload": {
        const value = argv[++i];
        assert(value, "--workload requires a path");
        options.workloads.push(value);
        break;
      }
      case "--out": {
        const value = argv[++i];
        assert(value, "--out requires a path");
        options.outDir = resolve(repoRoot, value);
        break;
      }
      case "--target-root": {
        const value = argv[++i];
        assert(value, "--target-root requires a path");
        options.targetRoot = resolve(repoRoot, value);
        break;
      }
      case "--timeout": {
        const value = argv[++i];
        assert(value, "--timeout requires seconds");
        options.timeoutSeconds = parsePositiveInteger(value, "--timeout");
        break;
      }
      case "--published-package": {
        const value = argv[++i];
        assert(value, "--published-package requires a package spec");
        options.publishedPackage = value;
        break;
      }
      case "--schema": {
        const value = argv[++i];
        assert(value, "--schema requires a path");
        options.schemaPath = resolve(repoRoot, value);
        break;
      }
      case "--reporting": {
        const value = argv[++i];
        assert(value, "--reporting requires a path");
        options.reportingPath = resolve(repoRoot, value);
        break;
      }
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--experimental-tools":
        options.experimentalTools = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.workloads.length === 0) {
    options.workloads.push(
      join(repoRoot, "eval", "agentic", "workloads", "express-router.md"),
    );
  }
  validateExperimentalToolsScope(options);
  if (options.surface === "mcp" && options.guidanceProfile === undefined) {
    options.guidanceProfile = "descriptors";
  }
  validateGuidanceProfileScope(options, guidanceProfileExplicit);
  if (options.agent === "codex") {
    options.model ??= DEFAULT_CODEX_MODEL;
    options.reasoningEffort ??= DEFAULT_CODEX_REASONING_EFFORT;
  } else {
    assert(
      options.reasoningEffort === undefined,
      "--reasoning-effort requires --agent codex",
    );
  }
  options.workloads = options.workloads.map((path) => resolve(repoRoot, path));
  return options;
}

export function validateExperimentalToolsScope(
  options: Pick<AgentEvalOptions, "surface" | "server" | "experimentalTools">,
): void {
  assert(
    !options.experimentalTools ||
      (options.surface === "mcp" && options.server === "local"),
    "--experimental-tools requires --surface mcp --server local",
  );
}

export function validateGuidanceProfileScope(
  options: {
    surface: EvalSurface;
    server: ServerMode;
    guidanceProfile?: GuidanceProfile;
  },
  explicit = false,
): void {
  const profile = options.guidanceProfile ?? "descriptors";
  assert(
    options.surface !== "skills" || !explicit,
    "--guidance-profile cannot be used with --surface skills",
  );
  assert(
    profile === "descriptors" ||
      (options.surface === "mcp" && options.server === "local"),
    `--guidance-profile ${profile} requires --surface mcp --server local`,
  );
}

function printHelp(): void {
  console.log(`Usage: bun run agent:e2e [options]

Options:
  --agent claude|codex|opencode   Agent to run (default: claude)
  --model <name>                  Agent model name or alias, e.g. sonnet, haiku, gpt-5.4-mini
  --guidance-profile descriptors|full  MCP guidance profile (default: descriptors)
  --reasoning-effort minimal|low|medium|high|xhigh|max|ultra  Codex reasoning effort
  --surface mcp|skills            GitHits access surface under test (default: mcp)
  --server local|published        GitHits source mode: local checkout or published package (default: local)
  --workload <path>               Workload markdown path, repeatable
  --out <dir>                     Output directory
  --target-root <path>             Target checkout under test (default: measurement root)
  --timeout <seconds>             Per-workload timeout (default: 300)
  --published-package <spec>      Package for published mode (default: githits@latest)
  --experimental-tools            Enable local experimental MCP tools for this run
  --schema <path>                 Result JSON schema path
  --reporting <path>              Reporting contract markdown path
  --dry-run                       Generate artifacts without invoking the agent
`);
}

export function buildMcpConfig(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & {
    targetRoot?: string;
    experimentalTools?: boolean;
    guidanceProfile?: GuidanceProfile;
  },
  baseEnv: NodeJS.ProcessEnv = process.env,
): McpServerConfig {
  const command = buildMcpCommand(options, baseEnv);
  return {
    mcpServers: {
      githits: command,
    },
  };
}

function buildMcpCommand(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & {
    targetRoot?: string;
    experimentalTools?: boolean;
    guidanceProfile?: GuidanceProfile;
  },
  baseEnv: NodeJS.ProcessEnv = process.env,
): McpServerConfig["mcpServers"]["githits"] {
  const env = buildMcpServerEnv(baseEnv);
  if (options.server === "local") {
    const targetRoot = effectiveTargetRoot(options);
    return {
      command: "bun",
      args: [
        "run",
        "--cwd",
        targetRoot,
        "dev",
        "mcp",
        "start",
        ...(options.experimentalTools ? ["--experimental-tools"] : []),
      ],
      ...(env ? { env } : {}),
    };
  }

  return {
    command: "npx",
    args: ["-y", options.publishedPackage, "mcp", "start"],
    ...(env ? { env } : {}),
  };
}

function buildMcpServerEnv(
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const key of MCP_CONFIG_ENV_KEYS) {
    const value = baseEnv[key];
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, effectiveMcpConfigRoots(baseEnv));
  return Object.keys(env).length > 0 ? env : undefined;
}

function effectiveMcpConfigRoots(
  baseEnv: Record<string, string | undefined>,
): Record<string, string> {
  const roots: Record<string, string> = {};
  const xdgConfigHome =
    baseEnv.XDG_CONFIG_HOME ??
    (process.platform === "win32" || baseEnv.HOME === undefined
      ? undefined
      : join(baseEnv.HOME, ".config"));
  if (xdgConfigHome !== undefined) roots.XDG_CONFIG_HOME = xdgConfigHome;

  const appdata =
    baseEnv.APPDATA ??
    (process.platform !== "win32" || baseEnv.USERPROFILE === undefined
      ? undefined
      : join(baseEnv.USERPROFILE, "AppData", "Roaming"));
  if (appdata !== undefined) roots.APPDATA = appdata;
  return roots;
}

export function buildCodexConfig(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & {
    targetRoot?: string;
    experimentalTools?: boolean;
    guidanceProfile?: GuidanceProfile;
    reasoningEffort?: CodexReasoningEffort;
  },
  baseEnv: NodeJS.ProcessEnv = process.env,
): string {
  const command = buildMcpCommand(options, baseEnv);
  const lines = options.reasoningEffort
    ? [
        `model_reasoning_effort = ${JSON.stringify(options.reasoningEffort)}`,
        "",
      ]
    : [];
  lines.push(
    "[mcp_servers.githits]",
    `command = ${JSON.stringify(command.command)}`,
    `args = ${JSON.stringify(command.args)}`,
  );
  if (command.env && Object.keys(command.env).length > 0) {
    lines.push("", "[mcp_servers.githits.env]");
    for (const [key, value] of Object.entries(command.env)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function buildCodexConfigArgs(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & {
    targetRoot?: string;
    experimentalTools?: boolean;
    guidanceProfile?: GuidanceProfile;
    reasoningEffort?: CodexReasoningEffort;
  },
  baseEnv: NodeJS.ProcessEnv = process.env,
): string[] {
  const command = buildMcpCommand(options, baseEnv);
  const args = [
    "-c",
    `mcp_servers.githits.command=${JSON.stringify(command.command)}`,
    "-c",
    `mcp_servers.githits.args=${JSON.stringify(command.args)}`,
  ];
  if (options.reasoningEffort) {
    args.push(
      "-c",
      `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`,
    );
  }
  if (command.env) {
    for (const [key, value] of Object.entries(command.env)) {
      args.push(
        "-c",
        `mcp_servers.githits.env.${key}=${JSON.stringify(value)}`,
      );
    }
  }
  return args;
}

export function buildOpenCodeConfig(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & {
    targetRoot?: string;
    experimentalTools?: boolean;
    guidanceProfile?: GuidanceProfile;
  },
  baseEnv: NodeJS.ProcessEnv = process.env,
): OpenCodeConfig {
  const command = buildMcpCommand(options, baseEnv);
  return {
    permission: {
      task: "deny",
    },
    mcp: {
      githits: {
        type: "local",
        command: [command.command, ...command.args],
        ...(command.env ? { environment: command.env } : {}),
        enabled: true,
        timeout: 90_000,
      },
    },
  };
}

export function buildOpenCodeSkillsConfig(): OpenCodeConfig {
  return {
    permission: {
      task: "deny",
    },
  };
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function writeGitHitsShim(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & { targetRoot?: string },
  binDir: string,
): string {
  mkdirSync(binDir, { recursive: true });
  const isWindows = process.platform === "win32";
  const shimPath = join(binDir, isWindows ? "githits.cmd" : "githits");
  const targetRoot = effectiveTargetRoot(options);
  if (isWindows) {
    const command =
      options.server === "local"
        ? `bun run --cwd "${targetRoot}" dev %*`
        : `npx -y "${options.publishedPackage}" %*`;
    writeFileSync(shimPath, `@echo off\r\n${command}\r\n`);
    return shimPath;
  }
  const command =
    options.server === "local"
      ? `exec bun run --cwd ${shQuote(targetRoot)} dev "$@"`
      : `exec npx -y ${shQuote(options.publishedPackage)} "$@"`;
  writeFileSync(shimPath, `#!/bin/sh\n${command}\n`);
  chmodSync(shimPath, 0o755);
  return shimPath;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertDirectoryOrAbsent(path: string, description: string): void {
  if (!pathExists(path)) return;
  if (!lstatSync(path).isDirectory()) {
    throw new Error(`Refusing to overwrite ${description}: ${path}`);
  }
}

function assertMissing(path: string, description: string): void {
  if (pathExists(path)) {
    throw new Error(`Refusing to overwrite ${description}: ${path}`);
  }
}

function planSkillsWorkspace(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & { targetRoot?: string },
  workspaceDir: string,
  requestedSourceChildren?: string[],
  includeCliShim = true,
): SkillWorkspacePlan {
  const sourceDir = join(effectiveTargetRoot(options), "skills");
  assert(existsSync(sourceDir), `Skills directory not found: ${sourceDir}`);
  const sourceChildren = requestedSourceChildren ?? readdirSync(sourceDir);
  if (requestedSourceChildren) {
    for (const child of requestedSourceChildren) {
      const sourcePath = join(sourceDir, child);
      assert(existsSync(sourcePath), `Skill source not found: ${sourcePath}`);
    }
  }
  const installedDirs = [
    join(workspaceDir, "skills"),
    join(workspaceDir, ".opencode", "skills"),
    join(workspaceDir, ".agents", "skills"),
    join(workspaceDir, ".claude", "skills"),
    join(workspaceDir, ".codex", "skills"),
  ];
  assertDirectoryOrAbsent(workspaceDir, "skill workspace");
  for (const installedDir of installedDirs) {
    assertDirectoryOrAbsent(dirname(installedDir), "skill directory parent");
    assertDirectoryOrAbsent(installedDir, "skill directory");
    for (const child of sourceChildren) {
      assertMissing(join(installedDir, child), "existing GitHits skill path");
    }
  }
  const cliShim = includeCliShim
    ? join(
        workspaceDir,
        ".agent-eval-bin",
        process.platform === "win32" ? "githits.cmd" : "githits",
      )
    : undefined;
  if (cliShim) {
    assertDirectoryOrAbsent(dirname(cliShim), "CLI shim directory");
    assertMissing(cliShim, "existing GitHits CLI shim");
  }
  return {
    sourceDir,
    installedDirs,
    ...(cliShim ? { cliShim } : {}),
    ...(includeCliShim ? { cliMode: options.server } : {}),
    sourceChildren,
  };
}

function applySkillWorkspacePlan(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & { targetRoot?: string },
  plan: SkillWorkspacePlan,
): SkillInstallationMetadataBase {
  for (const installedDir of plan.installedDirs) {
    mkdirSync(installedDir, { recursive: true });
    for (const child of plan.sourceChildren) {
      cpSync(join(plan.sourceDir, child), join(installedDir, child), {
        recursive: true,
      });
    }
  }
  const cliShim = plan.cliShim
    ? writeGitHitsShim(options, dirname(plan.cliShim))
    : undefined;
  return {
    sourceDir: plan.sourceDir,
    installedDirs: plan.installedDirs,
    ...(cliShim ? { cliShim } : {}),
    ...(plan.cliMode ? { cliMode: plan.cliMode } : {}),
  };
}

export function prepareSkillsWorkspace(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & { targetRoot?: string },
  workspaceDir: string,
): SkillInstallationMetadata {
  const installation = applySkillWorkspacePlan(
    options,
    planSkillsWorkspace(options, workspaceDir),
  );
  assert(
    installation.cliShim !== undefined && installation.cliMode !== undefined,
    "Skills workspace plan unexpectedly omitted its CLI shim",
  );
  return installation as SkillInstallationMetadata;
}

function planProjectGuidance(
  workspaceDir: string,
  guidanceBlock: string,
): ProjectGuidancePlan {
  const instructionPaths = [
    join(workspaceDir, "CLAUDE.md"),
    join(workspaceDir, "AGENTS.md"),
  ];
  const writes: Array<{ path: string; content: string }> = [];
  for (const instructionPath of instructionPaths) {
    if (pathExists(instructionPath) && !lstatSync(instructionPath).isFile()) {
      throw new Error(
        `Refusing to overwrite existing project guidance path: ${instructionPath}`,
      );
    }
    const existing = pathExists(instructionPath)
      ? readFileSync(instructionPath, "utf8")
      : "";
    const merged = mergeManagedBlock(
      existing,
      GITHITS_GUIDANCE_MARKER,
      guidanceBlock,
    );
    if (merged.status !== "already_configured") {
      writes.push({ path: instructionPath, content: merged.content });
    }
  }
  return { instructionPaths, writes };
}

export async function loadTargetGuidanceBlock(
  targetRoot: string,
): Promise<string> {
  const modulePath = resolve(
    targetRoot,
    "src",
    "commands",
    "init",
    "guidance-assets.ts",
  );
  assert(
    existsSync(modulePath),
    `Target guidance module not found: ${modulePath}`,
  );
  let guidanceModule: unknown;
  try {
    guidanceModule = await import(pathToFileURL(modulePath).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Target guidance module failed to load: ${message}`);
  }
  const guidanceBlock =
    guidanceModule !== null && typeof guidanceModule === "object"
      ? (guidanceModule as { GITHITS_GUIDANCE_BLOCK?: unknown })
          .GITHITS_GUIDANCE_BLOCK
      : undefined;
  assert(
    typeof guidanceBlock === "string" && guidanceBlock.trim().length > 0,
    `Target guidance module has invalid GITHITS_GUIDANCE_BLOCK export: ${modulePath}`,
  );
  return guidanceBlock;
}

function applyProjectGuidance(plan: ProjectGuidancePlan): void {
  for (const write of plan.writes) {
    writeFileSync(write.path, write.content);
  }
}

export function prepareFullGuidanceWorkspace(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & { targetRoot?: string },
  workspaceDir: string,
  guidanceBlock?: string,
): GuidanceInstallationMetadata;
export function prepareFullGuidanceWorkspace(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & { targetRoot?: string },
  workspaceDir: string,
  guidanceBlock: string | undefined,
  includeCliShim: false,
): EvalGuidanceInstallationMetadata;
export function prepareFullGuidanceWorkspace(
  options: Pick<
    AgentEvalOptions,
    "server" | "repoRoot" | "publishedPackage"
  > & { targetRoot?: string },
  workspaceDir: string,
  guidanceBlock?: string,
  includeCliShim = true,
): GuidanceInstallationMetadata | EvalGuidanceInstallationMetadata {
  const resolvedGuidanceBlock = guidanceBlock ?? GITHITS_GUIDANCE_BLOCK;
  const skillPlan = planSkillsWorkspace(
    options,
    workspaceDir,
    ["githits-mcp"],
    includeCliShim,
  );
  const guidancePlan = planProjectGuidance(workspaceDir, resolvedGuidanceBlock);
  applyProjectGuidance(guidancePlan);
  const installation = {
    instructionPaths: guidancePlan.instructionPaths,
    skillInstallation: applySkillWorkspacePlan(options, skillPlan),
  };
  return installation as
    | GuidanceInstallationMetadata
    | EvalGuidanceInstallationMetadata;
}

export function buildEvalEnv(
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of [...BASE_ENV_KEYS, ...PASSTHROUGH_ENV_KEYS]) {
    const value = baseEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  env.NO_COLOR = "1";
  return env;
}

const CODEX_HOME_GLOBAL_INSTRUCTION_FILES = [
  "AGENTS.override.md",
  "AGENTS.md",
] as const;

function findCodexHomeGlobalInstruction(directory: string): string | undefined {
  return CODEX_HOME_GLOBAL_INSTRUCTION_FILES.find((name) =>
    pathExists(join(directory, name)),
  );
}

export function validateCodexEvalHome(
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
  const codexHome = baseEnv.CODEX_HOME;
  assert(
    codexHome !== undefined && codexHome.length > 0,
    "Codex evals require CODEX_HOME pointing to a dedicated eval home",
  );
  assert(
    isAbsolute(codexHome),
    `CODEX_HOME must be an absolute directory: ${codexHome}`,
  );
  assert(
    existsSync(codexHome) && statSync(codexHome).isDirectory(),
    `CODEX_HOME must be an existing directory: ${codexHome}`,
  );
  const globalInstruction = findCodexHomeGlobalInstruction(codexHome);
  assert(
    globalInstruction === undefined,
    `CODEX_HOME contains global instructions: ${globalInstruction}`,
  );
}

export function createWorkloadIsolation(
  baseEnv: Record<string, string>,
): WorkloadIsolation {
  const rootDir = mkdtempSync(join(tmpdir(), "githits-agent-eval-isolation-"));
  const workspaceDir = join(rootDir, "workspace");
  const home = join(rootDir, "home");
  const config = join(rootDir, "config");
  const appdata = join(rootDir, "appdata");
  const temp = join(rootDir, "tmp");
  for (const path of [workspaceDir, home, config, appdata, temp]) {
    mkdirSync(path, { recursive: true });
  }
  return {
    rootDir,
    workspaceDir,
    env: {
      ...baseEnv,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: config,
      APPDATA: appdata,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
    },
    metadata: {
      root: "<ephemeral>",
      workspace: "workspace",
      home: "home",
      userprofile: "home",
      xdgConfigHome: "config",
      appdata: "appdata",
      temp: "tmp",
    },
  };
}

function relativeWorkspacePath(workspaceDir: string, path: string): string {
  return relative(workspaceDir, path).replaceAll("\\", "/") || ".";
}

function persistSkillInstallationMetadata(
  installation: SkillInstallationMetadataBase,
  workspaceDir: string,
): SkillInstallationMetadataBase {
  return {
    sourceDir: "<target>/skills",
    installedDirs: installation.installedDirs.map((path) =>
      relativeWorkspacePath(workspaceDir, path),
    ),
    ...(installation.cliShim
      ? { cliShim: relativeWorkspacePath(workspaceDir, installation.cliShim) }
      : {}),
    ...(installation.cliMode ? { cliMode: installation.cliMode } : {}),
  };
}

function persistGuidanceInstallationMetadata(
  installation: GuidanceInstallationMetadata | EvalGuidanceInstallationMetadata,
  workspaceDir: string,
): EvalGuidanceInstallationMetadata {
  return {
    instructionPaths: installation.instructionPaths.map((path) =>
      relativeWorkspacePath(workspaceDir, path),
    ),
    skillInstallation: persistSkillInstallationMetadata(
      installation.skillInstallation,
      workspaceDir,
    ),
  };
}

export function isolateOpenCodeSkills(env: Record<string, string>): void {
  env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1";
  env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = "1";
}

export function collectSecretValues(env: Record<string, string>): string[] {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_PATTERN.test(key) && value.length >= 8) {
      values.add(value);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export function collectHostHomeValues(env: Record<string, string>): string[] {
  const values = new Set<string>();
  for (const key of ["HOME", "USERPROFILE"] as const) {
    const value = env[key];
    if (value !== undefined && value.length > 1) values.add(value);
  }
  for (const value of Object.values(effectiveMcpConfigRoots(env))) {
    if (value.length > 1) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function combineRedactionValues(...valueLists: string[][]): string[] {
  return [...new Set(valueLists.flat())].sort((a, b) => b.length - a.length);
}

export function redactText(text: string, secretValues: string[]): string {
  let redacted = text;
  for (const secret of secretValues) {
    redacted = redacted.split(secret).join("<redacted>");
  }
  return redacted;
}

export function sanitizedEnvSummary(
  env: Record<string, string>,
): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = env[key];
    if (value === undefined) {
      continue;
    }
    summary[key] = SECRET_PATTERN.test(key) ? "<redacted>" : value;
  }
  if (env.HOME) summary.HOME = "<inherited>";
  if (env.USERPROFILE) summary.USERPROFILE = "<inherited>";
  if (env.XDG_CONFIG_HOME) summary.XDG_CONFIG_HOME = "<inherited>";
  if (env.APPDATA) summary.APPDATA = "<inherited>";
  return summary;
}

function workloadId(workloadPath: string): string {
  return workloadIdFromPath(workloadPath);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function redactValue(value: unknown, secretValues: string[]): unknown {
  if (typeof value === "string") {
    return redactText(value, secretValues);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secretValues));
  }
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = redactValue(item, secretValues);
    }
    return redacted;
  }
  return value;
}

function redactCommand(command: string[], redactionValues: string[]): string[] {
  return command.map((argument) => redactText(argument, redactionValues));
}

async function commandProbe(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandProbeResult | undefined> {
  try {
    const proc = Bun.spawn([command, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return { stdout, exitCode };
  } catch {
    return undefined;
  }
}

async function commandOutput(
  command: string,
  args: string[],
  cwd: string,
): Promise<string | undefined> {
  const result = await commandProbe(command, args, cwd);
  if (result === undefined || result.exitCode !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

export async function collectGitMetadata(
  repoRoot: string,
  probe: CommandProbe = commandProbe,
): Promise<GitMetadata> {
  const [branch, sha, status] = await Promise.all([
    probe("git", ["branch", "--show-current"], repoRoot),
    probe("git", ["rev-parse", "HEAD"], repoRoot),
    probe("git", ["status", "--porcelain", "--untracked-files=all"], repoRoot),
  ]);
  return {
    branch: branch?.exitCode === 0 ? branch.stdout.trim() || null : null,
    sha: sha?.exitCode === 0 ? sha.stdout.trim() || null : null,
    dirty:
      status === undefined || status.exitCode !== 0
        ? null
        : status.stdout.trim().length > 0,
  };
}

async function claudeVersion(): Promise<string | undefined> {
  return commandOutput("claude", ["--version"], process.cwd());
}

async function codexVersion(): Promise<string | undefined> {
  return commandOutput("codex", ["--version"], process.cwd());
}

async function opencodeVersion(): Promise<string | undefined> {
  return commandOutput("opencode", ["--version"], process.cwd());
}

async function assertClaudeAvailable(): Promise<void> {
  const version = await claudeVersion();
  assert(
    version,
    "claude CLI not found or not executable. Install Claude Code before running live agent evals.",
  );
}

async function assertCodexAvailable(): Promise<void> {
  const version = await codexVersion();
  assert(
    version,
    "codex CLI not found or not executable. Install Codex before running live agent evals.",
  );
}

async function assertOpenCodeAvailable(): Promise<void> {
  const version = await opencodeVersion();
  assert(
    version,
    "opencode CLI not found or not executable. Install OpenCode before running live agent evals.",
  );
}

async function assertAgentAvailable(agent: AgentName): Promise<void> {
  if (agent === "claude") {
    await assertClaudeAvailable();
  } else if (agent === "codex") {
    await assertCodexAvailable();
  } else {
    await assertOpenCodeAvailable();
  }
}

async function collectAgentVersions(): Promise<
  [string | undefined, string | undefined, string | undefined]
> {
  return Promise.all([claudeVersion(), codexVersion(), opencodeVersion()]);
}

const DEFAULT_AGENT_EVAL_DEPENDENCIES: AgentEvalDependencies = {
  assertAgentAvailable,
  collectAgentVersions,
};

function extractFinalJson(stdout: string): unknown | undefined {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const message = event.message;
      if (message !== null && typeof message === "object") {
        const text = extractTextFromContent(
          (message as Record<string, unknown>).content,
        );
        if (text) {
          const parsed = parseJsonFromText(text);
          if (parsed !== undefined) return parsed;
        }
      }
      const candidates = [
        event.result,
        event.message,
        event.content,
        event.text,
        event.part,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string") {
          const parsed = parseJsonFromText(candidate);
          if (parsed !== undefined) return parsed;
        }
        if (candidate !== null && typeof candidate === "object") {
          const text = (candidate as Record<string, unknown>).text;
          if (typeof text === "string") {
            const parsed = parseJsonFromText(text);
            if (parsed !== undefined) return parsed;
          }
        }
      }
      if (event.status || event.answer) {
        return event;
      }
    } catch {
      try {
        return JSON.parse(line);
      } catch {
        // Continue scanning older lines.
      }
    }
  }
  return undefined;
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((item): string[] => {
    if (item === null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return record.type === "text" && typeof record.text === "string"
      ? [record.text]
      : [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function extractClaudeToolCalls(
  event: Record<string, unknown>,
): ExtractedToolCall[] {
  const message = event.message;
  if (message === null || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): ExtractedToolCall[] => {
    if (item === null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (record.type !== "tool_use" || typeof record.name !== "string")
      return [];
    const match = record.name.match(/^mcp__(.+)__(.+)$/);
    if (!match) return [];
    const server = match[1];
    const tool = match[2];
    if (!server || !tool) return [];
    return [
      {
        agent: "claude",
        server,
        tool,
        status: "started",
        arguments: record.input,
      },
    ];
  });
}

function extractCodexToolCall(
  event: Record<string, unknown>,
): ExtractedToolCall | undefined {
  const item = event.item;
  if (item === null || typeof item !== "object") return undefined;
  const record = item as Record<string, unknown>;
  if (record.type !== "mcp_tool_call" || typeof record.tool !== "string") {
    return undefined;
  }
  const providerCallId =
    typeof record.id === "string" && record.id.length > 0
      ? record.id
      : undefined;
  return {
    agent: "codex",
    server: typeof record.server === "string" ? record.server : undefined,
    tool: record.tool,
    ...(providerCallId ? { providerCallId } : {}),
    status: typeof record.status === "string" ? record.status : undefined,
    arguments: record.arguments,
    error: record.error,
  };
}

function extractOpenCodeToolCall(
  event: Record<string, unknown>,
): ExtractedToolCall | undefined {
  if (event.type !== "tool_use") return undefined;
  const part = event.part;
  if (part === null || typeof part !== "object") return undefined;
  const record = part as Record<string, unknown>;
  if (record.type !== "tool" || typeof record.tool !== "string") {
    return undefined;
  }
  const match = record.tool.match(/^githits_(.+)$/);
  if (!match?.[1]) return undefined;
  const state =
    record.state !== null && typeof record.state === "object"
      ? (record.state as Record<string, unknown>)
      : undefined;
  const outputError = extractJsonEnvelopeError(state?.output);
  return {
    agent: "opencode",
    server: "githits",
    tool: match[1],
    status: typeof state?.status === "string" ? state.status : undefined,
    arguments: state?.input,
    error: state?.error ?? outputError,
  };
}

function extractJsonEnvelopeError(output: unknown): unknown | undefined {
  if (typeof output !== "string") return undefined;
  const parsed = parseJsonFromText(output);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  return typeof record.error === "string" && typeof record.code === "string"
    ? record
    : undefined;
}

function commandStringFromArgv(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.filter(
    (item): item is string => typeof item === "string",
  );
  if (parts.length === 0) return undefined;
  return parts.join(" ");
}

function collectCommandStrings(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCommandStrings(item));
  }
  const commands: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (
      (key === "command" || key === "cmd" || key === "shell_command") &&
      typeof item === "string"
    ) {
      commands.push(item);
    }
    if ((key === "argv" || key === "args") && Array.isArray(item)) {
      const command = commandStringFromArgv(item);
      if (command) commands.push(command);
    }
    commands.push(...collectCommandStrings(item));
  }
  return commands;
}

function stripShellQuoting(value: string): string {
  return value.replace(/["']/g, "");
}

function commandPartsAfterGitHits(command: string): string[] | undefined {
  const normalized = stripShellQuoting(command).replace(/\s+/g, " ").trim();
  const githits = normalized.match(/(?:^|\s)githits\s+(.+)$/);
  if (githits?.[1]) return githits[1].split(" ");
  const npx = normalized.match(/(?:^|\s)npx\s+-y\s+githits(?:@\S+)?\s+(.+)$/);
  if (npx?.[1]) return npx[1].split(" ");
  const bunDev = normalized.match(/(?:^|\s)bun\s+run\s+.*\s+dev\s+(.+)$/);
  if (bunDev?.[1]) return bunDev[1].split(" ");
  return undefined;
}

function cliToolNameFromCommand(command: string): string | undefined {
  const parts = commandPartsAfterGitHits(command);
  if (!parts) return undefined;
  const positional = parts.filter((part) => !part.startsWith("-"));
  const [first, second] = positional;
  if (!first) return undefined;
  if (first === "example") return "get_example";
  if (first === "languages") return "search_language";
  if (first === "feedback") return "feedback";
  if (first === "search") return "search";
  if (first === "search-status") return "search_status";
  if (first === "code" && second) return `code_${second.replace(/-/g, "_")}`;
  if (first === "docs" && second) return `docs_${second.replace(/-/g, "_")}`;
  if (first === "pkg" && second) return `pkg_${second.replace(/-/g, "_")}`;
  return undefined;
}

function extractCliToolCalls(
  event: Record<string, unknown>,
  agent: AgentName,
): ExtractedToolCall[] {
  const commands = collectCommandStrings(event);
  const item = event.item;
  const providerCallId =
    agent === "codex" &&
    item !== null &&
    typeof item === "object" &&
    typeof (item as Record<string, unknown>).id === "string" &&
    ((item as Record<string, unknown>).id as string).length > 0
      ? ((item as Record<string, unknown>).id as string)
      : undefined;
  const itemStatus =
    agent === "codex" &&
    item !== null &&
    typeof item === "object" &&
    typeof (item as Record<string, unknown>).status === "string"
      ? ((item as Record<string, unknown>).status as string)
      : undefined;
  const seen = new Set<string>();
  return commands.flatMap((command): ExtractedToolCall[] => {
    const tool = cliToolNameFromCommand(command);
    if (!tool) return [];
    const key = `${tool}\0${command}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        agent,
        server: "githits-cli",
        tool,
        ...(providerCallId ? { providerCallId } : {}),
        status: itemStatus ?? "started",
        arguments: { command },
      },
    ];
  });
}

export function extractToolCalls(
  stdout: string,
  agent: AgentName,
): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (agent === "claude") {
        calls.push(...extractCliToolCalls(event, agent));
        calls.push(...extractClaudeToolCalls(event));
      } else if (agent === "codex") {
        calls.push(...extractCliToolCalls(event, agent));
        const call = extractCodexToolCall(event);
        if (call) calls.push(call);
      } else {
        calls.push(...extractCliToolCalls(event, agent));
        const call = extractOpenCodeToolCall(event);
        if (call) calls.push(call);
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return calls;
}

const GUIDANCE_REFERENCE_KEYS = new Set([
  "command",
  "cmd",
  "shell_command",
  "argv",
  "args",
  "path",
  "file",
  "file_path",
  "filename",
  "target",
]);

function collectGuidanceReferenceStrings(
  value: unknown,
  key?: string,
): string[] {
  if (typeof value === "string") {
    return key !== undefined && GUIDANCE_REFERENCE_KEYS.has(key) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectGuidanceReferenceStrings(item, key));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([entryKey, item]) =>
      collectGuidanceReferenceStrings(item, entryKey),
    );
  }
  return [];
}

function redactExternalGuidancePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized
    .split("/")
    .filter(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
  const guidanceRootIndex = segments.findIndex(
    (segment) =>
      segment === "skills" ||
      segment === ".agents" ||
      segment === ".claude" ||
      segment === ".codex",
  );
  const suffix =
    guidanceRootIndex >= 0
      ? segments.slice(guidanceRootIndex).join("/")
      : segments.at(-1);
  return suffix ? `<external>/.../${suffix}` : "<external>/unknown";
}

function externalGuidancePaths(value: string): string[] {
  const paths: string[] = [];
  const pattern =
    /(?:[A-Za-z]:[\\/]|\\\\|\/|~\/|\$[A-Za-z_][A-Za-z0-9_]*\/|\.\.?[\\/]|(?:[A-Za-z0-9_.-]+[\\/])+)[^"'`\s),;]*?(?:AGENTS|CLAUDE|GEMINI|SKILL)\.md|(?:^|[\s"'`(=])(?:AGENTS|CLAUDE|GEMINI|SKILL)\.md/gi;
  for (const match of value.matchAll(pattern)) {
    const path = match[0]?.replace(/^[\s"'`(=]+/, "");
    if (path) paths.push(path);
  }
  return paths;
}

function pathInsideDirectory(path: string, directory: string): boolean {
  const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]|^\\\\/.test(path);
  if (
    /^~[\\/]|^\$[A-Za-z_][A-Za-z0-9_]*[\\/]/.test(path) ||
    (isWindowsAbsolutePath && process.platform !== "win32")
  )
    return false;
  const { resolvedPath, resolvedDirectory } = resolveGuidancePaths(
    path,
    directory,
  );
  const relativePath = relative(resolvedDirectory, resolvedPath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath) &&
    !/^[A-Za-z]:[\\/]/.test(relativePath)
  );
}

function resolveGuidancePaths(
  path: string,
  directory: string,
): { resolvedPath: string; resolvedDirectory: string } {
  const normalizedPath = path.replaceAll("\\", "/");
  const resolvedDirectory = resolve(directory);
  const resolvedPath = isAbsolute(normalizedPath)
    ? resolve(normalizedPath)
    : resolve(directory, normalizedPath);
  try {
    return {
      resolvedDirectory: realpathSync(resolvedDirectory),
      resolvedPath: realpathSync(resolvedPath),
    };
  } catch {
    return { resolvedDirectory, resolvedPath };
  }
}

function relativeGuidancePath(path: string, directory: string): string {
  const { resolvedPath, resolvedDirectory } = resolveGuidancePaths(
    path,
    directory,
  );
  return relative(resolvedDirectory, resolvedPath)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

export function extractEvalValidationViolations(
  stdout: string,
  options: Pick<AgentEvalOptions, "surface" | "guidanceProfile">,
  workspaceDir: string,
  agent: AgentName,
): EvalValidationViolation[] {
  const violations: EvalValidationViolation[] = [];
  const externalPaths = new Set<string>();
  const descriptorPaths = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    for (const value of collectGuidanceReferenceStrings(event)) {
      for (const path of externalGuidancePaths(value)) {
        if (!pathInsideDirectory(path, workspaceDir)) {
          externalPaths.add(path);
        } else if (
          options.surface === "mcp" &&
          (options.guidanceProfile ?? "descriptors") === "descriptors"
        ) {
          descriptorPaths.add(path);
        }
      }
    }
  }
  for (const path of [...externalPaths].sort()) {
    violations.push({
      category: "external-guidance-read",
      path: redactExternalGuidancePath(path),
    });
  }
  for (const path of [...descriptorPaths].sort()) {
    violations.push({
      category: "descriptor-guidance-read",
      path: `<workspace>/${relativeGuidancePath(path, workspaceDir)}`,
    });
  }
  if (options.surface === "mcp") {
    const cliTools = new Set<string>();
    for (const call of extractToolCalls(stdout, agent)) {
      if (call.server === "githits-cli") cliTools.add(call.tool);
    }
    for (const tool of [...cliTools].sort()) {
      violations.push({ category: "mcp-cli-fallback", tool });
    }
  }
  return violations;
}

function claudeMessageContent(event: Record<string, unknown>): unknown[] {
  const message = event.message;
  if (message === null || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content) ? content : [];
}

export function extractDiscoveryEvents(
  stdout: string,
  agent: AgentName,
): DiscoveryArtifact {
  if (agent !== "claude") {
    return { status: "not_exposed", events: [] };
  }

  const events: DiscoveryEvent[] = [];
  const toolSearchIds = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      for (const item of claudeMessageContent(event)) {
        if (item === null || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        if (record.type === "tool_use" && record.name === "ToolSearch") {
          const toolUseId =
            typeof record.id === "string" ? record.id : undefined;
          if (toolUseId) toolSearchIds.add(toolUseId);
          events.push({
            type: "request",
            tool: "ToolSearch",
            ...(toolUseId ? { toolUseId } : {}),
            query: record.input,
          });
          continue;
        }
        if (
          record.type === "tool_result" &&
          typeof record.tool_use_id === "string" &&
          toolSearchIds.has(record.tool_use_id)
        ) {
          events.push({
            type: "result",
            tool: "ToolSearch",
            toolUseId: record.tool_use_id,
            result: record.content,
          });
        }
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return {
    status: events.length > 0 ? "observed" : "not_observed",
    events,
  };
}

function parseJsonFromText(text: string): unknown | undefined {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to fenced JSON extraction.
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fence?.[1]) {
    return undefined;
  }
  try {
    return JSON.parse(fence[1].trim());
  } catch {
    return undefined;
  }
}

export function isValidAgentReport(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const report = value as Record<string, unknown>;
  const allowedKeys = new Set(["status", "answer", "confidence"]);
  if (Object.keys(report).some((key) => !allowedKeys.has(key))) {
    return false;
  }
  return (
    (report.status === "success" ||
      report.status === "failure" ||
      report.status === "inconclusive") &&
    typeof report.answer === "string" &&
    (report.confidence === "high" ||
      report.confidence === "medium" ||
      report.confidence === "low")
  );
}

async function killProcessTree(
  proc: Bun.Subprocess,
  signal: "SIGINT" | "SIGTERM" | "SIGKILL",
): Promise<void> {
  const pid = proc.pid;
  if (pid === undefined) {
    proc.kill(signal);
    return;
  }

  if (process.platform === "win32") {
    const taskkill = Bun.spawn(
      [
        "taskkill",
        "/PID",
        String(pid),
        "/T",
        ...(signal === "SIGKILL" ? ["/F"] : []),
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    await taskkill.exited.catch(() => undefined);
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    proc.kill(signal);
  }
}

export async function runWithTimeout(
  command: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutSeconds: number,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode?: number;
  timedOut: boolean;
}> {
  const proc = Bun.spawn(command, {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const signalHandlers = new Map<"SIGINT" | "SIGTERM", () => void>();
  const removeSignalHandlers = (): void => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.clear();
  };
  const forwardSignal = (signal: "SIGINT" | "SIGTERM"): void => {
    removeSignalHandlers();
    void killProcessTree(proc, signal).finally(() => {
      process.kill(process.pid, signal);
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = (): void => forwardSignal(signal);
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  const timer = setTimeout(() => {
    timedOut = true;
    cleanupPromise = (async () => {
      await killProcessTree(proc, "SIGTERM");
      await new Promise<void>((resolve) => {
        escalationTimer = setTimeout(() => {
          void killProcessTree(proc, "SIGKILL").finally(resolve);
        }, 2_000);
        escalationTimer.unref?.();
      });
    })();
  }, timeoutSeconds * 1_000);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited.catch(() => undefined),
    ]);
    clearTimeout(timer);
    if (cleanupPromise !== undefined) await cleanupPromise;
    return { stdout, stderr, exitCode, timedOut };
  } finally {
    clearTimeout(timer);
    if (cleanupPromise !== undefined) await cleanupPromise;
    removeSignalHandlers();
  }
}

export function buildClaudeCommand(
  prompt: string,
  mcpConfigPath: string | undefined,
  model?: string,
  surface: EvalSurface = "mcp",
  guidanceProfile: GuidanceProfile = "descriptors",
): string[] {
  const command = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
  ];
  if (surface === "mcp" || surface === "skills") {
    assert(mcpConfigPath, `${surface} surface requires an MCP config path`);
    command.splice(3, 0, "--mcp-config", mcpConfigPath, "--strict-mcp-config");
  }
  if (surface === "mcp") {
    if (guidanceProfile === "full") {
      command.push("--setting-sources", "project");
    } else {
      command.push("--disable-slash-commands");
    }
  } else if (surface === "skills") {
    command.push("--setting-sources", "project");
  }
  if (model) command.push("--model", model);
  return command;
}

export function buildCodexCommand(
  prompt: string,
  workspaceDir: string,
  finalMessagePath: string,
  schemaPath: string,
  options: Pick<
    AgentEvalOptions,
    | "server"
    | "repoRoot"
    | "publishedPackage"
    | "model"
    | "reasoningEffort"
    | "guidanceProfile"
  > & { surface?: EvalSurface; targetRoot?: string },
  baseEnv: NodeJS.ProcessEnv = process.env,
): string[] {
  const command = [
    "codex",
    "exec",
    "--cd",
    workspaceDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "--output-last-message",
    finalMessagePath,
    "--output-schema",
    schemaPath,
    "--dangerously-bypass-approvals-and-sandbox",
  ];
  for (const feature of ["apps", "plugins", "remote_plugin"] as const) {
    command.push("--disable", feature);
  }
  if (options.surface !== "skills") {
    command.splice(2, 0, ...buildCodexConfigArgs(options, baseEnv));
    command.push("--ignore-rules");
    command.push("--ignore-user-config");
  } else {
    command.push("--ignore-user-config");
    if (options.reasoningEffort) {
      command.push(
        "-c",
        `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`,
      );
    }
  }
  if (options.model) command.push("-m", options.model);
  command.push(prompt);
  return command;
}

export function buildOpenCodeCommand(
  prompt: string,
  workspaceDir: string,
  options: Pick<AgentEvalOptions, "model"> & { surface?: EvalSurface },
): string[] {
  const command = [
    "opencode",
    "run",
    "--format",
    "json",
    "--dangerously-skip-permissions",
    "--dir",
    workspaceDir,
  ];
  if (options.model) command.push("--model", options.model);
  command.push(prompt);
  return command;
}

function buildAgentCommand(
  options: AgentEvalOptions,
  prompt: string,
  workspaceDir: string,
  mcpConfigPath: string,
  codexFinalPath: string,
  baseEnv: NodeJS.ProcessEnv,
): string[] {
  if (options.agent === "claude") {
    return buildClaudeCommand(
      prompt,
      mcpConfigPath,
      options.model,
      options.surface,
      options.guidanceProfile,
    );
  }
  if (options.agent === "codex") {
    return buildCodexCommand(
      prompt,
      workspaceDir,
      codexFinalPath,
      options.schemaPath,
      options,
      baseEnv,
    );
  }
  return buildOpenCodeCommand(prompt, workspaceDir, options);
}

export function buildAgentEvalMetricsArtifact(
  input: AgentEvalMetricsRunInput,
): AgentEvalMetrics {
  const records: AgentEvalRecordInput[] = input.records.map(
    ({ stdout, dryRun, ...record }) => {
      const model = record.resolvedModel ?? record.requestedModel ?? undefined;
      return {
        ...record,
        usage: dryRun
          ? unknownAgentUsage(record.agent, model, "dry_run_no_telemetry")
          : adaptAgentUsage(stdout ?? "", record.agent, model),
      };
    },
  );
  return buildAgentEvalMetrics({
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    records,
  });
}

const WORKLOAD_ARTIFACTS = [
  ["prompt", "prompt.md"],
  ["mcpConfig", "mcp.json"],
  ["codexConfig", "codex-config.toml"],
  ["codexFinal", "codex-final.txt"],
  ["openCodeConfig", "opencode.json"],
  ["stdout", "stdout.json"],
  ["stderr", "stderr.txt"],
  ["toolCalls", "tool-calls.json"],
  ["discoveryEvents", "discovery-events.json"],
  ["final", "final.json"],
  ["invalidFinal", "invalid-final.json"],
  ["dryRun", "dry-run.json"],
  ["skillInstallation", "skill-installation.json"],
  ["guidanceInstallation", "guidance-installation.json"],
  ["isolationViolations", "isolation-violations.json"],
] as const;

function existingWorkloadArtifacts(
  runDir: string,
  workloadDir: string,
): Record<string, string> {
  const artifacts: Record<string, string> = {};
  for (const [key, name] of WORKLOAD_ARTIFACTS) {
    const path = join(workloadDir, name);
    if (existsSync(path) && lstatSync(path).isFile()) {
      artifacts[key] = relative(runDir, path).replaceAll("\\", "/");
    }
  }
  return artifacts;
}

function redactPersistedRuntimeConfigs(
  paths: string[],
  redactionValues: string[],
): void {
  const serializedRedactionValues = [
    ...redactionValues,
    ...redactionValues
      .map((value) => JSON.stringify(value).slice(1, -1))
      .filter((value) => value.length > 0),
  ];
  for (const path of paths) {
    if (existsSync(path) && lstatSync(path).isFile()) {
      writeFileSync(
        path,
        redactText(readFileSync(path, "utf8"), serializedRedactionValues),
      );
    }
  }
}

async function runWorkload(
  options: AgentEvalOptions,
  workloadPath: string,
  runDir: string,
  env: Record<string, string>,
  mcpConfig: McpServerConfig,
  secretValues: string[],
  hostHomeValues: string[],
  targetGit: GitMetadata,
  runCommand: typeof runWithTimeout,
  guidanceBlock?: string,
): Promise<WorkloadRunExecution> {
  assert(existsSync(workloadPath), `Workload not found: ${workloadPath}`);
  assert(
    existsSync(options.reportingPath),
    `Reporting contract not found: ${options.reportingPath}`,
  );
  const id = workloadId(workloadPath);
  const workloadDir = join(runDir, "workloads", id);
  const isolation = createWorkloadIsolation(env);
  const workspaceDir = isolation.workspaceDir;
  const mcpConfigPath = join(workloadDir, "mcp.json");
  const codexConfigPath = join(workloadDir, "codex-config.toml");
  const openCodeConfigPath = join(workloadDir, "opencode.json");
  const runtimeConfigRedactionValues = combineRedactionValues(
    secretValues,
    hostHomeValues,
  );

  try {
    mkdirSync(workloadDir, { recursive: true });
    const workloadPrompt = readFileSync(workloadPath, "utf8").trimEnd();
    const reportingPrompt = readFileSync(options.reportingPath, "utf8").trim();
    const prompt = `${workloadPrompt}\n\n${reportingPrompt}\n`;
    const codexFinalPath = join(workloadDir, "codex-final.txt");
    const workspaceOpenCodeConfigPath = join(workspaceDir, "opencode.json");
    writeFileSync(join(workloadDir, "prompt.md"), prompt);
    const guidanceInstallation =
      options.guidanceProfile === "full"
        ? prepareFullGuidanceWorkspace(
            options,
            workspaceDir,
            guidanceBlock,
            false,
          )
        : undefined;
    const skillInstallation =
      options.surface === "skills"
        ? prepareSkillsWorkspace(options, workspaceDir)
        : guidanceInstallation?.skillInstallation;
    if (options.surface === "mcp") {
      writeJson(mcpConfigPath, mcpConfig);
      writeFileSync(codexConfigPath, buildCodexConfig(options, env));
      const openCodeConfig = buildOpenCodeConfig(options, env);
      writeJson(openCodeConfigPath, openCodeConfig);
      writeJson(workspaceOpenCodeConfigPath, openCodeConfig);
    } else {
      writeJson(mcpConfigPath, { mcpServers: {} });
      const openCodeConfig = buildOpenCodeSkillsConfig();
      writeJson(openCodeConfigPath, openCodeConfig);
      writeJson(workspaceOpenCodeConfigPath, openCodeConfig);
    }
    if (skillInstallation) {
      writeJson(
        join(workloadDir, "skill-installation.json"),
        persistSkillInstallationMetadata(skillInstallation, workspaceDir),
      );
    }
    if (guidanceInstallation) {
      writeJson(
        join(workloadDir, "guidance-installation.json"),
        persistGuidanceInstallationMetadata(guidanceInstallation, workspaceDir),
      );
    }

    const command = buildAgentCommand(
      options,
      prompt,
      workspaceDir,
      mcpConfigPath,
      codexFinalPath,
      env,
    );
    const workloadEnv = { ...isolation.env };
    if (options.agent === "opencode") {
      isolateOpenCodeSkills(workloadEnv);
    }
    if (skillInstallation?.cliShim) {
      workloadEnv.PATH = `${dirname(skillInstallation.cliShim)}${workloadEnv.PATH ? `${delimiter}${workloadEnv.PATH}` : ""}`;
    }
    const metadataBase = {
      id,
      path: workloadPath,
      guidanceProfile: options.guidanceProfile,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      command,
      workspaceDir: "<ephemeral>",
      isolation: isolation.metadata,
      workloadDir,
      measurementRoot: options.repoRoot,
      targetRoot: effectiveTargetRoot(options),
      targetGit,
      experimentalTools: options.experimentalTools,
      ...(skillInstallation
        ? {
            skillInstallation: persistSkillInstallationMetadata(
              skillInstallation,
              workspaceDir,
            ),
          }
        : {}),
      ...(guidanceInstallation
        ? {
            guidanceInstallation: persistGuidanceInstallationMetadata(
              guidanceInstallation,
              workspaceDir,
            ),
          }
        : {}),
    };
    const persistedMetadata = {
      ...metadataBase,
      command: redactCommand(
        metadataBase.command,
        runtimeConfigRedactionValues,
      ),
    };

    if (options.dryRun) {
      writeJson(
        join(workloadDir, "dry-run.json"),
        redactValue(persistedMetadata, secretValues),
      );
      writeJson(join(workloadDir, "discovery-events.json"), {
        status: options.agent === "claude" ? "not_observed" : "not_exposed",
        events: [],
      });
      return {
        metadata: { ...metadataBase, status: "dry-run" },
        toolCalls: [],
        artifacts: existingWorkloadArtifacts(runDir, workloadDir),
      };
    }

    const startedAt = new Date().toISOString();
    const started = Date.now();
    const result = await runCommand(
      command,
      workspaceDir,
      workloadEnv,
      options.timeoutSeconds,
    );
    const durationMs = Date.now() - started;
    const completedAt = new Date().toISOString();

    writeFileSync(
      join(workloadDir, "stdout.json"),
      redactText(result.stdout, secretValues),
    );
    writeFileSync(
      join(workloadDir, "stderr.txt"),
      redactText(result.stderr, secretValues),
    );

    const toolCalls = extractToolCalls(result.stdout, options.agent);
    writeJson(
      join(workloadDir, "tool-calls.json"),
      redactValue(toolCalls, secretValues),
    );
    writeJson(
      join(workloadDir, "discovery-events.json"),
      redactValue(
        extractDiscoveryEvents(result.stdout, options.agent),
        secretValues,
      ),
    );
    const validationViolations = extractEvalValidationViolations(
      result.stdout,
      options,
      workspaceDir,
      options.agent,
    );
    if (validationViolations.length > 0) {
      writeJson(
        join(workloadDir, "isolation-violations.json"),
        redactValue(validationViolations, secretValues),
      );
    }

    const finalJson = extractFinalJson(result.stdout);
    const codexFinalText = existsSync(codexFinalPath)
      ? readFileSync(codexFinalPath, "utf8")
      : undefined;
    if (codexFinalText !== undefined) {
      writeFileSync(
        join(workloadDir, "codex-final.txt"),
        redactText(codexFinalText, secretValues),
      );
    }
    const reportJson =
      options.agent === "codex" && codexFinalText !== undefined
        ? parseJsonFromText(codexFinalText)
        : finalJson;
    const validFinalJson = isValidAgentReport(reportJson);
    if (validFinalJson) {
      writeJson(
        join(workloadDir, "final.json"),
        redactValue(reportJson, secretValues),
      );
    } else if (reportJson !== undefined) {
      writeJson(
        join(workloadDir, "invalid-final.json"),
        redactValue(reportJson, secretValues),
      );
    }

    const status: RunStatus = result.timedOut
      ? "timeout"
      : result.exitCode === 0 &&
          validFinalJson &&
          validationViolations.length === 0
        ? "success"
        : "failed";

    const finalStatus =
      validFinalJson &&
      reportJson !== null &&
      typeof reportJson === "object" &&
      !Array.isArray(reportJson) &&
      typeof (reportJson as Record<string, unknown>).status === "string"
        ? ((reportJson as Record<string, unknown>)
            .status as AgentEvalFinalStatus)
        : undefined;

    return {
      metadata: {
        ...metadataBase,
        status,
        exitCode: result.exitCode,
        durationMs,
        timedOut: result.timedOut,
        startedAt,
        completedAt,
        ...(finalStatus ? { finalStatus } : {}),
        toolCallCount: toolCalls.length,
        ...(validationViolations.length > 0 ? { validationViolations } : {}),
      },
      stdout: result.stdout,
      toolCalls: toolCalls.map(
        ({ tool, server, providerCallId, status, error }) => ({
          tool,
          server,
          ...(providerCallId ? { providerCallId } : {}),
          status,
          error,
        }),
      ),
      artifacts: existingWorkloadArtifacts(runDir, workloadDir),
    };
  } finally {
    redactPersistedRuntimeConfigs(
      [mcpConfigPath, codexConfigPath, openCodeConfigPath],
      runtimeConfigRedactionValues,
    );
    rmSync(isolation.rootDir, { recursive: true, force: true });
  }
}

export async function runAgentEval(
  options: AgentEvalOptions,
  dependencies: AgentEvalDependencies = DEFAULT_AGENT_EVAL_DEPENDENCIES,
): Promise<void> {
  assert(
    existsSync(options.schemaPath),
    `Schema not found: ${options.schemaPath}`,
  );
  mkdirSync(options.outDir, { recursive: true });
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  assertUniqueWorkloadIds(options.workloads);
  if (options.surface === "mcp" && options.guidanceProfile === undefined) {
    options.guidanceProfile = "descriptors";
  }
  validateGuidanceProfileScope(options);
  if (options.agent !== "codex") {
    assert(
      options.reasoningEffort === undefined,
      "reasoning effort is only supported for Codex evals",
    );
  }
  const env = buildEvalEnv(dependencies.baseEnv ?? process.env);
  if (options.agent === "codex" && !options.dryRun) {
    validateCodexEvalHome(env);
  }
  const secretValues = collectSecretValues(env);
  const hostHomeValues = collectHostHomeValues(env);
  const runtimeConfigRedactionValues = combineRedactionValues(
    secretValues,
    hostHomeValues,
  );
  const guidanceBlock =
    options.guidanceProfile === "full"
      ? await loadTargetGuidanceBlock(effectiveTargetRoot(options))
      : undefined;
  const mcpConfig = buildMcpConfig(options, env);

  if (!options.dryRun) {
    await dependencies.assertAgentAvailable(options.agent);
  }

  const versionsPromise: Promise<
    [string | undefined, string | undefined, string | undefined]
  > = options.dryRun
    ? Promise.resolve([undefined, undefined, undefined])
    : dependencies.collectAgentVersions();
  const [git, [claude, codex, opencode]] = await Promise.all([
    collectGitMetadata(effectiveTargetRoot(options)),
    versionsPromise,
  ]);

  const workloadExecutions: WorkloadRunExecution[] = [];
  for (const workload of options.workloads) {
    workloadExecutions.push(
      await runWorkload(
        options,
        workload,
        options.outDir,
        env,
        mcpConfig,
        secretValues,
        hostHomeValues,
        git,
        dependencies.runCommand ?? runWithTimeout,
        guidanceBlock,
      ),
    );
  }
  const completedAt = new Date().toISOString();
  const workloadResults = workloadExecutions.map(
    (execution) => execution.metadata,
  );

  const runMetadata = {
    runId,
    startedAt,
    completedAt,
    agent: options.agent,
    model: options.model,
    surface: options.surface,
    server: options.server,
    guidanceProfile: options.guidanceProfile,
    reasoningEffort: options.reasoningEffort,
    experimentalTools: options.experimentalTools,
    publishedPackage: options.publishedPackage,
    dryRun: options.dryRun,
    timeoutSeconds: options.timeoutSeconds,
    repoRoot: options.repoRoot,
    measurementRoot: options.repoRoot,
    targetRoot: effectiveTargetRoot(options),
    schemaPath: options.schemaPath,
    reportingPath: options.reportingPath,
    git,
    claudeVersion: claude,
    codexVersion: codex,
    opencodeVersion: opencode,
    env: sanitizedEnvSummary(env),
    workloads: workloadResults,
  };

  const persistedRunMetadata = {
    ...runMetadata,
    workloads: runMetadata.workloads.map((workload) => ({
      ...workload,
      command: redactCommand(workload.command, runtimeConfigRedactionValues),
    })),
  };
  writeJson(
    join(options.outDir, "run.json"),
    redactValue(persistedRunMetadata, secretValues),
  );

  writeJson(join(options.outDir, "summary.json"), {
    status: workloadResults.some(
      (result) => result.status === "failed" || result.status === "timeout",
    )
      ? "failed"
      : options.dryRun
        ? "dry-run"
        : "success",
    workloads: workloadResults.map(
      ({ id, status, exitCode, durationMs, timedOut }) => ({
        id,
        status,
        exitCode,
        durationMs,
        timedOut,
      }),
    ),
  });

  const agentVersion =
    options.agent === "claude"
      ? claude
      : options.agent === "codex"
        ? codex
        : opencode;
  const metrics = buildAgentEvalMetricsArtifact({
    runId,
    startedAt,
    completedAt,
    records: workloadExecutions.map(
      ({ metadata, stdout, toolCalls, artifacts }) => ({
        workloadId: metadata.id,
        requestedModel: options.model ?? null,
        resolvedModel: null,
        agent: options.agent,
        agentVersion: agentVersion ?? null,
        reasoningEffort: options.reasoningEffort ?? null,
        surface: options.surface,
        server: options.server,
        guidanceProfile: options.guidanceProfile ?? null,
        experimentalTools: options.experimentalTools,
        publishedPackage:
          options.server === "local" ? null : options.publishedPackage,
        targetGit: git,
        startedAt: metadata.startedAt ?? null,
        completedAt: metadata.completedAt ?? null,
        durationMs: metadata.durationMs ?? null,
        processStatus: metadata.status,
        finalStatus: metadata.finalStatus ?? null,
        exitCode: metadata.exitCode ?? null,
        timedOut: metadata.timedOut ?? null,
        toolCalls,
        artifacts,
        stdout,
        dryRun: options.dryRun,
      }),
    ),
  });
  writeJson(
    join(options.outDir, "metrics.json"),
    redactValue(metrics, secretValues),
  );
  const report = buildRunReportFromMetadata(options.outDir, {
    ...runMetadata,
    git,
  });
  writeReportJson(options.outDir, report);
  console.log(formatRunReport(report).trimEnd());
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const options = parseArgs(process.argv.slice(2), repoRoot);
  if (!isAbsolute(options.outDir)) {
    options.outDir = resolve(repoRoot, options.outDir);
  }
  await runAgentEval(options);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
