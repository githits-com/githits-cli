import { describe, expect, it } from "bun:test";
import type {
  GrepHit,
  GrepLineSlice,
  GrepResult,
  GrepTargetStatus,
} from "@githits/core-internal";
import { parseGrepResult } from "../../../core-internal/src/services/grep-service.js";
import mixed100 from "./fixtures/grep-text/mixed-100.json";
import { formatGrepText } from "./grep-text.js";

interface HitGroup {
  hits: GrepHit[];
}

describe("grep text formatting", () => {
  it("groups an interleaved page by exact file identity while preserving JSON occurrence order", () => {
    const parsedOriginal = parseGrepResult(mixed100);
    const formattedInput = parseGrepResult(mixed100);
    const rendered = formatGrepText(formattedInput, {
      useColors: false,
      width: 80,
      syntax: "cli",
    });
    expect(formattedInput).toEqual(parsedOriginal);
    expect(JSON.stringify(formattedInput)).toBe(JSON.stringify(parsedOriginal));
    expect(formattedInput.hits).toHaveLength(100);
    expect(parsedOriginal.nextCursor).not.toBeNull();

    const scopes = new Map<number, GrepTargetStatus>(
      parsedOriginal.targets.map((scope) => [scope.targetIndex, scope]),
    );
    const groups = new Map<string, HitGroup>();
    for (const hit of parsedOriginal.hits) {
      const key = fileIdentity(hit);
      const group = groups.get(key);
      if (group) group.hits.push(hit);
      else groups.set(key, { hits: [hit] });
    }
    expect(groups.size).toBe(8);

    const firstHostedHit = parsedOriginal.hits.findIndex(
      (hit) => scopes.get(hit.targetIndex)?.kind === "SITE",
    );
    const lastRepositoryHit = parsedOriginal.hits.reduce(
      (lastIndex, hit, index) =>
        scopes.get(hit.targetIndex)?.kind === "REPOSITORY" ? index : lastIndex,
      -1,
    );
    expect(firstHostedHit).toBeGreaterThanOrEqual(0);
    expect(lastRepositoryHit).toBeGreaterThan(firstHostedHit);

    const lines = rendered.split("\n");
    const expectedHeaders = [
      "[1] https://github.com/expressjs/express@dbac741a49a5a64336b70c06e85c2e2706e36336 History.md",
      "[2] https://expressjs.com/en/3x/api/application/",
      "[3] https://expressjs.com/en/4x/api/",
      "[4] https://expressjs.com/en/4x/api/application/",
      "[5] https://expressjs.com/en/4x/api/express/",
      "[6] https://github.com/expressjs/express@dbac741a49a5a64336b70c06e85c2e2706e36336 examples/README.md",
      "[7] https://github.com/expressjs/express@dbac741a49a5a64336b70c06e85c2e2706e36336 lib/application.js",
      "[8] https://expressjs.com/en/4x/api/request/",
    ] as const;
    expect(lines.filter((line) => /^\[\d+\] /.test(line))).toEqual([
      ...expectedHeaders,
    ]);
    expect(lines.filter((line) => line.startsWith("# source ["))).toHaveLength(
      0,
    );
    const normalizedText = rendered.replace(/\s+/g, " ");
    expect(normalizedText).toContain(
      "Sources: - github:expressjs/express@dbac741a - site:expressjs.com (hosted documentation)",
    );
    expect(normalizedText.match(/site:expressjs\.com/g) ?? []).toHaveLength(1);
    expect(
      lines.filter((line) => line.startsWith("# Read files:")),
    ).toHaveLength(1);
    expect(
      lines.filter((line) => line.startsWith("# Read pages:")),
    ).toHaveLength(1);
    expect(rendered).not.toContain("Read recipes");
    expect(rendered).not.toContain("Hosted page reads");
    const expectedRows = new Map<string, number>();
    let distinctWindowCount = 0;
    for (const group of groups.values()) {
      const windows = new Map<string, GrepHit>();
      for (const hit of group.hits)
        windows.set(
          JSON.stringify([
            hit.line,
            hit.lineSlice.startByte,
            hit.lineSlice.endByte,
            hit.lineSlice.content,
          ]),
          hit,
        );
      distinctWindowCount += windows.size;

      const lineNumbers = group.hits.flatMap((hit) => [
        ...hit.contextBeforeSlices.map(
          (_, index) => hit.line - hit.contextBeforeSlices.length + index,
        ),
        hit.line,
        ...hit.contextAfterSlices.map((_, index) => hit.line + index + 1),
      ]);
      const gutterWidth = Math.max(
        ...lineNumbers.map((line) => String(line).length),
      );
      for (const hit of windows.values())
        increment(
          expectedRows,
          `${String(hit.line).padStart(gutterWidth)}: ${renderedSlice(hit.lineSlice)}`,
        );
    }
    expect(distinctWindowCount).toBeLessThan(parsedOriginal.hits.length);

    const matchingRows = lines.filter((line) => /^\s*\d+: /.test(line));
    const finalMatchingRowIndex = lines.reduce(
      (lastIndex, line, index) => (/^\s*\d+: /.test(line) ? index : lastIndex),
      -1,
    );
    expect(
      lines.findIndex((line) => line.startsWith("  --cursor ")),
    ).toBeGreaterThan(finalMatchingRowIndex);
    expect(sortedCounts(countValues(matchingRows))).toEqual(
      sortedCounts(expectedRows),
    );
    expect(matchingRows).toHaveLength(distinctWindowCount);
    expect(distinctWindowCount).toBe(81);
    expect(rendered).not.toMatch(/\(\d+ matches\)/);
  });

  it("does not repeat a site target as its own source identity", () => {
    const parsedOriginal = parseGrepResult(mixed100);
    const originalSiteScope = parsedOriginal.targets.find(
      (scope) => scope.kind === "SITE",
    );
    expect(originalSiteScope).toBeDefined();
    if (!originalSiteScope) throw new Error("Expected a hosted docs scope");

    const hostedHits = parsedOriginal.hits
      .filter(
        (hit) =>
          hit.__typename === "GrepSiteHit" &&
          hit.targetIndex === originalSiteScope.targetIndex,
      )
      .map((hit) => ({ ...hit, targetIndex: 0 }));
    expect(hostedHits.length).toBeGreaterThan(0);
    const requestedInputIndex = originalSiteScope.requestedInputIndices[0];
    expect(requestedInputIndex).toBeDefined();

    const siteOnlyResult: GrepResult = {
      ...parsedOriginal,
      indexingEstimates: [],
      hits: hostedHits,
      targets: [
        {
          ...originalSiteScope,
          targetIndex: 0,
          requestedInputIndices: [requestedInputIndex!],
          target: "site:expressjs.com",
          traversal: "COMPLETE",
        },
      ],
      totalMatches: hostedHits.length,
      traversal: "COMPLETE",
      nextCursor: null,
    };
    const rendered = formatGrepText(siteOnlyResult, {
      useColors: false,
      width: 80,
      syntax: "cli",
    });

    expect(
      rendered.split("\n").filter((line) => line.startsWith("  - ")),
    ).toEqual(["  - site:expressjs.com (hosted documentation)"]);
    expect(rendered).not.toContain(
      "Sources: site:expressjs.com - site:expressjs.com",
    );
    expect(rendered.match(/site:expressjs\.com/g) ?? []).toHaveLength(1);
  });

  it("separates pending package source from served hosted docs and keeps retry guidance at the end", () => {
    const original = parseGrepResult(mixed100);
    const site = original.targets.find((scope) => scope.kind === "SITE")!;
    const hits = original.hits.filter(
      (hit) => hit.targetIndex === site.targetIndex,
    );
    const target = "npm:express@1.0.2";
    const result: GrepResult = {
      ...original,
      targets: [{ ...site, target }],
      hits,
      totalMatches: hits.length,
      unavailableTargets: [
        {
          inputIndex: 0,
          target,
          reason: "repository_indexing",
          retryable: true,
          progressRef: "opaque-indexing-id",
          suggestedSiteTargets: null,
        },
      ],
      indexingEstimates: [
        {
          kind: "REPOSITORY",
          targets: [target],
          estimate: { lowerSeconds: 37, upperSeconds: 85 },
        },
      ],
    };
    const before = structuredClone(result);
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(result, { syntax, width: 160 });
      const lines = text.split("\n");
      const summary = `Sources:\n  - site:expressjs.com (hosted documentation)\n\nPreparing:\n  - ${target} (indexing, estimated total: 37-85s)`;
      expect(text).toContain(summary);
      expect(formatGrepText(result, { syntax, width: 80 })).toContain(summary);
      expect(text).not.toContain("Serving partial data.");
      expect(text).not.toContain("(requested:");
      expect(text).not.toContain("github:expressjs/express");
      expect(text).not.toContain("Run grep again");
      expect(text).not.toContain("Use the cursor below");
      expect(lines.at(-1)).toBe(
        `To retry omitted targets, rerun the original query with ${syntax === "cli" ? "--wait 100000" : "wait_timeout_ms=100000"}.`,
      );
      const cursor = syntax === "cli" ? "  --cursor " : "  cursor=";
      expect(
        lines.findIndex((line) => line.startsWith(cursor)),
      ).toBeGreaterThan(lines.findLastIndex((line) => /^\s*\d+: /.test(line)));
    }
    expect(result).toEqual(before);
  });

  it("lists resolved sources without matches with a page-specific explanation", () => {
    const original = parseGrepResult(mixed100);
    const site = original.targets.find((scope) => scope.kind === "SITE")!;
    const hits = original.hits.filter(
      (hit) => hit.targetIndex === site.targetIndex,
    );
    const text = formatGrepText(
      { ...original, hits, totalMatches: hits.length },
      { width: 160 },
    );
    expect(text).toContain("  - site:expressjs.com (hosted documentation)");
    expect(text).toContain(
      "  - github:expressjs/express@dbac741a (no results on this page)",
    );
  });

  it("lists unvisited scopes beside the matched source without duplicating coverage internals", () => {
    const original = parseGrepResult(mixed100);
    const repository = original.targets.find(
      (scope) => scope.kind === "REPOSITORY",
    )!;
    const site = original.targets.find((scope) => scope.kind === "SITE")!;
    const hit = original.hits.find(
      (hit) => hit.targetIndex === repository.targetIndex,
    )!;
    const result: GrepResult = {
      ...original,
      hits: [hit],
      totalMatches: 1,
      targets: [
        repository,
        {
          ...site,
          target: "npm:express@1.0.3",
          readiness: "UNSPECIFIED",
          traversal: "RESUMABLE_LIMIT",
        },
      ],
    };
    const before = structuredClone(result);
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(result, { syntax, width: 80 });
      expect(text).toContain(
        "Sources:\n  - github:expressjs/express@dbac741a\n  - site:expressjs.com (no results on this page, hosted documentation)",
      );
      expect(text).not.toContain("Hosted docs npm:");
      expect(text).not.toContain("not visited");
      expect(text).not.toContain("Omitted:");
      expect(text).not.toContain("To retry omitted targets");
      expect(text).toContain("More matches: repeat this grep, adding:");
      expect(text).toContain(syntax === "cli" ? "  --cursor " : "  cursor=");
    }
    expect(result).toEqual(before);
    const failed = formatGrepText({
      ...result,
      targets: [
        repository,
        {
          ...result.targets[1]!,
          traversal: "FAILED",
          errorCode: "docs_failed",
          publicMessage: "Could not search pages.",
        },
      ],
    });
    expect(failed).toContain("search failed");
    expect(failed).toContain("docs_failed");
    expect(failed.replace(/\s+/g, " ")).toContain("Could not search pages.");
    expect(failed).not.toContain("pages..");
  });

  it("combines page-result status for scopes sharing a resolved source", () => {
    const original = parseGrepResult(mixed100);
    for (const kind of ["SITE", "REPOSITORY"] as const) {
      const scope = original.targets.find((scope) => scope.kind === kind)!;
      const duplicate = {
        ...scope,
        targetIndex: 99,
        target: "npm:second-request",
        readiness: scope.readiness,
      };
      const hits = original.hits.filter(
        (hit) => hit.targetIndex === scope.targetIndex,
      );
      for (const targets of [
        [scope, duplicate],
        [duplicate, scope],
      ]) {
        for (const pageHits of [hits, []]) {
          const result: GrepResult = {
            ...original,
            targets,
            hits: pageHits,
            totalMatches: pageHits.length,
          };
          // The documented wire shape permits repeated resolved identities.
          expect(parseGrepResult(result).targets).toHaveLength(2);
          const bullets = formatGrepText(result, { width: 160 })
            .split("\n")
            .filter((line) => line.startsWith("  - "));
          expect(bullets).toHaveLength(1);
          expect(bullets[0]!.includes("no results on this page")).toBe(
            pageHits.length === 0,
          );
        }
      }
    }
  });

  it("keeps differing requested refs with one served source and combines their page results", () => {
    const original = parseGrepResult(mixed100);
    const repository = original.targets.find(
      (scope) => scope.kind === "REPOSITORY",
    )!;
    const fallback = {
      ...repository,
      targetIndex: 99,
      target: "npm:older-version",
      requestedRef: "a".repeat(40),
    };
    const hits = original.hits.filter(
      (hit) => hit.targetIndex === repository.targetIndex,
    );
    for (const targets of [
      [repository, fallback],
      [fallback, repository],
    ]) {
      for (const pageHits of [hits, []]) {
        const text = formatGrepText(
          {
            ...original,
            targets,
            hits: pageHits,
            totalMatches: pageHits.length,
          },
          { width: 160 },
        );
        const bullets = text
          .split("\n")
          .filter((line) => line.startsWith("  - "));
        expect(bullets).toHaveLength(1);
        expect(bullets[0]).toContain(
          "github:expressjs/express@dbac741a (requested: npm:older-version",
        );
        expect(bullets[0]!.includes("no results on this page")).toBe(
          pageHits.length === 0,
        );
      }
    }
  });

  it("wraps source and omission bullets under their text and distinguishes completed searches", () => {
    const original = parseGrepResult(mixed100);
    const site = original.targets.find((scope) => scope.kind === "SITE")!;
    const target = "npm:express@1.0.3";
    const result: GrepResult = {
      ...original,
      hits: [],
      totalMatches: 0,
      targets: [
        {
          ...site,
          canonicalSite: `https://${"a".repeat(64)}.test`,
          readiness: "UNSPECIFIED",
        },
      ],
      unavailableTargets: [
        {
          inputIndex: 0,
          target,
          reason: "repository_indexing",
          retryable: true,
          progressRef: null,
          suggestedSiteTargets: null,
        },
      ],
      indexingEstimates: [
        {
          kind: "REPOSITORY",
          targets: [target],
          estimate: { lowerSeconds: 33, upperSeconds: 85, elapsedSeconds: 90 },
        },
      ],
    };
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(result, { syntax, width: 80 });
      expect(text).toContain(
        `  - site:${"a".repeat(64)}.test\n    (no results on this page, hosted documentation)`,
      );
      expect(text).toContain(
        `  - ${target} (indexing, estimated total: 33-85s, time spent indexing:\n    90s)`,
      );
      expect(
        text
          .split("\n")
          .every((line) => line.length <= 80 || line.includes("cursor")),
      ).toBe(true);
      const complete: GrepResult = {
        ...result,
        targets: [{ ...site, readiness: "CURRENT", traversal: "COMPLETE" }],
        traversal: "COMPLETE",
        nextCursor: null,
        unavailableTargets: [],
        indexingEstimates: [],
      };
      expect(formatGrepText(complete, { syntax })).toContain(
        "No matches.\n\nSources:\n  - site:expressjs.com (no results, hosted documentation)",
      );
      expect(formatGrepText({ ...complete, targets: [] }, { syntax })).toBe(
        "No matches.",
      );
    }
  });

  it("keeps repository requests concise beside their served commit", () => {
    const original = parseGrepResult(mixed100);
    const repository = original.targets.find(
      (scope) => scope.kind === "REPOSITORY",
    )!;
    const hits = original.hits.filter(
      (hit) => hit.targetIndex === repository.targetIndex,
    );
    for (const target of [
      "github:expressjs/express",
      "https://github.com/expressjs/express@dbac741a49a5a64336b70c06e85c2e2706e36336",
    ]) {
      const text = formatGrepText(
        {
          ...original,
          targets: [{ ...repository, target }],
          hits,
          totalMatches: hits.length,
        },
        { width: 160 },
      );
      expect(text).toContain("  - github:expressjs/express@dbac741a");
      expect(text).not.toContain("(requested:");
    }
  });
  it("shows the requested repository target only when a different snapshot was served", () => {
    const original = parseGrepResult(mixed100);
    const repository = original.targets.find(
      (scope) => scope.kind === "REPOSITORY",
    )!;
    const hits = original.hits.filter(
      (hit) => hit.targetIndex === repository.targetIndex,
    );
    const target = "github:expressjs/express@v2";
    for (const { readiness, requestedRef, showRequested } of [
      { readiness: "CURRENT", requestedRef: "v2", showRequested: false },
      { readiness: "STALE", requestedRef: "v2", showRequested: false },
      {
        readiness: "STALE",
        requestedRef: repository.commitSha!,
        showRequested: false,
      },
      {
        readiness: "CURRENT",
        requestedRef: "a".repeat(40),
        showRequested: true,
      },
      { readiness: "STALE", requestedRef: "a".repeat(40), showRequested: true },
    ] as const) {
      const text = formatGrepText(
        {
          ...original,
          targets: [{ ...repository, target, requestedRef, readiness }],
          hits,
          totalMatches: hits.length,
        },
        { width: 160 },
      );
      const sources = text.split("\n").find((line) => line.startsWith("  - "));
      if (showRequested) {
        expect(sources).toContain(`requested: ${target}`);
      } else {
        expect(sources).not.toContain("(requested:");
      }
    }
  });
  it("shared preparing rows attribute duplicate inputs once per actual job", () => {
    const original = parseGrepResult(mixed100);
    const pending = [0, 2].map((inputIndex) => ({
      inputIndex,
      target: "npm:cold",
      reason: "repository_indexing",
      retryable: true,
      progressRef: "opaque",
      suggestedSiteTargets:
        inputIndex === 2 ? ["site:docs.example.test"] : null,
    }));
    const result: GrepResult = {
      ...original,
      unavailableTargets: pending,
      indexingEstimates: [
        {
          kind: "REPOSITORY",
          targets: ["npm:cold"],
          repositoryUrl: "https://github.com/owner/repo",
          commitSha: "b".repeat(40),
          estimate: { lowerSeconds: 100, upperSeconds: 120 },
        },
      ],
    };
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatGrepText(result, { syntax, width: 200 });
      expect(text).toContain(
        "Preparing:\n  - github:owner/repo@bbbbbbbb (indexing, estimated total: 100-120s)\n    Requested: npm:cold (input 0)\n    Requested: npm:cold (input 2)\n      Suggested site: site:docs.example.test",
      );
      expect(text.match(/estimated total: 100-120s/g)).toHaveLength(1);
      expect(text).not.toContain("observed HEAD");
      expect(text).not.toContain("opaque");
      expect(text.indexOf("Preparing:")).toBeLessThan(text.indexOf("[1]"));
    }
  });
  it("shared preparing rows retain a single explicit ref and unmatched job aliases", () => {
    const original = parseGrepResult(mixed100);
    const target = "github:owner/repo@release";
    const value: GrepResult = {
      ...original,
      unavailableTargets: [
        {
          inputIndex: 2,
          target,
          reason: "repository_indexing",
          retryable: true,
          progressRef: null,
          suggestedSiteTargets: null,
        },
      ],
      indexingEstimates: [
        {
          kind: "REPOSITORY",
          targets: [target, "npm:alias"],
          repositoryUrl: "https://github.com/owner/repo",
          commitSha: "b".repeat(40),
          estimate: { lowerSeconds: 100, upperSeconds: 120 },
        },
      ],
    };
    const text = formatGrepText(value, { width: 200 });
    expect(text).toContain("Requested: github:owner/repo@release (input 2)");
    expect(text).toContain("Requested: npm:alias");
    expect(text.match(/estimated total: 100-120s/g)).toHaveLength(1);
    expect(text).not.toContain("observed HEAD");
  });
  it("shared preparing rows retain label-only pending inputs and non-preparation omissions", () => {
    const original = parseGrepResult(mixed100);
    const result: GrepResult = {
      ...original,
      indexingEstimates: [],
      unavailableTargets: [
        {
          inputIndex: 0,
          target: "github:owner/cold",
          reason: "repository_indexing",
          retryable: true,
          progressRef: null,
          suggestedSiteTargets: null,
        },
        {
          inputIndex: 1,
          target: "site:missing.example",
          reason: "site_not_found",
          retryable: false,
          progressRef: null,
          suggestedSiteTargets: ["site:docs.example"],
        },
      ],
    };
    const text = formatGrepText(result, { width: 200 });
    expect(text).toContain("Preparing:\n  - github:owner/cold (indexing)");
    expect(text).toContain("Omitted:\n  - site:missing.example");
    expect(text).toContain("Suggested site: site:docs.example");
    expect(text).not.toContain("estimated total:");
  });
  it("shared source rows preserve distinct readiness and remove only duplicated served SHA", () => {
    const original = parseGrepResult(mixed100);
    const scope = original.targets.find(
      (entry) => entry.kind === "REPOSITORY",
    )!;
    const result: GrepResult = {
      ...original,
      targets: [
        { ...scope, readiness: "CURRENT" },
        {
          ...scope,
          targetIndex: 9,
          readiness: "STALE",
          requestedRef: "HEAD",
          filesScanned: 23,
          filesInScope: 206,
        },
      ],
      indexingEstimates: [],
      unavailableTargets: [],
    };
    const text = formatGrepText(result, { width: 200 });
    const section = text.split("Sources:")[1]!.split("Repository")[0]!;
    expect(section.match(/github:expressjs\/express@dbac741a/g)).toHaveLength(
      2,
    );
    expect(text).toContain("older snapshot");
    expect(text).toContain("Requested ref: HEAD.");
    expect(text).toContain("Searched 23 of 206 files.");
    expect(text).not.toContain(`Served ${scope.commitSha}`);
  });
});

function fileIdentity(hit: GrepHit): string {
  return JSON.stringify([
    hit.targetIndex,
    hit.__typename,
    hit.read.target,
    hit.read.path,
  ]);
}

function renderedSlice(slice: GrepLineSlice): string {
  return `${slice.startByte > 0 ? "[...] " : ""}${escapeSource(slice.content)}${slice.endByte < slice.originalLineBytes ? " [...]" : ""}`;
}

function escapeSource(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (
        (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) &&
        character !== "\t"
      )
        return `\\u${code.toString(16).padStart(4, "0")}`;
      return character;
    })
    .join("");
}

function increment(counts: Map<string, number>, value: string): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function sortedCounts(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...counts].sort(([left], [right]) => left.localeCompare(right)),
  );
}
