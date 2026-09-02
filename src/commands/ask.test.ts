import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  type AgenticAskCliResponse,
  AgenticAskHttpError,
  AgenticAskRequestTimeoutError,
  type AgenticAskService,
} from "@githits/core-internal";
import { TermsAcceptanceRequiredError } from "@githits/core-internal/browser";
import { AuthRequiredError } from "@githits/mcp/internal";
import {
  type AskCommandDependencies,
  askAction,
  formatAgenticAskHumanResponse,
  formatAgenticAskSourceCommand,
} from "./ask.js";

const TOOL_CALL_ID = "018f47a6-7b32-7a1e-8f45-6a2d39c81720";

function result(
  overrides: Partial<AgenticAskCliResponse> = {},
): AgenticAskCliResponse {
  return {
    source_format: "cli",
    tool_call_id: TOOL_CALL_ID,
    answer_markdown: "Use the public factory.",
    sources: [
      {
        command: "npx",
        arguments: [
          "githits@latest",
          "code",
          "read",
          "--lines",
          "10-20",
          "--",
          "npm:example",
          "src/index.ts",
        ],
      },
      {
        command: "npx",
        arguments: [
          "githits@latest",
          "docs",
          "read",
          "--lines",
          "3-8",
          "--",
          "docs:example:guide",
        ],
      },
    ],
    ...overrides,
  };
}

type CliAsk = (
  request: { target: string; question: string; sourceFormat?: "cli" },
  options?: { signal?: AbortSignal },
) => Promise<AgenticAskCliResponse>;

function createDeps(
  ask: CliAsk = mock(() => Promise.resolve(result())),
  overrides: Partial<AskCommandDependencies> = {},
): AskCommandDependencies {
  return {
    agenticAskService: {
      ask: ask as unknown as AgenticAskService["ask"],
    },
    hasValidToken: true,
    mcpUrl: "https://mcp.githits.com",
    ...overrides,
  };
}

afterEach(() => {
  mock.restore();
});

describe("askAction", () => {
  it("forwards target and question and prints readable source commands", async () => {
    const ask = mock(() => Promise.resolve(result()));
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);

    await askAction(
      "npm:example",
      "How is the client created?",
      {},
      createDeps(ask),
    );

    expect(ask).toHaveBeenCalledWith(
      {
        target: "npm:example",
        question: "How is the client created?",
      },
      undefined,
    );
    expect(write.mock.calls[0]?.[0]).toContain("Use the public factory.");
    expect(write.mock.calls[0]?.[0]).toContain(
      "npx githits@latest code read --lines 10-20 -- npm:example src/index.ts",
    );
    expect(write.mock.calls[0]?.[0]).toContain(
      "npx githits@latest docs read --lines 3-8 -- docs:example:guide",
    );
    expect(write.mock.calls[0]?.[0]).toContain(`Ask run ID: ${TOOL_CALL_ID}`);
  });

  it("emits only the validated response on JSON stdout", async () => {
    const response = result();
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);

    await askAction(
      "npm:example",
      "How?",
      { json: true },
      createDeps(mock(() => Promise.resolve(response))),
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(response);
    expect(write).not.toHaveBeenCalled();
  });

  it("stops interactive progress before writing the answer", async () => {
    const events: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(() => {
      events.push("answer");
      return true;
    });

    await askAction(
      "npm:example",
      "How?",
      {},
      createDeps(undefined, {
        createSpinner: () => ({ stop: () => events.push("spinner stopped") }),
      }),
    );

    expect(events).toEqual(["spinner stopped", "answer"]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("throws the standard auth error before invoking the service", async () => {
    const ask = mock(() => Promise.resolve(result()));
    await expect(
      askAction(
        "npm:example",
        "How?",
        {},
        createDeps(ask, { hasValidToken: false }),
      ),
    ).rejects.toBeInstanceOf(AuthRequiredError);
    expect(ask).not.toHaveBeenCalled();
  });

  it("prints standard JSON auth guidance when no token is available", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      askAction(
        "npm:example",
        "How?",
        { json: true },
        createDeps(undefined, { hasValidToken: false }),
      ),
    ).rejects.toThrow("process.exit");

    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
      error: "No local GitHits authentication token found.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "local" },
    });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("prints retry guidance and a validated failure run ID", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const failure = new AgenticAskHttpError(
      "RATE_LIMITED",
      "Agentic Ask is rate limited.",
      429,
      TOOL_CALL_ID,
      12,
      true,
    );

    await expect(
      askAction(
        "npm:example",
        "How?",
        {},
        createDeps(mock(() => Promise.reject(failure))),
      ),
    ).rejects.toThrow("process.exit");

    expect(error.mock.calls[0]?.[0]).toBe(
      `Agentic Ask is rate limited. Try again in 12 seconds.\nAsk run ID: ${TOOL_CALL_ID}`,
    );
  });

  it("renders the shared terms-acceptance remediation", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      askAction(
        "npm:example",
        "How?",
        {},
        createDeps(
          mock(() => Promise.reject(new TermsAcceptanceRequiredError())),
        ),
      ),
    ).rejects.toThrow("process.exit");

    expect(error.mock.calls[0]?.[0]).toBe(
      "Terms acceptance required. Run `githits settings terms accept`, then retry.",
    );
  });

  it("sanitizes mapped human error messages", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      askAction(
        "npm:example",
        "How?",
        {},
        createDeps(
          mock(() =>
            Promise.reject(
              new AgenticAskHttpError(
                "ACCESS_DENIED",
                "Access\u001b[31m denied.\u0007",
                403,
              ),
            ),
          ),
        ),
      ),
    ).rejects.toThrow("process.exit");

    expect(error.mock.calls[0]?.[0]).toBe("Access denied.");
  });

  it("preserves structured timeout data without exposing usage", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      askAction(
        "npm:example",
        "How?",
        { json: true },
        createDeps(
          mock(() =>
            Promise.reject(new AgenticAskRequestTimeoutError(210_000)),
          ),
        ),
      ),
    ).rejects.toThrow("process.exit");

    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
      error: "Agentic Ask timed out. Try again.",
      code: "TIMEOUT",
      retryable: true,
      details: { timeoutMs: 210_000 },
    });
  });

  it("omits a failure run ID when the service did not validate one", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      askAction(
        "npm:example",
        "How?",
        { json: true },
        createDeps(
          mock(() =>
            Promise.reject(
              new AgenticAskHttpError(
                "SERVICE_UNAVAILABLE",
                "Agentic Ask is temporarily unavailable.",
                503,
                undefined,
                undefined,
                true,
              ),
            ),
          ),
        ),
      ),
    ).rejects.toThrow("process.exit");

    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).not.toHaveProperty(
      "tool_call_id",
    );
  });

  it("propagates caller cancellation after stopping progress output", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const ask = mock(async () => {
      controller.abort(reason);
      throw reason;
    });

    await expect(
      askAction(
        "npm:example",
        "How?",
        {},
        createDeps(ask, { signal: controller.signal }),
      ),
    ).rejects.toBe(reason);
  });
});

describe("Agentic Ask human formatting", () => {
  it("preserves markdown newlines while stripping terminal controls", () => {
    const formatted = formatAgenticAskHumanResponse(
      result({
        answer_markdown: "First\n\tindented\n\t\tdeep\n\u001b[31mSecond\u0007",
      }),
    );
    expect(formatted).toContain("First\n\tindented\n\t\tdeep\nSecond");
    expect(formatted).not.toContain("\u001b");
    expect(formatted).not.toContain("\u0007");
  });

  it("shell-quotes untrusted argv while keeping normal commands direct", () => {
    expect(
      formatAgenticAskSourceCommand({
        command: "npx",
        arguments: [
          "githits@latest",
          "code",
          "read",
          "--lines",
          "1-2",
          "--",
          "github:owner/repo",
          "path with 'quote'\nand control.ts",
        ],
      }),
    ).toBe(
      `npx githits@latest code read --lines 1-2 -- github:owner/repo 'path with '"'"'quote'"'"'and control.ts'`,
    );
  });
});
