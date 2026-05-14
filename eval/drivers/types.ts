/**
 * Common interface for an agent-CLI driver. Each implementation (Claude,
 * Codex, ...) shells out to a local CLI binary that uses the user's own
 * subscription auth and produces a single-turn text response.
 */

export type DriverName = "claude" | "codex";

export interface DriverResponse {
  /** The model's text response, stripped of any CLI chrome. */
  response: string;
  /** Wall-clock duration of the subprocess invocation. */
  durationMs: number;
  /** Raw stderr for debugging when something goes wrong. */
  stderr?: string;
}

export interface SendOptions {
  /**
   * If set, the driver wires up the mock MCP server so the agent has
   * a `pkg_vulns` tool available. The runner is responsible for
   * writing the per-cell state file at `stateFilePath` before calling
   * `send`; the spawned MCP subprocess reads it via the
   * `EVAL_MCP_STATE_FILE` env var.
   */
  mcp?: {
    /** Absolute path to the eval-mcp state JSON the server reads. */
    stateFilePath: string;
    /** Absolute path to the MCP server entry point (typescript file). */
    serverScriptPath: string;
    /** Extra env vars forwarded into the spawned MCP server process. */
    extraEnv?: Record<string, string>;
  };
  /**
   * If set, the driver runs from an isolated workspace containing the
   * GitHits Agent Skills and a mock `githits` CLI shim on PATH. The shim
   * reads the same state file as the mock MCP server so skills and MCP
   * surfaces receive identical fixture content.
   */
  skills?: {
    /** Workspace containing copied skill directories. */
    workspaceDir: string;
    /** Directory containing the mock `githits` executable. */
    binDir: string;
    /** Absolute path to the eval state JSON the mock CLI reads. */
    stateFilePath: string;
    /** Extra env vars forwarded to the agent and mock CLI. */
    extraEnv?: Record<string, string>;
  };
}

export interface AgentDriver {
  readonly name: DriverName;

  /**
   * Confirm the driver is usable on this machine: binary present on PATH,
   * user authenticated, version compatible. Returns a human-readable
   * reason on failure so the runner can skip with a clear message.
   */
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;

  /**
   * Send a single-turn prompt and return the model's response.
   *
   * When `opts.mcp` is set, the driver attaches the mock MCP server.
   * When `opts.skills` is set, the driver exposes copied Agent Skills
   * plus a mock GitHits CLI. Otherwise the driver runs tool-less for
   * direct-prompt evals.
   *
   * Should not throw on non-zero exit codes; instead surface them via
   * stderr in the returned object so the runner can log + continue.
   */
  send(prompt: string, opts?: SendOptions): Promise<DriverResponse>;
}
