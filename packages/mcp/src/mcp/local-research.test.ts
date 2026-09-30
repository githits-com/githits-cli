import { describe, expect, it, mock } from "bun:test";
import {
  AgenticAskHttpError,
  type AgenticAskResponse,
  type AgenticAskService,
  AuthenticationError,
} from "@githits/core-internal";
import { TermsAcceptanceRequiredError } from "@githits/core-internal/browser";
import { z } from "zod";
import displayContract from "../../../core-internal/src/services/fixtures/ask-display-contract.json";
import {
  createLocalResearchTool,
  DESCRIPTION,
  formatResearchMcpText,
  type LocalResearchMcpArgs,
} from "./local-research.js";

const TOOL_CALL_ID = "018f47a6-7b32-7a1e-8f45-6a2d39c81720";
const THREAD_ID = "018f47a6-7b32-7b1e-8f45-6a2d39c81720";

function response(): AgenticAskResponse {
  return displayContract.mcp;
}
function urlResponse(): AgenticAskResponse {
  return displayContract.url;
}

type McpAsk = (
  request: ({ target?: string } | { threadId: string }) & {
    question: string;
    sourceFormat: "mcp" | "url";
  },
  options?: { signal?: AbortSignal },
) => Promise<AgenticAskResponse>;

function createService(
  ask: McpAsk = mock(() => Promise.resolve(response())),
): AgenticAskService {
  return { ask: ask as unknown as AgenticAskService["ask"] };
}

function invoke(
  tool: ReturnType<typeof createLocalResearchTool>,
  args: LocalResearchMcpArgs,
  signal?: AbortSignal,
) {
  return tool.handler(args, signal ? { signal } : undefined);
}

describe("local research MCP adapter", () => {
  it("publishes the open-world read-only descriptor and standard format schema", () => {
    const tool = createLocalResearchTool(createService());
    const jsonSchema = z.toJSONSchema(z.object(tool.schema));

    expect(tool.name).toBe("research");
    const firstSentence = `${DESCRIPTION.split(".", 1)[0]}.`;
    expect(firstSentence).toBe(
      "Research a public repository or package to answer a question with sources.",
    );
    expect(firstSentence.length).toBe(74);
    expect(DESCRIPTION.slice(0, 80)).toStartWith(firstSentence);
    expect(DESCRIPTION).toContain("If Research returns candidates");
    expect(tool.schema.thread_id?.description).toContain("research call");
    expect(tool.schema.question?.description).toContain("research question");
    expect(DESCRIPTION).toContain(
      "Omit target and thread_id to identify the target from the question",
    );
    expect(DESCRIPTION).toContain(
      "ask the user to select a target before retrying",
    );
    expect(
      z.object(tool.schema).parse({ question: "How does codex work?" }),
    ).toEqual({
      question: "How does codex work?",
      source_format: "mcp",
      format: "text",
    });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    });
    expect(Object.keys(tool.schema)).toEqual([
      "target",
      "thread_id",
      "question",
      "source_format",
      "format",
    ]);
    expect(jsonSchema.properties?.source_format).toMatchObject({
      default: "mcp",
      enum: ["mcp", "url"],
    });
    expect(jsonSchema.properties?.format).toMatchObject({
      default: "text",
      enum: ["text", "json"],
    });
    expect(tool.schema.format?.parse(undefined)).toBe("text");
    expect(tool.schema.target?.safeParse("").success).toBe(false);
    expect(tool.schema.thread_id?.safeParse("").success).toBe(false);
    expect(tool.schema.format?.safeParse("text-v1").success).toBe(false);
    expect(tool.schema.format?.description).toBe(
      "Omit `format` to use token-efficient text when the model reads the result or chooses follow-up tools. Set `json` only when code consumes the raw response instead of the model, or a required field is absent from text.",
    );
  });

  it("always requests MCP sources and renders them in backend order", async () => {
    const ask = mock(() => Promise.resolve(response()));
    const result = await invoke(createLocalResearchTool(createService(ask)), {
      target: "npm:example",
      question: "How?",
    });

    expect(ask).toHaveBeenCalledWith(
      {
        target: "npm:example",
        question: "How?",
        sourceFormat: "mcp",
      },
      undefined,
    );
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: formatResearchMcpText(response()),
        },
      ],
    });
    expect(result.content[0]?.text).toBe(displayContract.mcp.display_markdown);
  });

  it("continues a thread without resending a target", async () => {
    const ask = mock(() => Promise.resolve(response()));
    await invoke(createLocalResearchTool(createService(ask)), {
      thread_id: THREAD_ID,
      question: "Where is that checked?",
    });

    expect(ask).toHaveBeenCalledWith(
      {
        threadId: THREAD_ID,
        question: "Where is that checked?",
        sourceFormat: "mcp",
      },
      undefined,
    );
  });

  it("rejects conflicting and malformed selectors before the service call", async () => {
    const ask = mock(() => Promise.resolve(response()));
    const tool = createLocalResearchTool(createService(ask));
    const invalidArgs: LocalResearchMcpArgs[] = [
      { target: "npm:example", thread_id: THREAD_ID, question: "How?" },
      { thread_id: "not-a-uuid", question: "How?" },
    ];

    for (const args of invalidArgs) {
      const result = await invoke(tool, args);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
        code: "INVALID_ARGUMENT",
        retryable: false,
      });
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it("rejects a legacy repository target with the exact @ref migration", async () => {
    const ask = mock(() => Promise.resolve(response()));
    const result = await invoke(createLocalResearchTool(createService(ask)), {
      target: "github:expressjs/express#main",
      question: "How?",
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error:
        'Repository target "github:expressjs/express#main" uses legacy #ref syntax. Use "github:expressjs/express@main"; # is reserved for semantic fragments.',
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    "https://expressjs.com/en/guide/",
    "https://github.com/facebook/react/tree/main#readme",
  ])(
    "leaves non-repository URL target %s for backend classification",
    async (target) => {
      const ask = mock(() => Promise.resolve(response()));
      const result = await invoke(createLocalResearchTool(createService(ask)), {
        target,
        question: "How?",
      });

      expect(result.isError).toBeUndefined();
      expect(ask).toHaveBeenCalledWith(
        { target, question: "How?", sourceFormat: "mcp" },
        undefined,
      );
    },
  );

  it.each(["mcp", "url"] as const)(
    "answers a question-only request with %s sources",
    async (sourceFormat) => {
      const answer = sourceFormat === "mcp" ? response() : urlResponse();
      const ask = mock(() => Promise.resolve(answer));
      const signal = new AbortController().signal;
      const result = await invoke(
        createLocalResearchTool(createService(ask)),
        {
          question: "How does express routing work?",
          source_format: sourceFormat,
        },
        signal,
      );
      expect(ask).toHaveBeenCalledWith(
        {
          question: "How does express routing work?",
          sourceFormat,
        },
        { signal },
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe(formatResearchMcpText(answer));
    },
  );

  it.each(["text", "json"] as const)(
    "returns question-only clarification as successful %s without retrying",
    async (format) => {
      const clarification = displayContract.clarification;
      const ask = mock(() => Promise.resolve(clarification));
      const result = await invoke(createLocalResearchTool(createService(ask)), {
        question: "How does codex handle chat compaction?",
        format,
      });
      expect(ask).toHaveBeenCalledTimes(1);
      expect(ask).toHaveBeenCalledWith(
        {
          question: "How does codex handle chat compaction?",
          sourceFormat: "mcp",
        },
        undefined,
      );
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? "";
      if (format === "json") {
        expect(JSON.parse(text)).toEqual(clarification);
        expect(JSON.parse(text)).not.toHaveProperty("thread_id");
      } else {
        expect(text).toContain("github:openai/codex [medium]");
        expect(text).toContain("Related targets:");
        expect(text).toContain("protected exact-name match");
        expect(text).not.toContain("Thread ID:");
      }
    },
  );

  it("preserves the complete API response for JSON", async () => {
    const answer = {
      ...response(),
      usage: { input_tokens: 1 },
      future_field: true,
    };
    const result = await invoke(
      createLocalResearchTool(
        createService(mock(() => Promise.resolve(answer))),
      ),
      {
        target: "npm:example",
        question: "How?",
        format: "json",
      },
    );

    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(answer);
  });

  it("requests and renders original upstream URLs when selected", async () => {
    const response = urlResponse();
    const ask = mock(() => Promise.resolve(response));
    const result = await invoke(createLocalResearchTool(createService(ask)), {
      target: "npm:example",
      question: "How?",
      source_format: "url",
    });

    expect(ask).toHaveBeenCalledWith(
      {
        target: "npm:example",
        question: "How?",
        sourceFormat: "url",
      },
      undefined,
    );
    expect(result.content[0]?.text).toBe(displayContract.url.display_markdown);
  });

  it("returns only the URL envelope for JSON when selected", async () => {
    const response = urlResponse();
    const result = await invoke(
      createLocalResearchTool(
        createService(mock(() => Promise.resolve(response))),
      ),
      {
        target: "npm:example",
        question: "How?",
        source_format: "url",
        format: "json",
      },
    );

    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(response);
    expect(result.content[0]?.text).not.toContain("usage");
  });

  it("includes the failure run ID in the standard MCP error", async () => {
    const error = new AgenticAskHttpError(
      "RATE_LIMITED",
      "Research is rate limited.",
      429,
      TOOL_CALL_ID,
      12,
      true,
      THREAD_ID,
    );
    const ask = mock(() => Promise.reject(error));
    const result = await invoke(createLocalResearchTool(createService(ask)), {
      target: "npm:example",
      question: "How?",
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Research is rate limited.",
      code: "RATE_LIMITED",
      retryable: true,
      details: { status: 429, retryAfterSeconds: 12 },
      tool_call_id: TOOL_CALL_ID,
      thread_id: THREAD_ID,
    });
  });

  it.each([
    ["THREAD_NOT_FOUND", "Research thread was not found.", 404, "NOT_FOUND"],
    [
      "INVALID_REQUEST",
      "This Research thread cannot accept another follow-up.",
      409,
      "INVALID_ARGUMENT",
    ],
  ] as const)(
    "maps %s thread failures without exposing response bodies",
    async (errorCode, message, status, mappedCode) => {
      const ask = mock(() =>
        Promise.reject(new AgenticAskHttpError(errorCode, message, status)),
      );
      const result = await invoke(createLocalResearchTool(createService(ask)), {
        thread_id: THREAD_ID,
        question: "How?",
      });

      expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
        error: message,
        code: mappedCode,
        retryable: false,
        details: { status },
      });
    },
  );

  it("preserves question-only service failures without inventing identifiers", async () => {
    const ask = mock(() =>
      Promise.reject(
        new AgenticAskHttpError(
          "SERVICE_UNAVAILABLE",
          "Research is temporarily unavailable.",
          503,
        ),
      ),
    );
    const result = await invoke(createLocalResearchTool(createService(ask)), {
      question: "How does Express routing work?",
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      code: "BACKEND_ERROR",
      details: { status: 503 },
    });
    expect(JSON.parse(result.content[0]?.text ?? "{}")).not.toHaveProperty(
      "tool_call_id",
    );
    expect(JSON.parse(result.content[0]?.text ?? "{}")).not.toHaveProperty(
      "thread_id",
    );
  });

  it("uses the local terms remediation without exposing backend details", async () => {
    const ask = mock(() => Promise.reject(new TermsAcceptanceRequiredError()));
    const tool = createLocalResearchTool(createService(ask));
    const result = await tool.handler(
      { target: "npm:example", question: "How?" },
      {
        termsRemediation: {
          message: "Accept terms with the local CLI, then retry.",
          action: "githits settings terms accept",
        },
      },
    );

    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      error: "Accept terms with the local CLI, then retry.",
      code: "TERMS_ACCEPTANCE_REQUIRED",
      retryable: false,
      details: { action: "githits settings terms accept" },
    });
  });

  it("uses the local authentication action", async () => {
    const ask = mock(() => Promise.reject(new AuthenticationError()));
    const tool = createLocalResearchTool(createService(ask));
    const result = await tool.handler(
      { target: "npm:example", question: "How?" },
      { authAction: "Authenticate locally, then retry." },
    );

    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { action: "Authenticate locally, then retry." },
    });
  });

  it("passes the caller signal through and preserves cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    const ask = mock(() => Promise.reject(reason));

    await expect(
      invoke(
        createLocalResearchTool(createService(ask)),
        { target: "npm:example", question: "How?" },
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(ask).toHaveBeenCalledWith(
      {
        target: "npm:example",
        question: "How?",
        sourceFormat: "mcp",
      },
      { signal: controller.signal },
    );
  });
});

describe("Backend-owned Research display", () => {
  it.each(Object.entries(displayContract))(
    "passes through contract case %s",
    async (_name, wire) => {
      const result = await invoke(
        createLocalResearchTool(createService(async () => wire)),
        { question: "How?" },
      );
      expect(result).toEqual({
        content: [{ type: "text", text: wire.display_markdown }],
      });
    },
  );

  it("passes new display sections and Unicode verbatim without interpreting them", () => {
    const wire = {
      display_markdown: "New section\n\n```ts\n\tconst x = 'é';\n```\n",
      future_metadata: { version: 2 },
    };
    expect(formatResearchMcpText(wire)).toBe(wire.display_markdown);
  });

  it.each([
    null,
    {},
    { display_markdown: false },
    { answer_markdown: "legacy" },
  ])("maps a missing display primitive only in text mode: %j", async (wire) => {
    const tool = createLocalResearchTool(
      createService(async () => wire as unknown as AgenticAskResponse),
    );
    const text = await invoke(tool, { question: "How?" });
    expect(text.isError).toBe(true);
    expect(text.content[0]?.text).toContain("invalid Research response");
    const json = await invoke(tool, { question: "How?", format: "json" });
    expect(json.isError).toBeUndefined();
    expect(JSON.parse(json.content[0]?.text ?? "")).toEqual(wire);
  });
});
