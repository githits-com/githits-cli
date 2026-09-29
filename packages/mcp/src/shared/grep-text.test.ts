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
      "Sources: npm:express - site:expressjs.com, github:expressjs/express@dbac741a",
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
      rendered.split("\n").find((line) => line.startsWith("Sources:")),
    ).toBe("Sources: site:expressjs.com");
    expect(rendered).not.toContain(
      "Sources: site:expressjs.com - site:expressjs.com",
    );
    expect(rendered.match(/site:expressjs\.com/g) ?? []).toHaveLength(1);
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
