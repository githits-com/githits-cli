import { describe, expect, it } from "bun:test";
import { createPlatformMockFileSystemService } from "../../services/test-helpers.js";
import {
  type ClaudeHttpMcpExpectation,
  type ClaudeMcpInvocation,
  parseClaudeUserMcpState,
  resolveClaudeUserConfigPath,
} from "./claude-user-config.js";

const CANONICAL_INVOCATION: ClaudeMcpInvocation = {
  command: "npx",
  args: ["-y", "githits@latest", "mcp", "start"],
};
const CANONICAL_ENTRY = { type: "stdio", ...CANONICAL_INVOCATION };
const CANONICAL_HTTP_EXPECTATION: ClaudeHttpMcpExpectation = {
  type: "http",
  url: "https://mcp.example.test/mcp",
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

  it("rejects stdio entries with a non-empty URL", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: {
            githits: {
              ...CANONICAL_ENTRY,
              url: "https://other.example.test/mcp",
            },
          },
        }),
        CANONICAL_INVOCATION,
      ),
    ).toEqual({ status: "non_canonical" });
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

  it("classifies an HTTP entry with the exact expected type and URL", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: { githits: CANONICAL_HTTP_EXPECTATION },
        }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "configured" });
  });

  it("rejects HTTP entries with a non-empty local command", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: {
            githits: { ...CANONICAL_HTTP_EXPECTATION, command: "npx" },
          },
        }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "non_canonical" });
  });

  it("rejects HTTP entries with non-empty local args", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: {
            githits: {
              ...CANONICAL_HTTP_EXPECTATION,
              args: ["mcp", "start"],
            },
          },
        }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "non_canonical" });
  });

  it("accepts canonical HTTP entries with empty local command and args", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: {
            githits: {
              ...CANONICAL_HTTP_EXPECTATION,
              command: "",
              args: [],
            },
          },
        }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "configured" });
  });

  it("classifies an HTTP entry with a different URL as non-canonical", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: {
            githits: {
              ...CANONICAL_HTTP_EXPECTATION,
              url: "https://other.example.test/mcp",
            },
          },
        }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "non_canonical" });
  });

  it("classifies SSE as non-canonical when HTTP is expected", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: {
            githits: { ...CANONICAL_HTTP_EXPECTATION, type: "sse" },
          },
        }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "non_canonical" });
  });

  it("classifies an omitted type as non-canonical when HTTP is expected", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: { githits: { url: CANONICAL_HTTP_EXPECTATION.url } },
        }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "non_canonical" });
  });

  it("classifies a local invocation as non-canonical when HTTP is expected", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({ mcpServers: { githits: CANONICAL_ENTRY } }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "non_canonical" });
  });

  it("classifies HTTP as non-canonical when a local invocation is expected", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: { githits: CANONICAL_HTTP_EXPECTATION },
        }),
        CANONICAL_INVOCATION,
      ),
    ).toEqual({ status: "non_canonical" });
  });

  it("classifies a non-string HTTP URL as a probe failure", () => {
    expect(
      parseClaudeUserMcpState(
        JSON.stringify({
          mcpServers: { githits: { type: "http", url: 42 } },
        }),
        CANONICAL_HTTP_EXPECTATION,
      ),
    ).toEqual({ status: "probe_failed" });
  });

  it("classifies malformed JSON as a probe failure", () => {
    expect(parseClaudeUserMcpState("{", CANONICAL_HTTP_EXPECTATION)).toEqual({
      status: "probe_failed",
    });
  });

  it("does not expose a fake credential in the classification result", () => {
    const fakeCredential = "fake-secret-credential-do-not-return";
    const result = parseClaudeUserMcpState(
      JSON.stringify({
        mcpServers: {
          githits: {
            ...CANONICAL_HTTP_EXPECTATION,
            headers: { authorization: `Bearer ${fakeCredential}` },
          },
        },
      }),
      CANONICAL_HTTP_EXPECTATION,
    );

    expect(result).toEqual({ status: "configured" });
    expect(JSON.stringify(result)).not.toContain(fakeCredential);
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
