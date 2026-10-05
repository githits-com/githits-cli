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
  readPath: string | null = "exact-backend-path",
): ListResult["entries"][number] {
  return {
    kind,
    path,
    title: "metadata is omitted",
    read: { target: readTarget, path: readPath },
    browse: { target: "exact-backend-target", paths: ["exact-backend-path"] },
  };
}

describe("formatListText", () => {
  it("distinguishes pending preparation retry from available continuation", () => {
    const result = sourceResult({
      indexingEstimates: [
        {
          kind: "REPOSITORY",
          targets: ["github:example/repo@main"],
          estimate: { lowerSeconds: 38, upperSeconds: 57 },
        },
      ],
      entries: [entry("FILE", "src/index.ts")],
      hasMore: true,
      nextCursor: "available-page",
    });
    for (const syntax of ["cli", "mcp"] as const) {
      const text = formatListText(result, { syntax, hasAfter: true });
      expect(text).toContain(
        syntax === "cli" ? "Leave out --after" : "Leave out after",
      );
      expect(text).toContain("More results available now");
      expect(text).toContain("Retry this list with");
      expect(text.indexOf("More results available now")).toBeLessThan(
        text.indexOf("Retry this list with"),
      );
      expect(text).toContain("available-page");
    }
    expect(formatListText(result, { includeHeader: false })).toBe(
      "src/index.ts",
    );
  });
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
        '# source github:example/repo@main | follow up with "read github:example/repo@main $path" | more results available',
        "src/index.ts",
        "docs/",
        "examples/",
        "README.md",
        "",
        "More results: repeat this list, adding:",
        "  --after 'opaque-cursor'",
      ].join("\n"),
    );
  });

  it("renders an MCP continuation with the opaque cursor", () => {
    const result = sourceResult({
      entries: [entry("FILE", "src/index.ts")],
      hasMore: true,
      nextCursor: 'opaque "cursor"',
    });

    expect(formatListText(result, { syntax: "mcp" })).toEndWith(
      'More results: repeat this list, adding:\n  after="opaque \\"cursor\\""',
    );
  });

  it("uses exact site read paths and relative site directories", () => {
    const result = siteResult({
      requestedTarget: "site:legacy.example.test/api",
      entries: [
        entry("PAGE", "/", "site:legacy.example.test/api", "/"),
        entry("PAGE", "client/", "site:legacy.example.test/api", "client"),
        entry("DIRECTORY", "reference"),
      ],
    });

    expect(formatListText(result)).toBe(
      [
        '# source site:legacy.example.test/api | follow up with "read site:legacy.example.test/api $path"',
        "/",
        "client",
        "reference/",
      ].join("\n"),
    );
  });

  it("preserves a meaningful trailing slash in an exact site page action", () => {
    const result = siteResult({
      entries: [
        entry("PAGE", "pair/", "site:docs.example.test/api", "pair/"),
        entry("DIRECTORY", "reference"),
      ],
    });

    expect(formatListText(result)).toBe(
      [
        '# source site:docs.example.test/api | follow up with "read site:docs.example.test/api $path"',
        "pair/",
        "reference/",
      ].join("\n"),
    );
  });

  it("renders exceptional URL actions as-is beside logical site paths", () => {
    const result = siteResult({
      entries: [
        entry("PAGE", "guide", "site:docs.example.test/api", "guide"),
        entry(
          "PAGE",
          "guide?version=1",
          "http://legacy.example.test/guide?version=1",
          null,
        ),
      ],
    });

    expect(formatListText(result)).toBe(
      [
        '# source site:docs.example.test/api | follow up with "read site:docs.example.test/api $path"',
        "guide",
        "http://legacy.example.test/guide?version=1",
      ].join("\n"),
    );
  });

  it("omits site follow-up guidance when page actions have different targets", () => {
    const result = siteResult({
      entries: [
        entry("PAGE", "a", "site:docs.example.test", "a"),
        entry("PAGE", "b", "site:legacy.example.test", "b"),
      ],
    });

    expect(formatListText(result)).toBe(
      ["# source site:docs.example.test/api", "a", "b"].join("\n"),
    );
  });

  it.each([
    {
      target: "site:reference.langchain.com/python/langchain/agents",
      canonicalTarget: "site:reference.langchain.com/python/langchain",
      paths: [
        "_subagent_transformer/",
        "factory/",
        "middleware/",
        "structured_output/",
      ],
    },
    {
      target: "site:reference.langchain.com/python/langchain",
      canonicalTarget: "site:reference.langchain.com/python/langchain",
      paths: ["agents/_subagent_transformer/", "agents/factory/"],
    },
    {
      target: "site:expressjs.com",
      canonicalTarget: "site:expressjs.com",
      paths: ["en/resources/"],
    },
  ])(
    "preserves directory paths relative to $target",
    ({ target, canonicalTarget, paths }) => {
      const result = siteResult({
        requestedTarget: target,
        canonicalTarget,
        entries: paths.map((path) => ({
          kind: "DIRECTORY",
          path,
          read: null,
          browse: { target, paths: [path] },
        })),
      });
      expect(formatListText(result)).toBe(
        [`# source ${target}`, ...paths].join("\n"),
      );
      expect(formatListText(result, { includeHeader: false })).toBe(
        paths.join("\n"),
      );
    },
  );

  it("uses the requested site base when an empty inventory has a broader owner", () => {
    expect(
      formatListText(
        siteResult({
          requestedTarget: "site:docs.example.test/api/nested",
          canonicalTarget: "site:docs.example.test/api",
        }),
      ),
    ).toBe("# source site:docs.example.test/api/nested");
  });

  it("pairs descendant PAGE paths with their emitted target instead of the owner", () => {
    const target = "site:docs.example.test/api/nested";
    expect(
      formatListText(
        siteResult({
          requestedTarget: target,
          entries: [
            entry("PAGE", "client", target, "client"),
            { kind: "DIRECTORY", path: "reference/", read: null },
          ],
        }),
      ),
    ).toBe(
      [
        `# source ${target} | follow up with "read ${target} $path"`,
        "client",
        "reference/",
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

  it("can omit the source line for paths-only output", () => {
    const result = sourceResult({
      entries: [entry("FILE", "src/index.ts"), entry("DIRECTORY", "docs")],
      hasMore: true,
      nextCursor: "opaque-cursor",
    });

    expect(
      formatListText(result, { includeHeader: false, useColors: true }),
    ).toBe("src/index.ts\ndocs/");
    expect(formatListText(sourceResult(), { includeHeader: false })).toBe("");
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

describe("list preparation outcomes", () => {
  it("distinguishes empty pending inventory from empty ready, with conditional cursor advice", () => {
    const pending = sourceResult({
      codeIndexState: "INDEXING",
      indexingEstimates: [
        {
          kind: "REPOSITORY",
          targets: ["npm:express@1.0.3"],
          estimate: { lowerSeconds: 33, upperSeconds: 85 },
        },
      ],
    });
    const text = formatListText(pending);
    expect(text).toStartWith("No files available yet.");
    expect(text).toContain(
      "npm:express@1.0.3 (indexing, estimated total: 33-85s)",
    );
    expect(text).toEndWith("Retry this list with --wait 100000.");
    expect(text).not.toContain("follow up with");
    expect(text).not.toContain("--after");
    expect(formatListText(sourceResult())).not.toContain("Retry");
    expect(formatListText(pending, { includeHeader: false })).toBe("");
  });
  it("retains hosted pages and their cursor while refresh has no ETA", () => {
    const result = siteResult({
      entries: [entry("PAGE", "/api", "site:docs.example.test", "/api")],
      nextCursor: "next-page",
      hasMore: true,
      indexingEstimates: [
        {
          kind: "DOCUMENTATION",
          targets: ["site:docs.example.test"],
          unavailableReason: "UNSUPPORTED_WORK",
        },
      ],
    });
    const text = formatListText(result, { syntax: "mcp" });
    expect(text).toContain("/api");
    expect(text).toContain("preparing documentation, no estimate available");
    expect(text).toContain('after="next-page"');
    expect(text).not.toContain("Omitted");
    expect(text).toEndWith("Retry this list with wait_timeout_ms=30000.");
  });
});
