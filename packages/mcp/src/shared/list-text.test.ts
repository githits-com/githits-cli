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
        syntax === "cli" ? "Leave out --after" : "Leave out the after argument",
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
        "Sources:",
        "  - github:example/repo@main",
        "Read files: read -- 'github:example/repo@main' $path",
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
        "Sources:",
        "  - site:legacy.example.test/api (hosted documentation)",
        "Read pages: read -- 'site:legacy.example.test/api' $path",
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
        "Sources:",
        "  - site:docs.example.test/api (hosted documentation)",
        "Read pages: read -- 'site:docs.example.test/api' $path",
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
        "Sources:",
        "  - site:docs.example.test/api (hosted documentation)",
        "Read pages: read -- 'site:docs.example.test/api' $path",
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
      [
        "Sources:",
        "  - site:docs.example.test/api (hosted documentation)",
        "a",
        "b",
      ].join("\n"),
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
        ["Sources:", `  - ${target} (hosted documentation)`, ...paths].join(
          "\n",
        ),
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
    ).toBe(
      [
        "No pages.",
        "Sources:",
        "  - site:docs.example.test/api/nested (hosted documentation)",
      ].join("\n"),
    );
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
        "Sources:",
        `  - ${target} (hosted documentation)`,
        `Read pages: read -- '${target}' $path`,
        "client",
        "reference/",
      ].join("\n"),
    );
  });

  it("falls back to the requested source for an empty inventory", () => {
    expect(formatListText(sourceResult({ canonicalTarget: null }))).toBe(
      ["No files.", "Sources:", "  - github:example/repo@main"].join("\n"),
    );
  });

  it("keeps source rows plain when colors are enabled", () => {
    const output = formatListText(
      sourceResult({ entries: [entry("FILE", "src/index.ts")] }),
      { useColors: true },
    );
    expect(output).toBe(
      [
        "Sources:",
        "  - github:example/repo@main",
        "Read files: read -- 'github:example/repo@main' $path",
        "src/index.ts",
      ].join("\n"),
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

    expect(output).toContain('  - github:exa"mple/repo');
    expect(output.split("\n").slice(-2)).toEqual([
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

describe("list site rows", () => {
  it("uses the shared PAGE target for CLI and MCP guidance despite a broader owner", () => {
    const target = "site:docs.example.test/api/v2/nested";
    const result = siteResult({
      requestedTarget: target,
      canonicalTarget: "site:docs.example.test/api/v2",
      entries: [
        entry("PAGE", "guide", target, "guide"),
        { kind: "DIRECTORY", path: "reference/", read: null },
      ],
    });

    expect(formatListText(result)).toBe(
      [
        "Sources:",
        `  - ${target} (hosted documentation)`,
        `Read pages: read -- '${target}' $path`,
        "guide",
        "reference/",
      ].join("\n"),
    );
    expect(formatListText(result, { syntax: "mcp" })).toBe(
      [
        "Sources:",
        `  - ${target} (hosted documentation)`,
        `Read pages: read target=${JSON.stringify(target)} path=$path`,
        "guide",
        "reference/",
      ].join("\n"),
    );
  });

  it("handles ready, pending, and directory-only inventories without inventing recipes", () => {
    const requestedTarget = "site:docs.example.test/api/nested";
    const readyEmpty = formatListText(
      siteResult({
        requestedTarget,
        canonicalTarget: "site:docs.example.test/api",
      }),
    );
    expect(readyEmpty).toBe(
      [
        "No pages.",
        "Sources:",
        `  - ${requestedTarget} (hosted documentation)`,
      ].join("\n"),
    );
    expect(readyEmpty).not.toContain("Read pages:");

    const pendingEmpty = formatListText(
      siteResult({
        requestedTarget,
        canonicalTarget: "site:docs.example.test/api",
        codeIndexState: "INDEXING",
      }),
    );
    expect(pendingEmpty).toStartWith("No pages available yet.");
    expect(pendingEmpty).not.toContain("Sources:");
    expect(pendingEmpty).not.toContain("Read pages:");
    expect(pendingEmpty).toContain("Preparing:");

    const directoryOnly = formatListText(
      siteResult({
        requestedTarget,
        canonicalTarget: "site:docs.example.test/api",
        entries: [{ kind: "DIRECTORY", path: "reference/", read: null }],
      }),
    );
    expect(directoryOnly).toBe(
      [
        "Sources:",
        `  - ${requestedTarget} (hosted documentation)`,
        "reference/",
      ].join("\n"),
    );
    expect(directoryOnly).not.toContain("Read pages:");
  });

  it("omits guidance for disagreeing PAGE targets and preserves exceptional paths", () => {
    const requestedTarget = "site:docs.example.test/api/requested";
    const result = siteResult({
      requestedTarget,
      canonicalTarget: "site:docs.example.test/api",
      entries: [
        entry("PAGE", "chapter/", "site:docs.example.test/api/one", "chapter/"),
        entry(
          "PAGE",
          "exception",
          "https://legacy.example.test/page?x=1",
          null,
        ),
        entry("PAGE", "other", "site:docs.example.test/api/two", "other"),
      ],
    });
    const text = formatListText(result);

    expect(text).toBe(
      [
        "Sources:",
        `  - ${requestedTarget} (hosted documentation)`,
        "chapter/",
        "https://legacy.example.test/page?x=1",
        "other",
      ].join("\n"),
    );
    expect(text).not.toContain("Read pages:");
  });

  it("wraps SITE provenance at the requested width and leaves silent output as paths only", () => {
    const wrapped = formatListText(
      siteResult({
        requestedTarget: "site:docs.example.test/api/reference",
        canonicalTarget: "site:docs.example.test/api",
      }),
      { width: 55 },
    );
    expect(wrapped).toBe(
      [
        "No pages.",
        "Sources:",
        "  - site:docs.example.test/api/reference (hosted",
        "    documentation)",
      ].join("\n"),
    );

    const pendingTarget = "site:docs.example.test/api/reference";
    const pending = formatListText(
      siteResult({
        entries: [
          entry("PAGE", "guide", "site:docs.example.test/api", "guide"),
        ],
        indexingEstimates: [
          {
            kind: "DOCUMENTATION",
            targets: [pendingTarget],
            unavailableReason: "UNSUPPORTED_WORK",
          },
        ],
      }),
      { width: 55 },
    );
    expect(pending).toContain(
      [
        "Preparing:",
        `  - ${pendingTarget} (preparing`,
        "    documentation, no estimate available)",
      ].join("\n"),
    );

    const result = siteResult({
      entries: [
        entry("PAGE", "guide", "site:docs.example.test/api", "guide"),
        { kind: "DIRECTORY", path: "reference/", read: null },
      ],
    });
    expect(formatListText(result, { includeHeader: false })).toBe(
      "guide\nreference/",
    );
  });
});

describe("list source rows", () => {
  const repositoryUrl = "https://github.com/acme/project";
  const servedSha = "1234567890abcdef1234567890abcdef12345678";
  const requestedSha = "abcdef1234567890abcdef1234567890abcdef12";

  it("renders a dated current served pin with exact package read guidance", () => {
    const result = sourceResult({
      requestedTarget: "npm:react@19.0.0",
      canonicalTarget: "npm:react@19.1.0",
      entries: [entry("FILE", "src/index.js")],
      targetResolution: {
        requested: null,
        resolvedRequested: null,
        served: {
          kind: "repo_tag",
          repoUrl: repositoryUrl,
          gitRef: "v19.1.0",
          commitSha: servedSha,
          committedAt: "2025-08-09T10:11:12Z",
        },
        freshness: "current",
        freshnessReason: "exact_current",
      },
    });

    expect(formatListText(result, { syntax: "mcp", width: 200 })).toBe(
      [
        "Sources:",
        "  - github:acme/project@12345678 (committed 2025-08-09, indexed from ref v19.1.0)",
        'Read files: read target="npm:react@19.1.0" path=$path',
        "src/index.js",
      ].join("\n"),
    );
  });

  it("keeps same-ref requested work and recovery separate from the served pin", () => {
    const result = sourceResult({
      requestedTarget: "github:acme/project@HEAD",
      canonicalTarget: "github:acme/project@HEAD",
      entries: [entry("FILE", "src/index.ts")],
      codeIndexState: "INDEXING",
      indexingEstimates: [
        {
          kind: "REPOSITORY",
          repositoryUrl,
          commitSha: requestedSha,
          targets: ["github:acme/project@HEAD"],
          estimate: { lowerSeconds: 30, upperSeconds: 45 },
        },
      ],
      targetResolution: {
        requested: {
          kind: "repo_head",
          repoUrl: repositoryUrl,
          gitRef: "HEAD",
          commitSha: requestedSha,
          committedAt: "2026-01-02T03:04:05Z",
        },
        resolvedRequested: {
          kind: "repo_head",
          repoUrl: repositoryUrl,
          gitRef: "HEAD",
          commitSha: requestedSha,
          committedAt: "2026-01-02T03:04:05Z",
        },
        served: {
          kind: "repo_head",
          repoUrl: repositoryUrl,
          gitRef: "HEAD",
          commitSha: servedSha,
          committedAt: "2025-12-31T23:59:59Z",
        },
        freshness: "fallback_recent",
        freshnessReason: "requested_ref_indexing",
        availableRefs: [{ version: null, ref: "main" }],
        suggestedRefs: [{ version: null, ref: "candidate" }],
      },
    });

    expect(formatListText(result, { width: 200 })).toBe(
      [
        "Sources:",
        "  - github:acme/project@12345678 (committed 2025-12-31, indexed from ref HEAD, older snapshot)",
        "Read files: read -- 'github:acme/project@HEAD' $path",
        "src/index.ts",
        "",
        "Preparing:",
        "  - github:acme/project@abcdef12 (indexing, estimated total: 30-45s, committed 2026-01-02, observed HEAD)",
        "",
        "queryable now: refs=main",
        "suggested refs (may need indexing): candidate",
        "",
        "Retry this list with --wait 60000.",
      ].join("\n"),
    );
  });

  it("keeps unavailable or indexing identities out of Sources without a served artifact", () => {
    const requested = {
      kind: "repo_head",
      repoUrl: repositoryUrl,
      gitRef: "HEAD",
      commitSha: requestedSha,
      committedAt: "2026-01-02T03:04:05Z",
    };
    const unavailable = formatListText(
      sourceResult({
        requestedTarget: "github:acme/project@HEAD",
        canonicalTarget: "github:acme/project@HEAD",
        targetResolution: {
          requested,
          resolvedRequested: requested,
          served: null,
          freshness: "unavailable",
          freshnessReason: "ref_resolution_deferred",
        },
      }),
    );
    expect(unavailable).not.toContain("Sources:");
    expect(unavailable).toContain("Requested: github:acme/project@abcdef12");
    expect(unavailable).toContain("Target unavailable.");

    const indexing = formatListText(
      sourceResult({
        requestedTarget: "github:acme/project@HEAD",
        canonicalTarget: "github:acme/project@HEAD",
        codeIndexState: "INDEXING",
        targetResolution: {
          requested,
          resolvedRequested: requested,
          served: null,
          freshness: "indexing",
          freshnessReason: "requested_ref_indexing",
        },
      }),
    );
    expect(indexing).not.toContain("Sources:");
    expect(indexing).toContain("Requested: github:acme/project@abcdef12");
    expect(indexing).toContain("Requested ref is being indexed.");

    const pendingWithoutResolution = formatListText(
      sourceResult({ codeIndexState: "INDEXING" }),
    );
    expect(pendingWithoutResolution).not.toContain("Sources:");
    expect(pendingWithoutResolution).toContain("Preparing:");
    expect(pendingWithoutResolution).toContain("github:example/repo@main");
  });

  it("compact unresolved requested identity retains a repository target", () => {
    const target = "github:owner/repo@missing";
    const text = formatListText(
      sourceResult({
        requestedTarget: target,
        canonicalTarget: target,
        targetResolution: {
          requested: {
            kind: "git_branch",
            repoUrl: "https://github.com/owner/repo",
            gitRef: "missing",
          },
          resolvedRequested: null,
          served: null,
          freshness: "unavailable",
          freshnessReason: null,
        },
      }),
    );

    expect(text).toBe(
      ["No files.", "", `Requested: ${target}`, "Target unavailable."].join(
        "\n",
      ),
    );
    expect(text).not.toContain("Sources:");
  });

  it("compact unresolved requested identity retains a package target", () => {
    const target = "npm:example@missing";
    const text = formatListText(
      sourceResult({
        requestedTarget: target,
        canonicalTarget: target,
        targetResolution: {
          requested: {
            kind: "package_exact_version",
            registry: "npm",
            packageName: "example",
            version: "missing",
            gitRef: null,
          },
          resolvedRequested: null,
          served: null,
          freshness: "unavailable",
          freshnessReason: null,
        },
      }),
    );

    expect(text).toBe(
      ["No files.", "", `Requested: ${target}`, "Target unavailable."].join(
        "\n",
      ),
    );
    expect(text).not.toContain("Sources:");
  });

  it("keeps silent source output byte-for-byte paths only", () => {
    const result = sourceResult({
      entries: [entry("FILE", "src/index.ts"), entry("DIRECTORY", "docs")],
      targetResolution: {
        requested: null,
        resolvedRequested: null,
        served: {
          repoUrl: repositoryUrl,
          gitRef: "main",
          commitSha: servedSha,
          committedAt: "2025-08-09T10:11:12Z",
        },
        freshness: "current",
        freshnessReason: "exact_current",
      },
    });

    expect(formatListText(result, { includeHeader: false })).toBe(
      "src/index.ts\ndocs/",
    );
  });

  it("labels empty and pending inventories while retaining an authoritative source", () => {
    const result = sourceResult({
      targetResolution: {
        requested: null,
        resolvedRequested: null,
        served: {
          repoUrl: repositoryUrl,
          gitRef: "main",
          commitSha: servedSha,
          committedAt: "2025-08-09T10:11:12Z",
        },
        freshness: "current",
        freshnessReason: "exact_current",
      },
    });
    expect(formatListText(result)).toBe(
      [
        "No files.",
        "Sources:",
        "  - github:acme/project@12345678 (committed 2025-08-09, indexed from ref main)",
      ].join("\n"),
    );

    const pending = formatListText(
      sourceResult({
        entries: [],
        codeIndexState: "INDEXING",
        targetResolution: result.targetResolution,
      }),
    );
    expect(pending).toStartWith("No files available yet.\nSources:\n");
    expect(pending).toContain("github:acme/project@12345678");
    expect(pending).not.toContain("Read files:");
  });

  it("empty source read guidance appears only when paths are returned", () => {
    const target = "github:owner/repo@main";
    const readyEmpty = sourceResult({
      requestedTarget: target,
      canonicalTarget: target,
    });
    const pendingEmpty = sourceResult({
      requestedTarget: target,
      canonicalTarget: target,
      codeIndexState: "INDEXING",
    });
    const withPath = sourceResult({
      requestedTarget: target,
      canonicalTarget: target,
      entries: [entry("FILE", "src/index.ts")],
    });

    for (const syntax of ["cli", "mcp"] as const) {
      const readyText = formatListText(readyEmpty, { syntax });
      const pendingText = formatListText(pendingEmpty, { syntax });
      const pathText = formatListText(withPath, { syntax });
      const guidance =
        syntax === "mcp"
          ? `Read files: read target=${JSON.stringify(target)} path=$path`
          : `Read files: read -- '${target}' $path`;

      expect(readyText).toStartWith("No files.\n");
      expect(readyText).not.toContain("Read files:");
      expect(pendingText).toStartWith("No files available yet.");
      expect(pendingText).not.toContain("Read files:");
      expect(pathText).toContain(guidance);
    }
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

describe("list width", () => {
  it("wraps pending fallback prose without changing its words or native action", () => {
    const result = sourceResult({ codeIndexState: "INDEXING" });
    const narrow = formatListText(result, { width: 40 });
    const wide = formatListText(result, { width: 200 });
    const prose = (text: string): string =>
      text.split("Preparing:\n")[1]!.split("\n\n")[0]!;
    expect(
      prose(narrow)
        .split("\n")
        .every((line) => line.length <= 40),
    ).toBe(true);
    expect(prose(narrow).replace(/\s+/g, " ")).toBe(
      prose(wide).replace(/\s+/g, " "),
    );
    expect(narrow).not.toContain("Read files:");
  });
});
