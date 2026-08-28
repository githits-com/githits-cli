import { describe, expect, it, mock, spyOn } from "bun:test";
import { searchAction } from "../commands/search.js";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

function outcomeWithPartial(partialResults: boolean) {
  if (defaultUnifiedSearchOutcome.state !== "completed") {
    throw new Error("expected completed outcome fixture");
  }
  return {
    ...defaultUnifiedSearchOutcome,
    result: { ...defaultUnifiedSearchOutcome.result, partialResults },
  };
}

async function cliJson(partialResults: boolean): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await searchAction(
      "router",
      { in: ["npm:express"], json: true },
      {
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() =>
            Promise.resolve(outcomeWithPartial(partialResults)),
          ),
        }),
        codeNavigationUrl: "https://pkgseer.dev",
        hasValidToken: true,
        mcpUrl: "https://mcp.example.com",
      },
    );
    return JSON.parse(String(logSpy.mock.calls[0]?.[0]));
  } finally {
    logSpy.mockRestore();
  }
}

async function mcpJson(partialResults: boolean): Promise<unknown> {
  const tool = createParityMcpTool("search", {
    codeNavigationService: createMockCodeNavigationService({
      search: mock(() => Promise.resolve(outcomeWithPartial(partialResults))),
    }),
  });
  const result = await tool.handler(
    { target: "npm:express", query: "router", format: "json" },
    {},
  );
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("search parity", () => {
  it.each([false, true] as const)(
    "PARITY-JSON-KEYS: CLI === MCP with partialResults=%s",
    async (partialResults) => {
      expect(await cliJson(partialResults)).toEqual(
        await mcpJson(partialResults),
      );
    },
  );
});
