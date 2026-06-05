import { createHash, randomUUID } from "node:crypto";

/**
 * Maximum byte length for a header value.
 * Values exceeding this are dropped (returns undefined).
 */
const MAX_HEADER_BYTES = 256;

// ---------------------------------------------------------------------------
// Session ID
// ---------------------------------------------------------------------------

/**
 * Environment variables to probe for a terminal session identifier,
 * ordered from most-specific to least-specific.
 *
 * Terminal-specific:
 * - TERM_SESSION_ID: macOS Terminal.app
 * - ITERM_SESSION_ID: iTerm2
 * - WEZTERM_PANE: WezTerm
 * - KITTY_PID: Kitty
 * - ALACRITTY_SOCKET: Alacritty
 * - WT_SESSION: Windows Terminal
 *
 * IDE / agent:
 * - VSCODE_PID: VS Code (per-window, changes each launch)
 * - SUPERSET_PANE_ID: Superset/OpenCode pane
 * - SUPERSET_WORKSPACE_ID: Superset workspace session
 *
 * Shell-level:
 * - STARSHIP_SESSION_KEY: Starship prompt (widely used, per-shell session)
 *
 * Network:
 * - SSH_CONNECTION: SSH sessions
 */
const SESSION_ENV_VARS = [
  "TERM_SESSION_ID",
  "ITERM_SESSION_ID",
  "WEZTERM_PANE",
  "KITTY_PID",
  "ALACRITTY_SOCKET",
  "WT_SESSION",
  "VSCODE_PID",
  "SUPERSET_PANE_ID",
  "SUPERSET_WORKSPACE_ID",
  "STARSHIP_SESSION_KEY",
  "SSH_CONNECTION",
] as const;

/** Cached session ID — computed once per process. */
let cachedSessionId: string | undefined;

/**
 * Resolve a raw terminal session identifier from environment variables.
 * Falls back to parent PID (stable across CLI invocations from the same
 * shell), then process PID, then a random UUID.
 *
 * Exposed for testing — callers should use {@link getSessionId} instead.
 */
export function resolveRawSessionId(
  env: Record<string, string | undefined> = process.env,
  ppid: number = process.ppid,
): string {
  for (const key of SESSION_ENV_VARS) {
    const value = env[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  // Parent PID is stable across CLI invocations from the same shell/agent,
  // making it a better grouping key than process PID.
  if (typeof ppid === "number" && !Number.isNaN(ppid) && ppid > 0) {
    return String(ppid);
  }
  return randomUUID();
}

/**
 * Return a stable, privacy-safe session identifier.
 *
 * Hashes the raw session value with SHA-256 and truncates to 16 hex chars
 * (64 bits — sufficient for grouping, collision-safe at our scale).
 * Result is cached for the lifetime of the process.
 */
export function getSessionId(
  env?: Record<string, string | undefined>,
  ppid?: number,
): string {
  if (
    cachedSessionId !== undefined &&
    env === undefined &&
    ppid === undefined
  ) {
    return cachedSessionId;
  }
  const raw = resolveRawSessionId(env, ppid);
  const hashed = hashValue(raw);
  // Only cache when called with default (process) values
  if (env === undefined && ppid === undefined) {
    cachedSessionId = hashed;
  }
  return hashed;
}

/**
 * SHA-256 hash truncated to 16 hex characters.
 */
function hashValue(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Agent detection
// ---------------------------------------------------------------------------

/**
 * Agent identity: the tool/IDE driving the CLI.
 */
export interface AgentInfo {
  name: string;
  version?: string;
}

/**
 * Probes for well-known AI agent / IDE env vars.
 * Order matters — first match wins.
 *
 * | Env var              | Agent      | Notes                             |
 * |----------------------|------------|-----------------------------------|
 * | OPENCODE             | opencode   | OpenCode CLI                      |
 * | CLAUDECODE           | claude-code| Claude Code Bash tool shells only  |
 * | CURSOR_TRACE_ID      | cursor     | Cursor editor                     |
 * | WINDSURF_CONFIG_DIR  | windsurf   | Windsurf (Codeium)                |
 * | ZED_TERM             | zed        | Zed editor integrated terminal    |
 * | VSCODE_PID           | vscode     | VS Code (generic, any extension)  |
 */
const AGENT_PROBES: ReadonlyArray<{
  envVar: string;
  name: string;
}> = [
  { envVar: "OPENCODE", name: "opencode" },
  { envVar: "CLAUDECODE", name: "claude-code" },
  { envVar: "CURSOR_TRACE_ID", name: "cursor" },
  { envVar: "WINDSURF_CONFIG_DIR", name: "windsurf" },
  { envVar: "ZED_TERM", name: "zed" },
  { envVar: "VSCODE_PID", name: "vscode" },
];

/**
 * Parse an agent string in `name/version` format.
 * Returns undefined if the input is blank.
 */
export function parseAgentString(raw: string): AgentInfo | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) return { name: trimmed };
  const name = trimmed.slice(0, slashIndex);
  const ver = trimmed.slice(slashIndex + 1);
  if (name.length === 0) return undefined;
  return { name, version: ver || undefined };
}

/**
 * Format an AgentInfo as a `name/version` header value.
 */
function formatAgentInfo(info: AgentInfo): string {
  return info.version ? `${info.name}/${info.version}` : info.name;
}

/**
 * Detect agent from environment variables.
 *
 * Priority:
 * 1. `GITHITS_AGENT` — explicit override (format: `name/version` or `name`)
 * 2. Auto-detect from well-known env vars
 */
export function resolveAgentInfo(
  env: Record<string, string | undefined> = process.env,
): AgentInfo | undefined {
  // Explicit override — highest priority
  const explicit = env.GITHITS_AGENT;
  if (explicit && explicit.trim().length > 0) {
    return parseAgentString(explicit);
  }

  // Probe well-known env vars
  for (const probe of AGENT_PROBES) {
    const value = env[probe.envVar];
    if (value && value.trim().length > 0) {
      return { name: probe.name };
    }
  }

  return undefined;
}

/** Mutable agent info — set from env detection or MCP clientInfo. */
let currentAgentInfo: AgentInfo | undefined;
let agentInfoInitialized = false;
/** True when setAgentInfo() was called — prevents env re-detection. */
let agentInfoExplicitlySet = false;

/**
 * Optional lazy provider — called on every `buildClientHeaders()` invocation
 * to read the current MCP client identity. Used by the MCP server so we can
 * read `clientInfo` directly from the SDK at request time rather than racing
 * the `oninitialized` notification callback.
 *
 * The MCP SDK populates `_clientVersion` **synchronously** inside its
 * `_oninitialize` handler (before the initialize response is returned), so
 * every tool call that arrives after the initialize handshake will see a
 * populated value via this provider. The notification-callback pattern
 * (`server.oninitialized = …`) fires asynchronously after the initialize
 * response is sent — if the client's first tool call races the notification
 * dispatch, a callback-set agent info could be missing.
 */
type McpClientVersionProvider = () => AgentInfo | undefined;
let mcpClientVersionProvider: McpClientVersionProvider | undefined;

/**
 * Register a lazy MCP `clientInfo` provider. The provider runs on every
 * `buildClientHeaders()` call; when it returns a value, that takes
 * precedence over env-var detection.
 */
export function setMcpClientVersionProvider(
  provider: McpClientVersionProvider | undefined,
): void {
  mcpClientVersionProvider = provider;
}

/**
 * Get the current agent info. Priority order:
 *
 *  1. `setAgentInfo()` (explicit override, e.g. from a CLI flag)
 *  2. MCP `clientInfo` via the lazy provider (when running as MCP server)
 *  3. Env-var auto-detection (OPENCODE, CLAUDECODE, CURSOR_TRACE_ID, …)
 *
 * When `env` is passed (tests), auto-detection runs against that env.
 */
function getAgentInfo(
  env?: Record<string, string | undefined>,
): AgentInfo | undefined {
  if (agentInfoExplicitlySet) {
    return currentAgentInfo;
  }
  if (mcpClientVersionProvider) {
    try {
      const fromProvider = mcpClientVersionProvider();
      if (fromProvider && fromProvider.name.trim().length > 0) {
        return fromProvider;
      }
    } catch {
      // Provider failure must never break API requests — fall through to
      // env detection.
    }
  }
  if (!agentInfoInitialized || env !== undefined) {
    currentAgentInfo = resolveAgentInfo(env);
    if (env === undefined) {
      agentInfoInitialized = true;
    }
  }
  return currentAgentInfo;
}

/**
 * Override the agent info (e.g., from a CLI flag or test fixture). Takes
 * precedence over both the MCP clientInfo provider and env-var detection,
 * and cannot be overridden by subsequent env-based resolution.
 */
export function setAgentInfo(info: AgentInfo): void {
  currentAgentInfo = info;
  agentInfoInitialized = true;
  agentInfoExplicitlySet = true;
}

// ---------------------------------------------------------------------------
// Header sanitization
// ---------------------------------------------------------------------------

/**
 * Control character regex — matches C0 (0x00-0x1F), DEL (0x7F),
 * and C1 (0x80-0x9F) control characters.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — this regex exists to strip control chars from header values
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * Sanitize a header value:
 * 1. Coerce non-string inputs to undefined (runtime safety)
 * 2. Strip control characters
 * 3. Trim whitespace
 * 4. Return undefined if blank or exceeds MAX_HEADER_BYTES
 */
export function sanitizeHeaderValue(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === null || typeof value !== "string") {
    return undefined;
  }
  const cleaned = value.replace(CONTROL_CHARS, "").trim();
  if (cleaned.length === 0) return undefined;
  // Check byte length (UTF-8)
  if (Buffer.byteLength(cleaned, "utf8") > MAX_HEADER_BYTES) return undefined;
  return cleaned;
}

// ---------------------------------------------------------------------------
// Client mode
// ---------------------------------------------------------------------------

/** Default client name for direct CLI usage. */
const BASE_CLIENT_NAME = "githits-cli";

let clientName = BASE_CLIENT_NAME;
let clientVersion: string | undefined;

/**
 * Set the client mode suffix (e.g. `"mcp"`).
 * Changes the client name from `githits-cli` to `githits-cli/mcp`.
 */
export function setClientMode(mode: string): void {
  clientName = `${BASE_CLIENT_NAME}/${mode}`;
}

/**
 * Set the client package version used by the legacy module-level builder.
 * Prefer `createClientHeaderBuilder()` for new service code.
 */
export function setClientVersion(version: string | undefined): void {
  clientVersion = version;
}

export type ClientHeaderBuilder = () => Record<string, string>;

export interface CreateClientHeaderBuilderOptions {
  clientName: string;
  clientVersion?: string;
  agentProvider?: () => AgentInfo | undefined;
  env?: Record<string, string | undefined>;
  ppid?: number;
}

/**
 * Create an isolated, per-runtime client header builder.
 *
 * This is the package-boundary-safe API: callers provide their package
 * metadata and any request/client identity provider explicitly instead of
 * relying on module-level CLI state.
 */
export function createClientHeaderBuilder(
  options: CreateClientHeaderBuilderOptions,
): ClientHeaderBuilder {
  return () =>
    buildClientHeadersWithContext({
      clientName: options.clientName,
      clientVersion: options.clientVersion,
      agentProvider: options.agentProvider,
      env: options.env,
      ppid: options.ppid,
    });
}

// ---------------------------------------------------------------------------
// Header builder
// ---------------------------------------------------------------------------

/**
 * Build the `x-githits-*` client headers for authenticated API requests.
 *
 * Omits any header whose sanitized value is blank or oversized.
 * Returns a plain object suitable for spreading into request headers.
 *
 * Called per-request so that agent info set after client creation
 * (e.g., from MCP clientInfo) is included.
 *
 * Never throws — returns `{}` on unexpected errors so that API
 * requests proceed without client headers rather than failing.
 */
export function buildClientHeaders(
  env?: Record<string, string | undefined>,
  ppid?: number,
): Record<string, string> {
  return buildClientHeadersWithContext({
    clientName,
    clientVersion,
    env,
    ppid,
    agentProvider: () => getAgentInfo(env),
  });
}

interface BuildClientHeadersContext {
  clientName: string;
  clientVersion?: string;
  agentProvider?: () => AgentInfo | undefined;
  env?: Record<string, string | undefined>;
  ppid?: number;
}

function buildClientHeadersWithContext(
  context: BuildClientHeadersContext,
): Record<string, string> {
  try {
    const headers: Record<string, string> = {};

    const name = sanitizeHeaderValue(context.clientName);
    if (name) {
      headers["x-githits-client-name"] = name;
    }

    const safeClientVersion = sanitizeHeaderValue(context.clientVersion);
    if (safeClientVersion) {
      headers["x-githits-client-version"] = safeClientVersion;
    }

    const agentInfo =
      context.agentProvider?.() ?? resolveAgentInfo(context.env);
    if (agentInfo) {
      const agentValue = sanitizeHeaderValue(formatAgentInfo(agentInfo));
      if (agentValue) {
        headers["x-githits-agent"] = agentValue;
      }
    }

    const sessionId = sanitizeHeaderValue(
      getSessionId(context.env, context.ppid),
    );
    if (sessionId) {
      headers["x-githits-session-id"] = sessionId;
    }

    return headers;
  } catch {
    // Header generation must never break API requests.
    return {};
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset all mutable state. For testing only.
 */
export function resetRequestHeadersState(): void {
  cachedSessionId = undefined;
  currentAgentInfo = undefined;
  agentInfoInitialized = false;
  agentInfoExplicitlySet = false;
  mcpClientVersionProvider = undefined;
  clientName = BASE_CLIENT_NAME;
  clientVersion = undefined;
}
