import { describe, expect, it, mock, spyOn } from "bun:test";
import type { UnifiedSearchOutcome } from "@githits/core-internal";
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
  return cliJsonForOutcome(outcomeWithPartial(partialResults));
}

async function cliJsonForOutcome(
  outcome: UnifiedSearchOutcome,
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await searchAction(
      "router",
      { in: ["npm:express"], json: true },
      {
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
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
  return mcpJsonForOutcome(outcomeWithPartial(partialResults));
}

async function mcpJsonForOutcome(
  outcome: UnifiedSearchOutcome,
): Promise<unknown> {
  const tool = createParityMcpTool("search", {
    codeNavigationService: createMockCodeNavigationService({
      search: mock(() => Promise.resolve(outcome)),
    }),
  });
  const result = await tool.handler(
    { target: "npm:express", query: "router", format: "json" },
    {},
  );
  return JSON.parse(result.content[0]?.text ?? "");
}

async function cliTextForOutcome(
  outcome: UnifiedSearchOutcome,
): Promise<string> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  try {
    await searchAction(
      "router",
      { in: ["npm:express"] },
      {
        codeNavigationService: createMockCodeNavigationService({
          search: mock(() => Promise.resolve(outcome)),
        }),
        codeNavigationUrl: "https://pkgseer.dev",
        hasValidToken: true,
        mcpUrl: "https://mcp.example.com",
      },
    );
    return String(logSpy.mock.calls[0]?.[0]);
  } finally {
    logSpy.mockRestore();
  }
}

async function mcpTextForOutcome(
  outcome: UnifiedSearchOutcome,
): Promise<string> {
  const tool = createParityMcpTool("search", {
    codeNavigationService: createMockCodeNavigationService({
      search: mock(() => Promise.resolve(outcome)),
    }),
  });
  const result = await tool.handler(
    { target: "npm:express", query: "router" },
    {},
  );
  return result.content[0]?.text ?? "";
}

function evidenceOutcome(): UnifiedSearchOutcome {
  if (defaultUnifiedSearchOutcome.state !== "completed") {
    throw new Error("expected completed outcome fixture");
  }
  const hit = defaultUnifiedSearchOutcome.result.results[0];
  if (!hit) throw new Error("expected search hit fixture");
  const repositoryFilePath = "packages/pkg/src/feature.ts";
  return {
    ...defaultUnifiedSearchOutcome,
    result: {
      ...defaultUnifiedSearchOutcome.result,
      results: [
        {
          ...hit,
          locator: {
            ...hit.locator,
            repoUrl: "https://github.com/owner/monorepo",
            gitRef: "served-ref",
            commitSha: "0123456789abcdef0123456789abcdef01234567",
            requestedRef: "main",
            filePath: "src/feature.ts",
            repositoryFilePath,
            startLine: 30,
            endLine: 35,
            evidenceRange: {
              startLine: 30,
              endLine: 35,
              matchLine: 32,
              rangeKind: "match_window",
              matchSpansTruncated: false,
            },
            indexedRange: { startLine: 1, endLine: 80 },
            symbolContext: {
              name: "feature",
              kind: "function",
              relation: "encloses_match",
              definitionRange: {
                filePath: "src/feature.ts",
                repositoryFilePath,
                startLine: 20,
                endLine: 50,
              },
            },
          },
        },
      ],
    },
  };
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

  it("PARITY-JSON-KEYS: CLI === MCP for additive evidence locators", async () => {
    const outcome = evidenceOutcome();
    const cli = await cliJsonForOutcome(outcome);
    const mcp = await mcpJsonForOutcome(outcome);

    expect(cli).toEqual(mcp);
    expect(cli).toMatchObject({
      results: [
        {
          locator: {
            startLine: 30,
            endLine: 35,
            evidenceRange: { startLine: 30, endLine: 35 },
            indexedRange: { startLine: 1, endLine: 80 },
            symbolContext: {
              relation: "encloses_match",
              definitionRange: { startLine: 20, endLine: 50 },
            },
          },
        },
      ],
    });
  });

  it("PARITY-TEXT-FORMATTER: CLI === MCP for evidence and definition ranges", async () => {
    const outcome = evidenceOutcome();
    expect(await cliTextForOutcome(outcome)).toBe(
      await mcpTextForOutcome(outcome),
    );
  });
});
