import { describe, expect, it, mock, spyOn } from "bun:test";
import { exampleAction } from "../commands/example.js";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

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

describe("get_example parity", () => {
  it("PARITY-JSON-KEYS: CLI === MCP", async () => {
    const markdown =
      "# Example\n\n```ts\nrouter();\n```\n\nSolution ID: sol_123";

    expect(await cliJson(markdown)).toEqual(await mcpJson(markdown));
  });
});
