import { describe, expect, it } from "bun:test";
import type {
  GrepHit,
  GrepLineSlice,
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
    const repositoryHeading = lines.findIndex((line) =>
      line.startsWith("Repository: "),
    );
    const hostedHeading = lines.findIndex((line) =>
      line.startsWith("Hosted docs: "),
    );
    expect(
      lines.filter((line) => line.startsWith("Repository: ")),
    ).toHaveLength(1);
    expect(
      lines.filter((line) => line.startsWith("Hosted docs: ")),
    ).toHaveLength(1);
    expect(repositoryHeading).toBeGreaterThanOrEqual(0);
    expect(hostedHeading).toBeGreaterThan(repositoryHeading);

    const repositoryLines = lines.slice(repositoryHeading + 1, hostedHeading);
    const hostedLines = lines.slice(hostedHeading + 1);
    const expectedLocators = new Map<
      GrepTargetStatus["kind"],
      Map<string, number>
    >();
    const expectedRows = new Map<
      GrepTargetStatus["kind"],
      Map<string, number>
    >();
    let distinctWindowCount = 0;
    for (const group of groups.values()) {
      const first = group.hits[0]!;
      const kind = scopes.get(first.targetIndex)!.kind;
      increment(expectedLocators, kind, locator(first));

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
          kind,
          `${String(hit.line).padStart(gutterWidth)}: ${renderedSlice(hit.lineSlice)}`,
        );
    }
    expect(distinctWindowCount).toBeLessThan(parsedOriginal.hits.length);

    const sectionByKind = new Map<GrepTargetStatus["kind"], string[]>([
      ["REPOSITORY", repositoryLines],
      ["SITE", hostedLines],
    ]);
    let renderedWindowCount = 0;
    for (const kind of ["REPOSITORY", "SITE"] as const) {
      const section = sectionByKind.get(kind)!;
      const locatorCounts = expectedLocators.get(kind)!;
      for (const [heading, count] of locatorCounts)
        expect(section.filter((line) => line === heading)).toHaveLength(count);

      const matchingRows = section.filter((line) => /^\s*\d+: /.test(line));
      const actualRowCounts = countValues(matchingRows);
      const expectedRowCounts = expectedRows.get(kind)!;
      expect(sortedCounts(actualRowCounts)).toEqual(
        sortedCounts(expectedRowCounts),
      );
      renderedWindowCount += matchingRows.length;
    }
    expect(renderedWindowCount).toBe(distinctWindowCount);
    expect(rendered).not.toMatch(/\(\d+ matches\)/);
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

function locator(hit: GrepHit): string {
  return hit.__typename === "GrepRepositoryHit" ? hit.filePath : hit.pageUrl;
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

function increment<K>(
  counts: Map<K, Map<string, number>>,
  key: K,
  value: string,
): void {
  const values = counts.get(key) ?? new Map<string, number>();
  values.set(value, (values.get(value) ?? 0) + 1);
  counts.set(key, values);
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
