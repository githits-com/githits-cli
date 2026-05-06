import { describe, expect, it, mock } from "bun:test";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { createFeedbackTool } from "./feedback.js";

describe("feedbackTool", () => {
  it("submits positive feedback", async () => {
    const submitFeedback = mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
    );
    const service = createMockGitHitsService({ submitFeedback });
    const tool = createFeedbackTool(service);

    const result = await tool.handler(
      { solution_id: "abc-123", accepted: true },
      {},
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Feedback submitted");
    expect(submitFeedback).toHaveBeenCalledWith({
      solutionId: "abc-123",
      accepted: true,
      feedbackText: undefined,
    });
  });

  it("submits negative feedback with text", async () => {
    const submitFeedback = mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
    );
    const service = createMockGitHitsService({ submitFeedback });
    const tool = createFeedbackTool(service);

    await tool.handler(
      {
        solution_id: "abc-123",
        accepted: false,
        feedback_text: "Example was outdated",
      },
      {},
    );

    expect(submitFeedback).toHaveBeenCalledWith({
      solutionId: "abc-123",
      accepted: false,
      feedbackText: "Example was outdated",
    });
  });

  it("submits generic feedback without solution_id", async () => {
    const submitFeedback = mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
    );
    const service = createMockGitHitsService({ submitFeedback });
    const tool = createFeedbackTool(service);

    const result = await tool.handler(
      {
        accepted: false,
        feedback_text: "search is missing kotlin support",
      },
      {},
    );

    expect(result.isError).toBeUndefined();
    expect(submitFeedback).toHaveBeenCalledWith({
      solutionId: undefined,
      accepted: false,
      feedbackText: "search is missing kotlin support",
    });
  });

  it("returns error result on service failure", async () => {
    const service = createMockGitHitsService({
      submitFeedback: mock(() => Promise.reject(new Error("Auth required"))),
    });
    const tool = createFeedbackTool(service);

    const result = await tool.handler(
      { solution_id: "abc-123", accepted: true },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Auth required");
  });
});
