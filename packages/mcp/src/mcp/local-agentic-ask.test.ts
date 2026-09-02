import { describe, expect, it, mock } from "bun:test";
import {
  AgenticAskHttpError,
  type AgenticAskMcpResponse,
  type AgenticAskService,
  AuthenticationError,
} from "@githits/core-internal";
import { TermsAcceptanceRequiredError } from "@githits/core-internal/browser";
import { z } from "zod";
import {
  type AgenticAskMcpArgs,
  createLocalAgenticAskTool,
  DESCRIPTION,
  formatAgenticAskMcpText,
} from "./local-agentic-ask.js";

const TOOL_CALL_ID = "018f47a6-7b32-7a1e-8f45-6a2d39c81720";

function response(): AgenticAskMcpResponse {
  return {
    source_format: "mcp",
    tool_call_id: TOOL_CALL_ID,
    answer_markdown: "Use the documented API.",
    sources: [
      {
        name: "code_read",
        arguments: {
          target: "npm:example",
          path: "src/index.ts",
          start_line: 10,
          end_line: 20,
        },
      },
      {
        name: "docs_read",
        arguments: {
          page_id: "docs:example:guide",
          start_line: 3,
          end_line: 8,
        },
      },
    ],
  };
}

type McpAsk = (
  request: { target: string; question: string; sourceFormat: "mcp" },
  options?: { signal?: AbortSignal },
) => Promise<AgenticAskMcpResponse>;

function createService(
  ask: McpAsk = mock(() => Promise.resolve(response())),
): AgenticAskService {
  return { ask: ask as unknown as AgenticAskService["ask"] };
}

function invoke(
  tool: ReturnType<typeof createLocalAgenticAskTool>,
  args: AgenticAskMcpArgs,
  signal?: AbortSignal,
) {
  return tool.handler(args, signal ? { signal } : undefined);
}

describe("local ask MCP adapter", () => {
  it("publishes the bounded-write descriptor and standard format schema", () => {
    const tool = createLocalAgenticAskTool(createService());
    const jsonSchema = z.toJSONSchema(z.object(tool.schema));

    expect(tool.name).toBe("ask");
    expect(DESCRIPTION.slice(0, 80)).toBe(
      "Ask one grounded question about a canonical public package or repository target.",
    );
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
    expect(Object.keys(tool.schema)).toEqual(["target", "question", "format"]);
    expect(jsonSchema.properties?.format).toMatchObject({
      default: "text-v1",
      enum: ["text-v1", "text", "json"],
    });
  });

  it("always requests MCP sources and renders them in backend order", async () => {
    const ask = mock(() => Promise.resolve(response()));
    const result = await invoke(createLocalAgenticAskTool(createService(ask)), {
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
      content: [{ type: "text", text: formatAgenticAskMcpText(response()) }],
    });
    expect(result.content[0]?.text).toBe(
      'Use the documented API.\n\nSources:\n  1. code_read({"target":"npm:example","path":"src/index.ts","start_line":10,"end_line":20})\n  2. docs_read({"page_id":"docs:example:guide","start_line":3,"end_line":8})\n\nAsk run ID: 018f47a6-7b32-7a1e-8f45-6a2d39c81720\n',
    );
  });

  it("returns only the validated MCP envelope for JSON", async () => {
    const result = await invoke(createLocalAgenticAskTool(createService()), {
      target: "npm:example",
      question: "How?",
      format: "json",
    });

    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(response());
    expect(result.content[0]?.text).not.toContain("usage");
  });

  it("includes a validated failure run ID in the standard MCP error", async () => {
    const error = new AgenticAskHttpError(
      "RATE_LIMITED",
      "Agentic Ask is rate limited.",
      429,
      TOOL_CALL_ID,
      12,
      true,
    );
    const ask = mock(() => Promise.reject(error));
    const result = await invoke(createLocalAgenticAskTool(createService(ask)), {
      target: "npm:example",
      question: "How?",
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Agentic Ask is rate limited.",
      code: "RATE_LIMITED",
      retryable: true,
      details: { status: 429, retryAfterSeconds: 12 },
      tool_call_id: TOOL_CALL_ID,
    });
  });

  it("omits a missing failure run ID", async () => {
    const ask = mock(() =>
      Promise.reject(
        new AgenticAskHttpError("EXECUTION_FAILED", "Agentic Ask failed.", 500),
      ),
    );
    const result = await invoke(createLocalAgenticAskTool(createService(ask)), {
      target: "npm:example",
      question: "How?",
    });

    expect(JSON.parse(result.content[0]?.text ?? "{}")).not.toHaveProperty(
      "tool_call_id",
    );
  });

  it("uses the local terms remediation without exposing backend details", async () => {
    const ask = mock(() => Promise.reject(new TermsAcceptanceRequiredError()));
    const tool = createLocalAgenticAskTool(createService(ask));
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
    const tool = createLocalAgenticAskTool(createService(ask));
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
        createLocalAgenticAskTool(createService(ask)),
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
