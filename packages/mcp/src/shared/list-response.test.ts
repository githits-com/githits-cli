import { describe, expect, it } from "bun:test";
import type { ListResult } from "@githits/core-internal";
import { projectListResult } from "./list-response.js";

function baseResult(overrides: Partial<ListResult> = {}): ListResult {
  return {
    inventoryKind: "SOURCE",
    requestedTarget: "github:expressjs/express@v5.2.1",
    canonicalTarget: "github:expressjs/express@v5.2.1",
    entries: [],
    hasMore: false,
    nextCursor: null,
    indexedVersion: null,
    codeIndexState: null,
    indexingStatus: null,
    indexingRef: null,
    inventoryState: null,
    crawlStatus: null,
    coverageState: null,
    coverageReason: null,
    preparation: null,
    ...overrides,
  };
}

function repositoryRootFixture(): ListResult {
  return baseResult({
    entries: [
      {
        kind: "FILE",
        path: "src/a%2Fb.ts",
        title: null,
        language: null,
        fileType: null,
        intent: null,
        byteSize: null,
        lineCount: null,
        contentHash: null,
        read: {
          target: "github:expressjs/express@0123456789abcdef",
          path: "src/a%2Fb.ts",
        },
        browse: null,
      },
    ],
    hasMore: true,
    nextCursor: "opaque/%2Fcursor+雪==",
    indexedVersion: "v5.2.1",
    resolution: {
      requestedVersion: null,
      requestedRef: "v5.2.1",
      resolvedRef: "0123456789abcdef",
      commitSha: "0123456789abcdef",
    },
    targetResolution: {
      requested: null,
      resolvedRequested: null,
      served: {
        kind: "repository_commit",
        registry: null,
        packageName: null,
        version: null,
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "v5.2.1",
        commitSha: "0123456789abcdef",
      },
      freshness: "current",
      freshnessReason: null,
      indexingRef: null,
      availableVersions: null,
      availableRefs: [],
      suggestedRefs: [],
    },
    codeIndexState: "CURRENT",
    indexingStatus: "COMPLETED",
    indexingRef: null,
    availableVersions: [{ version: null, ref: "main" }],
    indexingEstimate: {
      lowerSeconds: null,
      upperSeconds: null,
      elapsedSeconds: null,
      sampleCount: null,
      source: null,
    },
  });
}

function packageSubtreeFixture(): ListResult {
  return baseResult({
    inventoryKind: "SOURCE",
    requestedTarget: "npm:@express/subpackage@5.2.1",
    canonicalTarget: null,
    entries: [
      {
        kind: "DIRECTORY",
        path: "docs",
        title: null,
        read: null,
        browse: null,
      },
    ],
  });
}

function recursiveGlobFixture(): ListResult {
  return baseResult({
    entries: [
      {
        kind: "FILE",
        path: "docs/日本語%2Fintro.md",
        title: null,
        read: {
          target: "npm:express@5.2.1",
          path: "docs/日本語%2Fintro.md",
        },
        browse: null,
      },
    ],
  });
}

function siteSubtreeFixture(): ListResult {
  return baseResult({
    inventoryKind: "SITE",
    requestedTarget: "site:docs.example.test/api",
    canonicalTarget: "site:docs.example.test/api",
    entries: [
      {
        kind: "PAGE",
        path: "docs.example.test/api/",
        title: "API 雪",
        read: {
          target: "https://docs.example.test/api/?lang=en%2Fja#intro",
          path: null,
        },
        browse: {
          target: "site:docs.example.test",
          paths: ["docs.example.test/api/"],
        },
      },
    ],
    inventoryState: "EMPTY",
    crawlStatus: "RUNNING",
    coverageState: "CAPPED",
    coverageReason: "page_limit",
    preparation: {
      selected: 2,
      enqueued: 1,
      activeJobs: [{ mode: null, state: "FAILED" }],
      awaited: [{ mode: null, outcome: "TIMEOUT" }],
    },
  });
}

describe("projectListResult", () => {
  it("projects all four target fixtures without changing selected values", () => {
    const fixtures = [
      repositoryRootFixture(),
      packageSubtreeFixture(),
      recursiveGlobFixture(),
      siteSubtreeFixture(),
    ];

    for (const fixture of fixtures) {
      const projected = projectListResult(fixture);
      expect(projected).toEqual(fixture);
      expect(JSON.parse(JSON.stringify(projected))).toEqual(fixture);
    }
  });

  it("retains nullable selected fields and omitted conditional detail fields", () => {
    const result = repositoryRootFixture();
    const projected = projectListResult(result);

    expect(projected.canonicalTarget).toBe("github:expressjs/express@v5.2.1");
    expect(projected.entries[0]?.title).toBeNull();
    expect(projected.entries[0]?.language).toBeNull();
    expect(projected.entries[0]?.read?.path).toBe("src/a%2Fb.ts");
    expect(projected.entries[0]?.browse).toBeNull();
    expect(projected.availableVersions?.[0]?.version).toBeNull();
    expect(projected.targetResolution?.availableVersions).toBeNull();
    expect(projected.indexingEstimate?.source).toBeNull();

    const compact = projectListResult(packageSubtreeFixture());
    expect(compact.canonicalTarget).toBeNull();
    expect(compact.resolution).toBeUndefined();
    expect(compact.entries[0]?.browse).toBeNull();
    expect("language" in (compact.entries[0] ?? {})).toBe(false);
  });

  it("uses an allowlist, clones nested data, and adds no totals or filter echoes", () => {
    const source = repositoryRootFixture() as ListResult & {
      unexpected?: string;
    };
    source.unexpected = "discarded";
    (
      source.entries[0] as ListResult["entries"][number] & {
        unexpected?: string;
      }
    ).unexpected = "discarded";

    const projected = projectListResult(source);
    expect("unexpected" in projected).toBe(false);
    expect("unexpected" in (projected.entries[0] ?? {})).toBe(false);
    expect("total" in projected).toBe(false);
    expect("filter" in projected).toBe(false);

    const siteFixture = siteSubtreeFixture();
    const projectedBrowse = projectListResult(siteFixture);
    projectedBrowse.entries[0]?.browse?.paths?.push("mutated");
    expect(siteFixture.entries[0]?.browse?.paths).toEqual([
      "docs.example.test/api/",
    ]);
  });
});
