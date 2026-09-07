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
      focusedSource: null,
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
      matchedSource: {
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
  it("omits unverified code titles with and without semantic scopes", () => {
    for (const title of ["r", "layer"]) {
      const hit = semanticHit();
      hit.title = title;
      expect(render(hit)).not.toContain(` - ${title}`);
      expect(render(hit)).not.toMatch(new RegExp(`^\\s+${title}$`, "m"));
      hit.repositoryEvidence!.semanticContext = null;
      expect(render(hit)).not.toContain(` - ${title}`);
      expect(render(hit)).not.toMatch(new RegExp(`^\\s+${title}$`, "m"));
    }
  });

  it("preserves repository documentation headings", () => {
    const hit = semanticHit();
    hit.type = "repository_doc";
    hit.title = "Session storage";
    expect(render(hit)).toContain("Session storage");
  });

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

  it("uses singular line for a single-line declaration", () => {
    const hit = semanticHit();
    hit.repositoryEvidence!.semanticContext!.scopes[1]!.declarationEndLine =
      120;
    expect(render(hit)).toContain("    - method Client.send | line 120");
    expect(render(hit)).toContain("  - class Client | lines 20-620");
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

  it.each(["github:owner/monorepo#main", "owner/monorepo@main"])(
    "keeps header %s pinned when package metadata contains a synthetic version",
    (targetLabel) => {
      const hit = semanticHit();
      const read = hit.repositoryEvidence!.semanticContext!.preferredRead;
      read.targetLabel = targetLabel;
      read.version = sha;
      const text = render(hit);
      expect(text).toContain(
        `github:owner/monorepo#${sha} packages/pkg/src/client.ts:142-145`,
      );
      expect(text).not.toContain("npm:pkg");
      expect(text).not.toContain("#main");
    },
  );

  it("renders nullable semantic and source branches independently", () => {
    const sourceOnly = semanticHit();
    sourceOnly.repositoryEvidence!.semanticContext = null;
    expect(render(sourceOnly)).toContain("> 143 |     return response;");
    expect(render(sourceOnly)).not.toContain("class Client");
    const scopesOnly = semanticHit();
    scopesOnly.repositoryEvidence!.matchedSource = null;
    expect(render(scopesOnly)).toContain("- method Client.send");
    expect(render(scopesOnly)).toContain("Snippet unavailable");
    expect(render(scopesOnly)).not.toContain("LEGACY SOURCE");
    const neither = semanticHit();
    neither.repositoryEvidence = null;
    expect(render(neither)).toContain("Snippet unavailable");
    expect(render(neither)).not.toContain("LEGACY SOURCE");
  });

  it("keeps scope gaps, source crops, and grapheme highlights distinct", () => {
    const hit = semanticHit();
    hit.repositoryEvidence!.semanticContext!.scopeChainTruncated = true;
    const source = hit.repositoryEvidence!.matchedSource!;
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
      expect(render(hit)).not.toContain("Snippet unavailable");
    }
  });
});

describe("v31 search presentation", () => {
  it("renders path-only hits as one actionable header without arbitrary chunk evidence", () => {
    const hit = semanticHit();
    hit.repositoryEvidence!.bm25MatchFields = ["FILE_PATH"];
    hit.repositoryEvidence!.focusedSource =
      hit.repositoryEvidence!.matchedSource!;
    hit.repositoryEvidence!.matchedSource = null;
    const text = render(hit);
    expect(text).toBe(
      "1 result | 1 repo code hit\n\n[1] npm:pkg@1.2.3 src/client.ts [repo code, path match]",
    );
    expect(text).not.toContain("send");
    expect(text).not.toContain("142");
    expect(text).not.toContain("Snippet unavailable");
    hit.type = "repository_doc";
    hit.title = "Arbitrary heading";
    expect(render(hit)).toContain("src/client.ts [repo doc, path match]");
    expect(render(hit)).not.toContain("Arbitrary heading");
  });

  it.each([
    { fields: null },
    { fields: ["FILE_PATH"] },
    { fields: ["FILE_PATH", "SOURCE_IDENTIFIER"] },
  ] as const)(
    "keeps proven source independent of indexed provenance %j without captions",
    ({ fields }) => {
      const hit = semanticHit();
      hit.repositoryEvidence!.bm25MatchFields =
        fields === null ? null : [...fields];
      const text = render(hit);
      expect(text).toContain("src/client.ts:142-145 [repo code]");
      expect(text).toContain("> 143 |     return response;");
      expect(text).not.toContain("path match");
      expect(text).not.toContain("Matched source");
      expect(text).not.toContain("Indexed matches");
    },
  );

  it.each([
    { fields: null },
    { fields: ["SOURCE_IDENTIFIER"] },
    { fields: ["FILE_PATH", "DOCUMENTATION"] },
  ] as const)(
    "never promotes compatibility source to proof for provenance %j",
    ({ fields }) => {
      const hit = semanticHit();
      hit.repositoryEvidence!.bm25MatchFields =
        fields === null ? null : [...fields];
      hit.repositoryEvidence!.focusedSource =
        hit.repositoryEvidence!.matchedSource!;
      hit.repositoryEvidence!.matchedSource = null;
      const text = render(hit);
      expect(text).toContain("Snippet unavailable");
      expect(text).toContain("- method Client.send");
      expect(text).not.toContain("return response");
      expect(text).not.toContain("LEGACY SOURCE");
      expect(text).not.toContain("path match");
    },
  );

  it("does not render a repository summary when an older injected service has no evidence", () => {
    const hit = semanticHit();
    delete hit.repositoryEvidence;
    expect(render(hit)).toContain("Snippet unavailable");
    expect(render(hit)).not.toContain("LEGACY SOURCE");
  });

  it("uses matched bounds even when compatibility source describes a different range", () => {
    const hit = semanticHit();
    hit.repositoryEvidence!.focusedSource = {
      ...hit.repositoryEvidence!.matchedSource!,
      startLine: 900,
      endLine: 910,
      lines: [],
    };
    expect(render(hit)).toContain("src/client.ts:142-145");
    expect(render(hit)).not.toContain(":900-910");
  });

  it.each(["## é👩‍💻", "é👩‍💻\n======"])(
    "converts preview graphemes before trimming a duplicate heading: %s",
    (heading) => {
      const hit = semanticHit();
      hit.type = "documentation_page";
      hit.title = "é👩‍💻";
      hit.repositoryEvidence = null;
      const preview = `${heading}\n\né👩‍💻 target after`;
      const segmenter = new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      });
      const start = [
        ...segmenter.segment(preview.slice(0, preview.indexOf("target"))),
      ].length;
      hit.documentationPreview = {
        text: preview,
        highlights: [[start, start + 6]],
      };
      const plain = render(hit);
      const colored = render(hit, true);
      expect(plain).toContain("  é👩‍💻 target after");
      expect(plain).not.toContain("LEGACY SOURCE");
      expect(plain).not.toContain("======");
      expect(colored).toContain(
        `é👩‍💻 ${colors.bold}${colors.yellow}target${colors.reset} after`,
      );
      expect(Bun.stripANSI(colored)).toBe(plain);
    },
  );

  it("wraps a preview highlight across lines and preserves empty highlight lists", () => {
    const hit = semanticHit();
    hit.type = "documentation_page";
    hit.repositoryEvidence = null;
    hit.title = "Heading";
    hit.documentationPreview = {
      text: `🙂 ${"matched ".repeat(10).trim()}`,
      highlights: [[2, 81]],
    };
    const colored = render(hit, true);
    expect(
      colored
        .split("\n")
        .filter((line) => line.includes(`${colors.yellow}matched`)).length,
    ).toBeGreaterThan(1);
    hit.documentationPreview.highlights = [];
    const plain = render(hit);
    expect(plain).toContain("🙂 matched");
    expect(plain).not.toContain("LEGACY SOURCE");
    hit.documentationPreview = null;
    expect(render(hit)).not.toContain("LEGACY SOURCE");
    expect(render(hit)).not.toContain("Snippet unavailable");
  });
});
