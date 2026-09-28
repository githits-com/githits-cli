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
  readTarget = "exact-backend-target",
): ListResult["entries"][number] {
  return {
    kind,
    path,
    title: "metadata is omitted",
    read: { target: readTarget, path: "exact-backend-path" },
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
        '# source github:example/repo@main | follow up with "read github:example/repo@main $path" | more',
        "src/index.ts",
        "docs/",
        "examples/",
        "README.md",
      ].join("\n"),
    );
  });

  it("uses leading-slash page URL paths and relative site directories", () => {
    const result = siteResult({
      entries: [
        entry("PAGE", "docs.example.test/", "https://docs.example.test"),
        entry(
          "PAGE",
          "docs.example.test/api/client/",
          "https://docs.example.test/api/client/",
        ),
        entry("DIRECTORY", "docs.example.test/api/reference"),
      ],
    });

    expect(formatListText(result)).toBe(
      [
        '# source site:docs.example.test/api | follow up with "read https://docs.example.test$path" (URLs as-is)',
        "https://docs.example.test",
        "/api/client/",
        "api/reference/",
      ].join("\n"),
    );
  });

  it("uses a slash-terminated root target as the root URL path", () => {
    const result = siteResult({
      entries: [
        entry("PAGE", "docs.example.test/", "https://docs.example.test/"),
        entry(
          "PAGE",
          "docs.example.test/guide/",
          "https://docs.example.test/guide/",
        ),
      ],
    });

    expect(formatListText(result)).toBe(
      [
        '# source site:docs.example.test/api | follow up with "read https://docs.example.test$path"',
        "/",
        "/guide/",
      ].join("\n"),
    );
  });

  it("renders exact page targets when one site page spans multiple origins", () => {
    const result = siteResult({
      entries: [
        entry(
          "PAGE",
          "docs.example.test/guide",
          "https://docs.example.test/guide",
        ),
        entry(
          "PAGE",
          "legacy.example.test/guide",
          "http://legacy.example.test/guide?version=1",
        ),
      ],
    });

    expect(formatListText(result)).toBe(
      [
        "# source site:docs.example.test/api",
        "https://docs.example.test/guide",
        "http://legacy.example.test/guide?version=1",
      ].join("\n"),
    );
  });

  it("falls back to the requested source for an empty inventory", () => {
    expect(formatListText(sourceResult({ canonicalTarget: null }))).toBe(
      '# source github:example/repo@main | follow up with "read github:example/repo@main $path"',
    );
  });

  it("dims only the source line when colors are enabled", () => {
    const output = formatListText(
      sourceResult({ entries: [entry("FILE", "src/index.ts")] }),
      { useColors: true },
    );
    expect(output).toBe(
      '\u001b[2m# source github:example/repo@main | follow up with "read github:example/repo@main $path"\u001b[0m\nsrc/index.ts',
    );
  });

  it("escapes line-breaking and terminal control characters without quoting ordinary paths", () => {
    const result = sourceResult({
      requestedTarget: 'github:exa"mple/repo\n\u0085\u2028',
      canonicalTarget: 'github:exa"mple/repo\n\u0085\u2028',
      entries: [
        entry("FILE", 'docs/space name-π-😀-"quote"-\\slash-\ud800.md'),
        entry("FILE", "docs/line\nbreak\t\u001b\u0085\u2029.md"),
      ],
    });
    const output = formatListText(result);

    expect(output).toContain('# source github:exa"mple/repo\\n\\u0085\\u2028');
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
