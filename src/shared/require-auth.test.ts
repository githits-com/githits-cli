import { describe, expect, it, spyOn } from "bun:test";
import { AuthRequiredError, requireAuth } from "./require-auth.js";

describe("requireAuth", () => {
  it("does nothing when token is valid", () => {
    requireAuth({ hasValidToken: true, mcpUrl: "https://mcp.githits.com" });
  });

  it("throws AuthRequiredError when token is missing", () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    expect(() =>
      requireAuth({
        hasValidToken: false,
        mcpUrl: "https://mcp.githits.com",
      }),
    ).toThrow(AuthRequiredError);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Authentication required");
    expect(output).toContain("githits login");
    expect(output).toContain("support@githits.com");
    consoleSpy.mockRestore();
  });

  it("includes context in message when provided", () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    expect(() =>
      requireAuth(
        { hasValidToken: false, mcpUrl: "https://mcp.githits.com" },
        "to start MCP server",
      ),
    ).toThrow(AuthRequiredError);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Authentication required to start MCP server.");
    consoleSpy.mockRestore();
  });

  it("shows custom environment when not default", () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    expect(() =>
      requireAuth({
        hasValidToken: false,
        mcpUrl: "https://custom.example.com",
      }),
    ).toThrow(AuthRequiredError);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("custom.example.com");
    expect(output).toContain("custom environment");
    consoleSpy.mockRestore();
  });
});
