import { describe, expect, it } from "bun:test";
import { projectUnifiedSearchPresentation } from "./unified-search-presentation.js";
import type {
  UnifiedSearchCompletedPresentation,
  UnifiedSearchSourceStatusPayload,
} from "./unified-search-response.js";
import { renderUnifiedSearchStatusText } from "./unified-search-status-text.js";
import { renderUnifiedSearchSuccess } from "./unified-search-text.js";

const target = "github:torvalds/linux";
const repoUrl = "https://github.com/torvalds/linux";
const sha = "067c5c24cef23d913b67eaaf71ae67e7169a6620";

function source(
  sourceKind: string = "code",
  commitSha: string = sha,
): UnifiedSearchSourceStatusPayload {
  return {
    source: sourceKind,
    targetLabel: target,
    resultCount: 1,
    codeIndexState: "CURRENT",
    targetResolution: {
      served: {
        repoUrl,
        commitSha,
        gitRef: "HEAD",
        committedAt: "2026-11-10T00:00:00Z",
      },
      freshness: "current",
      availableVersions: [],
      availableRefs: [],
    },
  };
}

function payload(
  sources: UnifiedSearchSourceStatusPayload[] = [source()],
): UnifiedSearchCompletedPresentation {
  return {
    completed: true,
    partialResults: false,
    hasMore: true,
    nextOffset: 10,
    query: { raw: "mutex" },
    sourceStatus: sources,
    results: [
      {
        type: "repository_code",
        target,
        locator: {
          repoUrl,
          commitSha: sha,
          filePath: "mutex.h",
          startLine: 42,
          endLine: 42,
        },
        readTarget: {
          target: `${target}@${sha}`,
          path: "mutex.h",
          startLine: 42,
          endLine: 42,
        },
      },
    ],
  };
}

function texts(value: UnifiedSearchCompletedPresentation): string[] {
  return [
    renderUnifiedSearchSuccess(value),
    renderUnifiedSearchStatusText({
      completed: true,
      searchRef: "stored",
      result: value,
    }),
  ];
}

function sourcesSection(text: string): string {
  return text.split("Sources:\n")[1]?.split("\n\n")[0] ?? "";
}

describe("compact search provenance", () => {
  it("shows the Linux snapshot once without a zero-hit docs category", () => {
    const docs = source("docs");
    docs.contributors = [
      {
        kind: "REPOSITORY_DOCS",
        state: "SEARCHED",
        resultCount: 0,
        repositoryUrl: repoUrl,
        commitSha: sha,
      },
    ];
    const value = payload([docs, source()]);
    for (const width of [40, 80])
      for (const useColors of [false, true]) {
        const text = renderUnifiedSearchSuccess(value, { width, useColors });
        expect(sourcesSection(text).replace(/\s+/g, " ")).toBe(
          " - github:torvalds/linux@067c5c24 (committed 2026-11-10, indexed from ref HEAD)",
        );
        expect(text).toContain("mutex.h:42");
        expect(text).toContain("More results:");
        expect(text).toContain("offset=10");
        expect(text).toContain('path="mutex.h" start_line=42 end_line=42');
      }
    expect(sourcesSection(texts(value)[1]!)).toBe(
      sourcesSection(texts(value)[0]!),
    );
  });

  it("coalesces positive docs/code/symbol sources and fills only matching metadata", () => {
    const docs = source("docs");
    docs.targetResolution!.served!.gitRef = undefined;
    docs.targetResolution!.served!.committedAt = undefined;
    docs.contributors = [
      {
        kind: "REPOSITORY_DOCS",
        state: "SEARCHED",
        resultCount: 1,
        repositoryUrl: repoUrl,
        commitSha: sha,
      },
    ];
    const value = payload([docs, source(), source("symbol")]);
    value.results.push(
      { ...value.results[0]!, type: "repository_doc" },
      { ...value.results[0]!, type: "repository_symbol" },
    );
    const model = projectUnifiedSearchPresentation(value);
    expect(model.sourceRows).toHaveLength(1);
    expect(model.sourceRows[0]!.identity).toMatchObject({
      repoUrl,
      commitSha: sha,
      gitRef: "HEAD",
      committedAt: "2026-11-10T00:00:00Z",
    });
    expect(model.provenance).toHaveLength(3);
  });

  it("keeps distinct full SHAs despite identical display prefixes", () => {
    const other = "067c5c24" + "a".repeat(32);
    const value = payload([source(), source("code", other)]);
    value.results.push({
      ...value.results[0]!,
      locator: { repoUrl, commitSha: other },
    });
    expect(projectUnifiedSearchPresentation(value).sourceRows).toHaveLength(2);
  });

  it("keeps meaningful requested refs but merges equivalent unqualified spellings", () => {
    const value = payload([
      source(),
      { ...source(), targetLabel: `${target}@HEAD` },
    ]);
    value.results.push({ ...value.results[0]!, target: `${target}@HEAD` });
    expect(projectUnifiedSearchPresentation(value).sourceRows).toHaveLength(1);
    value.sourceStatus![1]!.targetLabel = `${target}@v1`;
    value.results[1]!.target = `${target}@v1`;
    expect(projectUnifiedSearchPresentation(value).sourceRows).toHaveLength(2);
    expect(
      projectUnifiedSearchPresentation(value).sourceRows[1]!.qualifiers,
    ).toContain(`requested: ${target}@v1`);
  });

  it.each(["gitRef", "committedAt"] as const)(
    "keeps conflicting %s facts separate",
    (field) => {
      const second = source();
      second.targetResolution!.served![field] =
        field === "gitRef" ? "main" : "2026-11-09T00:00:00Z";
      expect(
        projectUnifiedSearchPresentation(payload([source(), second]))
          .sourceRows,
      ).toHaveLength(2);
    },
  );

  it("coalesces exact package rows without manufacturing a repository identity", () => {
    const first = {
      source: "code",
      targetLabel: "npm:one@1.0.0",
      resultCount: 1,
      codeIndexState: "CURRENT",
    };
    const value = payload([first, { ...first, source: "symbol" }]);
    value.results = [
      { type: "repository_code", target: first.targetLabel, locator: {} },
      { type: "repository_symbol", target: first.targetLabel, locator: {} },
    ];
    expect(projectUnifiedSearchPresentation(value).sourceRows).toEqual([
      { target: first.targetLabel, identity: undefined, qualifiers: [] },
    ]);
  });

  it("coalesces exact site identities and keeps different sites separate", () => {
    const docs = source("docs");
    docs.targetLabel = "npm:one@1.0.0";
    const contributor = {
      kind: "DOCPACK" as const,
      state: "SEARCHED" as const,
      resultCount: 1,
      siteUrl: "https://docs.example.com",
    };
    docs.contributors = [
      contributor,
      { ...contributor },
      { ...contributor, siteUrl: "https://other.example.com" },
    ];
    const value = payload([docs]);
    value.results = [
      "https://docs.example.com",
      "https://other.example.com",
    ].map((sourceUrl) => ({
      type: "documentation_page",
      target: docs.targetLabel,
      locator: { sourceUrl },
    }));
    expect(projectUnifiedSearchPresentation(value).sourceRows).toHaveLength(2);
  });

  it.each([false, true])(
    "omits Sources on empty current pages (hasMore=%s)",
    (hasMore) => {
      const empty = source();
      empty.resultCount = 0;
      const value = { ...payload([empty]), results: [], hasMore };
      for (const text of texts(value)) {
        expect(text).not.toContain("Sources:");
        expect(text).not.toContain("commit:");
        expect(text).toStartWith(
          hasMore ? "No results on this page." : "No results found.",
        );
      }
    },
  );

  it("discloses older empty snapshots even with no observed requested SHA", () => {
    const empty = source();
    empty.resultCount = 0;
    empty.targetResolution!.freshness = "fallback_recent";
    const value = { ...payload([empty]), results: [] };
    for (const text of texts(value)) {
      expect(text).not.toContain("Sources:");
      expect(text.replace(/\s+/g, " ")).toContain(
        "commit: github:torvalds/linux@067c5c24",
      );
      expect(text).toContain("older snapshot");
      expect(text).not.toContain("\n\nRead:");
      expect(text).not.toContain("search_status");
    }
  });

  it.each(["PARTIAL", "CAPPED"])(
    "retains zero-hit hosted %s coverage beside code hits",
    (coverageState) => {
      const docs = source("docs");
      const code = source();
      docs.targetLabel = code.targetLabel = "npm:one@1.0.0";
      docs.contributors = [
        {
          kind: "DOCPACK",
          state: "SEARCHED",
          resultCount: 0,
          siteUrl: "https://docs.example.com",
          coverage: { coverageState, pagesCrawled: 120 },
        },
      ];
      const value = payload([code, docs]);
      value.results[0]!.target = code.targetLabel;
      for (const text of texts(value)) {
        expect(sourcesSection(text).match(/ {2}- /g)).toHaveLength(1);
        expect(sourcesSection(text)).not.toContain("docs.example.com");
        expect(text.replace(/\s+/g, " ")).toContain(
          `docs.example.com docs (120 pages; ${coverageState.toLowerCase()})`,
        );
        expect(text.match(/120 pages/g)).toHaveLength(1);
      }
    },
  );
});
