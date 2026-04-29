import semver from "semver";
import type { FileSystemService } from "./filesystem-service.js";

const NPM_DIST_TAGS_URL =
  "https://registry.npmjs.org/-/package/githits/dist-tags";
const NPM_PACKAGE_VERSION_URL = "https://registry.npmjs.org/githits";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1000;
const DIR_MODE = 0o700;
const UPDATE_COMMAND = "npm i -g githits@latest";
const MAX_DEPRECATION_REASON_LENGTH = 200;

export interface UpdateCheckNotice {
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}

export interface RequiredUpdateNotice {
  currentVersion: string;
  latestKnownVersion?: string;
  reason: string;
  updateCommand: string;
}

export interface UpdateCheckService {
  checkForUpdate(signal?: AbortSignal): Promise<UpdateCheckNotice | undefined>;
  refreshRequiredUpdateStatus(signal?: AbortSignal): Promise<void>;
  getRequiredUpdateNotice(): Promise<RequiredUpdateNotice | undefined>;
}

export type UpdateCheckFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface UpdateCheckServiceOptions {
  currentVersion: string;
  fileSystemService: FileSystemService;
  fetcher?: UpdateCheckFetcher;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  checkIntervalMs?: number;
  fetchTimeoutMs?: number;
}

interface UpdateCheckCache {
  checkedAt?: string;
  latestVersion?: string;
  currentVersionStatus?: CurrentVersionStatus;
}

interface CurrentVersionStatus {
  version: string;
  checkedAt: string;
  deprecatedReason?: string;
}

export interface UpdateCheckEligibilityInput {
  args: string[];
  env?: Record<string, string | undefined>;
  stderrIsTTY?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

export interface RequiredUpdateEligibilityInput {
  args: string[];
  env?: Record<string, string | undefined>;
}

export class NpmRegistryUpdateCheckService implements UpdateCheckService {
  private readonly currentVersion: string;
  private readonly fs: FileSystemService;
  private readonly fetcher: UpdateCheckFetcher;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => Date;
  private readonly checkIntervalMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly configDir: string;
  private readonly cachePath: string;

  constructor(options: UpdateCheckServiceOptions) {
    this.currentVersion = options.currentVersion;
    this.fs = options.fileSystemService;
    this.fetcher = options.fetcher ?? fetch;
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
    this.configDir = this.fs.joinPath(
      resolveConfigHome(this.env, this.fs),
      "githits",
    );
    this.cachePath = this.fs.joinPath(this.configDir, "update-check.json");
  }

  async checkForUpdate(
    signal?: AbortSignal,
  ): Promise<UpdateCheckNotice | undefined> {
    const cache = await this.loadCache();
    const latestDue = !cache || this.isCheckDue(cache);
    const currentVersionStatusDue = this.isCurrentVersionStatusDue(
      cache?.currentVersionStatus,
    );
    const currentVersionStatus = await this.refreshCurrentVersionStatusIfDue(
      cache?.currentVersionStatus,
      signal,
    );
    const currentVersionStatusChanged =
      currentVersionStatusDue &&
      !sameCurrentVersionStatus(
        currentVersionStatus,
        cache?.currentVersionStatus,
      );

    if (cache && !latestDue) {
      if (currentVersionStatusChanged) {
        await this.saveCache({
          ...cache,
          currentVersionStatus,
        });
      }
      return this.noticeFromLatest(cache.latestVersion);
    }

    const latestVersion = await this.fetchLatestVersion(signal);
    if (!latestVersion) {
      if (currentVersionStatusChanged) {
        await this.saveCache({
          ...cache,
          currentVersionStatus,
        });
      }
      return this.noticeFromLatest(cache?.latestVersion);
    }

    await this.saveCache({
      checkedAt: this.now().toISOString(),
      latestVersion,
      currentVersionStatus,
    });

    return this.noticeFromLatest(latestVersion);
  }

  async refreshRequiredUpdateStatus(signal?: AbortSignal): Promise<void> {
    const cache = await this.loadCache();
    const currentVersionStatusDue = this.isCurrentVersionStatusDue(
      cache?.currentVersionStatus,
    );
    const currentVersionStatus = await this.refreshCurrentVersionStatusIfDue(
      cache?.currentVersionStatus,
      signal,
    );
    if (
      currentVersionStatusDue &&
      !sameCurrentVersionStatus(
        currentVersionStatus,
        cache?.currentVersionStatus,
      )
    ) {
      await this.saveCache({
        ...cache,
        currentVersionStatus,
      });
    }
  }

  async getRequiredUpdateNotice(): Promise<RequiredUpdateNotice | undefined> {
    const cache = await this.loadCache();
    const status = cache?.currentVersionStatus;
    if (
      !status ||
      status.version !== this.currentVersion ||
      !status.deprecatedReason
    ) {
      return undefined;
    }

    return {
      currentVersion: this.currentVersion,
      ...(cache.latestVersion
        ? { latestKnownVersion: cache.latestVersion }
        : {}),
      reason: status.deprecatedReason,
      updateCommand: formatUpdateCommand(this.env),
    };
  }

  private noticeFromLatest(
    latestVersion: string | undefined,
  ): UpdateCheckNotice | undefined {
    if (
      !latestVersion ||
      !semver.valid(latestVersion) ||
      !semver.valid(this.currentVersion) ||
      !semver.gt(latestVersion, this.currentVersion)
    ) {
      return undefined;
    }

    return {
      currentVersion: this.currentVersion,
      latestVersion,
      updateCommand: UPDATE_COMMAND,
    };
  }

  private isCheckDue(cache: UpdateCheckCache): boolean {
    if (!cache.checkedAt || !cache.latestVersion) {
      return true;
    }
    const checkedAtMs = Date.parse(cache.checkedAt);
    if (Number.isNaN(checkedAtMs)) {
      return true;
    }
    return this.now().getTime() - checkedAtMs >= this.checkIntervalMs;
  }

  private isCurrentVersionStatusDue(
    status: CurrentVersionStatus | undefined,
  ): boolean {
    if (!status || status.version !== this.currentVersion) {
      return true;
    }
    const checkedAtMs = Date.parse(status.checkedAt);
    if (Number.isNaN(checkedAtMs)) {
      return true;
    }
    return this.now().getTime() - checkedAtMs >= this.checkIntervalMs;
  }

  private async refreshCurrentVersionStatusIfDue(
    cached: CurrentVersionStatus | undefined,
    signal: AbortSignal | undefined,
  ): Promise<CurrentVersionStatus | undefined> {
    const reusableCached =
      cached?.version === this.currentVersion ? cached : undefined;
    if (!this.isCurrentVersionStatusDue(reusableCached)) {
      return reusableCached;
    }

    const remote = await this.fetchCurrentVersionStatus(signal);
    if (!remote) {
      return reusableCached;
    }

    return remote;
  }

  private async fetchLatestVersion(
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    try {
      const timeoutSignal = AbortSignal.timeout(this.fetchTimeoutMs);
      const response = await this.fetcher(NPM_DIST_TAGS_URL, {
        signal: signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal,
      });
      if (!response.ok) {
        return undefined;
      }
      const body = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as { latest?: unknown }).latest !== "string"
      ) {
        return undefined;
      }
      const latest = (body as { latest: string }).latest;
      return semver.valid(latest) ? latest : undefined;
    } catch {
      return undefined;
    }
  }

  private async fetchCurrentVersionStatus(
    signal: AbortSignal | undefined,
  ): Promise<CurrentVersionStatus | undefined> {
    try {
      const timeoutSignal = AbortSignal.timeout(this.fetchTimeoutMs);
      const response = await this.fetcher(
        `${NPM_PACKAGE_VERSION_URL}/${this.currentVersion}`,
        {
          signal: signal
            ? AbortSignal.any([signal, timeoutSignal])
            : timeoutSignal,
        },
      );
      if (!response.ok) {
        return undefined;
      }
      const body = await response.json();
      if (!body || typeof body !== "object") {
        return undefined;
      }
      const rawDeprecated = (body as { deprecated?: unknown }).deprecated;
      const deprecatedReason =
        typeof rawDeprecated === "string"
          ? sanitizeDeprecationReason(rawDeprecated)
          : undefined;

      return {
        version: this.currentVersion,
        checkedAt: this.now().toISOString(),
        ...(deprecatedReason ? { deprecatedReason } : {}),
      };
    } catch {
      return undefined;
    }
  }

  private async loadCache(): Promise<UpdateCheckCache | undefined> {
    try {
      if (!(await this.fs.exists(this.cachePath))) {
        return undefined;
      }
      const raw = await this.fs.readFile(this.cachePath);
      const parsed = JSON.parse(raw) as Partial<UpdateCheckCache>;
      const currentVersionStatus = parseCurrentVersionStatus(
        parsed.currentVersionStatus,
      );
      const hasLatest =
        typeof parsed.checkedAt === "string" &&
        typeof parsed.latestVersion === "string";
      if (!hasLatest && !currentVersionStatus) {
        return undefined;
      }
      return {
        ...(hasLatest
          ? {
              checkedAt: parsed.checkedAt,
              latestVersion: parsed.latestVersion,
            }
          : {}),
        currentVersionStatus,
      };
    } catch {
      return undefined;
    }
  }

  private async saveCache(cache: UpdateCheckCache): Promise<void> {
    try {
      await this.fs.ensureDir(this.configDir, DIR_MODE);
      if (typeof this.fs.atomicWriteFile === "function") {
        await this.fs.atomicWriteFile(
          this.cachePath,
          `${JSON.stringify(cache, null, 2)}\n`,
        );
        return;
      }
      await this.fs.writeFile(
        this.cachePath,
        `${JSON.stringify(cache, null, 2)}\n`,
        0o600,
      );
    } catch {
      // Update checks must never break the real command.
    }
  }
}

export function resolveConfigHome(
  env: Record<string, string | undefined>,
  fs: FileSystemService,
): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) {
    return xdgConfigHome;
  }
  return fs.joinPath(fs.getHomeDir(), ".config");
}

export function shouldRunUpdateCheck(
  input: UpdateCheckEligibilityInput,
): boolean {
  if (input.stderrIsTTY !== true) {
    return false;
  }

  const env = input.env ?? process.env;
  if (env.CI || env.GITHITS_DISABLE_UPDATE_CHECK) {
    return false;
  }

  if (isHelpOrVersionInvocation(input.args)) {
    return false;
  }

  if (isLikelyEphemeralPackageRunner(env)) {
    return false;
  }

  if (
    isMcpStdioInvocation(
      input.args,
      input.stdinIsTTY === true,
      input.stdoutIsTTY === true,
    )
  ) {
    return false;
  }

  return true;
}

export function shouldRunRequiredUpdateEnforcement(
  input: RequiredUpdateEligibilityInput,
): boolean {
  if (isHelpOrVersionInvocation(input.args)) {
    return false;
  }

  const env = input.env ?? process.env;
  if (isLikelyEphemeralPackageRunner(env)) {
    return false;
  }

  return true;
}

export function formatUpdateNotice(notice: UpdateCheckNotice): string {
  return `Update available: githits ${notice.currentVersion} -> ${notice.latestVersion}\nRun: ${notice.updateCommand}`;
}

export function formatRequiredUpdateNotice(
  notice: RequiredUpdateNotice,
): string {
  const lines = [
    `Update required: ${notice.reason}`,
    "",
    `Installed githits ${notice.currentVersion} is no longer supported.`,
  ];
  if (notice.latestKnownVersion) {
    lines.push(`Latest known version: ${notice.latestKnownVersion}`);
  }
  lines.push("Update with:", `  ${notice.updateCommand}`);
  return [...lines].join("\n");
}

export function formatUpdateCommand(
  env: Record<string, string | undefined> = process.env,
): string {
  const userAgent = env.npm_config_user_agent ?? "";
  const execPath = env.npm_execpath ?? "";
  const signal = `${userAgent} ${execPath}`.toLowerCase();

  if (signal.includes("pnpm")) {
    return "pnpm add -g githits@latest";
  }
  if (signal.includes("yarn")) {
    return "yarn global add githits@latest";
  }
  if (signal.includes("bun")) {
    return "bun add -g githits@latest";
  }
  return UPDATE_COMMAND;
}

function parseCurrentVersionStatus(
  value: unknown,
): CurrentVersionStatus | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const status = value as Partial<CurrentVersionStatus>;
  if (typeof status.version !== "string") {
    return undefined;
  }
  if (typeof status.checkedAt !== "string") {
    return undefined;
  }
  const deprecatedReason =
    typeof status.deprecatedReason === "string"
      ? sanitizeDeprecationReason(status.deprecatedReason)
      : undefined;
  return {
    version: status.version,
    checkedAt: status.checkedAt,
    ...(deprecatedReason ? { deprecatedReason } : {}),
  };
}

function sameCurrentVersionStatus(
  left: CurrentVersionStatus | undefined,
  right: CurrentVersionStatus | undefined,
): boolean {
  return (
    left?.version === right?.version &&
    left?.checkedAt === right?.checkedAt &&
    left?.deprecatedReason === right?.deprecatedReason
  );
}

function sanitizeDeprecationReason(value: string): string | undefined {
  const sanitized = Array.from(value)
    .map((character) => (isControlCharacter(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DEPRECATION_REASON_LENGTH)
    .trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

function isControlCharacter(value: string): boolean {
  const code = value.charCodeAt(0);
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function isHelpOrVersionInvocation(args: string[]): boolean {
  return (
    args.length === 0 ||
    args[0] === "help" ||
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    args.includes("-V")
  );
}

function isLikelyEphemeralPackageRunner(
  env: Record<string, string | undefined>,
): boolean {
  const lifecycleEvent = env.npm_lifecycle_event;
  if (lifecycleEvent === "npx" || lifecycleEvent === "bunx") {
    return true;
  }

  const userAgent = env.npm_config_user_agent ?? "";
  return (
    env.npm_command === "exec" &&
    (userAgent.startsWith("npm/") || userAgent.startsWith("bun/"))
  );
}

function isMcpStdioInvocation(
  args: string[],
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
): boolean {
  const firstTokenIndex = args.findIndex((arg) => !arg.startsWith("-"));
  if (firstTokenIndex === -1 || args[firstTokenIndex] !== "mcp") {
    return false;
  }

  const remainingArgs = args.slice(firstTokenIndex + 1);
  return remainingArgs.includes("start") || !stdinIsTTY || !stdoutIsTTY;
}
