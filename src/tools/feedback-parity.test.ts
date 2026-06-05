import { describe, expect, it, mock, spyOn } from "bun:test";
import { feedbackAction } from "../commands/feedback.js";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

async function cliText(): Promise<string> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await feedbackAction(
      "sol_123",
      { accept: true },
      {
        githitsService: createMockGitHitsService({
          submitFeedback: mock(() =>
            Promise.resolve({ success: true, message: "Feedback submitted" }),
          ),
        }),
        hasValidToken: true,
        mcpUrl: "https://mcp.example.com",
      },
    );
    return String(logSpy.mock.calls[0]?.[0]);
  } finally {
    logSpy.mockRestore();
  }
}

async function mcpText(): Promise<string> {
  const tool = createParityMcpTool("feedback", {
    githitsService: createMockGitHitsService({
      submitFeedback: mock(() =>
        Promise.resolve({ success: true, message: "Feedback submitted" }),
      ),
    }),
  });
  const result = await tool.handler(
    { solution_id: "sol_123", accepted: true },
    {},
  );
  return result.content[0]?.text ?? "";
}

describe("feedback parity", () => {
  it("matches success text without hitting live services", async () => {
    expect(await cliText()).toBe(await mcpText());
  });
});
