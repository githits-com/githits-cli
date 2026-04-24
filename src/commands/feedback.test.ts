import { describe, expect, it, mock, spyOn } from "bun:test";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { type FeedbackDependencies, feedbackAction } from "./feedback.js";

describe("feedbackAction", () => {
  function createDeps(
    overrides: Partial<FeedbackDependencies> = {},
  ): FeedbackDependencies {
    return {
      githitsService: createMockGitHitsService(),
      ...overrides,
    };
  }

  it("submits positive feedback with --accept", async () => {
    const submitFn = mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
    );
    const deps = createDeps({
      githitsService: createMockGitHitsService({ submitFeedback: submitFn }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await feedbackAction("abc-123", { accept: true }, deps);

    expect(submitFn).toHaveBeenCalledWith({
      solutionId: "abc-123",
      accepted: true,
      feedbackText: undefined,
    });
    consoleSpy.mockRestore();
  });

  it("submits negative feedback with --reject", async () => {
    const submitFn = mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
    );
    const deps = createDeps({
      githitsService: createMockGitHitsService({ submitFeedback: submitFn }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await feedbackAction("abc-123", { reject: true }, deps);

    expect(submitFn).toHaveBeenCalledWith({
      solutionId: "abc-123",
      accepted: false,
      feedbackText: undefined,
    });
    consoleSpy.mockRestore();
  });

  it("includes feedback message when provided", async () => {
    const submitFn = mock(() =>
      Promise.resolve({
        success: true,
        message: "Feedback submitted successfully",
      }),
    );
    const deps = createDeps({
      githitsService: createMockGitHitsService({ submitFeedback: submitFn }),
    });
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});

    await feedbackAction(
      "abc-123",
      { accept: true, message: "Solved my problem" },
      deps,
    );

    expect(submitFn).toHaveBeenCalledWith({
      solutionId: "abc-123",
      accepted: true,
      feedbackText: "Solved my problem",
    });
    consoleSpy.mockRestore();
  });

  it("outputs plain text result by default", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await feedbackAction("abc-123", { accept: true }, deps);

    expect(consoleSpy).toHaveBeenCalledWith("Feedback submitted successfully");
    consoleSpy.mockRestore();
  });

  it("outputs JSON when --json flag provided", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps();

    await feedbackAction("abc-123", { accept: true, json: true }, deps);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      success: true,
      message: "Feedback submitted successfully",
    });
    consoleSpy.mockRestore();
  });

  it("exits with error when neither --accept nor --reject", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps();

    try {
      await feedbackAction("abc-123", {}, deps);
    } catch {
      // expected
    }

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Specify either --accept or --reject");
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("catches service error and exits with message", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        submitFeedback: mock(() => Promise.reject(new Error("Auth required"))),
      }),
    });

    try {
      await feedbackAction("abc-123", { accept: true }, deps);
    } catch {
      // expected
    }

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Failed to submit feedback");
    expect(output).toContain("Auth required");
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
