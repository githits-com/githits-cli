import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  AgenticAskHttpError,
  AgenticAskRequestTimeoutError,
  type AgenticAskResponse,
  type AgenticAskService,
} from "@githits/core-internal";
import { TermsAcceptanceRequiredError } from "@githits/core-internal/browser";
import { AuthRequiredError } from "@githits/mcp/internal";
import { Command } from "commander";
import displayContract from "../../packages/core-internal/src/services/fixtures/ask-display-contract.json";
import { formatResearchMcpText } from "../../packages/mcp/src/mcp/local-research.js";
import {
  formatAgenticAskHumanResponse,
  type ResearchCommandDependencies,
  registerResearchCommand,
  researchAction,
  resolveResearchCommandPositionals,
  validateResearchCommandBeforeAction,
} from "./research.js";

const TOOL_CALL_ID = "018f47a6-7b32-7a1e-8f45-6a2d39c81720";
const THREAD_ID = "018f47a6-7b32-7b1e-8f45-6a2d39c81720";

function result(
  overrides: Partial<AgenticAskResponse> = {},
): AgenticAskResponse {
  return { ...displayContract.cli, ...overrides };
}

function urlResult(): AgenticAskResponse {
  return displayContract.url;
}

type CliAsk = (
  request: ({ target?: string; threadId?: never } | { threadId: string }) & {
    question: string;
    sourceFormat?: "cli" | "url";
  },
  options?: { signal?: AbortSignal },
) => Promise<AgenticAskResponse>;

function clarification(): AgenticAskResponse {
  return structuredClone(displayContract.clarification);
}

describe("Ask target clarification", () => {
  it("renders provider grouping and confidence consistently in CLI and MCP", () => {
    const result = clarification();
    const text = formatAgenticAskHumanResponse(result);
    expect(text).toBe(formatResearchMcpText(result));
    expect(text).toContain("Did you mean any of these?");
    expect(text).toContain("github:openai/codex [medium]");
    expect(text).toContain("Related targets:");
    expect(text).toContain("npm:@openai/codex");
    expect(text).toContain("protected exact-name match");
    expect(text).toContain("122k stars");
    expect(text).not.toContain("Thread ID:");
    expect(text).not.toContain("githits search");
  });

  it("shows candidates even when the resolver supplies no best reference", () => {
    const result = clarification();
    result.display_markdown += "description\u001b[2J";
    const text = formatAgenticAskHumanResponse(result);
    expect(text).toContain("github:openai/codex");
    expect(text).not.toContain("\u001b");
  });

  it("writes a successful JSON clarification without retrying or exiting", async () => {
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const ask = mock(() => Promise.resolve(clarification()));
    await researchAction(
      undefined,
      "How does codex handle chat compaction?",
      { json: true },
      createDeps(ask),
    );
    expect(ask).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      display_markdown: clarification().display_markdown,
    });
    expect(exit).not.toHaveBeenCalled();
  });
});

function createDeps(
  ask: CliAsk = mock(() => Promise.resolve(result())),
  overrides: Partial<ResearchCommandDependencies> = {},
): ResearchCommandDependencies {
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

describe("researchAction", () => {
  it("forwards target and question and prints readable source commands", async () => {
    const ask = mock(() => Promise.resolve(result()));
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);

    await researchAction(
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
    expect(write.mock.calls[0]?.[0]).toBe(displayContract.cli.display_markdown);
  });

  it("continues a thread without a target", async () => {
    const ask = mock(() => Promise.resolve(result()));
    spyOn(process.stdout, "write").mockImplementation(() => true);

    await researchAction(
      undefined,
      "Where is that choice checked?",
      { thread: THREAD_ID },
      createDeps(ask),
    );

    expect(ask).toHaveBeenCalledWith(
      {
        threadId: THREAD_ID,
        question: "Where is that choice checked?",
      },
      undefined,
    );
  });

  it.each([undefined, "url"] as const)(
    "forwards a question without target or thread with source format %s",
    async (sourceFormat) => {
      const ask = mock(() =>
        Promise.resolve(sourceFormat === "url" ? urlResult() : result()),
      );
      spyOn(console, "log").mockImplementation(() => undefined);
      await researchAction(
        undefined,
        "How does Express routing work?",
        { json: true, sourceFormat },
        createDeps(ask),
      );
      expect(ask).toHaveBeenCalledWith(
        {
          question: "How does Express routing work?",
          ...(sourceFormat ? { sourceFormat } : {}),
        },
        undefined,
      );
    },
  );

  it("rejects ambiguous and malformed thread selectors", async () => {
    const ask = mock(() => Promise.resolve(result()));

    await expect(
      researchAction(
        "npm:example",
        "How?",
        { thread: THREAD_ID },
        createDeps(ask),
      ),
    ).rejects.toThrow("Do not provide a target");
    await expect(
      researchAction(
        undefined,
        "How?",
        { thread: "not-a-uuid" },
        createDeps(ask),
      ),
    ).rejects.toThrow("thread UUID");
    expect(ask).not.toHaveBeenCalled();
  });

  it("rejects a legacy repository target before authentication or service work", async () => {
    const ask = mock(() => Promise.resolve(result()));

    await expect(
      researchAction(
        "github:expressjs/express#main",
        "How?",
        {},
        createDeps(ask, { hasValidToken: false }),
      ),
    ).rejects.toThrow(
      'Use "github:expressjs/express@main"; # is reserved for semantic fragments.',
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    "https://expressjs.com/en/guide/",
    "https://github.com/facebook/react/tree/main#readme",
  ])(
    "leaves non-repository URL target %s for backend classification",
    async (target) => {
      const ask = mock(() => Promise.resolve(result()));
      spyOn(process.stdout, "write").mockImplementation(() => true);

      await researchAction(target, "How?", {}, createDeps(ask));

      expect(ask).toHaveBeenCalledWith({ target, question: "How?" }, undefined);
    },
  );

  it("preserves the complete API response on JSON stdout", async () => {
    const response = {
      ...result(),
      usage: { input_tokens: 1 },
      future_field: true,
    };
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);

    await researchAction(
      "npm:example",
      "How?",
      { json: true },
      createDeps(mock(() => Promise.resolve(response))),
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(response);
    expect(write).not.toHaveBeenCalled();
  });

  it("requests and renders original upstream URLs when selected", async () => {
    const response = urlResult();
    const ask = mock(() => Promise.resolve(response));
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);

    await researchAction(
      "npm:example",
      "How?",
      { sourceFormat: "url" },
      createDeps(ask),
    );

    expect(ask).toHaveBeenCalledWith(
      {
        target: "npm:example",
        question: "How?",
        sourceFormat: "url",
      },
      undefined,
    );
    expect(write.mock.calls[0]?.[0]).toBe(displayContract.url.display_markdown);
  });

  it("returns only the URL envelope when URL sources and JSON are selected", async () => {
    const response = urlResult();
    const log = spyOn(console, "log").mockImplementation(() => undefined);

    await researchAction(
      "npm:example",
      "How?",
      { json: true, sourceFormat: "url" },
      createDeps(mock(() => Promise.resolve(response))),
    );

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(response);
    expect(log.mock.calls[0]?.[0]).not.toContain("usage");
  });

  it("stops interactive progress before writing the answer", async () => {
    const events: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(() => {
      events.push("answer");
      return true;
    });

    await researchAction(
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
      researchAction(
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
      researchAction(
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

  it("prints retry guidance and the failure run ID", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const failure = new AgenticAskHttpError(
      "RATE_LIMITED",
      "Research is rate limited.",
      429,
      TOOL_CALL_ID,
      12,
      true,
      THREAD_ID,
    );

    await expect(
      researchAction(
        "npm:example",
        "How?",
        {},
        createDeps(mock(() => Promise.reject(failure))),
      ),
    ).rejects.toThrow("process.exit");

    expect(error.mock.calls[0]?.[0]).toBe(
      `Research is rate limited. Try again in 12 seconds.\nResearch run ID: ${TOOL_CALL_ID}\nThread ID: ${THREAD_ID}`,
    );
  });

  it("renders the shared terms-acceptance remediation", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      researchAction(
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
      researchAction(
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

  it("sanitizes opaque error IDs and backend hints only for terminal output", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const failure = new AgenticAskHttpError(
      "INVALID_TARGET",
      "Use an exact target. Retry\u001b[31m here.",
      400,
      "run\u001b[31m-V2",
      undefined,
      false,
      "thread\u0007-V2",
      {
        code: "future code",
        message: "Use an exact target.",
        hint: "Retry\u001b[31m here.",
      },
    );
    await expect(
      researchAction(
        "npm:example",
        "How?",
        {},
        createDeps(mock(() => Promise.reject(failure))),
      ),
    ).rejects.toThrow("process.exit");
    expect(error.mock.calls[0]?.[0]).toBe(
      "Use an exact target. Retry here.\nResearch run ID: run-V2\nThread ID: thread-V2",
    );
  });

  it("preserves structured timeout data without exposing usage", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      researchAction(
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
      error: "Research timed out. Try again.",
      code: "TIMEOUT",
      retryable: true,
      details: { timeoutMs: 210_000 },
    });
  });

  it("omits a failure run ID when the service supplies none", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      researchAction(
        "npm:example",
        "How?",
        { json: true },
        createDeps(
          mock(() =>
            Promise.reject(
              new AgenticAskHttpError(
                "SERVICE_UNAVAILABLE",
                "Research is temporarily unavailable.",
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
      researchAction(
        "npm:example",
        "How?",
        {},
        createDeps(ask, { signal: controller.signal }),
      ),
    ).rejects.toBe(reason);
  });
});

describe("Research human formatting", () => {
  it.each(Object.entries(displayContract))(
    "prints backend contract case %s",
    (_name, wire) => {
      expect(formatAgenticAskHumanResponse(wire)).toBe(wire.display_markdown);
    },
  );

  it("preserves new, reordered, or removed sections and opaque metadata", async () => {
    const wire = result({
      display_markdown: "New heading\n\n```sh\nfuture_read --flag 'a b'\n```\n",
      future: { nested: true },
      tool_call_id: "opaque-v2",
    });
    expect(formatAgenticAskHumanResponse(wire)).toBe(wire.display_markdown);
    const log = spyOn(console, "log").mockImplementation(() => {});
    await researchAction(
      undefined,
      "How?",
      { json: true },
      createDeps(async () => wire),
    );
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(wire);
  });

  it("preserves Markdown whitespace and Unicode while stripping controls", () => {
    expect(
      formatAgenticAskHumanResponse({
        display_markdown:
          "  First\n\tindented\n\t\tdeep\n\u001b[31mHéllo\u0007\n\n",
      }),
    ).toBe("  First\n\tindented\n\t\tdeep\nHéllo\n\n");
  });

  it.each([null, {}, { display_markdown: 42 }, { answer_markdown: "legacy" }])(
    "fails text clearly but preserves malformed JSON: %j",
    async (wire) => {
      expect(() => formatAgenticAskHumanResponse(wire)).toThrow(
        "invalid Research response",
      );
      const log = spyOn(console, "log").mockImplementation(() => {});
      await researchAction(
        undefined,
        "How?",
        { json: true },
        createDeps(async () => wire as unknown as AgenticAskResponse),
      );
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(wire);
    },
  );

  it("does not trim or reject an empty display string in the client", () => {
    expect(formatAgenticAskHumanResponse({ display_markdown: "" })).toBe("");
  });
});

describe("Research positional parsing", () => {
  it.each(["How does Express routing work?", "express", "npm:example"])(
    "treats one positional as the question without guessing target syntax: %s",
    (question) => {
      expect(
        resolveResearchCommandPositionals(question, undefined, undefined),
      ).toEqual({
        target: undefined,
        question,
      });
    },
  );

  it("keeps the initial target and question form", () => {
    expect(
      resolveResearchCommandPositionals("npm:example", "How?", undefined),
    ).toEqual({ target: "npm:example", question: "How?" });
  });

  it("treats the only positional as the question with --thread", () => {
    expect(
      resolveResearchCommandPositionals(
        "Where is that checked?",
        undefined,
        THREAD_ID,
      ),
    ).toEqual({ target: undefined, question: "Where is that checked?" });
  });

  it("rejects ambiguous and incomplete positional forms", () => {
    expect(() =>
      resolveResearchCommandPositionals("npm:example", "How?", THREAD_ID),
    ).toThrow("Do not provide a target");
    expect(() =>
      resolveResearchCommandPositionals(undefined, undefined, undefined),
    ).toThrow("Provide a question");
    expect(() =>
      resolveResearchCommandPositionals(undefined, undefined, THREAD_ID),
    ).toThrow("Provide a question");
  });
});

describe("Research registration", () => {
  it.each(
    ["research", "ask"].flatMap((command) =>
      ["", " ", "\t\n"].flatMap((question) => [
        { args: [command, question] },
        { args: [command, "npm:example", question] },
        { args: [command, "--thread", THREAD_ID, question] },
      ]),
    ),
  )(
    "rejects blank questions before root command work: %j",
    async ({ args }) => {
      const program = new Command().name("githits").exitOverride();
      let rootWorkStarted = false;
      const action = mock(() => undefined);
      program.hook("preAction", (_thisCommand, actionCommand) => {
        validateResearchCommandBeforeAction(actionCommand);
        rootWorkStarted = true;
      });
      registerResearchCommand(program).action(action);
      await expect(
        program.parseAsync(["node", "githits", ...args]),
      ).rejects.toThrow("non-empty question");
      expect(rootWorkStarted).toBe(false);
      expect(action).not.toHaveBeenCalled();
    },
  );

  it.each(
    ["research", "ask"].flatMap((command) =>
      [
        [command, "How does Express routing work?"],
        [
          command,
          "--json",
          "How does Express routing work?",
          "--source-format",
          "url",
        ],
        [command, "npm:express", "How is routing implemented?"],
        [command, "--thread", THREAD_ID, "Where is that checked?"],
      ].map((args) => ({ args })),
    ),
  )("accepts valid positionals through Commander: %j", async ({ args }) => {
    const program = new Command().name("githits").exitOverride();
    const action = mock(() => undefined);
    program.hook("preAction", (_thisCommand, actionCommand) => {
      expect(actionCommand.name()).toBe("research");
      validateResearchCommandBeforeAction(actionCommand);
    });
    registerResearchCommand(program).action(action);
    await program.parseAsync(["node", "githits", ...args]);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it.each(
    ["research", "ask"].flatMap((command) => [
      [
        `${command}: missing follow-up question`,
        [command, "--thread", THREAD_ID],
      ],
      [`${command}: missing initial question`, [command]],
      [
        `${command}: target combined with thread`,
        [command, "npm:example", "How?", "--thread", THREAD_ID],
      ],
      [
        `${command}: malformed thread`,
        [command, "--thread", "not-a-uuid", "How?"],
      ],
    ]),
  )("rejects %s before root command work", async (_name, args) => {
    const program = new Command().name("githits").exitOverride();
    let rootWorkStarted = false;
    program.hook("preAction", (_thisCommand, actionCommand) => {
      validateResearchCommandBeforeAction(actionCommand);
      rootWorkStarted = true;
    });
    registerResearchCommand(program);

    await expect(
      program.parseAsync(["node", "githits", ...args]),
    ).rejects.toBeInstanceOf(Error);
    expect(rootWorkStarted).toBe(false);
  });
});
