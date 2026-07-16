// PARITY-JSON-KEYS: CLI and MCP success payloads have the same keys.
// PARITY-ERROR-ENVELOPE: CLI and MCP errors carry the same structured metadata.
import { describe, expect, it, mock, spyOn } from "bun:test";
import { ApiRateLimitError, FetchTimeoutError } from "@githits/core-internal";
import { exampleAction } from "../commands/example.js";
import { createMockGitHitsService } from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

async function cliJson(markdown: string): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await exampleAction(
      "router",
      { json: true },
      {
        githitsService: createMockGitHitsService({
          search: mock(() => Promise.resolve(markdown)),
        }),
        hasValidToken: true,
        mcpUrl: "https://mcp.example.com",
      },
    );
    return JSON.parse(String(logSpy.mock.calls[0]?.[0]));
  } finally {
    logSpy.mockRestore();
  }
}

async function mcpJson(markdown: string): Promise<unknown> {
  const tool = createParityMcpTool("get_example", {
    githitsService: createMockGitHitsService({
      search: mock(() => Promise.resolve(markdown)),
    }),
  });
  const result = await tool.handler({ query: "router", format: "json" }, {});
  return JSON.parse(result.content[0]?.text ?? "");
}

async function cliJsonError(error: Error): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await exampleAction(
        "router",
        { json: true },
        {
          githitsService: createMockGitHitsService({
            search: mock(() => Promise.reject(error)),
          }),
          hasValidToken: true,
          mcpUrl: "https://mcp.example.com",
        },
      );
    } catch (caught) {
      if (!isProcessExitSentinel(caught)) throw caught;
    }
    const raw = errorSpy.mock.calls[0]?.[0] as string | undefined;
    return raw ? JSON.parse(raw) : undefined;
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

async function mcpJsonError(error: Error): Promise<unknown> {
  const tool = createParityMcpTool("get_example", {
    githitsService: createMockGitHitsService({
      search: mock(() => Promise.reject(error)),
    }),
  });
  const result = await tool.handler({ query: "router", format: "json" }, {});
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("get_example parity", () => {
  it("PARITY-JSON-KEYS: CLI === MCP", async () => {
    const markdown =
      "# Example\n\n```ts\nrouter();\n```\n\nSolution ID: sol_123";

    expect(await cliJson(markdown)).toEqual(await mcpJson(markdown));
  });

  it("PARITY-ERROR-ENVELOPE: RATE_LIMITED CLI === MCP", async () => {
    const cli = await cliJsonError(
      new ApiRateLimitError("Request limit reached.", 17),
    );
    const mcp = await mcpJsonError(
      new ApiRateLimitError("Request limit reached.", 17),
    );

    expect(cli).toEqual(mcp);
    expect(cli).toEqual({
      error: "Request limit reached.",
      code: "RATE_LIMITED",
      retryable: true,
      details: { status: 429, retryAfterSeconds: 17 },
    });
  });

  it("PARITY-ERROR-ENVELOPE: TIMEOUT CLI === MCP", async () => {
    const cli = await cliJsonError(new FetchTimeoutError(1_234));
    const mcp = await mcpJsonError(new FetchTimeoutError(1_234));

    expect(cli).toEqual(mcp);
    expect(cli).toEqual({
      error: "Failed to get example: Request timed out after 1234ms.",
      code: "TIMEOUT",
      retryable: true,
      details: { timeoutMs: 1_234 },
    });
  });
});
