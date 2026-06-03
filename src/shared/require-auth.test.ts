import { describe, expect, it, spyOn } from "bun:test";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  formatAuthRequiredForTerminal,
  requireAuth,
} from "./require-auth.js";

describe("requireAuth", () => {
  it("does nothing when token is valid", () => {
    requireAuth({ hasValidToken: true, mcpUrl: "https://mcp.githits.com" });
  });

  it("throws AuthRequiredError when token is missing", () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    let thrown: unknown;
    try {
      requireAuth({
        hasValidToken: false,
        mcpUrl: "https://mcp.githits.com",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AuthRequiredError);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("includes context in message when provided", () => {
    expect(() =>
      requireAuth(
        { hasValidToken: false, mcpUrl: "https://mcp.githits.com" },
        "to start MCP server",
      ),
    ).toThrow(
      "No local GitHits authentication token found to start MCP server.",
    );
  });

  it("formats terminal recovery text", () => {
    let thrown: unknown;
    try {
      requireAuth({
        hasValidToken: false,
        mcpUrl: "https://custom.example.com",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AuthRequiredError);
    const output = formatAuthRequiredForTerminal(thrown as AuthRequiredError);
    expect(output).toContain("custom.example.com");
    expect(output).toContain("custom environment");
    expect(output).toContain("githits login");
    expect(output).toContain("support@githits.com");
  });

  it("builds the JSON error envelope", () => {
    const error = new AuthRequiredError(
      "Authentication required.",
      "https://mcp.githits.com",
    );

    expect(buildAuthRequiredErrorPayload(error)).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "local" },
    });
  });
});
