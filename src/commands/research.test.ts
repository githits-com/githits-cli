import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  type AgenticAskCliResponse,
  AgenticAskHttpError,
  type AgenticAskNeedsTargetResponse,
  AgenticAskRequestTimeoutError,
  type AgenticAskService,
  type AgenticAskUrlResponse,
  parseCompactResolveTargetResult,
} from "@githits/core-internal";
import { TermsAcceptanceRequiredError } from "@githits/core-internal/browser";
import { AuthRequiredError } from "@githits/mcp/internal";
import { Command } from "commander";
import { ASK_NEEDS_TARGET_WIRE } from "../../packages/core-internal/src/services/ask-needs-target.fixture.js";
import { formatResearchMcpText } from "../../packages/mcp/src/mcp/local-research.js";
import {
  formatAgenticAskHumanResponse,
  formatAgenticAskSourceCommand,
  projectAgenticAskCliSources,
  type ResearchCommandDependencies,
  registerResearchCommand,
  researchAction,
  resolveResearchCommandPositionals,
  validateResearchCommandBeforeAction,
} from "./research.js";

const TOOL_CALL_ID = "018f47a6-7b32-7a1e-8f45-6a2d39c81720";
const THREAD_ID = "018f47a6-7b32-7b1e-8f45-6a2d39c81720";

function result(
  overrides: Partial<AgenticAskCliResponse> = {},
): AgenticAskCliResponse {
  return {
    source_format: "cli",
    tool_call_id: TOOL_CALL_ID,
    thread_id: THREAD_ID,
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

function urlResult(): AgenticAskUrlResponse {
  return {
    source_format: "url",
    tool_call_id: TOOL_CALL_ID,
    thread_id: THREAD_ID,
    answer_markdown: "Use the public factory.",
    sources: [
      {
        url: "https://github.com/example/project/blob/main/src/index.ts#L10-L20",
      },
      { url: "https://example.com/docs/guide#L3-L8" },
    ],
  };
}

type CliAsk = (
  request: ({ target?: string; threadId?: never } | { threadId: string }) & {
    question: string;
    sourceFormat?: "cli" | "url";
  },
  options?: { signal?: AbortSignal },
) => Promise<
  AgenticAskCliResponse | AgenticAskUrlResponse | AgenticAskNeedsTargetResponse
>;

function clarification(): AgenticAskNeedsTargetResponse {
  const resolution = parseCompactResolveTargetResult(
    ASK_NEEDS_TARGET_WIRE.resolution,
  );
  if (!resolution) throw new Error("Invalid backend fixture");
  return {
    outcome: "needs_target",
    message: ASK_NEEDS_TARGET_WIRE.message,
    resolution,
  };
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
    result.resolution.best = undefined;
    result.resolution.targets[0]!.description = "description\u001b[2J";
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
      outcome: "needs_target",
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
    expect(write.mock.calls[0]?.[0]).toContain("Use the public factory.");
    expect(write.mock.calls[0]?.[0]).toContain(
      "npx githits@latest code read --lines 10-20 -- npm:example src/index.ts",
    );
    expect(write.mock.calls[0]?.[0]).toContain(
      "npx githits@latest docs read --lines 3-8 -- docs:example:guide",
    );
    expect(write.mock.calls[0]?.[0]).toContain(
      `Research run ID: ${TOOL_CALL_ID}`,
    );
    expect(write.mock.calls[0]?.[0]).toContain(`Thread ID: ${THREAD_ID}`);
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

  it("emits only the validated response on JSON stdout", async () => {
    const response = result();
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
    expect(write.mock.calls[0]?.[0]).toBe(
      "Use the public factory.\n\nSources:\n  1. https://github.com/example/project/blob/main/src/index.ts#L10-L20\n  2. https://example.com/docs/guide#L3-L8\n\nResearch run ID: 018f47a6-7b32-7a1e-8f45-6a2d39c81720\nThread ID: 018f47a6-7b32-7b1e-8f45-6a2d39c81720\nUse this thread ID for follow-ups; name a new project or version in the question to change scope.\n",
    );
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

  it("prints retry guidance and a validated failure run ID", async () => {
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

  it("omits a failure run ID when the service did not validate one", async () => {
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
  it("canonicalizes legacy code source targets without mutating docs locators", () => {
    const wire = result({
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
            "github:owner/repo#release@stable",
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
            "github:owner/repo@abc123/guide.md#configuration",
          ],
        },
      ],
    });
    const original = structuredClone(wire);
    const projected = projectAgenticAskCliSources(wire);

    expect(projected).toMatchObject({
      sources: [
        {
          arguments: [
            "githits@latest",
            "code",
            "read",
            "--lines",
            "10-20",
            "--",
            "github:owner/repo@release@stable",
            "src/index.ts",
          ],
        },
        {
          arguments: [
            "githits@latest",
            "docs",
            "read",
            "--lines",
            "3-8",
            "--",
            "github:owner/repo@abc123/guide.md#configuration",
          ],
        },
      ],
    });
    expect(wire).toEqual(original);
  });

  it.each([
    {
      target: "https://docs.example/page?lang=en&view=full#section",
      argument: "'https://docs.example/page?lang=en&view=full#section'",
    },
    { target: "repo-doc:sha:pinned", argument: "repo-doc:sha:pinned" },
    { target: "docs:example:guide", argument: "docs:example:guide" },
  ])(
    "renders documentation read targets unchanged: $target",
    ({ target, argument }) => {
      const formatted = formatAgenticAskHumanResponse(
        result({
          sources: [
            {
              command: "npx",
              arguments: [
                "githits@latest",
                "docs",
                "read",
                "--lines",
                "3-8",
                "--",
                target,
              ],
            },
          ],
        }),
      );

      expect(formatted).toContain(
        `Sources:\n  1. npx githits@latest docs read --lines 3-8 -- ${argument}\n`,
      );
    },
  );

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
