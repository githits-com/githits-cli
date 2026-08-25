import { describe, expect, it, mock } from "bun:test";
import {
  createMockFileSystemService,
  createPlatformMockFileSystemService,
} from "../../services/test-helpers.js";
import {
  parseClaudeUserMcpState,
  readClaudeUserMcpState,
  resolveClaudeUserConfigPath,
} from "./claude-user-config.js";

const CANONICAL_ENTRY = {
  type: "stdio",
  command: "npx",
  args: ["-y", "githits@latest", "mcp", "start"],
};

describe("resolves Claude user config paths", () => {
  it("uses the home directory by default", () => {
    const fileSystem = createPlatformMockFileSystemService("darwin");

    expect(resolveClaudeUserConfigPath(fileSystem, {})).toBe(
      "/home/test/.claude.json",
    );
  });

  it("uses a non-empty override and falls back for an empty override", () => {
    const fileSystem = createPlatformMockFileSystemService("darwin");

    expect(
      resolveClaudeUserConfigPath(fileSystem, {
        CLAUDE_CONFIG_DIR: "/custom/claude",
      }),
    ).toBe("/custom/claude/.claude.json");
    expect(
      resolveClaudeUserConfigPath(fileSystem, { CLAUDE_CONFIG_DIR: "" }),
    ).toBe("/home/test/.claude.json");
  });

  it("uses injected POSIX and Windows path joins", () => {
    expect(
      resolveClaudeUserConfigPath(
        createPlatformMockFileSystemService("linux"),
        { CLAUDE_CONFIG_DIR: "/custom/claude" },
      ),
    ).toBe("/custom/claude/.claude.json");
    expect(
      resolveClaudeUserConfigPath(
        createPlatformMockFileSystemService("win32"),
        { CLAUDE_CONFIG_DIR: "C:\\custom\\claude" },
      ),
    ).toBe("C:\\custom\\claude\\.claude.json");
  });
});

describe("classifies Claude user MCP state", () => {
  it("accepts canonical explicit and omitted stdio entries", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({ mcpServers: { githits: CANONICAL_ENTRY } }),
      ),
    ).toEqual({ status: "configured" });
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          unrelated: "ignored",
          mcpServers: {
            other: { command: "secret-command" },
            githits: { command: "npx", args: CANONICAL_ENTRY.args },
          },
        }),
      ),
    ).toEqual({ status: "configured" });
  });

  it("classifies valid but non-canonical entries", () => {
    for (const entry of [
      { ...CANONICAL_ENTRY, type: "sse" },
      { ...CANONICAL_ENTRY, command: "node" },
      { ...CANONICAL_ENTRY, args: ["-y", "githits", "mcp", "start"] },
      { command: "npx" },
      { extra: { secret: "do-not-return" } },
    ]) {
      expect(
        parseClaudeUserMcpState(
          JSON.stringify({ mcpServers: { githits: entry } }),
        ),
      ).toEqual({ status: "non_canonical", reason: "non_canonical" });
    }
  });

  it("classifies absent and invalid shapes", () => {
    expect(parseClaudeUserMcpState("{}")).toEqual({
      status: "not_configured",
      reason: "missing_mcp_servers",
    });
    expect(parseClaudeUserMcpState('{"mcpServers":{}}')).toEqual({
      status: "not_configured",
      reason: "missing_server",
    });
    expect(parseClaudeUserMcpState("null")).toEqual({
      status: "probe_failed",
      reason: "invalid_root",
    });
    expect(parseClaudeUserMcpState('{"mcpServers":[]}')).toEqual({
      status: "probe_failed",
      reason: "invalid_mcp_servers",
    });
    expect(parseClaudeUserMcpState('{"mcpServers":{"githits":null}}')).toEqual({
      status: "probe_failed",
      reason: "invalid_server",
    });
    expect(
      parseClaudeUserMcpState(
        '{"mcpServers":{"githits":{"args":["safe",42]}}}',
      ),
    ).toEqual({ status: "probe_failed", reason: "invalid_server" });
  });
});

describe("reads Claude user MCP state safely", () => {
  it("maps a missing file to not configured without exposing input", async () => {
    const fileSystem = createMockFileSystemService();
    const result = await readClaudeUserMcpState(fileSystem);

    expect(result).toEqual({
      status: "not_configured",
      reason: "missing_file",
      path: "/home/test/.claude.json",
    });
  });

  it("sanitizes IO and parse failures", async () => {
    const secret = "super-secret-credential";
    const unreadable = new Error(secret) as NodeJS.ErrnoException;
    unreadable.code = "EACCES";
    const unreadableFileSystem = createMockFileSystemService({
      readFile: mock(() => Promise.reject(unreadable)),
    });
    const unreadableResult = await readClaudeUserMcpState(unreadableFileSystem);
    expect(unreadableResult).toEqual({
      status: "probe_failed",
      reason: "unreadable",
      path: "/home/test/.claude.json",
    });
    expect(JSON.stringify(unreadableResult)).not.toContain(secret);

    const malformedFileSystem = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(`{"mcpServers":{"githits":{"token":"${secret}"`),
      ),
    });
    const malformedResult = await readClaudeUserMcpState(malformedFileSystem);
    expect(malformedResult).toEqual({
      status: "probe_failed",
      reason: "invalid_json",
      path: "/home/test/.claude.json",
    });
    expect(JSON.stringify(malformedResult)).not.toContain(secret);
  });

  it("returns only state and path for a secret-bearing canonical document", async () => {
    const secret = "super-secret-credential";
    const fileSystem = createMockFileSystemService({
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify({
            sessionToken: secret,
            mcpServers: {
              unrelated: { headers: { authorization: secret } },
              githits: { ...CANONICAL_ENTRY, env: { TOKEN: secret } },
            },
          }),
        ),
      ),
    });

    const result = await readClaudeUserMcpState(fileSystem);
    expect(result).toEqual({
      status: "configured",
      path: "/home/test/.claude.json",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
