import { describe, expect, it } from "bun:test";
import stringWidth from "fast-string-width";
import { wrapPromptText } from "./prompt-service.js";

describe("prompt word wrapping", () => {
  it("keeps the remote description readable in a narrow selector", () => {
    const text = "Use the hosted GitHits server. Sign in through your agent.";
    const wrapped = wrapPromptText(text, 39);
    expect(wrapped).toBe(
      "Use the hosted GitHits server. Sign in\nthrough your agent.",
    );
    expect(wrapped.split("\n").every((line) => stringWidth(line) <= 39)).toBe(
      true,
    );
  });
  it("reserves the selector prefix and preserves deliberate lines", () => {
    expect(
      wrapPromptText("Run MCP locally (supports experimental features)", 38),
    ).toBe("Run MCP locally (supports experimental\nfeatures)");
    expect(
      wrapPromptText("Help your agent.\n\nAdds skills and instructions.", 20),
    ).toBe("Help your agent.\n\nAdds skills and\ninstructions.");
  });
  it("preserves indentation, Unicode and indivisible locators", () => {
    expect(wrapPromptText("  Choose remote MCP for your agent?", 25)).toBe(
      "  Choose remote MCP for\n  your agent?",
    );
    expect(wrapPromptText("界界 next words", 8)).toBe("界界\nnext\nwords");
    expect(wrapPromptText("See https://mcp.githits.com", 10)).toBe(
      "See\nhttps://mcp.githits.com",
    );
  });
});
