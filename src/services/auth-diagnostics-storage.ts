import { getAuthFileStorageDir } from "./app-config-paths.js";
import { normalizeBaseUrl } from "./auth-storage.js";
import type { FileSystemService } from "./filesystem-service.js";

/**
 * Why auth credentials were last cleared. Enumerated so the value carries no
 * free-form text and is safe to surface in `githits doctor`.
 */
export type AuthClearReason =
  | "logout"
  | "terminal_invalid_refresh_token"
  | "terminal_invalid_client";

export interface AuthClearEvent {
  reason: AuthClearReason;
  /** ISO timestamp of when the clear happened. */
  at: string;
}

export interface AuthDiagnosticsStore {
  recordClear(baseUrl: string, reason: AuthClearReason): Promise<void>;
  load(baseUrl: string): Promise<AuthClearEvent | null>;
}

interface StoredAuthDiagnostics {
  version: 1;
  events: Record<string, AuthClearEvent>;
}

const DIAGNOSTICS_FILE = "diagnostics.json";
const DIR_MODE = 0o700;
const CLEAR_REASONS: ReadonlySet<string> = new Set<AuthClearReason>([
  "logout",
  "terminal_invalid_refresh_token",
  "terminal_invalid_client",
]);

/**
 * Persists a non-secret breadcrumb describing why auth credentials were last
 * cleared, so `githits doctor` can explain a missing token in environments
 * where ephemeral telemetry is not visible (e.g. an MCP server whose stderr is
 * swallowed by the host harness).
 *
 * Deliberately separate from metadata.json: credential clears wipe metadata, so
 * a breadcrumb stored there would erase itself. This file is only ever
 * overwritten by the next event, never cleared. It holds no secrets — only a
 * reason enum and a timestamp.
 */
export class AuthDiagnosticsStorage implements AuthDiagnosticsStore {
  private readonly configDir: string;
  private readonly diagnosticsPath: string;

  constructor(
    private readonly fs: FileSystemService,
    configDir?: string,
  ) {
    this.configDir = configDir ?? getAuthFileStorageDir(fs);
    this.diagnosticsPath = fs.joinPath(this.configDir, DIAGNOSTICS_FILE);
  }

  /**
   * Best-effort: a diagnostics write must never break the logout or refresh
   * path it observes, so all write failures are swallowed.
   */
  async recordClear(baseUrl: string, reason: AuthClearReason): Promise<void> {
    try {
      const stored = (await this.loadFile()) ?? {
        version: 1 as const,
        events: {},
      };
      stored.events[normalizeBaseUrl(baseUrl)] = {
        reason,
        at: new Date().toISOString(),
      };

      await this.fs.ensureDir(this.configDir, DIR_MODE);
      await this.fs.atomicWriteFile(
        this.diagnosticsPath,
        JSON.stringify(stored, null, 2),
      );
    } catch {
      // Diagnostic side-channel; never propagate into the observed clear path.
    }
  }

  async load(baseUrl: string): Promise<AuthClearEvent | null> {
    const stored = await this.loadFile();
    if (!stored) return null;
    const event = stored.events[normalizeBaseUrl(baseUrl)] ?? null;
    return isAuthClearEvent(event) ? event : null;
  }

  private async loadFile(): Promise<StoredAuthDiagnostics | null> {
    if (!(await this.fs.exists(this.diagnosticsPath))) return null;
    try {
      const content = await this.fs.readFile(this.diagnosticsPath);
      const data: unknown = JSON.parse(content);
      // `events` must be a plain object: an array (or null) is truthy but would
      // silently drop string-keyed writes in JSON.stringify, so reject it and
      // let the next recordClear rebuild a fresh, self-healed file.
      if (!isRecord(data) || data.version !== 1 || !isRecord(data.events)) {
        return null;
      }
      return data as unknown as StoredAuthDiagnostics;
    } catch {
      return null;
    }
  }
}

/** Plain object check that rejects `null` (which `typeof` reports as object) and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is one of the known clear reasons. Exported so consumers that
 * read the raw file (e.g. `githits doctor`) validate against the same set.
 */
export function isAuthClearReason(value: unknown): value is AuthClearReason {
  return typeof value === "string" && CLEAR_REASONS.has(value);
}

function isAuthClearEvent(
  value: AuthClearEvent | null,
): value is AuthClearEvent {
  if (value === null || typeof value !== "object") return false;
  return (
    isAuthClearReason(value.reason) &&
    typeof value.at === "string" &&
    value.at.length > 0
  );
}
