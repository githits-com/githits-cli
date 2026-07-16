import { describe, expect, it, mock, spyOn } from "bun:test";
import { AuthenticationError } from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { type FeedbackDependencies, feedbackAction } from "./feedback.js";

describe("feedbackAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<FeedbackDependencies> = {},
  ): FeedbackDependencies {
    return {
      githitsService: createMockGitHitsService(),
      hasValidToken: true,
      mcpUrl,
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
      toolName: undefined,
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
      toolName: undefined,
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
      toolName: undefined,
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

  it("submits generic feedback when solution_id positional is omitted", async () => {
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
      undefined,
      { accept: true, message: "code_grep regex is fast on npm:lodash" },
      deps,
    );

    expect(submitFn).toHaveBeenCalledWith({
      solutionId: undefined,
      accepted: true,
      feedbackText: "code_grep regex is fast on npm:lodash",
      toolName: undefined,
    });
    consoleSpy.mockRestore();
  });

  it("includes tool name when provided", async () => {
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
      undefined,
      {
        reject: true,
        message: "search missing kotlin support",
        tool: "search",
      },
      deps,
    );

    expect(submitFn).toHaveBeenCalledWith({
      solutionId: undefined,
      accepted: false,
      feedbackText: "search missing kotlin support",
      toolName: "search",
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

  it("emits JSON validation errors in JSON mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      feedbackAction("abc-123", { json: true }, createDeps()),
    ).rejects.toThrow("process.exit");

    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toEqual({
      error: "Specify either --accept or --reject.",
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("throws AuthRequiredError on auth failure", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createDeps({ hasValidToken: false });

    await expect(
      feedbackAction("abc-123", { accept: true }, deps),
    ).rejects.toThrow(AuthRequiredError);

    consoleSpy.mockRestore();
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

  for (const [name, serviceMessage] of [
    ["sanitized 500", "Server error (500). Try again shortly."],
    [
      "offline",
      "Could not connect to GitHits. Check your connection and GITHITS_API_URL, then try again.",
    ],
  ] as const) {
    it(`renders ${name} service errors on stderr`, async () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });
      const deps = createDeps({
        githitsService: createMockGitHitsService({
          submitFeedback: mock(() => Promise.reject(new Error(serviceMessage))),
        }),
      });

      await expect(
        feedbackAction("abc-123", { accept: true }, deps),
      ).rejects.toThrow("process.exit");

      expect(errorSpy.mock.calls[0]?.[0]).toBe(
        `Failed to submit feedback: ${serviceMessage}`,
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    });
  }

  it("emits a JSON envelope for generic service errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        submitFeedback: mock(() => Promise.reject(new Error("offline"))),
      }),
    });

    await expect(
      feedbackAction("abc-123", { accept: true, json: true }, deps),
    ).rejects.toThrow("process.exit");

    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toEqual({
      error: "Failed to submit feedback: offline",
      code: "UNKNOWN",
      retryable: false,
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("emits JSON auth envelope when service returns 401 in JSON mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        submitFeedback: mock(() =>
          Promise.reject(new AuthenticationError("Authentication required.")),
        ),
      }),
    });

    await expect(
      feedbackAction("abc-123", { accept: true, json: true }, deps),
    ).rejects.toThrow("process.exit");

    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "local" },
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("prints CLI auth remediation when service returns 401 in text mode", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const deps = createDeps({
      githitsService: createMockGitHitsService({
        submitFeedback: mock(() => Promise.reject(new AuthenticationError())),
      }),
    });

    await expect(
      feedbackAction("abc-123", { accept: true }, deps),
    ).rejects.toThrow("process.exit");

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "Authentication required. Run `githits login` to authenticate or set GITHITS_API_TOKEN.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
