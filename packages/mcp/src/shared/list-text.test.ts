import { describe, expect, it } from "bun:test";
import type { ListParams, ListResult } from "@githits/core-internal";
import { formatListText } from "./list-text.js";

function sourceResult(overrides: Partial<ListResult> = {}): ListResult {
  return {
    inventoryKind: "SOURCE",
    requestedTarget: "github:example/repo@main",
    canonicalTarget: "github:example/repo@main",
    entries: [],
    hasMore: false,
    nextCursor: null,
    indexedVersion: "main",
    codeIndexState: "CURRENT",
    indexingStatus: "COMPLETED",
    indexingRef: null,
    inventoryState: null,
    crawlStatus: null,
    coverageState: null,
    coverageReason: null,
    preparation: null,
    ...overrides,
  };
}

function siteResult(overrides: Partial<ListResult> = {}): ListResult {
  return {
    inventoryKind: "SITE",
    requestedTarget: "site:docs.example.test/api",
    canonicalTarget: "site:docs.example.test/api",
    entries: [],
    hasMore: false,
    nextCursor: null,
    indexedVersion: null,
    codeIndexState: null,
    indexingStatus: null,
    indexingRef: null,
    inventoryState: "AVAILABLE",
    crawlStatus: "COMPLETE",
    coverageState: "COMPLETE",
    coverageReason: null,
    preparation: null,
    ...overrides,
  };
}

function params(overrides: Partial<ListParams> = {}): ListParams {
  return {
    target: "github:example/repo@main",
    includeDetailedFields: false,
    ...overrides,
  };
}

function options(
  overrides: Partial<Parameters<typeof formatListText>[2]> = {},
): Parameters<typeof formatListText>[2] {
  return {
    surface: "mcp",
    verbose: false,
    useColors: false,
    ...overrides,
  };
}

function file(
  path: string,
  target: string,
  readPath: string,
): ListResult["entries"][number] {
  return {
    kind: "FILE",
    path,
    title: null,
    read: { target, path: readPath },
    browse: null,
  };
}

describe("formatListText", () => {
  it("compares repository root and package subtree actions without totals", () => {
    const pinnedTarget = `github:example/repo@${"a".repeat(120)}`;
    const repositoryRoot = sourceResult({
      requestedTarget: "github:example/repo",
      canonicalTarget: "github:example/repo@main",
      entries: [
        file("src/display-a.ts", pinnedTarget, "src/a%2Fb.ts"),
        file("src/display-b.ts", pinnedTarget, "src/b.ts"),
        {
          kind: "DIRECTORY",
          path: "docs",
          title: null,
          read: null,
          browse: {
            target: "github:example/repo@main",
            paths: ["docs/O'Reilly.md"],
          },
        },
      ],
    });
    const packageSubtree = sourceResult({
      requestedTarget: "npm:@example/pkg@2.0.0",
      canonicalTarget: null,
      entries: [
        {
          kind: "DIRECTORY",
          path: "docs",
          title: null,
          read: null,
          browse: null,
        },
      ],
    });

    const rootText = formatListText(
      repositoryRoot,
      params({ target: "github:example/repo" }),
      options({ width: 140 }),
    );
    expect(rootText).toContain('requested="github:example/repo"');
    expect(rootText).toContain('canonical="github:example/repo@main"');
    expect(rootText).toContain(
      `Read target: read target=${JSON.stringify(pinnedTarget)}`,
    );
    expect(rootText).toContain('read path="src/a%2Fb.ts"');
    expect(rootText).toContain('read path="src/b.ts"');
    expect(rootText).toContain(
      'browse: list target="github:example/repo@main" paths=["docs/O\'Reilly.md"]',
    );
    expect(rootText).not.toContain("total");
    const cliRootText = formatListText(
      repositoryRoot,
      params({ target: "github:example/repo" }),
      options({ surface: "cli" }),
    );
    expect(cliRootText).toContain(
      `browse: githits list 'github:example/repo@main' 'docs/O'"'"'Reilly.md'`,
    );

    const packageText = formatListText(
      packageSubtree,
      params({ target: "npm:@example/pkg@2.0.0" }),
      options(),
    );
    expect(packageText).toContain("canonical=null");
    expect(packageText).toContain("DIRECTORY");
    expect(packageText).not.toContain("browse:");

    const repeated = sourceResult({
      entries: repositoryRoot.entries
        .slice(0, 2)
        .map((entry, index) =>
          file(
            entry.path,
            `${pinnedTarget}-${index}`,
            entry.read?.path ?? entry.path,
          ),
        ),
    });
    const repeatedText = formatListText(repeated, params(), options());
    expect(rootText.length).toBeLessThan(repeatedText.length);
    expect(rootText.match(new RegExp(pinnedTarget, "g"))).toHaveLength(1);
  });

  it("renders recursive glob actions and exact continuation replay for both surfaces", () => {
    const cursor = "next/'cursor' $opaque;*";
    const recursive = sourceResult({
      entries: [
        {
          ...file("docs/雪%2Fguide.md", "npm:pkg@5.2.1", "docs/雪%2Fguide.md"),
          language: "TypeScript",
          fileType: "documentation",
          intent: "TEST",
          byteSize: 42,
          lineCount: null,
          contentHash: null,
        },
      ],
      hasMore: true,
      nextCursor: cursor,
      resolution: {
        requestedVersion: null,
        requestedRef: "v1",
        resolvedRef: "v1",
        commitSha: null,
      },
      targetResolution: {
        requested: null,
        resolvedRequested: null,
        served: null,
        freshness: "current",
        freshnessReason: null,
        indexingRef: null,
        availableVersions: null,
        availableRefs: [],
        suggestedRefs: [{ version: null, ref: "v2" }],
      },
      availableVersions: [{ version: null, ref: "v1" }],
      indexingEstimate: {
        lowerSeconds: null,
        upperSeconds: null,
        elapsedSeconds: null,
        sampleCount: null,
        source: "same_repository_refs",
      },
    });
    const request = params({
      target: "github:example/repo@v1",
      paths: ["**/*.md", "docs/O'Reilly.md"],
      recursive: true,
      fileTypes: ["documentation", "source"],
      languages: ["TypeScript"],
      intents: ["TEST"],
      limit: 25,
      after: "old cursor",
      waitTimeoutMs: 0,
      includeDetailedFields: true,
    });

    const cliText = formatListText(
      recursive,
      request,
      options({ surface: "cli", verbose: true }),
    );
    expect(cliText).toContain(
      "githits read 'npm:pkg@5.2.1' 'docs/雪%2Fguide.md'",
    );
    expect(cliText).toContain('language="TypeScript"');
    expect(cliText).toContain("lineCount=null");
    expect(cliText).toContain("resolution={requestedVersion=null");
    expect(cliText).toContain("targetResolution={requested=null");
    expect(cliText).toContain('availableVersions=[{version=null, ref="v1"}]');
    expect(cliText).toContain("indexingEstimate={lowerSeconds=null");
    expect(cliText).toContain(
      `Continue: githits list 'github:example/repo@v1' '**/*.md' 'docs/O'"'"'Reilly.md' --recursive --file-type 'documentation' --file-type 'source' --language 'TypeScript' --intent 'TEST' --limit 25 --after 'next/'"'"'cursor'"'"' $opaque;*' --wait 0 --verbose`,
    );
    expect(cliText).not.toContain("old cursor");

    const mcpText = formatListText(recursive, request, options());
    expect(mcpText).toContain(
      `Continue: list target="github:example/repo@v1" paths=["**/*.md", "docs/O'Reilly.md"] recursive=true file_types=["documentation", "source"] languages=["TypeScript"] intents=["TEST"] limit=25 after=${JSON.stringify(cursor)} wait_timeout_ms=0`,
    );
    expect(mcpText).not.toContain("old cursor");
    expect(mcpText).toContain('FILE "docs/雪%2Fguide.md"');
  });

  it("keeps a landing page title and both exact read and browse actions on one row", () => {
    const site = siteResult({
      entries: [
        {
          kind: "PAGE",
          path: "docs.example.test/api/",
          title: "API 雪",
          read: {
            target: "https://docs.example.test/api/?lang=en%2Fja#intro",
            path: null,
          },
          browse: {
            target: "site:docs.example.test",
            paths: ["docs.example.test/api/"],
          },
        },
      ],
      inventoryState: "EMPTY",
      crawlStatus: "RUNNING",
      coverageState: "PARTIAL",
      coverageReason: "refresh_pending",
      preparation: {
        selected: 3,
        enqueued: 1,
        activeJobs: [{ mode: "incremental_recrawl", state: "FAILED" }],
        awaited: [{ mode: null, outcome: "TIMEOUT" }],
      },
    });
    const text = formatListText(
      site,
      params({ target: "site:docs.example.test/api" }),
      options(),
    );

    const pageRow = text.split("\n").find((line) => line.startsWith("PAGE "));
    expect(pageRow).toContain('title="API 雪"');
    expect(pageRow).toContain(
      'read: read target="https://docs.example.test/api/?lang=en%2Fja#intro"',
    );
    expect(pageRow).toContain(
      'browse: list target="site:docs.example.test" paths=["docs.example.test/api/"]',
    );
    expect(text).toContain(
      'Site lifecycle: inventory="EMPTY" crawl="RUNNING" coverage="PARTIAL" reason="refresh_pending" preparation=selected=3 enqueued=1 activeJobs=["incremental_recrawl"/"FAILED"] awaited=[null/"TIMEOUT"]',
    );
  });

  it("keeps site EMPTY, RUNNING or FAILED, and PARTIAL or CAPPED states distinct", () => {
    for (const [crawlStatus, coverageState] of [
      ["RUNNING", "PARTIAL"],
      ["FAILED", "CAPPED"],
    ] as const) {
      const text = formatListText(
        siteResult({
          entries: [],
          inventoryState: "EMPTY",
          crawlStatus,
          coverageState,
          preparation: {
            selected: 0,
            enqueued: 0,
            activeJobs: [],
            awaited: [],
          },
        }),
        params({ target: "site:docs.example.test/api" }),
        options(),
      );
      expect(text).toContain("No pages are currently listed.");
      expect(text).toContain('inventory="EMPTY"');
      expect(text).toContain(`crawl="${crawlStatus}"`);
      expect(text).toContain(`coverage="${coverageState}"`);
      expect(text).not.toContain("not found");
    }
  });

  it("distinguishes an empty source inventory that is still indexing", () => {
    const text = formatListText(
      sourceResult({
        entries: [],
        codeIndexState: "CURRENT",
        indexingStatus: "INDEXING",
        indexingRef: "index-雪",
      }),
      params(),
      options({ verbose: true }),
    );
    expect(text).toContain(
      "Source index is INDEXING; no entries are available yet.",
    );
    expect(text).toContain('indexingStatus="INDEXING"');
    expect(text).toContain('indexingRef="index-雪"');
    expect(text).not.toContain("No entries matched.");
  });

  it("sanitizes control sequences without losing Unicode or encoded paths", () => {
    const value = "docs/雪%2Fguide\n\u001b[31m";
    const text = formatListText(
      sourceResult({ entries: [file(value, "npm:pkg", value)] }),
      params(),
      options({ width: 1 }),
    );
    expect(text).toContain("雪%2Fguide");
    expect(text).toContain("\\u{a}");
    expect(text).toContain("\\u{1b}[31m");
    expect(text).not.toContain("\u001b");
  });
});
