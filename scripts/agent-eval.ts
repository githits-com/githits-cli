import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

type AgentName = "claude";
type ServerMode = "local" | "published";
type RunStatus = "dry-run" | "success" | "failed" | "timeout";

export interface AgentEvalOptions {
  agent: AgentName;
  server: ServerMode;
  workloads: string[];
  outDir: string;
  timeoutSeconds: number;
  publishedPackage: string;
  dryRun: boolean;
  repoRoot: string;
  schemaPath: string;
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

interface WorkloadRunMetadata {
  id: string;
  path: string;
  status: RunStatus;
  exitCode?: number;
  durationMs?: number;
  timedOut?: boolean;
  command: string[];
  workspaceDir: string;
  workloadDir: string;
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
    server: "local",
    workloads: [],
    outDir: defaultOutDir(repoRoot),
    timeoutSeconds: 300,
    publishedPackage: "githits@latest",
    dryRun: false,
    repoRoot,
    schemaPath: join(repoRoot, "eval", "agentic", "result.schema.json"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--agent": {
        const value = argv[++i];
        assert(value === "claude", "--agent currently supports only claude");
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
      case "--dry-run":
        options.dryRun = true;
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
  options.workloads = options.workloads.map((path) => resolve(repoRoot, path));
  return options;
}

function printHelp(): void {
  console.log(`Usage: bun run agent:e2e [options]

Options:
  --agent claude                  Agent to run (default: claude)
  --server local|published        MCP server mode (default: local)
  --workload <path>               Workload markdown path, repeatable
  --out <dir>                     Output directory
  --timeout <seconds>             Per-workload timeout (default: 300)
  --published-package <spec>      Package for published mode (default: githits@latest)
  --schema <path>                 Result JSON schema path
  --dry-run                       Generate artifacts without invoking Claude
`);
}

export function buildMcpConfig(
  options: Pick<AgentEvalOptions, "server" | "repoRoot" | "publishedPackage">,
): McpServerConfig {
  if (options.server === "local") {
    return {
      mcpServers: {
        githits: {
          command: "bun",
          args: ["run", "--cwd", options.repoRoot, "dev", "mcp", "start"],
        },
      },
    };
  }

  return {
    mcpServers: {
      githits: {
        command: "npx",
        args: ["-y", options.publishedPackage, "mcp", "start"],
      },
    },
  };
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

export function collectSecretValues(env: Record<string, string>): string[] {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_PATTERN.test(key) && value.length >= 8) {
      values.add(value);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
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
  return basename(workloadPath).replace(/\.[^.]+$/, "");
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

async function commandOutput(
  command: string,
  args: string[],
  cwd: string,
): Promise<string | undefined> {
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
    if (exitCode !== 0) {
      return undefined;
    }
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function collectGitMetadata(
  repoRoot: string,
): Promise<Record<string, string | undefined>> {
  const [branch, sha] = await Promise.all([
    commandOutput("git", ["branch", "--show-current"], repoRoot),
    commandOutput("git", ["rev-parse", "HEAD"], repoRoot),
  ]);
  return { branch, sha };
}

async function claudeVersion(): Promise<string | undefined> {
  return commandOutput("claude", ["--version"], process.cwd());
}

async function assertClaudeAvailable(): Promise<void> {
  const version = await claudeVersion();
  assert(
    version,
    "claude CLI not found or not executable. Install Claude Code before running live agent evals.",
  );
}

function extractFinalJson(stdout: string): unknown | undefined {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const candidates = [
        event.result,
        event.message,
        event.content,
        event.text,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string") {
          const parsed = parseJsonFromText(candidate);
          if (parsed !== undefined) return parsed;
        }
      }
      if (event.status || event.answer || event.githitsToolsUsed) {
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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isToolUseArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).tool === "string" &&
        typeof (item as Record<string, unknown>).purpose === "string",
    )
  );
}

function isToolIssueArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" ||
        (item !== null &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).tool === "string" &&
          typeof (item as Record<string, unknown>).issue === "string"),
    )
  );
}

export function isValidAgentReport(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const report = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "status",
    "answer",
    "githitsToolsUsed",
    "toolIssues",
    "instructionIssues",
    "githitsUsefulness",
    "githitsUsefulnessReason",
    "confidence",
  ]);
  if (Object.keys(report).some((key) => !allowedKeys.has(key))) {
    return false;
  }
  return (
    (report.status === "success" ||
      report.status === "failure" ||
      report.status === "inconclusive") &&
    typeof report.answer === "string" &&
    isToolUseArray(report.githitsToolsUsed) &&
    isToolIssueArray(report.toolIssues) &&
    isStringArray(report.instructionIssues) &&
    (report.githitsUsefulness === "helped" ||
      report.githitsUsefulness === "hurt" ||
      report.githitsUsefulness === "unused" ||
      report.githitsUsefulness === "unclear") &&
    typeof report.githitsUsefulnessReason === "string" &&
    (report.confidence === "high" ||
      report.confidence === "medium" ||
      report.confidence === "low")
  );
}

async function runWithTimeout(
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
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 2_000).unref?.();
  }, timeoutSeconds * 1_000);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited.catch(() => undefined),
  ]);
  clearTimeout(timer);
  return { stdout, stderr, exitCode, timedOut };
}

function buildClaudeCommand(prompt: string, mcpConfigPath: string): string[] {
  return [
    "claude",
    "-p",
    prompt,
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    "--output-format",
    "json",
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
  ];
}

async function runWorkload(
  options: AgentEvalOptions,
  workloadPath: string,
  runDir: string,
  env: Record<string, string>,
  mcpConfig: McpServerConfig,
  secretValues: string[],
): Promise<WorkloadRunMetadata> {
  assert(existsSync(workloadPath), `Workload not found: ${workloadPath}`);
  const id = workloadId(workloadPath);
  const workloadDir = join(runDir, "workloads", id);
  const workspaceDir = mkdtempSync(
    join(tmpdir(), "githits-agent-eval-workspace-"),
  );
  mkdirSync(workloadDir, { recursive: true });

  const prompt = readFileSync(workloadPath, "utf8");
  const mcpConfigPath = join(workloadDir, "mcp.json");
  writeFileSync(join(workloadDir, "prompt.md"), prompt);
  writeJson(mcpConfigPath, mcpConfig);

  const command = buildClaudeCommand(prompt, mcpConfigPath);
  const metadataBase = {
    id,
    path: workloadPath,
    command,
    workspaceDir,
    workloadDir,
  };

  try {
    if (options.dryRun) {
      writeJson(join(workloadDir, "dry-run.json"), metadataBase);
      return { ...metadataBase, status: "dry-run" };
    }

    const started = Date.now();
    const result = await runWithTimeout(
      command,
      workspaceDir,
      env,
      options.timeoutSeconds,
    );
    const durationMs = Date.now() - started;

    writeFileSync(
      join(workloadDir, "stdout.json"),
      redactText(result.stdout, secretValues),
    );
    writeFileSync(
      join(workloadDir, "stderr.txt"),
      redactText(result.stderr, secretValues),
    );

    const finalJson = extractFinalJson(result.stdout);
    const validFinalJson = isValidAgentReport(finalJson);
    if (validFinalJson) {
      writeJson(
        join(workloadDir, "final.json"),
        redactValue(finalJson, secretValues),
      );
    } else if (finalJson !== undefined) {
      writeJson(
        join(workloadDir, "invalid-final.json"),
        redactValue(finalJson, secretValues),
      );
    }

    const status: RunStatus = result.timedOut
      ? "timeout"
      : result.exitCode === 0 && validFinalJson
        ? "success"
        : "failed";

    return {
      ...metadataBase,
      status,
      exitCode: result.exitCode,
      durationMs,
      timedOut: result.timedOut,
    };
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

export async function runAgentEval(options: AgentEvalOptions): Promise<void> {
  assert(
    existsSync(options.schemaPath),
    `Schema not found: ${options.schemaPath}`,
  );
  mkdirSync(options.outDir, { recursive: true });
  const env = buildEvalEnv(process.env);
  const secretValues = collectSecretValues(env);
  const mcpConfig = buildMcpConfig(options);

  if (!options.dryRun) {
    await assertClaudeAvailable();
  }

  const [git, claude] = await Promise.all([
    collectGitMetadata(options.repoRoot),
    claudeVersion(),
  ]);

  const workloadResults: WorkloadRunMetadata[] = [];
  for (const workload of options.workloads) {
    workloadResults.push(
      await runWorkload(
        options,
        workload,
        options.outDir,
        env,
        mcpConfig,
        secretValues,
      ),
    );
  }

  writeJson(join(options.outDir, "run.json"), {
    agent: options.agent,
    server: options.server,
    publishedPackage: options.publishedPackage,
    dryRun: options.dryRun,
    timeoutSeconds: options.timeoutSeconds,
    repoRoot: options.repoRoot,
    schemaPath: options.schemaPath,
    git,
    claudeVersion: claude,
    env: sanitizedEnvSummary(env),
    workloads: workloadResults,
  });

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
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const options = parseArgs(process.argv.slice(2), repoRoot);
  if (!isAbsolute(options.outDir)) {
    options.outDir = resolve(repoRoot, options.outDir);
  }
  await runAgentEval(options);
  console.log(`Agent eval artifacts written to ${options.outDir}`);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
