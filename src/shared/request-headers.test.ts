import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  buildClientHeaders,
  getSessionId,
  parseAgentString,
  resetRequestHeadersState,
  resolveAgentInfo,
  resolveRawSessionId,
  sanitizeHeaderValue,
  setAgentInfo,
  setClientMode,
  setMcpClientVersionProvider,
} from "./request-headers.js";

/** Compute the same hash the module uses internally. */
function sha256Prefix(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

afterEach(() => {
  resetRequestHeadersState();
});

// ---------------------------------------------------------------------------
// resolveRawSessionId
// ---------------------------------------------------------------------------

describe("resolveRawSessionId", () => {
  it("returns TERM_SESSION_ID when set", () => {
    const env = { TERM_SESSION_ID: "abc-123" };
    expect(resolveRawSessionId(env, 999)).toBe("abc-123");
  });

  it("returns ITERM_SESSION_ID when TERM_SESSION_ID is absent", () => {
    const env = { ITERM_SESSION_ID: "iterm-456" };
    expect(resolveRawSessionId(env, 999)).toBe("iterm-456");
  });

  it("returns WEZTERM_PANE when higher-priority vars are absent", () => {
    const env = { WEZTERM_PANE: "0" };
    expect(resolveRawSessionId(env, 999)).toBe("0");
  });

  it("returns WT_SESSION for Windows Terminal", () => {
    const env = { WT_SESSION: "win-sess-789" };
    expect(resolveRawSessionId(env, 999)).toBe("win-sess-789");
  });

  it("returns SSH_CONNECTION for SSH sessions", () => {
    const env = { SSH_CONNECTION: "192.168.1.1 12345 10.0.0.1 22" };
    expect(resolveRawSessionId(env, 999)).toBe("192.168.1.1 12345 10.0.0.1 22");
  });

  it("prefers higher-priority var when multiple are set", () => {
    const env = {
      TERM_SESSION_ID: "first",
      ITERM_SESSION_ID: "second",
      WT_SESSION: "third",
    };
    expect(resolveRawSessionId(env, 999)).toBe("first");
  });

  it("skips blank values", () => {
    const env = { TERM_SESSION_ID: "   ", ITERM_SESSION_ID: "real" };
    expect(resolveRawSessionId(env, 999)).toBe("real");
  });

  it("skips empty string values", () => {
    const env = { TERM_SESSION_ID: "" };
    expect(resolveRawSessionId(env, 999)).toBe("999");
  });

  it("falls back to PPID when no env vars are set", () => {
    expect(resolveRawSessionId({}, 42)).toBe("42");
  });

  it("falls back to PPID when env is empty", () => {
    expect(resolveRawSessionId({}, 1234)).toBe("1234");
  });

  it("generates a random UUID when PPID is NaN", () => {
    const result = resolveRawSessionId({}, NaN);
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("generates unique values on each call when PPID is NaN", () => {
    const a = resolveRawSessionId({}, NaN);
    const b = resolveRawSessionId({}, NaN);
    expect(a).not.toBe(b);
  });

  it("generates a random UUID when PPID is zero", () => {
    const result = resolveRawSessionId({}, 0);
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("returns SUPERSET_PANE_ID for Superset/OpenCode", () => {
    const env = { SUPERSET_PANE_ID: "pane-abc-123" };
    expect(resolveRawSessionId(env, 999)).toBe("pane-abc-123");
  });

  it("returns STARSHIP_SESSION_KEY for Starship prompt", () => {
    const env = { STARSHIP_SESSION_KEY: "1283792602727211" };
    expect(resolveRawSessionId(env, 999)).toBe("1283792602727211");
  });
});

// ---------------------------------------------------------------------------
// getSessionId
// ---------------------------------------------------------------------------

describe("getSessionId", () => {
  it("returns a 16-char hex string", () => {
    const id = getSessionId({}, 42);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hashes the raw session value", () => {
    const env = { TERM_SESSION_ID: "my-session" };
    const id = getSessionId(env, 999);
    expect(id).toBe(sha256Prefix("my-session"));
  });

  it("hashes PPID fallback", () => {
    const id = getSessionId({}, 9999);
    expect(id).toBe(sha256Prefix("9999"));
  });

  it("produces stable output for the same input", () => {
    const env = { TERM_SESSION_ID: "stable" };
    const a = getSessionId(env, 1);
    resetRequestHeadersState();
    const b = getSessionId(env, 1);
    expect(a).toBe(b);
  });

  it("produces different output for different inputs", () => {
    const a = getSessionId({ TERM_SESSION_ID: "session-a" }, 1);
    resetRequestHeadersState();
    const b = getSessionId({ TERM_SESSION_ID: "session-b" }, 1);
    expect(a).not.toBe(b);
  });

  it("does not expose the raw session value", () => {
    const raw = "secret-terminal-id-12345";
    const env = { TERM_SESSION_ID: raw };
    const id = getSessionId(env, 1);
    expect(id).not.toContain(raw);
    expect(id).not.toContain("secret");
  });
});

// ---------------------------------------------------------------------------
// parseAgentString
// ---------------------------------------------------------------------------

describe("parseAgentString", () => {
  it("parses name/version format", () => {
    expect(parseAgentString("claude-code/1.0.0")).toEqual({
      name: "claude-code",
      version: "1.0.0",
    });
  });

  it("parses name only (no slash)", () => {
    expect(parseAgentString("cursor")).toEqual({ name: "cursor" });
  });

  it("handles trailing slash with no version", () => {
    expect(parseAgentString("agent/")).toEqual({ name: "agent" });
  });

  it("returns undefined for empty string", () => {
    expect(parseAgentString("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(parseAgentString("   ")).toBeUndefined();
  });

  it("returns undefined when name is empty (starts with slash)", () => {
    expect(parseAgentString("/1.0.0")).toBeUndefined();
  });

  it("trims whitespace", () => {
    expect(parseAgentString("  agent/1.0  ")).toEqual({
      name: "agent",
      version: "1.0",
    });
  });

  it("handles version with multiple slashes", () => {
    // Only split on first slash
    expect(parseAgentString("agent/1.0/beta")).toEqual({
      name: "agent",
      version: "1.0/beta",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAgentInfo
// ---------------------------------------------------------------------------

describe("resolveAgentInfo", () => {
  it("returns undefined when no agent env vars are set", () => {
    expect(resolveAgentInfo({})).toBeUndefined();
  });

  it("uses GITHITS_AGENT explicit override", () => {
    const env = { GITHITS_AGENT: "claude-code/1.0.0" };
    expect(resolveAgentInfo(env)).toEqual({
      name: "claude-code",
      version: "1.0.0",
    });
  });

  it("GITHITS_AGENT takes precedence over auto-detected agents", () => {
    const env = {
      GITHITS_AGENT: "custom-agent/2.0",
      OPENCODE: "1",
      CLAUDECODE: "1",
    };
    expect(resolveAgentInfo(env)).toEqual({
      name: "custom-agent",
      version: "2.0",
    });
  });

  it("detects OpenCode", () => {
    expect(resolveAgentInfo({ OPENCODE: "1" })).toEqual({ name: "opencode" });
  });

  it("detects Claude Code", () => {
    expect(resolveAgentInfo({ CLAUDECODE: "1" })).toEqual({
      name: "claude-code",
    });
  });

  it("detects Cursor", () => {
    expect(resolveAgentInfo({ CURSOR_TRACE_ID: "abc-123" })).toEqual({
      name: "cursor",
    });
  });

  it("detects Windsurf", () => {
    expect(
      resolveAgentInfo({ WINDSURF_CONFIG_DIR: "/home/user/.windsurf" }),
    ).toEqual({ name: "windsurf" });
  });

  it("detects Zed", () => {
    expect(resolveAgentInfo({ ZED_TERM: "1" })).toEqual({ name: "zed" });
  });

  it("detects VS Code", () => {
    expect(resolveAgentInfo({ VSCODE_PID: "12345" })).toEqual({
      name: "vscode",
    });
  });

  it("prefers higher-priority agent when multiple are set", () => {
    const env = { OPENCODE: "1", VSCODE_PID: "12345" };
    expect(resolveAgentInfo(env)).toEqual({ name: "opencode" });
  });

  it("skips blank GITHITS_AGENT and falls back to probes", () => {
    const env = { GITHITS_AGENT: "   ", OPENCODE: "1" };
    expect(resolveAgentInfo(env)).toEqual({ name: "opencode" });
  });
});

// ---------------------------------------------------------------------------
// sanitizeHeaderValue
// ---------------------------------------------------------------------------

describe("sanitizeHeaderValue", () => {
  it("returns clean strings unchanged", () => {
    expect(sanitizeHeaderValue("hello")).toBe("hello");
  });

  it("returns undefined for undefined input", () => {
    expect(sanitizeHeaderValue(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(sanitizeHeaderValue("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(sanitizeHeaderValue("   ")).toBeUndefined();
  });

  it("strips control characters", () => {
    expect(sanitizeHeaderValue("hello\x00world")).toBe("helloworld");
    expect(sanitizeHeaderValue("tab\there")).toBe("tabhere");
    expect(sanitizeHeaderValue("new\nline")).toBe("newline");
    expect(sanitizeHeaderValue("cr\rreturn")).toBe("crreturn");
  });

  it("strips C1 control characters (0x80-0x9F)", () => {
    expect(sanitizeHeaderValue("a\x80b\x9fc")).toBe("abc");
  });

  it("trims whitespace", () => {
    expect(sanitizeHeaderValue("  hello  ")).toBe("hello");
  });

  it("returns undefined when only control chars remain", () => {
    expect(sanitizeHeaderValue("\x00\x01\x02")).toBeUndefined();
  });

  it("returns undefined for oversized values", () => {
    const longValue = "x".repeat(257);
    expect(sanitizeHeaderValue(longValue)).toBeUndefined();
  });

  it("accepts values at the byte limit", () => {
    const exactValue = "x".repeat(256);
    expect(sanitizeHeaderValue(exactValue)).toBe(exactValue);
  });

  it("checks byte length not char length for multibyte", () => {
    // Each emoji is 4 bytes in UTF-8; 65 of them = 260 bytes > 256
    const multibyteValue = "\u{1F600}".repeat(65);
    expect(sanitizeHeaderValue(multibyteValue)).toBeUndefined();
  });

  it("returns undefined for non-string inputs at runtime", () => {
    // These can happen if external data (e.g. MCP clientInfo) has unexpected types
    expect(sanitizeHeaderValue(42 as unknown as string)).toBeUndefined();
    expect(sanitizeHeaderValue(true as unknown as string)).toBeUndefined();
    expect(sanitizeHeaderValue({} as unknown as string)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildClientHeaders
// ---------------------------------------------------------------------------

describe("buildClientHeaders", () => {
  it("includes base headers without agent when no agent env is set", () => {
    const headers = buildClientHeaders({}, 42);
    expect(headers["x-githits-client-name"]).toBe("githits-cli");
    expect(headers["x-githits-client-version"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(headers["x-githits-session-id"]).toMatch(/^[0-9a-f]{16}$/);
    expect(headers["x-githits-agent"]).toBeUndefined();
  });

  it("includes agent header when agent env is set", () => {
    const env = { GITHITS_AGENT: "claude-code/1.0.0" };
    const headers = buildClientHeaders(env, 42);
    expect(headers["x-githits-agent"]).toBe("claude-code/1.0.0");
  });

  it("includes agent header from auto-detected env", () => {
    const env = { OPENCODE: "1" };
    const headers = buildClientHeaders(env, 42);
    expect(headers["x-githits-agent"]).toBe("opencode");
  });

  it("includes agent header after setAgentInfo", () => {
    setAgentInfo({ name: "claude-code", version: "1.2.3" });
    const headers = buildClientHeaders({}, 42);
    expect(headers["x-githits-agent"]).toBe("claude-code/1.2.3");
  });

  it("setAgentInfo overrides env-detected agent", () => {
    // First call detects from env
    const env = { OPENCODE: "1" };
    const before = buildClientHeaders(env, 42);
    expect(before["x-githits-agent"]).toBe("opencode");

    // MCP clientInfo overrides
    setAgentInfo({ name: "cursor", version: "0.45.0" });
    const after = buildClientHeaders({}, 42);
    expect(after["x-githits-agent"]).toBe("cursor/0.45.0");
  });

  it("only includes x-githits-* headers", () => {
    const headers = buildClientHeaders({}, 42);
    for (const key of Object.keys(headers)) {
      expect(key.startsWith("x-githits-")).toBe(true);
    }
  });

  it("returns three headers when no agent detected", () => {
    const headers = buildClientHeaders({}, 42);
    expect(Object.keys(headers)).toHaveLength(3);
  });

  it("returns four headers when agent is detected", () => {
    const headers = buildClientHeaders({ OPENCODE: "1" }, 42);
    expect(Object.keys(headers)).toHaveLength(4);
  });

  it("session-id is stable across calls with same env", () => {
    const env = { TERM_SESSION_ID: "test-session" };
    const a = buildClientHeaders(env, 42);
    const b = buildClientHeaders(env, 42);
    expect(a["x-githits-session-id"]).toBe(b["x-githits-session-id"]);
  });

  it("defaults client-name to githits-cli", () => {
    const headers = buildClientHeaders({}, 42);
    expect(headers["x-githits-client-name"]).toBe("githits-cli");
  });

  it("changes client-name after setClientMode", () => {
    setClientMode("mcp");
    const headers = buildClientHeaders({}, 42);
    expect(headers["x-githits-client-name"]).toBe("githits-cli/mcp");
  });

  it("resets client-name after state reset", () => {
    setClientMode("mcp");
    resetRequestHeadersState();
    const headers = buildClientHeaders({}, 42);
    expect(headers["x-githits-client-name"]).toBe("githits-cli");
  });

  it("still produces a session-id when PPID is NaN", () => {
    const headers = buildClientHeaders({}, NaN);
    expect(headers["x-githits-session-id"]).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// setMcpClientVersionProvider — MCP clientInfo lazy reader
// ---------------------------------------------------------------------------

describe("setMcpClientVersionProvider", () => {
  it("uses the provider's return value for x-githits-agent", () => {
    setMcpClientVersionProvider(() => ({
      name: "cursor",
      version: "0.42.0",
    }));
    const headers = buildClientHeaders({});
    expect(headers["x-githits-agent"]).toBe("cursor/0.42.0");
  });

  it("runs the provider on every buildClientHeaders call (no caching)", () => {
    let current: { name: string; version?: string } | undefined = {
      name: "first",
    };
    setMcpClientVersionProvider(() => current);

    expect(buildClientHeaders({})["x-githits-agent"]).toBe("first");

    // Simulate MCP clientInfo arriving later (post-handshake).
    current = { name: "claude-code", version: "1.0.0" };
    expect(buildClientHeaders({})["x-githits-agent"]).toBe("claude-code/1.0.0");
  });

  it("falls back to env detection when the provider returns undefined", () => {
    setMcpClientVersionProvider(() => undefined);
    const headers = buildClientHeaders({ OPENCODE: "1" });
    expect(headers["x-githits-agent"]).toBe("opencode");
  });

  it("falls back to env detection when provider returns a blank name", () => {
    setMcpClientVersionProvider(() => ({ name: "   " }));
    const headers = buildClientHeaders({ CURSOR_TRACE_ID: "abc" });
    expect(headers["x-githits-agent"]).toBe("cursor");
  });

  it("falls back to env detection when the provider throws", () => {
    setMcpClientVersionProvider(() => {
      throw new Error("sdk not ready");
    });
    const headers = buildClientHeaders({ CLAUDECODE: "1" });
    expect(headers["x-githits-agent"]).toBe("claude-code");
  });

  it("is overridden by setAgentInfo (explicit override wins)", () => {
    setMcpClientVersionProvider(() => ({ name: "cursor" }));
    setAgentInfo({ name: "override", version: "1.0" });
    const headers = buildClientHeaders({});
    expect(headers["x-githits-agent"]).toBe("override/1.0");
  });
});
