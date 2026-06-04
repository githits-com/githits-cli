import { describe, expect, it, mock, spyOn } from "bun:test";
import { languagesAction } from "../commands/languages.js";
import { createMockGitHitsService } from "../services/test-helpers.js";
import { createSearchLanguageTool } from "./search-language.js";

const languages = [
  {
    id: "1",
    name: "typescript",
    display_name: "TypeScript",
    aliases: ["ts"],
  },
  {
    id: "2",
    name: "python",
    display_name: "Python",
    aliases: ["py"],
  },
];

async function cliJson(): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await languagesAction(
      "type",
      { json: true },
      {
        githitsService: createMockGitHitsService({
          searchLanguages: mock(() => Promise.resolve(languages)),
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

async function mcpJson(): Promise<unknown> {
  const tool = createSearchLanguageTool(
    createMockGitHitsService({
      searchLanguages: mock(() => Promise.resolve(languages)),
    }),
  );
  const result = await tool.handler({ query: "type", format: "json" }, {});
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("search_language parity", () => {
  it("PARITY-JSON-KEYS: CLI === MCP", async () => {
    expect(await cliJson()).toEqual(await mcpJson());
  });
});
