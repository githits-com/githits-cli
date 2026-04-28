import semver from "semver";
import type { FileSystemService } from "./filesystem-service.js";

const NPM_DIST_TAGS_URL =
  "https://registry.npmjs.org/-/package/githits/dist-tags";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1000;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const UPDATE_COMMAND = "npm i -g githits@latest";

export interface UpdateCheckNotice {
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}

export interface UpdateCheckService {
  checkForUpdate(signal?: AbortSignal): Promise<UpdateCheckNotice | undefined>;
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
  checkedAt: string;
  latestVersion: string;
}

export interface UpdateCheckEligibilityInput {
  args: string[];
  env?: Record<string, string | undefined>;
  stderrIsTTY?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
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

    if (cache && !this.isCheckDue(cache)) {
      return this.noticeFromLatest(cache.latestVersion);
    }

    const latestVersion = await this.fetchLatestVersion(signal);
    if (!latestVersion) {
      return this.noticeFromLatest(cache?.latestVersion);
    }

    await this.saveCache({
      checkedAt: this.now().toISOString(),
      latestVersion,
    });

    return this.noticeFromLatest(latestVersion);
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
    const checkedAtMs = Date.parse(cache.checkedAt);
    if (Number.isNaN(checkedAtMs)) {
      return true;
    }
    return this.now().getTime() - checkedAtMs >= this.checkIntervalMs;
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

  private async loadCache(): Promise<UpdateCheckCache | undefined> {
    try {
      if (!(await this.fs.exists(this.cachePath))) {
        return undefined;
      }
      const raw = await this.fs.readFile(this.cachePath);
      const parsed = JSON.parse(raw) as Partial<UpdateCheckCache>;
      if (
        typeof parsed.checkedAt !== "string" ||
        typeof parsed.latestVersion !== "string"
      ) {
        return undefined;
      }
      return {
        checkedAt: parsed.checkedAt,
        latestVersion: parsed.latestVersion,
      };
    } catch {
      return undefined;
    }
  }

  private async saveCache(cache: UpdateCheckCache): Promise<void> {
    try {
      await this.fs.ensureDir(this.configDir, DIR_MODE);
      await this.fs.writeFile(
        this.cachePath,
        `${JSON.stringify(cache, null, 2)}\n`,
        FILE_MODE,
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

export function formatUpdateNotice(notice: UpdateCheckNotice): string {
  return `Update available: githits ${notice.currentVersion} -> ${notice.latestVersion}\nRun: ${notice.updateCommand}`;
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
