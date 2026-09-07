import { describe, expect, it, mock, spyOn } from "bun:test";
import type {
  ResolveTargetResult,
  UnifiedSearchOutcome,
  UnifiedSearchParams,
  UnifiedSearchRepositoryEvidence,
} from "@githits/core-internal";
import { resolveAction } from "../commands/resolve.js";
import { searchAction } from "../commands/search.js";
import {
  createMockCodeNavigationService,
  createMockResolveTargetService,
  defaultUnifiedSearchOutcome,
} from "../services/test-helpers.js";
import {
  createParityExperimentalMcpTool,
  createParityMcpTool,
} from "./parity-test-helpers.js";

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

function structuralEvidenceOutcome(): UnifiedSearchOutcome {
  const outcome = evidenceOutcome();
  if (outcome.state !== "completed") {
    throw new Error("expected completed evidence outcome");
  }
  const hit = outcome.result.results[0];
  if (!hit) throw new Error("expected evidence search hit");
  const commitSha = "0123456789abcdef0123456789abcdef01234567";
  const repositoryFilePath = "packages/express/lib/client.ts";
  const repositoryEvidence: UnifiedSearchRepositoryEvidence = {
    semanticContext: {
      scopes: [
        {
          name: "Client",
          qualifiedPath: "Client",
          kind: "class",
          parentQualifiedPath: null,
          declarationStartLine: 20,
          declarationEndLine: 220,
          parameterNames: [],
          returnType: null,
          symbolRef: "npm:express:4.18.2:Client",
        },
        {
          name: "send",
          qualifiedPath: "Client.send",
          kind: "method",
          parentQualifiedPath: "Client",
          declarationStartLine: 120,
          declarationEndLine: 165,
          parameterNames: ["request"],
          returnType: "Response",
          symbolRef: "npm:express:4.18.2:Client.send",
        },
      ],
      scopeChainTruncated: false,
      preferredRead: {
        targetLabel: "npm:express@4.18.2",
        registry: "npm",
        packageName: "express",
        version: "4.18.2",
        repoUrl: "https://github.com/expressjs/express",
        gitRef: commitSha,
        commitSha,
        requestedRef: null,
        filePath: "lib/client.ts",
        repositoryFilePath,
        startLine: 120,
        endLine: 165,
      },
    },
    focusedSource: {
      startLine: 142,
      endLine: 145,
      matchLine: 143,
      rangeKind: "match_window",
      matchSpansTruncated: false,
      linesOmittedBefore: false,
      linesOmittedAfter: false,
      lines: [
        {
          lineNumber: 142,
          text: "    const response = await transport(request);",
          highlights: [],
          prefixTruncated: false,
          suffixTruncated: false,
        },
        {
          lineNumber: 143,
          text: "    if (response.status === 429) {",
          highlights: [[8, 24]],
          prefixTruncated: false,
          suffixTruncated: false,
        },
        {
          lineNumber: 144,
          text: "      return retry(request);",
          highlights: [],
          prefixTruncated: false,
          suffixTruncated: false,
        },
        {
          lineNumber: 145,
          text: "    }",
          highlights: [],
          prefixTruncated: false,
          suffixTruncated: false,
        },
      ],
    },
  };
  return {
    ...outcome,
    result: {
      ...outcome.result,
      results: [
        {
          ...hit,
          title: "send",
          summary: "legacy summary must remain in JSON",
          repositoryEvidence,
          contentSafety: { filtered: false, modifications: [] },
          targetLabel: "npm:express@4.18.2",
          locator: {
            ...hit.locator,
            registry: "npm",
            packageName: "express",
            version: "4.18.2",
            repoUrl: "https://github.com/expressjs/express",
            gitRef: commitSha,
            commitSha,
            requestedRef: "4.18.2",
            filePath: "lib/client.ts",
            repositoryFilePath,
            startLine: 142,
            endLine: 145,
            evidenceRange: {
              startLine: 142,
              endLine: 145,
              matchLine: 143,
              rangeKind: "match_window",
              matchSpansTruncated: false,
            },
            indexedRange: { startLine: 20, endLine: 220 },
            symbolContext: {
              name: "send",
              qualifiedPath: "Client.send",
              kind: "method",
              relation: "encloses_match",
              definitionRange: {
                filePath: "lib/client.ts",
                repositoryFilePath,
                startLine: 120,
                endLine: 165,
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

  it("PARITY-STRUCTURAL-JSON: CLI === MCP and preserves structural evidence", async () => {
    const outcome = structuralEvidenceOutcome();
    if (outcome.state !== "completed") {
      throw new Error("expected completed structural outcome");
    }
    const cli = await cliJsonForOutcome(outcome);
    const mcp = await mcpJsonForOutcome(outcome);

    expect(cli).toEqual(mcp);
    const cliResult = cli as {
      results: Array<{
        repositoryEvidence?: unknown;
        contentSafety?: unknown;
        summary?: string;
        locator: {
          filePath?: string;
          repositoryFilePath?: string;
          startLine?: number;
          endLine?: number;
        };
        followUp?: string;
      }>;
    };
    const hit = cliResult.results[0];
    expect(hit?.repositoryEvidence).toEqual(
      outcome.result.results[0]?.repositoryEvidence,
    );
    expect(hit?.contentSafety).toEqual(
      outcome.result.results[0]?.contentSafety,
    );
    expect(hit?.summary).toBe("legacy summary must remain in JSON");
    expect(hit?.locator).toMatchObject({
      filePath: "lib/client.ts",
      repositoryFilePath: "packages/express/lib/client.ts",
      startLine: 142,
      endLine: 145,
    });
    expect(hit?.followUp).toBe(
      'code_read target="npm:express@4.18.2" path="lib/client.ts" start_line=120 end_line=165',
    );
  });

  it("PARITY-STRUCTURAL-TEXT: CLI === MCP with structural source and scopes", async () => {
    const outcome = structuralEvidenceOutcome();
    const cli = await cliTextForOutcome(outcome);
    const mcp = await mcpTextForOutcome(outcome);

    expect(cli).toBe(mcp);
    expect(cli).toContain(
      "[1] npm:express@4.18.2 lib/client.ts:142-145 [repo code]",
    );
    expect(cli).toContain("  - class Client | lines 20-220");
    expect(cli).toContain("    - method Client.send | lines 120-165");
    expect(cli).toContain(
      "  142 |     const response = await transport(request);",
    );
    expect(cli).toContain("> 143 |     if (response.status === 429) {");
    expect(cli).toContain("  144 |       return retry(request);");
    expect(cli).toContain("  145 |     }");
    expect(cli).not.toContain("legacy summary must remain in JSON");
    expect(cli).not.toContain("Read context");
    expect(cli).not.toContain("code_read target=");
  });
});

describe("S2b readiness", () => {
  for (const target of ["site:ai.pydantic.dev", "pypi:pydantic-ai"]) {
    for (const surface of ["CLI", "MCP"]) {
      it(`${surface} continues ${target} with unready docs into ordinary search before reporting indexing`, async () => {
        const kind = target.startsWith("site:") ? "SITE" : "PACKAGE";
        const best = { kind, canonicalKey: target, confidence: "EXACT" };
        const resolved: ResolveTargetResult = {
          best,
          targets: [
            {
              ...best,
              docsAvailable: false,
              docsPageCount: 0,
              codeAvailable: false,
              latestVersionMaliciousStatus:
                kind === "SITE" ? "NOT_APPLICABLE" : "CLEAR",
              match: { confidence: "EXACT" },
            },
          ],
          protectedMatches: [],
          targetsTruncated: false,
          ambiguous: false,
          ambiguousReason: "NOT_AMBIGUOUS",
        };
        const resolveTarget = mock(() => Promise.resolve(resolved));
        const resolveTargetService = createMockResolveTargetService({
          resolveTarget,
        });
        const outcome: UnifiedSearchOutcome = {
          state: "incomplete",
          completed: false,
          searchRef: "search-s2b",
          progress: {
            searchRef: "search-s2b",
            status: "INDEXING",
            targetsTotal: 1,
            targetsReady: 0,
            elapsedMs: 100,
            query: "tools",
            queryWarnings: [],
            sources: ["DOCS"],
          },
        };
        const search = mock((_params: UnifiedSearchParams) =>
          Promise.resolve(outcome),
        );
        const codeNavigationService = createMockCodeNavigationService({
          search,
        });
        let resolutionText: string;
        let searchText: string;
        if (surface === "CLI") {
          const stdout = spyOn(process.stdout, "write").mockImplementation(
            () => true,
          );
          const log = spyOn(console, "log").mockImplementation(() => {});
          try {
            await resolveAction(
              "Pydantic AI",
              {},
              {
                resolveTargetService,
                hasValidToken: true,
                mcpUrl: "https://mcp.example.com",
              },
            );
            resolutionText = String(stdout.mock.calls[0]?.[0]);
            expect(resolutionText).toContain(`--in '${target}'`);
            expect(search).not.toHaveBeenCalled();
            await searchAction(
              "tools",
              { in: [resolved.best!.canonicalKey], source: "docs" },
              {
                codeNavigationService,
                codeNavigationUrl: "https://nav.example.com",
                hasValidToken: true,
                mcpUrl: "https://mcp.example.com",
              },
            );
            searchText = String(log.mock.calls[0]?.[0]);
          } finally {
            stdout.mockRestore();
            log.mockRestore();
          }
        } else {
          const resolver = createParityExperimentalMcpTool("resolve_target", {
            resolveTargetService,
          });
          const resolution = await resolver.handler(
            { name: "Pydantic AI" },
            {},
          );
          resolutionText = resolution.content[0]?.text ?? "";
          expect(resolutionText).toContain(`"${target}"`);
          expect(search).not.toHaveBeenCalled();
          const tool = createParityMcpTool("search", { codeNavigationService });
          const response = await tool.handler(
            {
              target: resolved.best!.canonicalKey,
              query: "tools",
              source: "docs",
            },
            {},
          );
          expect(response.isError).toBeUndefined();
          searchText = response.content[0]?.text ?? "";
        }
        expect(resolveTarget).toHaveBeenCalledTimes(1);
        expect(resolutionText).not.toMatch(/queued|preparing|indexing/i);
        expect(search).toHaveBeenCalledTimes(1);
        expect(search.mock.calls[0]?.[0]).toMatchObject({
          targets:
            kind === "SITE"
              ? [{ site: target }]
              : [{ registry: "PYPI", packageName: "pydantic-ai" }],
          sources: ["DOCS"],
        });
        expect(searchText).toContain("indexing");
        expect(searchText).toContain("search-s2b");
      });
    }
  }
});
