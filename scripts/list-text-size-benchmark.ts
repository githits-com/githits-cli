import type { ListEntry, ListResult } from "@githits/core-internal";
import { formatListText } from "../packages/mcp/src/shared/list-text.js";

const ENTRY_COUNT = 100;

function sourceEntry(index: number): ListEntry {
  const path = `packages/example/src/module-${String(index).padStart(3, "0")}.ts`;
  return {
    kind: "FILE",
    path,
    title: null,
    language: "TypeScript",
    fileType: "source",
    intent: "PRODUCTION",
    byteSize: 4096,
    lineCount: 120,
    contentHash: `hash-${index}`,
    read: { target: "github:example/repo@commit", path },
    browse: null,
  };
}

function siteEntry(index: number): ListEntry {
  const path = `reference/topic-${String(index).padStart(3, "0")}`;
  return {
    kind: index % 10 === 0 ? "DIRECTORY" : "PAGE",
    path,
    title: `Reference topic ${index}`,
    read:
      index % 10 === 0
        ? null
        : {
            target: "site:docs.example.test",
            path,
          },
    browse:
      index % 10 === 0
        ? {
            target: "site:docs.example.test",
            paths: [path],
          }
        : null,
  };
}

function result(
  inventoryKind: "SOURCE" | "SITE",
  target: string,
  entries: ListEntry[],
): ListResult {
  return {
    inventoryKind,
    requestedTarget: target,
    canonicalTarget: target,
    entries,
    hasMore: true,
    nextCursor: "opaque-cursor",
    indexedVersion: inventoryKind === "SOURCE" ? "main" : null,
    codeIndexState: inventoryKind === "SOURCE" ? "CURRENT" : null,
    indexingStatus: inventoryKind === "SOURCE" ? "COMPLETED" : null,
    indexingRef: null,
    inventoryState: inventoryKind === "SITE" ? "AVAILABLE" : null,
    crawlStatus: inventoryKind === "SITE" ? "COMPLETE" : null,
    coverageState: inventoryKind === "SITE" ? "COMPLETE" : null,
    coverageReason: null,
    preparation: null,
  };
}

const cases = [
  result(
    "SOURCE",
    "github:example/repo@main",
    Array.from({ length: ENTRY_COUNT }, (_, index) => sourceEntry(index)),
  ),
  result(
    "SITE",
    "site:docs.example.test",
    Array.from({ length: ENTRY_COUNT }, (_, index) => siteEntry(index)),
  ),
];

for (const benchmarkCase of cases) {
  const output = formatListText(benchmarkCase);
  const previousCompactEntries = JSON.stringify(
    benchmarkCase.entries.map(({ kind, path, title, read, browse }) => ({
      kind,
      path,
      title,
      read,
      browse,
    })),
  );
  const compactEntries = JSON.stringify(
    benchmarkCase.entries.map(({ kind, path, read }) => ({
      kind,
      path,
      ...(benchmarkCase.inventoryKind === "SITE" ? { read } : {}),
    })),
  );
  const textBytes = utf8Bytes(output);
  const previousCompactBytes = utf8Bytes(previousCompactEntries);
  const compactBytes = utf8Bytes(compactEntries);
  console.log(
    `${benchmarkCase.inventoryKind.toLowerCase()}: ${benchmarkCase.entries.length} entries, text=${textBytes} bytes, compact-entry selection=${previousCompactBytes}->${compactBytes} bytes (${reduction(previousCompactBytes, compactBytes)}% reduction)`,
  );
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function reduction(before: number, after: number): string {
  return ((1 - after / before) * 100).toFixed(1);
}
