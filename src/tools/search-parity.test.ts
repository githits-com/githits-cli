import { describe, expect, it, mock, spyOn } from "bun:test";
import type {
  ResolveTargetResult,
  UnifiedSearchOutcome,
  UnifiedSearchParams,
  UnifiedSearchRepositoryEvidence,
} from "@githits/core-internal";
import { Command } from "commander";
import { resolveAction } from "../commands/resolve.js";
import {
  registerSearchCommand,
  searchAction,
  searchStatusAction,
} from "../commands/search.js";
import {
  createMockCodeNavigationService,
  createMockResolveTargetService,
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
          readTarget: {
            target: "backend-feature",
            path: "packages/pkg/src/feature.ts",
            startLine: 20,
            endLine: 50,
          },
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
  repositoryEvidence.bm25MatchFields = ["SOURCE_IDENTIFIER"];
  repositoryEvidence.matchedSource = {
    ...repositoryEvidence.focusedSource!,
    rangeKind: "match_window",
  };
  return {
    ...outcome,
    result: {
      ...outcome.result,
      results: [
        {
          ...hit,
          title: "send",
          readTarget: {
            target: "npm:express@4.18.2",
            path: "lib/client.ts",
            startLine: 120,
            endLine: 165,
          },
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
  it("PARITY-PACKAGE-DOCS: headers and JSON follow-ups use package-relative addressing", async () => {
    const outcome = outcomeWithPartial(false);
    const original = outcome.result.results[0]!;
    const commitSha = "0123456789abcdef0123456789abcdef01234567";
    const locator = {
      registry: "npm",
      packageName: "express",
      version: "4.18.2",
      filePath: "docs/routing.md",
      repositoryFilePath: "packages/express/docs/routing.md",
      repoUrl: "https://github.com/owner/monorepo",
      gitRef: commitSha,
      commitSha,
      pageId: `github:owner/monorepo@${commitSha}/packages/express/docs/routing.md`,
      docsReadTarget: `github:owner/monorepo@${commitSha}/packages/express/docs/routing.md`,
      startLine: 42,
      endLine: 52,
    };
    outcome.result.results = [
      {
        ...original,
        resultType: "REPOSITORY_DOC",
        readTarget: {
          target: "npm:express@4.18.2",
          path: "docs/routing.md",
          startLine: 42,
          endLine: 52,
        },
        targetLabel: "npm:express@4.18.2",
        title: "Routing",
        locator,
        repositoryEvidence: { semanticContext: null, matchedSource: null },
      },
    ];
    const cli = await cliJsonForOutcome(outcome);
    const mcp = await mcpJsonForOutcome(outcome);
    expect(cli).toEqual(mcp);
    for (const key of ["readTarget", "codeAction", "docAction"])
      expect(JSON.stringify(cli)).not.toContain(`"${key}":`);
    expect(cli).toMatchObject({
      results: [
        {
          locator,
          followUp:
            'read target="npm:express@4.18.2" path="docs/routing.md" start_line=42 end_line=52',
        },
      ],
    });
    for (const text of [
      await cliTextForOutcome(outcome),
      await mcpTextForOutcome(outcome),
    ]) {
      expect(text).toContain(
        "npm:express@4.18.2 docs/routing.md:42-52 [repo doc, candidate]",
      );
      expect(text).not.toContain(locator.docsReadTarget);
    }
  });

  it("PARITY-V31: compact path hits and grapheme previews omit legacy JSON", async () => {
    const outcome = structuralEvidenceOutcome();
    if (outcome.state !== "completed")
      throw new Error("expected completed fixture");
    const first = outcome.result.results[0]!;
    first.repositoryEvidence!.bm25MatchFields = ["FILE_PATH"];
    first.repositoryEvidence!.matchedSource = null;
    first.documentationPreview = null;
    const preview = { text: "Router é👩‍💻 preview", highlights: [] };
    outcome.result.results.push({
      id: "crawled",
      resultType: "DOCUMENTATION_PAGE",
      readTarget: { target: "https://example.com/router" },
      targetLabel: "site:example.com",
      title: "Router",
      summary: "legacy preview stays in JSON",
      repositoryEvidence: null,
      documentationPreview: preview,
      locator: {
        docsReadTarget: "https://example.com/router",
        pageId: "page-1",
        sourceUrl: "https://example.com/router",
      },
    });
    outcome.result.page.returned = 2;
    const cli = await cliJsonForOutcome(outcome);
    expect(cli).toEqual(await mcpJsonForOutcome(outcome));
    expect(cli).toMatchObject({
      results: [
        {
          repositoryEvidence: {
            bm25MatchFields: ["FILE_PATH"],
            matchedSource: null,
          },
          documentationPreview: null,
        },
        {
          repositoryEvidence: null,
          documentationPreview: preview,
        },
      ],
    });
    const results = (cli as { results: Array<Record<string, unknown>> })
      .results;
    expect(results[0]?.repositoryEvidence).not.toHaveProperty("focusedSource");
    expect(results[1]).not.toHaveProperty("summary");
    const text = await cliTextForOutcome(outcome);
    const mcpText = await mcpTextForOutcome(outcome);
    expect(text).toBe(mcpText);
    expect(text).not.toContain("githits read ");
    expect(mcpText).not.toContain("read target=");
    expect(text).toContain(
      "lib/client.ts:120-165 [repo code, candidate; indexed: path]",
    );
    expect(text).not.toContain("response.status");
    expect(text).toContain(" - method Client.send");
    expect(text).not.toContain("legacy preview");
    expect(text).toContain("Router é👩‍💻 preview");
  });

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
    for (const key of ["readTarget", "codeAction", "docAction"])
      expect(JSON.stringify(cli)).not.toContain(`"${key}":`);
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

  it("PARITY-TEXT-FORMATTER: shared evidence without read commands", async () => {
    const outcome = evidenceOutcome();
    const cli = await cliTextForOutcome(outcome);
    const mcp = await mcpTextForOutcome(outcome);
    expect(cli).toBe(mcp);
    expect(cli).not.toContain("githits read ");
    expect(mcp).not.toContain("read target=");
  });

  it("PARITY-STRUCTURAL-JSON: CLI === MCP and preserves structural evidence", async () => {
    const outcome = structuralEvidenceOutcome();
    if (outcome.state !== "completed") {
      throw new Error("expected completed structural outcome");
    }
    const cli = await cliJsonForOutcome(outcome);
    const mcp = await mcpJsonForOutcome(outcome);

    expect(cli).toEqual(mcp);
    for (const key of ["readTarget", "codeAction", "docAction"])
      expect(JSON.stringify(cli)).not.toContain(`"${key}":`);
    const cliResult = cli as {
      results: Array<{
        repositoryEvidence?: unknown;
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
    expect(hit?.repositoryEvidence).toMatchObject({
      bm25MatchFields: ["SOURCE_IDENTIFIER"],
      matchedSource: expect.any(Object),
    });
    expect(hit?.repositoryEvidence).not.toHaveProperty("focusedSource");
    expect(hit).not.toHaveProperty("contentSafety");
    expect(hit).not.toHaveProperty("summary");
    expect(hit?.locator).toMatchObject({
      filePath: "lib/client.ts",
      repositoryFilePath: "packages/express/lib/client.ts",
      startLine: 142,
      endLine: 145,
    });
    expect(hit?.followUp).toBe(
      'read target="npm:express@4.18.2" path="lib/client.ts" start_line=120 end_line=165',
    );
  });

  it("PARITY-STRUCTURAL-TEXT: CLI === MCP with structural source and scopes", async () => {
    const outcome = structuralEvidenceOutcome();
    const cli = await cliTextForOutcome(outcome);
    const mcp = await mcpTextForOutcome(outcome);

    expect(cli).toBe(mcp);
    expect(cli).not.toContain("githits read ");
    expect(mcp).not.toContain("read target=");
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
    expect(cli).not.toContain("read target=");
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
          const resolver = createParityMcpTool("resolve_target", {
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

describe("usable snapshot presentation parity", () => {
  it.each(["github:anomalyco/opencode@HEAD", "github:anomalyco/opencode"])(
    "CLI/MCP initial and status prioritize a pinned read and preserve JSON: %s",
    async (target) => {
      if (defaultUnifiedSearchOutcome.state !== "completed")
        throw new Error("expected completed fixture");
      const original = defaultUnifiedSearchOutcome.result;
      const repoUrl = "https://github.com/anomalyco/opencode";
      const servedSha = "bbd72fb8b0bb6de580d2041a0150016227c63ac0";
      const requestedSha = "0112a92c416f5ad833d96e7a8308441f0a875d94";
      const servedTarget = "github:anomalyco/opencode@HEAD";
      const path = "packages/tui/src/routes/session/index.tsx";
      const outcome: UnifiedSearchOutcome = {
        state: "incomplete",
        completed: false,
        searchRef: "snapshot-ref",
        progress: {
          ...defaultUnifiedSearchOutcome.progress!,
          status: "INDEXING",
          indexingEstimates: [
            {
              kind: "REPOSITORY",
              targets: [target],
              repositoryUrl: repoUrl,
              commitSha: requestedSha,
              estimate: { lowerSeconds: 100, upperSeconds: 120 },
            },
          ],
        },
        result: {
          ...original,
          partialResults: false,
          evidenceNotice: "Snapshot evidence may change.",
          results: [
            {
              id: "snapshot",
              resultType: "REPOSITORY_CODE",
              targetLabel: target,
              servedTargetLabel: servedTarget,
              locator: {
                repoUrl,
                commitSha: servedSha,
                gitRef: servedSha,
                filePath: path,
                startLine: 177,
                endLine: 187,
              },
              readTarget: {
                target: "github:anomalyco/opencode@bbd72fb8",
                path,
                startLine: 177,
                endLine: 1362,
              },
            },
          ],
          sourceStatus: [
            {
              ...original.sourceStatus[0]!,
              targetLabel: target,
              servedTargetLabel: servedTarget,
              codeIndexState: "STALE",
              targetResolution: {
                requested: { kind: "repo_default_branch" },
                resolvedRequested: {
                  repoUrl,
                  gitRef: "HEAD",
                  commitSha: requestedSha,
                  committedAt: "2026-10-05T00:00:01Z",
                },
                served: {
                  repoUrl,
                  gitRef: "HEAD",
                  commitSha: servedSha,
                  committedAt: "2026-09-01T23:59:59Z",
                },
                freshness: "fallback_recent",
                freshnessReason: "requested_ref_indexing",
                availableVersions: [],
                availableRefs: [],
              },
            },
          ],
        },
      };
      const service = createMockCodeNavigationService({
        search: mock(() => Promise.resolve(outcome)),
        searchStatus: mock(() => Promise.resolve(outcome)),
      });
      const cli = await cliTextForOutcome(outcome);
      const mcp = await mcpTextForOutcome(outcome);
      const log = spyOn(console, "log").mockImplementation(() => {});
      let cliStatus: string;
      try {
        await searchStatusAction(
          "snapshot-ref",
          { wait: "0" },
          {
            codeNavigationService: service,
            codeNavigationUrl: "https://nav.example.com",
            hasValidToken: true,
            mcpUrl: "https://mcp.example.com",
          },
        );
        cliStatus = String(log.mock.calls[0]?.[0]);
      } finally {
        log.mockRestore();
      }
      const statusTool = createParityMcpTool("search_status", {
        codeNavigationService: service,
      });
      const mcpStatus = await statusTool.handler(
        { search_ref: "snapshot-ref", wait_timeout_ms: 0 },
        {},
      );
      expect(cliStatus).toBe(cli);
      expect(mcpStatus.content[0]?.text).toBe(mcp);
      for (const text of [
        cli,
        mcp,
        cliStatus,
        mcpStatus.content[0]?.text ?? "",
      ]) {
        expect(text).toContain("  - github:anomalyco/opencode@bbd72fb8");
        expect(text.replace(/\s+/g, " ")).toContain(
          "committed 2026-09-01, indexed from ref HEAD",
        );
        expect(text.replace(/\s+/g, " ")).toContain(
          "indexing, estimated total: 100-120s, committed 2026-10-05, observed HEAD",
        );
        expect(text).toContain("Next: use these hits");
        expect(text).not.toContain("Next: search_status");
        expect(text).not.toContain("Next: githits search-status");
        expect(text).toContain("If you need current HEAD");
      }
      expect(mcp).toContain(
        `read target="github:anomalyco/opencode@bbd72fb8" path="${path}" start_line=177 end_line=1362`,
      );
      expect(cli).toContain(
        `githits read 'github:anomalyco/opencode@bbd72fb8' '${path}' --lines 177-1362`,
      );
      const json = await cliJsonForOutcome(outcome);
      expect(json).toEqual(await mcpJsonForOutcome(outcome));
      expect(json).toMatchObject({
        completed: false,
        partialResults: false,
        results: [
          {
            locator: { commitSha: servedSha },
            followUp: `read target="github:anomalyco/opencode@bbd72fb8" path="${path}" start_line=177 end_line=476`,
          },
        ],
        sourceStatus: [
          {
            targetResolution: {
              served: {
                commitSha: servedSha,
                committedAt: "2026-09-01T23:59:59Z",
              },
              resolvedRequested: {
                commitSha: requestedSha,
                committedAt: "2026-10-05T00:00:01Z",
              },
            },
          },
        ],
      });
      const statusJson = await statusTool.handler(
        { search_ref: "snapshot-ref", wait_timeout_ms: 0, format: "json" },
        {},
      );
      const cliLog = spyOn(console, "log").mockImplementation(() => {});
      try {
        await searchStatusAction(
          "snapshot-ref",
          { wait: "0", json: true },
          {
            codeNavigationService: service,
            codeNavigationUrl: "https://nav.example.com",
            hasValidToken: true,
            mcpUrl: "https://mcp.example.com",
          },
        );
        const cliStatusJson = JSON.parse(String(cliLog.mock.calls[0]?.[0]));
        const mcpStatusJson = JSON.parse(statusJson.content[0]?.text ?? "");
        expect(cliStatusJson).toEqual(mcpStatusJson);
        expect(mcpStatusJson.result.sourceStatus[0].targetResolution).toEqual(
          (json as { sourceStatus: Array<{ targetResolution: unknown }> })
            .sourceStatus[0]!.targetResolution,
        );
      } finally {
        cliLog.mockRestore();
      }
      // JSON keeps the existing capped follow-up contract; the text's practical
      // example uses the backend selection unchanged.
    },
  );
});

describe("healthy source provenance through actual search adapters", () => {
  it.each(["code", "repository-docs", "mixed-zero", "no-resolution"])(
    "preserves healthy source provenance %s through initial/status text and compact JSON",
    async (mode) => {
      if (defaultUnifiedSearchOutcome.state !== "completed")
        throw new Error("expected completed fixture");
      const original = defaultUnifiedSearchOutcome.result;
      const repoUrl = "https://github.com/n8n-io/n8n";
      const sha = "4fdfc9f9db35702b64a8f15044a454044e47f6fc";
      const target = "npm:n8n@2.36.6";
      const outcome: UnifiedSearchOutcome = {
        state: "completed",
        completed: true,
        searchRef: "healthy-search",
        result: {
          ...original,
          partialResults: false,
          results: [
            {
              ...original.results[0]!,
              targetLabel: target,
              locator: {
                ...original.results[0]!.locator,
                repoUrl,
                commitSha: sha,
                gitRef: sha,
              },
              readTarget: { target, path: "src/index.ts" },
            },
          ],
          sourceStatus: [
            {
              ...original.sourceStatus[0]!,
              source: "CODE",
              targetLabel: target,
              codeIndexState: "CURRENT",
              indexingStatus: "INDEXED",
              resultCount: 1,
              targetResolution: {
                requested: {
                  kind: "package_exact_version",
                  registry: "npm",
                  packageName: "n8n",
                  version: "2.36.6",
                },
                resolvedRequested: {
                  repoUrl,
                  gitRef: "n8n@2.36.6",
                  commitSha: sha,
                  committedAt: "2026-08-24T00:00:00Z",
                },
                served: {
                  repoUrl,
                  gitRef: "n8n@2.36.6",
                  commitSha: sha,
                  committedAt: "2026-08-24T00:00:00Z",
                },
                freshness: "current",
                freshnessReason: "exact_current",
                availableVersions: [],
                availableRefs: [],
              },
            },
          ],
        },
      };
      if (mode === "repository-docs") {
        const source = outcome.result.sourceStatus[0]!;
        source.source = "DOCS";
        source.contributors = [
          {
            kind: "REPOSITORY_DOCS",
            state: "SEARCHED",
            freshness: "CURRENT",
            resultCount: 1,
            repositoryUrl: repoUrl,
            commitSha: sha,
          },
        ];
        outcome.result.results[0]!.resultType = "REPOSITORY_DOC";
        outcome.result.results[0]!.locator.pageId = "repository-doc-page";
      } else if (mode === "mixed-zero") {
        const zeroSha = "a".repeat(40);
        outcome.result.sourceStatus.push({
          ...outcome.result.sourceStatus[0]!,
          targetLabel: `github:n8n-io/n8n@${zeroSha}`,
          resultCount: 0,
          targetResolution: {
            requested: { kind: "repo_commit", repoUrl, gitRef: zeroSha },
            served: {
              repoUrl,
              commitSha: zeroSha,
              committedAt: "2026-08-23T00:00:00Z",
            },
            freshness: "current",
            availableVersions: [],
            availableRefs: [],
          },
        });
        outcome.result.partialResults = true;
      } else if (mode === "no-resolution") {
        outcome.result.sourceStatus[0]!.targetResolution = undefined;
        outcome.result.sourceStatus[0]!.resultCount = 2;
        outcome.result.results.push({
          ...outcome.result.results[0]!,
          id: "second-hit",
          locator: {
            ...outcome.result.results[0]!.locator,
            filePath: "src/other.ts",
          },
        });
        outcome.result.page.returned = 2;
      }
      for (const text of [
        await cliTextForOutcome(outcome),
        await mcpTextForOutcome(outcome),
      ]) {
        expect(text).toContain("Sources:");
        expect(text).toContain("github:n8n-io/n8n@4fdfc9f9");
        expect(text.match(/ {2}- github:n8n-io\/n8n@4fdfc9f9/g)).toHaveLength(
          1,
        );
        if (mode === "no-resolution") {
          expect(text).not.toContain("committed");
          expect(text).not.toContain("indexed from ref");
        } else
          expect(text.replace(/\s+/g, " ")).toContain(
            "committed 2026-08-24, indexed from ref n8n@2.36.6",
          );
        if (mode === "mixed-zero")
          expect(text.replace(/\s+/g, " ")).toMatch(
            /github:n8n-io\/n8n@aaaaaaaa \(committed 2026-08-23[^)]*no results\)/,
          );
        expect(text).not.toContain("If you need current HEAD");
        expect(text).not.toContain("sourceStatusForText");
      }
      const service = createMockCodeNavigationService({
        searchStatus: mock(async () => outcome),
      });
      const log = spyOn(console, "log").mockImplementation(() => {});
      let cliStatus = "";
      try {
        await searchStatusAction(
          "healthy-search",
          { wait: "0" },
          {
            codeNavigationService: service,
            codeNavigationUrl: "https://pkgseer.dev",
            hasValidToken: true,
            mcpUrl: "https://mcp.example.com",
          },
        );
        cliStatus = String(log.mock.calls[0]?.[0]);
      } finally {
        log.mockRestore();
      }
      const statusTool = createParityMcpTool("search_status", {
        codeNavigationService: service,
      });
      const mcpStatus = await statusTool.handler(
        { search_ref: "healthy-search", wait_timeout_ms: 0 },
        {},
      );
      for (const text of [cliStatus, mcpStatus.content[0]?.text ?? ""]) {
        expect(text).toContain("Sources:");
        expect(text).toContain("github:n8n-io/n8n@4fdfc9f9");
        if (mode === "no-resolution") expect(text).not.toContain("committed");
        else expect(text).toContain("committed 2026-08-24");
        if (mode === "mixed-zero")
          expect(text.replace(/\s+/g, " ")).toMatch(
            /github:n8n-io\/n8n@aaaaaaaa \(committed 2026-08-23[^)]*no results\)/,
          );
        expect(text).not.toContain("sourceStatusForText");
      }
      const cli = await cliJsonForOutcome(outcome);
      const mcp = await mcpJsonForOutcome(outcome);
      expect(cli).toEqual(mcp);
      expect(JSON.stringify(cli)).not.toContain("sourceStatusForText");
      if (mode === "repository-docs")
        expect(
          (cli as { sourceStatus: Array<{ targetResolution?: unknown }> })
            .sourceStatus[0],
        ).not.toHaveProperty("targetResolution");
      else expect(cli).not.toHaveProperty("sourceStatus");
      const jsonStatus = await statusTool.handler(
        { search_ref: "healthy-search", format: "json" },
        {},
      );
      expect(jsonStatus.content[0]?.text).not.toContain("sourceStatusForText");
      const statusJson = JSON.parse(jsonStatus.content[0]?.text ?? "{}");
      if (mode === "repository-docs")
        expect(statusJson.result.sourceStatus[0]).not.toHaveProperty(
          "targetResolution",
        );
      else expect(statusJson.result).not.toHaveProperty("sourceStatus");
    },
  );
});

describe("partial search default across adapters", () => {
  it.each([undefined, true, false])(
    "preserves partial mode %s through CLI and MCP with truthful JSON",
    async (allowPartial) => {
      const search = mock((_: UnifiedSearchParams) =>
        Promise.resolve(defaultUnifiedSearchOutcome),
      );
      const service = createMockCodeNavigationService({ search });
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        await searchAction(
          "router",
          { in: ["npm:express"], json: true, allowPartial },
          {
            codeNavigationService: service,
            codeNavigationUrl: "https://pkgseer.dev",
            hasValidToken: true,
            mcpUrl: "https://mcp.example.com",
          },
        );
        const cli = JSON.parse(String(log.mock.calls[0]?.[0]));
        const result = await createParityMcpTool("search", {
          codeNavigationService: service,
        }).handler(
          {
            target: "npm:express",
            query: "router",
            format: "json",
            allow_partial_results: allowPartial,
          },
          {},
        );
        const mcp = JSON.parse(result.content[0]?.text ?? "");
        expect(search.mock.calls[0]?.[0].allowPartialResults).toBe(
          allowPartial ?? true,
        );
        expect(search.mock.calls[1]?.[0].allowPartialResults).toBe(
          allowPartial ?? true,
        );
        expect(cli.query.allowPartialResults).toBe(allowPartial ?? true);
        expect(mcp).toEqual(cli);
      } finally {
        log.mockRestore();
      }
    },
  );
  it.each([undefined, "--allow-partial", "--no-allow-partial"])(
    "parses the CLI partial control %s",
    (flag) => {
      const program = new Command();
      registerSearchCommand(program);
      const search = program.commands.find(
        (command) => command.name() === "search",
      )!;
      search.parseOptions([
        "router",
        "--in",
        "npm:express",
        ...(flag ? [flag] : []),
      ]);
      expect(search.opts().allowPartial).toBe(flag !== "--no-allow-partial");
    },
  );
});
