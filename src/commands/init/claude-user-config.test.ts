import { describe, expect, it } from "bun:test";
import { createPlatformMockFileSystemService } from "../../services/test-helpers.js";
import {
  type ClaudeMcpInvocation,
  parseClaudeUserMcpState,
  resolveClaudeUserConfigPath,
} from "./claude-user-config.js";

const CANONICAL_INVOCATION: ClaudeMcpInvocation = {
  command: "npx",
  args: ["-y", "githits@latest", "mcp", "start"],
};
const CANONICAL_ENTRY = { type: "stdio", ...CANONICAL_INVOCATION };

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
        CANONICAL_INVOCATION,
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
        CANONICAL_INVOCATION,
      ),
    ).toEqual({ status: "configured" });
  });

  it("honors an alternate injected invocation", () => {
    const alternateInvocation: ClaudeMcpInvocation = {
      command: "bun",
      args: ["run", "githits-mcp"],
    };

    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: {
            githits: {
              command: alternateInvocation.command,
              args: alternateInvocation.args,
            },
          },
        }),
        alternateInvocation,
      ),
    ).toEqual({ status: "configured" });
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({ mcpServers: { githits: CANONICAL_ENTRY } }),
        alternateInvocation,
      ),
    ).toEqual({ status: "non_canonical" });
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
          CANONICAL_INVOCATION,
        ),
      ).toEqual({ status: "non_canonical" });
    }
  });

  it("classifies absent and invalid shapes", () => {
    expect(parseClaudeUserMcpState("{}", CANONICAL_INVOCATION)).toEqual({
      status: "not_configured",
    });
    expect(
      parseClaudeUserMcpState('{"mcpServers":{}}', CANONICAL_INVOCATION),
    ).toEqual({
      status: "not_configured",
    });
    expect(parseClaudeUserMcpState("null", CANONICAL_INVOCATION)).toEqual({
      status: "probe_failed",
    });
    expect(
      parseClaudeUserMcpState('{"mcpServers":[]}', CANONICAL_INVOCATION),
    ).toEqual({
      status: "probe_failed",
    });
    expect(
      parseClaudeUserMcpState(
        '{"mcpServers":{"githits":null}}',
        CANONICAL_INVOCATION,
      ),
    ).toEqual({
      status: "probe_failed",
    });
    expect(
      parseClaudeUserMcpState(
        '{"mcpServers":{"githits":{"args":["safe",42]}}}',
        CANONICAL_INVOCATION,
      ),
    ).toEqual({ status: "probe_failed" });
    const secret = "super-secret-credential";
    const malformedResult = parseClaudeUserMcpState(
      `{"mcpServers":{"githits":{"token":"${secret}"`,
      CANONICAL_INVOCATION,
    );
    expect(malformedResult).toEqual({
      status: "probe_failed",
    });
    expect(JSON.stringify(malformedResult)).not.toContain(secret);

    const validResult = parseClaudeUserMcpState(
      JSON.stringify({
        sessionToken: secret,
        mcpServers: {
          unrelated: { headers: { authorization: secret } },
          githits: { ...CANONICAL_ENTRY, env: { TOKEN: secret } },
        },
      }),
      CANONICAL_INVOCATION,
    );
    expect(validResult).toEqual({ status: "configured" });
    expect(JSON.stringify(validResult)).not.toContain(secret);
  });
});
