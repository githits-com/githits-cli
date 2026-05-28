import { describe, expect, it, mock, spyOn } from "bun:test";
import { searchAction } from "../commands/search.js";
import {
  createMockCodeNavigationService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import { createSearchTool } from "./search.js";

async function cliJson(): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await searchAction(
      "router",
      { in: ["npm:express"], json: true },
      {
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(defaultUnifiedSearchOutcome)),
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

async function mcpJson(): Promise<unknown> {
  const tool = createSearchTool(
    createMockCodeNavigationService({
      search: mock(() => Promise.resolve(defaultUnifiedSearchOutcome)),
    }),
  );
  const result = await tool.handler(
    { target: "npm:express", query: "router", format: "json" },
    {},
  );
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("search parity", () => {
  it("PARITY-JSON-KEYS: CLI === MCP", async () => {
    expect(await cliJson()).toEqual(await mcpJson());
  });
});
