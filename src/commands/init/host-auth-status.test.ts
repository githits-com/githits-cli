import { describe, expect, it } from "bun:test";
import {
  parseClaudeAuthStatus,
  parseCodexAuthStatus,
  parseNamedAuthStatus,
} from "./host-auth-status.js";

const MCP_URL = "https://mcp.githits.com";

function codexRow(
  auth_status: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify([
    {
      name: "githits",
      enabled: true,
      transport: { type: "streamable_http", url: MCP_URL },
      auth_status,
      ...overrides,
    },
  ]);
}

function claudeOutput(
  status: string,
  overrides: Partial<Record<"Scope" | "Type" | "URL", string>> = {},
): string {
  return [
    "githits:",
    `  Scope: ${overrides.Scope ?? "User config (available in all your projects)"}`,
    `  Status: ${status}`,
    `  Type: ${overrides.Type ?? "http"}`,
    `  URL: ${overrides.URL ?? MCP_URL}`,
  ].join("\n");
}

describe("parseCodexAuthStatus", () => {
  it("classifies supported states for one enabled canonical row", () => {
    expect(parseCodexAuthStatus(codexRow("not_logged_in"))).toBe("required");
    expect(parseCodexAuthStatus(codexRow("o_auth"))).toBe("authenticated");
    expect(parseCodexAuthStatus(codexRow("bearer_token"))).toBe(
      "authenticated",
    );
    expect(parseCodexAuthStatus(codexRow("unknown"))).toBe("unknown");
    expect(parseCodexAuthStatus(codexRow("unsupported"))).toBe("unknown");
  });

  it("returns unknown for malformed, duplicate, disabled, wrong-target or non-HTTP rows", () => {
    expect(parseCodexAuthStatus("not json")).toBe("unknown");
    expect(parseCodexAuthStatus(JSON.stringify({ name: "githits" }))).toBe(
      "unknown",
    );
    expect(parseCodexAuthStatus(JSON.stringify([{ name: "other" }]))).toBe(
      "unknown",
    );
    expect(
      parseCodexAuthStatus(
        JSON.stringify([
          {
            name: "githits",
            enabled: true,
            transport: { type: "streamable_http", url: MCP_URL },
            auth_status: "o_auth",
          },
          {
            name: "githits",
            enabled: true,
            transport: { type: "streamable_http", url: MCP_URL },
            auth_status: "not_logged_in",
          },
        ]),
      ),
    ).toBe("unknown");
    expect(parseCodexAuthStatus(codexRow("o_auth", { enabled: false }))).toBe(
      "unknown",
    );
    expect(
      parseCodexAuthStatus(
        codexRow("o_auth", { transport: { type: "stdio", url: MCP_URL } }),
      ),
    ).toBe("unknown");
    expect(
      parseCodexAuthStatus(
        codexRow("o_auth", {
          transport: { type: "streamable_http", url: "https://elsewhere.test" },
        }),
      ),
    ).toBe("unknown");
  });

  it("strips ANSI controls and discards extra secret-like fields", () => {
    const marker = "SYNTHETIC_SECRET_MARKER";
    const parsed = parseCodexAuthStatus(
      `\u001b[32m${codexRow("o_auth", { headers: { authorization: marker } })}\u001b[0m`,
    );
    expect(parsed).toBe("authenticated");
    expect(parsed).not.toContain(marker);
  });
});

describe("parseClaudeAuthStatus", () => {
  it("requires an exact user-scoped canonical entry and classifies supported statuses", () => {
    expect(parseClaudeAuthStatus(claudeOutput("✓ Connected"))).toBe(
      "authenticated",
    );
    expect(parseClaudeAuthStatus(claudeOutput("Connected"))).toBe(
      "authenticated",
    );
    expect(parseClaudeAuthStatus(claudeOutput("! Needs authentication"))).toBe(
      "required",
    );
    expect(parseClaudeAuthStatus(claudeOutput("✘ Needs authentication"))).toBe(
      "required",
    );
    expect(parseClaudeAuthStatus(claudeOutput("⚠ Needs authentication"))).toBe(
      "required",
    );
  });

  it("returns unknown for wrong scope, endpoint, type, ambiguous fields or status", () => {
    expect(
      parseClaudeAuthStatus("githits:\n  Status: Needs authentication"),
    ).toBe("unknown");
    expect(
      parseClaudeAuthStatus(
        claudeOutput("Needs authentication", { Scope: "Project config" }),
      ),
    ).toBe("unknown");
    expect(
      parseClaudeAuthStatus(
        claudeOutput("Needs authentication", { Type: "stdio" }),
      ),
    ).toBe("unknown");
    expect(
      parseClaudeAuthStatus(
        claudeOutput("Needs authentication", { URL: "https://elsewhere.test" }),
      ),
    ).toBe("unknown");
    expect(
      parseClaudeAuthStatus(
        `${claudeOutput("Connected")}\n  Status: Needs authentication`,
      ),
    ).toBe("unknown");
    expect(
      parseClaudeAuthStatus(claudeOutput("Connected · tools fetch failed")),
    ).toBe("unknown");
    expect(parseClaudeAuthStatus(claudeOutput("Failed to connect"))).toBe(
      "unknown",
    );
    expect(
      parseClaudeAuthStatus(
        `${claudeOutput("Connected")}\ngithits:\n  Status: Connected`,
      ),
    ).toBe("unknown");
  });

  it("strips ANSI controls and returns no raw output", () => {
    const marker = "SYNTHETIC_SECRET_MARKER";
    const parsed = parseClaudeAuthStatus(
      `\u001b[32m${claudeOutput("✓ Connected")}\u001b[0m\n  Detail: ${marker}`,
    );
    expect(parsed).toBe("authenticated");
    expect(parsed).not.toContain(marker);
  });
});

describe("parseNamedAuthStatus", () => {
  it("classifies Kilo and OpenCode auth list states for the exact server", () => {
    expect(
      parseNamedAuthStatus(
        "┌ MCP OAuth Status\n│\n● ✓ GitHits authenticated\n│   https://mcp.githits.com",
      ),
    ).toBe("authenticated");
    expect(
      parseNamedAuthStatus(
        "┌ MCP OAuth Status\n│\n● ✗ GitHits not authenticated\n│   https://mcp.githits.com",
      ),
    ).toBe("required");
    expect(
      parseNamedAuthStatus(
        "┌ MCP OAuth Status\n│\n● ⚠ GitHits expired\n│   https://mcp.githits.com",
      ),
    ).toBe("required");
  });

  it("ignores other server rows and requires the URL immediately after GitHits", () => {
    const output = [
      "┌ MCP OAuth Status",
      "● ✓ Other authenticated",
      "│   https://other.test",
      "● ✓ GitHits authenticated",
      "│   https://mcp.githits.com",
      "● ✗ Another not authenticated",
      "│   https://another.test",
    ].join("\n");
    expect(parseNamedAuthStatus(output)).toBe("authenticated");
    expect(
      parseNamedAuthStatus(
        "● ✓ GitHits authenticated\n● ✓ Other authenticated\n│   https://mcp.githits.com",
      ),
    ).toBe("unknown");
    expect(
      parseNamedAuthStatus(
        "● ✓ GitHits authenticated\n│   https://elsewhere.test",
      ),
    ).toBe("unknown");
    expect(parseNamedAuthStatus("● ✓ GitHits authenticated")).toBe("unknown");
    expect(
      parseNamedAuthStatus(
        "● ✓ GitHits authenticated\n│   https://mcp.githits.com\n● ✗ GitHits not authenticated\n│   https://mcp.githits.com",
      ),
    ).toBe("unknown");
  });

  it("strips ANSI controls and keeps secret-like output out of the result", () => {
    const marker = "SYNTHETIC_SECRET_MARKER";
    const parsed = parseNamedAuthStatus(
      `\u001b[32m● ✓ GitHits authenticated\u001b[0m\n│   ${MCP_URL}\n│   ${marker}`,
    );
    expect(parsed).toBe("authenticated");
    expect(parsed).not.toContain(marker);
  });
});
