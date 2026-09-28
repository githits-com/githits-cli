import { describe, expect, it } from "bun:test";
import type { ListResult } from "@githits/core-internal";
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
  return sourceResult({
    inventoryKind: "SITE",
    requestedTarget: "site:docs.example.test/api",
    canonicalTarget: "site:docs.example.test/api",
    indexedVersion: null,
    codeIndexState: null,
    indexingStatus: null,
    inventoryState: "AVAILABLE",
    crawlStatus: "COMPLETE",
    coverageState: "COMPLETE",
    ...overrides,
  });
}

function entry(
  kind: "FILE" | "PAGE" | "DIRECTORY",
  path: string,
): ListResult["entries"][number] {
  return {
    kind,
    path,
    title: "metadata is omitted",
    read: { target: "exact-backend-target", path: "exact-backend-path" },
    browse: { target: "exact-backend-target", paths: ["exact-backend-path"] },
  };
}

describe("formatListText", () => {
  it("renders source entries as paths and marks directories with a slash", () => {
    const result = sourceResult({
      entries: [
        entry("FILE", "src/index.ts"),
        entry("DIRECTORY", "docs"),
        entry("DIRECTORY", "examples/"),
        entry("FILE", "README.md"),
      ],
      hasMore: true,
      nextCursor: "opaque-cursor",
    });

    expect(formatListText(result)).toBe(
      [
        'SOURCE | requested="github:example/repo@main" canonical="github:example/repo@main" | 4+ entries',
        "src/index.ts",
        "docs/",
        "examples/",
        "README.md",
      ].join("\n"),
    );
  });

  it("uses the same path-only format for site inventories", () => {
    const result = siteResult({
      entries: [
        entry("PAGE", "docs.example.test/api/client"),
        entry("DIRECTORY", "docs.example.test/api/reference"),
      ],
    });

    expect(formatListText(result)).toBe(
      [
        'SITE | requested="site:docs.example.test/api" canonical="site:docs.example.test/api" | 2 entries',
        "docs.example.test/api/client",
        "docs.example.test/api/reference/",
      ].join("\n"),
    );
  });

  it("renders an empty inventory as the header alone", () => {
    expect(formatListText(sourceResult({ canonicalTarget: null }))).toBe(
      'SOURCE | requested="github:example/repo@main" canonical=null | 0 entries',
    );
  });

  it("escapes line-breaking and terminal control characters without quoting ordinary paths", () => {
    const result = sourceResult({
      requestedTarget: 'github:exa"mple/repo\n\u0085\u2028',
      entries: [
        entry("FILE", 'docs/space name-π-😀-"quote"-\\slash-\ud800.md'),
        entry("FILE", "docs/line\nbreak\t\u001b\u0085\u2029.md"),
      ],
    });
    const output = formatListText(result);

    expect(output).toContain(
      'requested="github:exa\\"mple/repo\\n\\u0085\\u2028"',
    );
    expect(output.split("\n").slice(1)).toEqual([
      'docs/space name-π-😀-"quote"-\\\\slash-\\ud800.md',
      "docs/line\\nbreak\\t\\u001b\\u0085\\u2029.md",
    ]);
    expect(
      [...output.replaceAll("\n", "")].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
      }),
    ).toBe(false);
  });
});
