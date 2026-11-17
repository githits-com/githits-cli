import { describe, expect, it } from "bun:test";
import type {
  UnifiedSearchOutcome,
  UnifiedSearchParams,
} from "@githits/core-internal";
import { defaultUnifiedSearchOutcome } from "../services/test-helpers.js";
import {
  buildSourceStatusWarnings,
  buildUnifiedSearchStatusPayload,
  buildUnifiedSearchSuccessPayload,
  type UnifiedSearchSourceStatusPayload,
} from "./unified-search-response.js";
import { renderUnifiedSearchSuccess } from "./unified-search-text.js";

const target = "maven:com.google.guava:guava@33.4.0-jre";
const wikiSha = "6a1a9624e5f144d5a1b3acaf3acde1a479e23419";
const readTarget = {
  target: `github:google/guava.wiki@${wikiSha}`,
  path: "MapMakerMigration.md",
  startLine: 50,
  endLine: 52,
};
const params: UnifiedSearchParams = {
  targets: [
    {
      registry: "MAVEN",
      packageName: "com.google.guava:guava",
      version: "33.4.0-jre",
    },
  ],
  query: "MapMaker",
  sources: ["DOCS"],
};

// Minimal replay of the captured completed Guava main+wiki response. Pair-level
// lifecycle can remain PENDING while both selected contributors were searched.
function guavaOutcome(state: string, completed = true): UnifiedSearchOutcome {
  if (defaultUnifiedSearchOutcome.state !== "completed") {
    throw new Error("expected completed fixture");
  }
  const result = {
    ...defaultUnifiedSearchOutcome.result,
    page: { ...defaultUnifiedSearchOutcome.result.page },
    query: "MapMaker",
    sources: ["DOCS" as const],
    results: [
      {
        id: "wiki-mapmaker",
        resultType: "REPOSITORY_DOC" as const,
        targetLabel: target,
        readTarget,
        locator: {
          pageId: "mapmaker-migration",
          repoUrl: "https://github.com/google/guava.wiki",
          commitSha: wikiSha,
          filePath: readTarget.path,
          startLine: 50,
          endLine: 52,
        },
      },
    ],
    sourceStatus: [
      {
        ...defaultUnifiedSearchOutcome.result.sourceStatus[0]!,
        source: "DOCS" as const,
        targetLabel: target,
        indexingStatus: state,
        codeIndexState: undefined,
        targetResolution: {
          freshness: "current" as const,
          availableVersions: [],
          availableRefs: [],
        },
        contributors: [
          {
            kind: "REPOSITORY_DOCS" as const,
            state: "SEARCHED" as const,
            freshness: "CURRENT" as const,
            resultCount: 0,
            repositoryUrl: "https://github.com/google/guava",
            commitSha: "5c71d2a15435399fa62508d807d5cc83506f7496",
          },
          {
            kind: "REPOSITORY_DOCS" as const,
            state: "SEARCHED" as const,
            freshness: "CURRENT" as const,
            resultCount: 1,
            repositoryUrl: "https://github.com/google/guava.wiki",
            commitSha: wikiSha,
          },
        ],
      },
    ],
  };
  return completed
    ? { state: "completed", completed: true, searchRef: "guava-search", result }
    : {
        state: "incomplete",
        completed: false,
        searchRef: "guava-search",
        result,
        progress: {
          searchRef: "guava-search",
          status: "INDEXING",
          targetsTotal: 1,
          targetsReady: 0,
          elapsedMs: 10,
          query: "MapMaker",
          queryWarnings: [],
          sources: ["DOCS"],
        },
      };
}

describe("source preparation warnings", () => {
  for (const field of ["indexingStatus", "codeIndexState"] as const) {
    for (const state of ["PENDING", "INDEXING"]) {
      it(`${field} ${state} is silent when completed and retains active progress`, () => {
        const entry: UnifiedSearchSourceStatusPayload = {
          source: "docs",
          targetLabel: target,
          [field]: state,
        };
        expect(buildSourceStatusWarnings([entry], { completed: true })).toEqual(
          [],
        );
        expect(
          buildSourceStatusWarnings([entry], { completed: false }),
        ).toEqual([
          `Source 'docs' for ${target}: ${field === "indexingStatus" ? "indexing status" : "code index state"} ${state}`,
        ]);
      });
    }
    it(`${field} retains failed and unknown terminal warnings`, () => {
      for (const state of ["FAILED", "UNRESOLVABLE", "FUTURE_STATE"]) {
        for (const completed of [true, false]) {
          expect(
            buildSourceStatusWarnings(
              [{ source: "docs", targetLabel: target, [field]: state }],
              { completed },
            ),
          ).toEqual([`Source 'docs' for ${target}: status ${state}`]);
        }
      }
    });
  }
  it("does not mix queued progress into a genuine terminal failure", () => {
    expect(
      buildSourceStatusWarnings(
        [
          {
            source: "docs",
            targetLabel: target,
            indexingStatus: "PENDING",
            codeIndexState: "FAILED",
          },
        ],
        { completed: true },
      ),
    ).toEqual([`Source 'docs' for ${target}: status FAILED`]);
  });

  for (const state of ["PENDING", "INDEXING"]) {
    for (const completed of [true, false]) {
      it(`${state}, completed=${completed}: initial/status preserve wiki evidence and native actions`, () => {
        const outcome = guavaOutcome(state, completed);
        const initial = buildUnifiedSearchSuccessPayload(
          params,
          "MapMaker",
          "MapMaker",
          outcome,
        );
        const status = buildUnifiedSearchStatusPayload(outcome);
        if (!status.result) throw new Error("expected disclosed result");
        expect(status.result.sourceStatus).toEqual(initial.sourceStatus);
        expect(status.result.warnings).toEqual(initial.warnings);
        expect(initial.sourceStatus?.[0]?.contributors).toEqual(
          outcome.result?.sourceStatus[0]?.contributors,
        );
        expect(initial.results[0]?.readTarget).toEqual(readTarget);
        expect(status.result.results[0]?.readTarget).toEqual(readTarget);
        if (completed) {
          expect(initial.warnings).toBeUndefined();
          expect(initial.sourceStatus?.[0]).not.toHaveProperty(
            "indexingStatus",
          );
        } else {
          expect(initial.sourceStatus?.[0]?.indexingStatus).toBe(state);
          expect(initial.warnings).toEqual([
            `Source 'docs' for ${target}: indexing status ${state}`,
          ]);
        }
        for (const actionSyntax of ["cli", "mcp"] as const) {
          const text = renderUnifiedSearchSuccess(initial, {
            actionSyntax,
            width: 160,
          });
          expect(text).toContain("google/guava.wiki@");
          expect(text).toContain(readTarget.path);
          expect(text).not.toContain(`: status ${state}`);
          if (completed)
            expect(text).not.toContain(
              actionSyntax === "cli" ? "search-status" : "search_status",
            );
          else
            expect(text).toContain(
              actionSyntax === "cli" ? "search-status" : "search_status",
            );
        }
      });
    }
  }

  it("suppresses completed code preparation fields while retaining empty-result context", () => {
    for (const state of ["PENDING", "INDEXING"]) {
      const outcome = guavaOutcome(state);
      if (outcome.state !== "completed")
        throw new Error("expected completed result");
      outcome.result.sourceStatus[0]!.codeIndexState = state;
      outcome.result.sourceStatus[0]!.contributors = [];
      const withHits = buildUnifiedSearchSuccessPayload(
        params,
        "MapMaker",
        "MapMaker",
        outcome,
      );
      expect(withHits.sourceStatus?.[0]?.codeIndexState).toBeUndefined();
      expect(withHits.warnings).toBeUndefined();
      outcome.result.results = [];
      outcome.result.page.returned = 0;
      outcome.result.sourceStatus[0]!.resultCount = 0;
      const empty = buildUnifiedSearchSuccessPayload(
        params,
        "MapMaker",
        "MapMaker",
        outcome,
      );
      expect(empty.sourceStatus?.[0]).toMatchObject({
        indexingStatus: state,
        codeIndexState: state,
        resultCount: 0,
      });
      expect(empty.warnings).toBeUndefined();
    }
  });
});
