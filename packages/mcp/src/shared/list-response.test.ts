import { describe, expect, it } from "bun:test";
import type { ListResult, ListTargetResolution } from "@githits/core-internal";
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
          target: "site:docs.example.test/api",
          path: "api?lang=en%2Fja",
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

    const minimal = packageSubtreeFixture();
    const minimalEntry = minimal.entries[0];
    if (!minimalEntry) throw new Error("fixture missing entry");
    delete minimalEntry.title;
    delete minimalEntry.read;
    delete minimalEntry.browse;
    const projectedMinimal = projectListResult(minimal);
    expect(projectedMinimal.entries[0]).toEqual({
      kind: "DIRECTORY",
      path: "docs",
    });
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

  it("list provenance projection preserves minimal identities and omitted fields", () => {
    const targetResolution: ListTargetResolution = {
      requested: { kind: "git_branch", gitRef: "main" },
      resolvedRequested: null,
      served: {
        repoUrl: "https://github.com/acme/project",
        gitRef: "main",
        commitSha: "full-sha",
        committedAt: "2025-04-03T02:01:00.123+05:30",
      },
      freshness: "current",
      freshnessReason: "exact_current",
    };
    const projected = projectListResult(baseResult({ targetResolution }));
    const projectedResolution = projected.targetResolution;

    expect(projectedResolution).toEqual(targetResolution);
    expect(Object.hasOwn(projectedResolution ?? {}, "indexingRef")).toBe(false);
    expect(Object.hasOwn(projectedResolution ?? {}, "availableVersions")).toBe(
      false,
    );
    expect(Object.hasOwn(projectedResolution ?? {}, "availableRefs")).toBe(
      false,
    );
    expect(Object.hasOwn(projectedResolution ?? {}, "suggestedRefs")).toBe(
      false,
    );
    expect(Object.hasOwn(projectedResolution?.served ?? {}, "kind")).toBe(
      false,
    );
    expect(projectedResolution?.served?.committedAt).toBe(
      "2025-04-03T02:01:00.123+05:30",
    );
  });

  it.each([
    {
      name: "served date with a null resolved request",
      targetResolution: {
        requested: null,
        resolvedRequested: null,
        served: {
          kind: "git_commit",
          registry: null,
          packageName: null,
          version: null,
          repoUrl: "https://github.com/acme/project",
          gitRef: "main",
          commitSha: "served-sha",
          committedAt: "2025-04-03T02:01:00Z",
        },
        freshness: "current",
        freshnessReason: null,
      },
    },
    {
      name: "resolved-requested date with a null served identity",
      targetResolution: {
        requested: null,
        resolvedRequested: {
          kind: "git_commit",
          registry: null,
          packageName: null,
          version: null,
          repoUrl: "https://github.com/acme/project",
          gitRef: "main",
          commitSha: "requested-sha",
          committedAt: "2025-04-02T01:00:00Z",
        },
        served: null,
        freshness: "fallback_recent",
        freshnessReason: "head_unavailable",
      },
    },
  ] satisfies Array<{
    name: string;
    targetResolution: ListTargetResolution;
  }>)("list provenance projection preserves $name", ({ targetResolution }) => {
    const projected = projectListResult(baseResult({ targetResolution }));

    expect(projected.targetResolution).toEqual(targetResolution);
    expect(projected.targetResolution?.resolvedRequested?.committedAt).toBe(
      targetResolution.resolvedRequested?.committedAt,
    );
    expect(projected.targetResolution?.served?.committedAt).toBe(
      targetResolution.served?.committedAt,
    );
  });

  it("list provenance projection preserves nulls, clones arrays, and allowlists fields", () => {
    const availableRef = { version: null, ref: "main", unexpected: true };
    const targetResolution = {
      requested: {
        kind: "git_branch",
        gitRef: "main",
        unexpected: true,
      },
      resolvedRequested: null,
      served: null,
      freshness: "current",
      freshnessReason: null,
      indexingRef: null,
      availableVersions: null,
      availableRefs: [availableRef],
      suggestedRefs: [],
      unexpected: true,
    } as ListTargetResolution & { unexpected: boolean };
    const result = baseResult({ targetResolution });

    const projected = projectListResult(result);
    const projectedResolution = projected.targetResolution;

    expect(projectedResolution?.indexingRef).toBeNull();
    expect(projectedResolution?.freshnessReason).toBeNull();
    expect(projectedResolution?.availableVersions).toBeNull();
    expect(projectedResolution?.availableRefs).toEqual([
      { version: null, ref: "main" },
    ]);
    expect(projectedResolution?.suggestedRefs).toEqual([]);
    expect(projectedResolution).not.toHaveProperty("unexpected");
    expect(projectedResolution?.requested).not.toHaveProperty("unexpected");
    expect(projectedResolution?.availableRefs?.[0]).not.toHaveProperty(
      "unexpected",
    );
    expect(projectedResolution?.availableRefs).not.toBe(
      targetResolution.availableRefs,
    );
    expect(projectedResolution?.availableRefs?.[0]).not.toBe(availableRef);
    expect(projectedResolution?.requested).not.toBe(targetResolution.requested);

    const projectedRequested = projectedResolution?.requested;
    if (projectedRequested) projectedRequested.gitRef = "changed";
    const projectedAvailableRef = projectedResolution?.availableRefs?.[0];
    if (projectedAvailableRef) projectedAvailableRef.ref = "changed";
    projectedResolution?.suggestedRefs?.push({ version: "1.0.0", ref: "v1" });
    expect(targetResolution.requested?.gitRef).toBe("main");
    expect(targetResolution.availableRefs).toHaveLength(1);
    expect(availableRef).toEqual({
      version: null,
      ref: "main",
      unexpected: true,
    });
    expect(targetResolution.suggestedRefs).toEqual([]);
  });
});
