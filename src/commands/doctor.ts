import { realpath } from "node:fs/promises";
import type { Command } from "commander";
import { parse as parseToml } from "smol-toml";
import { version } from "../../package.json";
import {
  type AuthStorageMode,
  type ClientRegistration,
  DEFAULT_API_URL,
  DEFAULT_CODE_NAV_URL,
  DEFAULT_MCP_URL,
  type FileSystemService,
  FileSystemServiceImpl,
  getAppConfigDirForEnv,
  getAuthConfigPathForEnv,
  getAuthFileStorageDirForEnv,
  getLegacyAuthStorageDirForEnv,
  getLegacyMacAuthConfigPathForEnv,
  getLegacyMacAuthFileStorageDirForEnv,
  normalizeBaseUrl,
  parseAuthStorageMode,
  type TokenData,
} from "../services/index.js";

type ProbeStatus =
  | "present"
  | "missing"
  | "unreadable"
  | "invalid"
  | "skipped"
  | "error";

type ProbeSource = "config" | "default" | "env" | "file" | "legacy" | "runtime";

interface Probe<T> {
  status: ProbeStatus;
  value?: T;
  source?: ProbeSource;
  error?: { code?: string; message: string };
}

interface ServiceProbe {
  source: "default" | "env";
  value?: string;
}

interface AuthFileProbe {
  dir: string;
  source: "file" | "legacy";
  authFile: Probe<string>;
  clientFile: Probe<string>;
  metadataFile: Probe<string>;
  token: Probe<{ createdAt: string; expiresAt: string | null }>;
  client: Probe<{ registeredAt: string }>;
  metadata: Probe<{
    createdAt: string;
    expiresAt: string | null;
    updatedAt: string;
  }>;
}

export interface DoctorReport {
  schemaVersion: 1;
  version: string;
  currentTime: string;
  platform: {
    platform: NodeJS.Platform;
    arch: string;
  };
  runtime: {
    kind: "bun" | "node";
    nodeVersion: string;
    bunVersion?: string;
    execPath: string;
    argv1: Probe<string>;
    argv1Realpath: Probe<string>;
    cwd: string;
    pathGithits: Probe<string>;
    npmExecPath: Probe<string>;
    npmUserAgent: Probe<string>;
    bunInstall: Probe<string>;
  };
  environment: {
    home: Probe<string>;
    userProfile: Probe<string>;
    xdgConfigHome: Probe<string>;
    appData: Probe<string>;
    authStorageOverride: Probe<string>;
    envApiToken: Probe<"set">;
    httpProxy: Probe<"set">;
    httpsProxy: Probe<"set">;
    noProxy: Probe<"set">;
    nodeTlsRejectUnauthorized: Probe<"set">;
  };
  services: {
    mcpUrl: ServiceProbe;
    apiUrl: ServiceProbe;
    codeNavigationUrl: ServiceProbe;
  };
  config: {
    appConfigDir: string;
    configPath: string;
    configFile: Probe<string>;
    authStorageMode: Probe<AuthStorageMode>;
  };
  auth: {
    storageMode: Probe<AuthStorageMode>;
    activeFileStorageDir: string;
    files: AuthFileProbe[];
  };
  recommendations: string[];
}

export interface DoctorOptions {
  json?: boolean;
}

export interface DoctorDependencies {
  fs: FileSystemService;
  env: NodeJS.ProcessEnv;
  argv: string[];
  execPath: string;
  cwd: string;
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  bunVersion?: string;
  version: string;
  now: () => Date;
  realpath: (path: string) => Promise<string>;
}

interface StoredAuthFile {
  version: 1;
  tokens: Record<string, TokenData>;
}

interface StoredClientFile {
  version: 1;
  clients: Record<string, ClientRegistration>;
}

interface StoredMetadataFile {
  version: 1;
  sessions: Record<
    string,
    { createdAt: string; expiresAt: string | null; updatedAt: string }
  >;
}

interface ResolvedAuthConfig {
  configPath: string;
  configFile: Probe<string>;
  authStorageMode: Probe<AuthStorageMode>;
}

export function createDoctorDependencies(): DoctorDependencies {
  return {
    fs: new FileSystemServiceImpl(),
    env: process.env,
    argv: process.argv,
    execPath: process.execPath,
    cwd: process.cwd(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    bunVersion: process.versions.bun,
    version,
    now: () => new Date(),
    realpath,
  };
}

export async function doctorAction(
  options: DoctorOptions,
  deps: DoctorDependencies = createDoctorDependencies(),
): Promise<void> {
  const report = await buildDoctorReport(deps);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(formatDoctorReport(report));
}

export async function buildDoctorReport(
  deps: DoctorDependencies,
): Promise<DoctorReport> {
  const fs = deps.fs;
  const config = await resolveAuthConfig(fs, deps.env, deps.platform);
  const activeFileStorageDir = getAuthFileStorageDirForEnv(
    fs,
    deps.env,
    deps.platform,
  );
  const authFiles = await probeAuthFiles(fs, deps.env, activeFileStorageDir, [
    ...(deps.platform === "darwin"
      ? [getLegacyMacAuthFileStorageDirForEnv(fs, deps.env)]
      : []),
    getLegacyAuthStorageDirForEnv(fs, deps.env, deps.platform),
  ]);
  const report: DoctorReport = {
    schemaVersion: 1,
    version: deps.version,
    currentTime: deps.now().toISOString(),
    platform: {
      platform: deps.platform,
      arch: deps.arch,
    },
    runtime: await buildRuntimeReport(deps),
    environment: buildEnvironmentReport(deps.env),
    services: buildServicesReport(deps.env),
    config: {
      appConfigDir: getAppConfigDirForEnv(fs, deps.env, deps.platform),
      configPath: config.configPath,
      configFile: config.configFile,
      authStorageMode: config.authStorageMode,
    },
    auth: {
      storageMode: config.authStorageMode,
      activeFileStorageDir,
      files: authFiles,
    },
    recommendations: [],
  };
  report.recommendations = buildRecommendations(report);
  return report;
}

function buildEnvironmentReport(
  env: NodeJS.ProcessEnv,
): DoctorReport["environment"] {
  return {
    home: envProbe(env.HOME),
    userProfile: envProbe(env.USERPROFILE),
    xdgConfigHome: envProbe(env.XDG_CONFIG_HOME),
    appData: envProbe(env.APPDATA),
    authStorageOverride: envProbe(env.GITHITS_AUTH_STORAGE),
    envApiToken: secretEnvProbe(env.GITHITS_API_TOKEN),
    httpProxy: secretEnvProbe(env.HTTP_PROXY ?? env.http_proxy),
    httpsProxy: secretEnvProbe(env.HTTPS_PROXY ?? env.https_proxy),
    noProxy: secretEnvProbe(env.NO_PROXY ?? env.no_proxy),
    nodeTlsRejectUnauthorized: secretEnvProbe(env.NODE_TLS_REJECT_UNAUTHORIZED),
  };
}

async function buildRuntimeReport(
  deps: DoctorDependencies,
): Promise<DoctorReport["runtime"]> {
  const argv1 = deps.argv[1];
  return {
    kind: deps.bunVersion ? "bun" : "node",
    nodeVersion: deps.nodeVersion,
    bunVersion: deps.bunVersion,
    execPath: deps.execPath,
    argv1: argv1 ? { status: "present", value: argv1 } : { status: "missing" },
    argv1Realpath: argv1
      ? await realpathProbe(argv1, deps.realpath)
      : { status: "skipped", error: { message: "process.argv[1] is missing" } },
    cwd: deps.cwd,
    pathGithits: await resolvePathExecutable("githits", deps),
    npmExecPath: envProbe(deps.env.npm_execpath),
    npmUserAgent: envProbe(deps.env.npm_config_user_agent),
    bunInstall: envProbe(deps.env.BUN_INSTALL),
  };
}

function buildServicesReport(env: NodeJS.ProcessEnv): DoctorReport["services"] {
  return {
    mcpUrl: serviceProbe(env.GITHITS_MCP_URL, DEFAULT_MCP_URL),
    apiUrl: serviceProbe(env.GITHITS_API_URL, DEFAULT_API_URL),
    codeNavigationUrl: serviceProbe(
      env.GITHITS_CODE_NAV_URL ?? env.PKGSEER_URL,
      DEFAULT_CODE_NAV_URL,
    ),
  };
}

async function resolveAuthConfig(
  fs: FileSystemService,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<ResolvedAuthConfig> {
  const configPath = getAuthConfigPathForEnv(fs, env, platform);
  const envMode = env.GITHITS_AUTH_STORAGE;
  if (envMode !== undefined && envMode.trim() !== "") {
    try {
      return {
        configPath,
        configFile: await filePresenceProbe(fs, configPath),
        authStorageMode: {
          status: "present",
          value: parseAuthStorageMode(envMode),
          source: "env",
        },
      };
    } catch (error) {
      return {
        configPath,
        configFile: await filePresenceProbe(fs, configPath),
        authStorageMode: toErrorProbe(error, "env"),
      };
    }
  }

  const primaryConfig = await readOptionalTextFile(fs, configPath);
  if (primaryConfig.status === "present" && primaryConfig.value !== undefined) {
    return parseConfigStorageMode(configPath, primaryConfig.value, "config");
  }
  if (primaryConfig.status !== "missing") {
    return {
      configPath,
      configFile: primaryConfig,
      authStorageMode: {
        status: "skipped",
        source: "config",
        error: { message: "Config file could not be read" },
      },
    };
  }

  if (platform === "darwin") {
    const legacyConfigPath = getLegacyMacAuthConfigPathForEnv(fs, env);
    const legacyConfig = await readOptionalTextFile(fs, legacyConfigPath);
    if (legacyConfig.status === "present" && legacyConfig.value !== undefined) {
      return parseConfigStorageMode(
        legacyConfigPath,
        legacyConfig.value,
        "legacy",
      );
    }
    if (legacyConfig.status !== "missing") {
      return {
        configPath: legacyConfigPath,
        configFile: legacyConfig,
        authStorageMode: {
          status: "skipped",
          source: "legacy",
          error: { message: "Legacy macOS config file could not be read" },
        },
      };
    }
  }

  return {
    configPath,
    configFile: primaryConfig,
    authStorageMode: {
      status: "present",
      value: "keychain",
      source: "default",
    },
  };
}

function parseConfigStorageMode(
  configPath: string,
  contents: string,
  source: "config" | "legacy",
): ResolvedAuthConfig {
  try {
    const parsed = parseToml(contents) as { auth?: { storage?: unknown } };
    const storage = parsed.auth?.storage;
    if (typeof storage !== "string" || storage.trim() === "") {
      return {
        configPath,
        configFile: { status: "present", value: configPath, source },
        authStorageMode: {
          status: "present",
          value: "keychain",
          source: "default",
        },
      };
    }
    return {
      configPath,
      configFile: { status: "present", value: configPath, source },
      authStorageMode: {
        status: "present",
        value: parseAuthStorageMode(storage),
        source,
      },
    };
  } catch (error) {
    return {
      configPath,
      configFile: { status: "invalid", value: configPath, source },
      authStorageMode: toErrorProbe(error, source),
    };
  }
}

async function probeAuthFiles(
  fs: FileSystemService,
  env: NodeJS.ProcessEnv,
  activeDir: string,
  legacyDirs: string[],
): Promise<AuthFileProbe[]> {
  const uniqueDirs = [activeDir, ...legacyDirs].filter(
    (dir, index, dirs) => dirs.indexOf(dir) === index,
  );
  return Promise.all(
    uniqueDirs.map((dir, index) =>
      probeAuthFileDir(fs, env, dir, index === 0 ? "file" : "legacy"),
    ),
  );
}

async function probeAuthFileDir(
  fs: FileSystemService,
  env: NodeJS.ProcessEnv,
  dir: string,
  source: "file" | "legacy",
): Promise<AuthFileProbe> {
  const authPath = fs.joinPath(dir, "auth.json");
  const clientPath = fs.joinPath(dir, "client.json");
  const metadataPath = fs.joinPath(dir, "metadata.json");
  const normalizedMcpUrl = normalizeBaseUrl(
    env.GITHITS_MCP_URL ?? DEFAULT_MCP_URL,
  );
  const authFile = await readJsonFile<StoredAuthFile>(
    fs,
    authPath,
    isStoredAuthFile,
  );
  const clientFile = await readJsonFile<StoredClientFile>(
    fs,
    clientPath,
    isStoredClientFile,
  );
  const metadataFile = await readJsonFile<StoredMetadataFile>(
    fs,
    metadataPath,
    isStoredMetadataFile,
  );
  const token =
    authFile.status === "present" && authFile.value !== undefined
      ? tokenProbe(authFile.value.tokens[normalizedMcpUrl])
      : dependentProbe<{ createdAt: string; expiresAt: string | null }>(
          authFile,
          "auth.json could not be read",
        );
  const client =
    clientFile.status === "present" && clientFile.value !== undefined
      ? clientProbe(clientFile.value.clients[normalizedMcpUrl])
      : dependentProbe<{ registeredAt: string }>(
          clientFile,
          "client.json could not be read",
        );
  const metadata =
    metadataFile.status === "present" && metadataFile.value !== undefined
      ? metadataProbe(metadataFile.value.sessions[normalizedMcpUrl])
      : dependentProbe<{
          createdAt: string;
          expiresAt: string | null;
          updatedAt: string;
        }>(metadataFile, "metadata.json could not be read");

  return {
    dir,
    source,
    authFile: fileProbeFromRead(authFile, authPath, source),
    clientFile: fileProbeFromRead(clientFile, clientPath, source),
    metadataFile: fileProbeFromRead(metadataFile, metadataPath, source),
    token,
    client,
    metadata,
  };
}

function tokenProbe(
  token: TokenData | undefined,
): Probe<{ createdAt: string; expiresAt: string | null }> {
  if (!token) return { status: "missing", source: "file" };
  return {
    status: "present",
    source: "file",
    value: { createdAt: token.createdAt, expiresAt: token.expiresAt },
  };
}

function clientProbe(
  client: ClientRegistration | undefined,
): Probe<{ registeredAt: string }> {
  if (!client) return { status: "missing", source: "file" };
  return {
    status: "present",
    source: "file",
    value: { registeredAt: client.registeredAt },
  };
}

function metadataProbe(
  metadata: StoredMetadataFile["sessions"][string] | undefined,
): Probe<{ createdAt: string; expiresAt: string | null; updatedAt: string }> {
  if (!metadata) return { status: "missing", source: "file" };
  return { status: "present", source: "file", value: metadata };
}

function dependentProbe<T>(file: Probe<unknown>, message: string): Probe<T> {
  if (file.status === "missing") return { status: "missing", source: "file" };
  return {
    status: "skipped",
    source: "file",
    error: file.error ?? { message },
  };
}

function fileProbeFromRead<T>(
  file: Probe<T>,
  path: string,
  source: "file" | "legacy",
): Probe<string> {
  return {
    status: file.status,
    value: file.status === "missing" ? undefined : path,
    source,
    error: file.error,
  };
}

function buildRecommendations(report: DoctorReport): string[] {
  const recommendations: string[] = [];
  if (report.environment.xdgConfigHome.status === "present") {
    recommendations.push(
      "XDG_CONFIG_HOME is set. Compare `githits doctor --json` between the working and failing environments.",
    );
  }
  if (report.environment.appData.status === "present") {
    recommendations.push(
      "APPDATA is set. Compare `githits doctor --json` between the working and failing environments.",
    );
  }
  if (report.auth.storageMode.value === "file") {
    const active = report.auth.files[0];
    const activeMissing = active?.token.status === "missing";
    const legacyPresent = report.auth.files
      .slice(1)
      .some((entry) => entry.token.status === "present");
    if (activeMissing && legacyPresent) {
      recommendations.push(
        "The active file auth location has no token, but a legacy auth location has one.",
      );
    }
  }
  if (report.auth.storageMode.status === "invalid") {
    recommendations.push(
      "Fix the auth storage configuration before logging in again.",
    );
  }
  if (report.environment.envApiToken.status === "present") {
    recommendations.push(
      "GITHITS_API_TOKEN is set and takes precedence over stored OAuth credentials.",
    );
  }
  return recommendations;
}

function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("GitHits Doctor", "");
  lines.push(`Version: ${report.version}`);
  lines.push(`Current time: ${report.currentTime}`);
  lines.push(
    `Platform: ${report.platform.platform} ${report.platform.arch}`,
    "",
  );
  lines.push("Runtime:");
  lines.push(`  Runtime: ${report.runtime.kind}`);
  lines.push(`  Node: ${report.runtime.nodeVersion}`);
  if (report.runtime.bunVersion)
    lines.push(`  Bun: ${report.runtime.bunVersion}`);
  lines.push(`  Executable: ${report.runtime.execPath}`);
  lines.push(`  CLI entrypoint: ${formatProbe(report.runtime.argv1)}`);
  lines.push(
    `  CLI entrypoint realpath: ${formatProbe(report.runtime.argv1Realpath)}`,
  );
  lines.push(`  PATH githits: ${formatProbe(report.runtime.pathGithits)}`);
  lines.push(`  Working directory: ${report.runtime.cwd}`, "");
  lines.push("Environment:");
  lines.push(`  HOME: ${formatProbe(report.environment.home)}`);
  lines.push(`  USERPROFILE: ${formatProbe(report.environment.userProfile)}`);
  lines.push(
    `  XDG_CONFIG_HOME: ${formatProbe(report.environment.xdgConfigHome)}`,
  );
  lines.push(`  APPDATA: ${formatProbe(report.environment.appData)}`);
  lines.push(
    `  GITHITS_AUTH_STORAGE: ${formatProbe(report.environment.authStorageOverride)}`,
  );
  lines.push(
    `  GITHITS_API_TOKEN: ${formatProbe(report.environment.envApiToken)}`,
  );
  lines.push(`  HTTP_PROXY: ${formatProbe(report.environment.httpProxy)}`);
  lines.push(`  HTTPS_PROXY: ${formatProbe(report.environment.httpsProxy)}`);
  lines.push(`  NO_PROXY: ${formatProbe(report.environment.noProxy)}`);
  lines.push(
    `  NODE_TLS_REJECT_UNAUTHORIZED: ${formatProbe(report.environment.nodeTlsRejectUnauthorized)}`,
    "",
  );
  lines.push("Services:");
  lines.push(`  MCP URL: ${formatServiceProbe(report.services.mcpUrl)}`);
  lines.push(`  API URL: ${formatServiceProbe(report.services.apiUrl)}`);
  lines.push(
    `  Code navigation URL: ${formatServiceProbe(report.services.codeNavigationUrl)}`,
    "",
  );
  lines.push("Config:");
  lines.push(`  App config dir: ${report.config.appConfigDir}`);
  lines.push(`  Config file: ${formatProbe(report.config.configFile)}`);
  lines.push(
    `  Auth storage mode: ${formatProbe(report.config.authStorageMode)}`,
    "",
  );
  lines.push("Auth:");
  lines.push(`  Active file storage dir: ${report.auth.activeFileStorageDir}`);
  for (const entry of report.auth.files) {
    if (entry.source === "legacy" && !hasLegacyAuthEvidence(entry)) continue;
    lines.push(
      `  ${entry.source === "file" ? "Active" : "Legacy"} auth dir: ${entry.dir}`,
    );
    lines.push(`    auth.json: ${formatProbe(entry.authFile)}`);
    lines.push(`    client.json: ${formatProbe(entry.clientFile)}`);
    lines.push(`    metadata.json: ${formatProbe(entry.metadataFile)}`);
    lines.push(`    token: ${formatTimedProbe(entry.token)}`);
    lines.push(`    client: ${formatTimedProbe(entry.client)}`);
    lines.push(`    metadata: ${formatTimedProbe(entry.metadata)}`);
  }
  if (report.recommendations.length > 0) {
    lines.push("", "Recommendations:");
    for (const recommendation of report.recommendations) {
      lines.push(`  ${recommendation}`);
    }
  }
  return lines.join("\n");
}

function hasLegacyAuthEvidence(entry: AuthFileProbe): boolean {
  return (
    entry.authFile.status !== "missing" ||
    entry.clientFile.status !== "missing" ||
    entry.metadataFile.status !== "missing" ||
    entry.token.status !== "missing" ||
    entry.client.status !== "missing" ||
    entry.metadata.status !== "missing"
  );
}

function formatServiceProbe(probe: ServiceProbe): string {
  return probe.source === "default"
    ? "default production"
    : `overridden: ${probe.value}`;
}

function formatProbe<T>(probe: Probe<T>): string {
  if (probe.status === "present") return String(probe.value ?? "present");
  if (probe.status === "missing") return "unset/missing";
  if (probe.error) return `${probe.status}: ${probe.error.message}`;
  return probe.status;
}

function formatTimedProbe<T>(probe: Probe<T>): string {
  if (
    probe.status !== "present" ||
    !probe.value ||
    typeof probe.value !== "object"
  ) {
    return formatProbe(probe);
  }
  const entries = Object.entries(probe.value)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `present (${entries})`;
}

function envProbe(value: string | undefined): Probe<string> {
  const trimmed = value?.trim();
  return trimmed
    ? { status: "present", value: trimmed, source: "env" }
    : { status: "missing", source: "env" };
}

function secretEnvProbe(value: string | undefined): Probe<"set"> {
  const trimmed = value?.trim();
  return trimmed
    ? { status: "present", value: "set", source: "env" }
    : { status: "missing", source: "env" };
}

function serviceProbe(
  value: string | undefined,
  _defaultValue: string,
): ServiceProbe {
  return value !== undefined ? { source: "env", value } : { source: "default" };
}

async function filePresenceProbe(
  fs: FileSystemService,
  path: string,
): Promise<Probe<string>> {
  try {
    return (await fs.exists(path))
      ? { status: "present", value: path, source: "file" }
      : { status: "missing", source: "file" };
  } catch (error) {
    return toErrorProbe(error, "file");
  }
}

async function readOptionalTextFile(
  fs: FileSystemService,
  path: string,
): Promise<Probe<string>> {
  try {
    if (!(await fs.exists(path))) return { status: "missing", source: "file" };
    return {
      status: "present",
      value: await fs.readFile(path),
      source: "file",
    };
  } catch (error) {
    return toFileReadErrorProbe(error);
  }
}

async function readJsonFile<T>(
  fs: FileSystemService,
  path: string,
  isValid: (value: unknown) => value is T,
): Promise<Probe<T>> {
  const file = await readOptionalTextFile(fs, path);
  if (file.status !== "present" || file.value === undefined)
    return file as Probe<T>;
  try {
    const parsed = JSON.parse(file.value);
    if (!isValid(parsed)) {
      return {
        status: "invalid",
        source: "file",
        error: { message: "Unexpected JSON shape" },
      };
    }
    return { status: "present", value: parsed, source: "file" };
  } catch (error) {
    return toErrorProbe(error, "file", "invalid");
  }
}

function toFileReadErrorProbe<T>(error: unknown): Probe<T> {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  return {
    status: code === "EACCES" || code === "EPERM" ? "unreadable" : "error",
    source: "file",
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function toErrorProbe<T>(
  error: unknown,
  source: ProbeSource,
  status: ProbeStatus = "invalid",
): Probe<T> {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  return {
    status,
    source,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

async function realpathProbe(
  path: string,
  resolveRealpath: (path: string) => Promise<string>,
): Promise<Probe<string>> {
  try {
    return {
      status: "present",
      value: await resolveRealpath(path),
      source: "runtime",
    };
  } catch (error) {
    return toErrorProbe(error, "runtime", "error");
  }
}

async function resolvePathExecutable(
  name: string,
  deps: DoctorDependencies,
): Promise<Probe<string>> {
  const pathValue = deps.env.PATH;
  if (!pathValue) return { status: "missing", source: "env" };
  const pathDelimiter = deps.platform === "win32" ? ";" : ":";
  for (const dir of pathValue.split(pathDelimiter)) {
    if (!dir) continue;
    const candidate = deps.fs.joinPath(dir, name);
    try {
      if (await deps.fs.exists(candidate)) {
        return { status: "present", value: candidate, source: "env" };
      }
    } catch (error) {
      return toErrorProbe(error, "env", "error");
    }
  }
  return { status: "missing", source: "env" };
}

function isStoredAuthFile(value: unknown): value is StoredAuthFile {
  return (
    hasVersionOne(value) && typeof (value as StoredAuthFile).tokens === "object"
  );
}

function isStoredClientFile(value: unknown): value is StoredClientFile {
  return (
    hasVersionOne(value) &&
    typeof (value as StoredClientFile).clients === "object"
  );
}

function isStoredMetadataFile(value: unknown): value is StoredMetadataFile {
  return (
    hasVersionOne(value) &&
    typeof (value as StoredMetadataFile).sessions === "object"
  );
}

function hasVersionOne(value: unknown): value is { version: 1 } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1
  );
}

const DOCTOR_DESCRIPTION = `Print redacted diagnostics for GitHits configuration and authentication.

Doctor is intended for comparing environments when GitHits works in one
terminal or agent but fails in another. It never prints token values or client
secrets.`;

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .summary("Diagnose GitHits configuration and auth state")
    .description(DOCTOR_DESCRIPTION)
    .option("--json", "Output diagnostics as JSON")
    .action(async (options: DoctorOptions) => {
      await doctorAction(options);
    });
}
