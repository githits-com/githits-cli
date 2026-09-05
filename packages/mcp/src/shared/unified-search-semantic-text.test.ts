import { describe, expect, it } from "bun:test";
import { colors } from "./colors.js";
import type { UnifiedSearchHitPayload } from "./unified-search-response.js";
import { renderUnifiedSearchSuccess } from "./unified-search-text.js";

const sha = "0123456789abcdef0123456789abcdef01234567";

function semanticHit(): UnifiedSearchHitPayload {
  return {
    type: "repository_code",
    target: "github:owner/monorepo#main",
    title: "send",
    summary: "LEGACY SOURCE MUST NOT RENDER",
    followUp: "DO NOT PRINT THIS COMMAND",
    locator: { filePath: "wrong-relative-path.ts", startLine: 1, endLine: 9 },
    repositoryEvidence: {
      semanticContext: {
        scopeChainTruncated: false,
        scopes: [
          {
            name: "Client",
            qualifiedPath: "Client",
            kind: "class",
            parentQualifiedPath: null,
            declarationStartLine: 20,
            declarationEndLine: 620,
            parameterNames: [],
            returnType: null,
            symbolRef: "outer-ref",
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
            symbolRef: "inner-ref",
          },
        ],
        preferredRead: {
          targetLabel: "npm:pkg@1.2.3",
          registry: "npm",
          packageName: "pkg",
          version: "1.2.3",
          repoUrl: "https://github.com/owner/monorepo",
          commitSha: sha,
          gitRef: sha,
          requestedRef: "main",
          filePath: "src/client.ts",
          repositoryFilePath: "packages/pkg/src/client.ts",
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
            text: "    return response;",
            highlights: [[11, 19]],
            prefixTruncated: false,
            suffixTruncated: false,
          },
          {
            lineNumber: 145,
            text: "",
            highlights: [],
            prefixTruncated: false,
            suffixTruncated: false,
          },
        ],
      },
    },
    contentSafety: { filtered: false, modifications: [] },
  };
}

function render(hit: UnifiedSearchHitPayload, useColors = false): string {
  return renderUnifiedSearchSuccess(
    {
      query: { raw: "response" },
      completed: true,
      partialResults: false,
      hasMore: false,
      results: [hit],
    },
    { width: 40, useColors },
  );
}

describe("semantic search text", () => {
  it("renders readable scopes and literal numbered source without a redundant command", () => {
    const text = render(semanticHit());
    expect(text).toContain(
      "[1] npm:pkg@1.2.3 src/client.ts:142-145 [repo code]",
    );
    expect(text).toContain("  - class Client | lines 20-620");
    expect(text).toContain("    - method Client.send | lines 120-165");
    expect(text).toContain(
      "  142 |     const response = await transport(request);",
    );
    expect(text).toContain("> 143 |     return response;");
    expect(text).toContain("  145 | ");
    expect(text).not.toContain("144 |");
    expect(text).not.toContain("LEGACY SOURCE");
    expect(text).not.toContain("DO NOT PRINT");
    expect(text).not.toContain("Read context");
    expect(text).not.toContain("outer-ref");
    expect(text).not.toContain("wrong-relative-path");
  });

  it("uses a repository-root path with its exact commit when package attribution is absent", () => {
    const hit = semanticHit();
    const read = hit.repositoryEvidence!.semanticContext!.preferredRead;
    read.registry = null;
    read.packageName = null;
    read.version = null;
    expect(render(hit)).toContain(
      `github:owner/monorepo#${sha} packages/pkg/src/client.ts:142-145`,
    );
    expect(render(hit)).not.toContain("#main");
  });

  it("renders nullable semantic and source branches independently", () => {
    const sourceOnly = semanticHit();
    sourceOnly.repositoryEvidence!.semanticContext = null;
    expect(render(sourceOnly)).toContain("> 143 |     return response;");
    expect(render(sourceOnly)).not.toContain("class Client");
    const scopesOnly = semanticHit();
    scopesOnly.repositoryEvidence!.focusedSource = null;
    expect(render(scopesOnly)).toContain("- method Client.send");
    expect(render(scopesOnly)).toContain("Exact source unavailable");
    expect(render(scopesOnly)).not.toContain("LEGACY SOURCE");
    const neither = semanticHit();
    neither.repositoryEvidence = null;
    expect(render(neither)).toContain("Exact source unavailable");
    expect(render(neither)).not.toContain("LEGACY SOURCE");
  });

  it("keeps scope gaps, source crops, and grapheme highlights distinct", () => {
    const hit = semanticHit();
    hit.repositoryEvidence!.semanticContext!.scopeChainTruncated = true;
    const source = hit.repositoryEvidence!.focusedSource!;
    source.linesOmittedBefore = true;
    source.linesOmittedAfter = true;
    source.matchSpansTruncated = true;
    source.lines = [
      {
        lineNumber: 143,
        text: "e\u0301👩‍💻 hit",
        highlights: [[3, 6]],
        prefixTruncated: true,
        suffixTruncated: true,
      },
    ];
    const plain = render(hit);
    const colored = render(hit, true);
    expect(plain).toContain("... outer scopes omitted");
    expect(plain.indexOf("... outer scopes omitted")).toBeLessThan(
      plain.indexOf("- class Client"),
    );
    expect(plain).toContain("... lines omitted before");
    expect(plain).toContain("> 143 | ...e\u0301👩‍💻 hit...");
    expect(plain).toContain("... lines omitted after");
    expect(plain).toContain("Some matches are not highlighted");
    expect(colored).toContain(
      `e\u0301👩‍💻 ${colors.bold}${colors.yellow}hit${colors.reset}`,
    );
    expect(
      colored.replace(
        new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
        "",
      ),
    ).toBe(plain);
  });

  it("shows content-safety changes only when the backend filtered content", () => {
    const hit = semanticHit();
    expect(render(hit)).not.toContain("Content filtered");
    hit.contentSafety = {
      filtered: true,
      modifications: ["INVISIBLE_CONTROLS_STRIPPED"],
    };
    expect(render(hit)).toMatch(
      /Content filtered:\s+INVISIBLE_CONTROLS_STRIPPED/,
    );
  });

  it("preserves crawled-doc and explicit-symbol legacy bodies", () => {
    for (const type of ["documentation_page", "repository_symbol"]) {
      const hit = semanticHit();
      hit.type = type;
      hit.repositoryEvidence = null;
      hit.title = "Independent title";
      expect(render(hit)).toContain("LEGACY SOURCE MUST NOT RENDER");
      expect(render(hit)).not.toContain("Exact source unavailable");
    }
  });
});
