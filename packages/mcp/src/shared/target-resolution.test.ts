import { describe, expect, it } from "bun:test";
import {
  buildResolutionFromRetryCandidates,
  buildRetryCandidateLine,
  buildTargetResolutionNotes,
  formatTargetResolutionIdentity,
  projectTargetResolution,
} from "./target-resolution.js";

describe("target-resolution helpers", () => {
  it.each([
    ["2026-09-01T12:00:00Z", "2026-10-05T00:00:00Z"],
    [null, "2026-10-05T00:00:00Z"],
    ["2026-09-01T12:00:00Z", null],
    [undefined, undefined],
  ])(
    "preserves independent nullable dates in lean JSON (%s / %s)",
    (servedDate, requestedDate) => {
      const projected = projectTargetResolution({
        requested: { kind: "repo_default_branch" },
        served: {
          commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          committedAt: servedDate ?? undefined,
        },
        resolvedRequested: {
          commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          committedAt: requestedDate ?? undefined,
        },
        freshness: "fallback_recent",
        availableVersions: [],
        availableRefs: [],
      });
      const json = JSON.parse(JSON.stringify(projected));
      expect(json.served).toEqual({
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ...(servedDate != null ? { committedAt: servedDate } : {}),
      });
      expect(json.resolvedRequested).toEqual({
        commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ...(requestedDate != null ? { committedAt: requestedDate } : {}),
      });
      expect(json.requested).not.toHaveProperty("committedAt");
    },
  );

  it("projects undefined targetResolution as absent", () => {
    expect(projectTargetResolution(undefined)).toBeUndefined();
  });

  it("renders fallback_recent as a recent snapshot note", () => {
    const notes = buildTargetResolutionNotes({
      requested: { repoUrl: "https://github.com/foo/bar" },
      resolvedRequested: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "main",
        commitSha: "def456789abc",
      },
      served: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "main",
        commitSha: "abc123789def",
      },
      freshness: "fallback_recent",
      freshnessReason: "ref_resolution_deferred",
      availableVersions: [],
      availableRefs: [{ ref: "main" }],
    });

    expect(notes[0]).toContain(
      "Using recent indexed snapshot while branch resolution is deferred",
    );
    expect(notes[0]).toContain("served=github:foo/bar@main (commit abc1237)");
    expect(notes[0]).not.toContain("fresh=");
    expect(notes[1]).toBe("queryable now: refs=main");
  });

  it("includes fresh target when fallback_recent is materially different", () => {
    const notes = buildTargetResolutionNotes({
      requested: { repoUrl: "https://github.com/foo/bar" },
      resolvedRequested: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "main",
        commitSha: "def456789abc",
      },
      served: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "v1.0.0",
        commitSha: "abc123789def",
      },
      freshness: "fallback_recent",
      freshnessReason: "no_current_fallback",
      availableVersions: [],
      availableRefs: [],
    });

    expect(notes[0]).toContain(
      "Serving an older indexed snapshot; current target is still being indexed",
    );
    expect(notes[0]).toContain("served=github:foo/bar@v1.0.0 (commit abc1237)");
    expect(notes[0]).toContain("fresh=github:foo/bar@main (commit def4567)");
  });

  it("renders repository refs containing @ with canonical @ syntax", () => {
    const notes = buildTargetResolutionNotes({
      requested: {
        repoUrl: "https://github.com/n8n-io/n8n",
        gitRef: "n8n@2.26.5",
      },
      freshness: "unavailable",
      availableVersions: [],
      availableRefs: [],
    });

    expect(notes[0]).toBe(
      "Target unavailable | requested=github:n8n-io/n8n@n8n@2.26.5",
    );
  });

  it("keeps commit-only repository identities short and canonical", () => {
    expect(
      formatTargetResolutionIdentity({
        repoUrl: "https://github.com/foo/bar",
        commitSha: "fd3d47cec611714272f68692b6fc91db575b41bf",
      }),
    ).toBe("github:foo/bar@fd3d47c");
  });

  it("projects and renders standalone site identities", () => {
    const projected = projectTargetResolution({
      requested: { kind: "site", site: "site:expressjs.com" },
      resolvedRequested: { site: "site:expressjs.com" },
      served: { site: "site:expressjs.com" },
      freshness: "current",
      availableVersions: [],
      availableRefs: [],
    });

    expect(projected?.requested?.site).toBe("site:expressjs.com");
    expect(formatTargetResolutionIdentity(projected?.requested)).toBe(
      "site:expressjs.com",
    );
  });

  it("renders requested_ref_indexing reason with requested and indexing refs", () => {
    const notes = buildTargetResolutionNotes({
      requested: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "feature",
      },
      resolvedRequested: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "feature",
        commitSha: "def456789abc",
      },
      served: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "main",
        commitSha: "abc123789def",
      },
      freshness: "indexing",
      freshnessReason: "requested_ref_indexing",
      indexingRef: "idx_123",
      availableVersions: [],
      availableRefs: [{ ref: "main" }],
    });

    expect(notes[0]).toContain("Requested ref is being indexed");
    expect(notes[0]).toContain("requested=github:foo/bar@feature");
    expect(notes[0]).toContain("fresh=github:foo/bar@feature (commit def4567)");
    expect(notes[0]).toContain("served=github:foo/bar@main (commit abc1237)");
    expect(notes[0]).toContain("indexingRef=idx_123");
  });

  it("does not repeat the served identity as fresh while indexing", () => {
    const identity = {
      repoUrl: "https://github.com/foo/bar",
      gitRef: "main",
      commitSha: "abc123789def",
    };
    const notes = buildTargetResolutionNotes({
      requested: { repoUrl: "https://github.com/foo/bar", gitRef: "main" },
      resolvedRequested: identity,
      served: identity,
      freshness: "indexing",
      freshnessReason: "requested_ref_indexing",
      availableVersions: [],
      availableRefs: [],
    });

    expect(notes[0]).toContain("served=github:foo/bar@main (commit abc1237)");
    expect(notes[0]).not.toContain("fresh=");
  });

  it("renders exact provisional identity without falling back to a ref", () => {
    const notes = buildTargetResolutionNotes({
      requested: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "main",
      },
      resolvedRequested: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "main",
        commitSha: "def456789abc",
      },
      served: {
        repoUrl: "https://github.com/foo/bar",
        gitRef: "main",
        commitSha: "abc123789def",
      },
      freshness: "provisional",
      freshnessReason: "exact_provisional",
      indexingRef: "idx_123",
      availableVersions: [],
      availableRefs: [],
    });

    expect(notes).toEqual([
      "provisional (still indexing) | served=github:foo/bar@main (commit abc1237) | indexingRef=idx_123",
    ]);
    expect(notes[0]).not.toContain("requested=");
    expect(notes[0]).not.toContain("fresh=");
  });

  it("renders indexing retry candidates for versions and refs", () => {
    expect(
      buildRetryCandidateLine({
        freshness: "indexing",
        indexingRef: "idx_123",
        availableVersions: [{ version: "1.2.3", ref: "v1.2.3" }],
        availableRefs: [{ ref: "main" }],
      }),
    ).toBe("queryable now: versions=1.2.3@v1.2.3 | refs=main");
  });

  it("maps uppercase provisional retry freshness to lowercase", () => {
    expect(
      buildResolutionFromRetryCandidates({
        freshness: "PROVISIONAL",
        indexingRef: "idx_123",
        availableVersions: [],
        availableRefs: [{ ref: "main" }],
      }),
    ).toMatchObject({
      freshness: "provisional",
      indexingRef: "idx_123",
    });
  });

  it("renders suggested refs separately from immediate retry candidates", () => {
    const notes = buildTargetResolutionNotes({
      freshness: "unavailable",
      availableVersions: [],
      availableRefs: [{ ref: "main" }],
      suggestedRefs: [{ ref: "pkg@1.2.3" }, { ref: "v1.2.3" }],
    });

    expect(notes).toContain("queryable now: refs=main");
    expect(notes).toContain(
      "suggested refs (may need indexing): pkg@1.2.3,v1.2.3",
    );
  });

  it("suppresses identical current provenance", () => {
    expect(
      buildTargetResolutionNotes({
        requested: {
          registry: "NPM",
          packageName: "express",
          version: "4.18.2",
        },
        resolvedRequested: {
          registry: "NPM",
          packageName: "express",
          version: "4.18.2",
        },
        served: { registry: "NPM", packageName: "express", version: "4.18.2" },
        freshness: "current",
        availableVersions: [],
        availableRefs: [],
      }),
    ).toEqual([]);
  });

  it("suppresses healthy current provenance for floating repo targets", () => {
    expect(
      buildTargetResolutionNotes({
        requested: {
          kind: "repo_default_branch",
          repoUrl: "https://github.com/githits-com/githits-cli",
        },
        resolvedRequested: {
          repoUrl: "https://github.com/githits-com/githits-cli",
          gitRef: "HEAD",
          commitSha: "fd3d47cec611714272f68692b6fc91db575b41bf",
        },
        served: {
          repoUrl: "https://github.com/githits-com/githits-cli",
          gitRef: "HEAD",
          commitSha: "fd3d47cec611714272f68692b6fc91db575b41bf",
        },
        freshness: "current",
        freshnessReason: "head_refresh_deferred_within_ttl",
        availableVersions: [],
        availableRefs: [],
      }),
    ).toEqual([]);
  });

  it("suppresses healthy current provenance for latest package targets", () => {
    expect(
      buildTargetResolutionNotes({
        requested: { registry: "NPM", packageName: "express" },
        resolvedRequested: {
          registry: "NPM",
          packageName: "express",
          version: "5.2.1",
        },
        served: { registry: "NPM", packageName: "express", version: "5.2.1" },
        freshness: "current",
        freshnessReason: "exact_current",
        availableVersions: [],
        availableRefs: [],
      }),
    ).toEqual([]);
  });

  it("suppresses obsolete retry candidates after a waited target becomes current", () => {
    expect(
      buildTargetResolutionNotes({
        requested: {
          repoUrl: "https://github.com/dmmulroy/anti-slop",
          gitRef: "e8100a10da49858cfa8d26883d170e9cc8281988",
        },
        resolvedRequested: {
          repoUrl: "https://github.com/dmmulroy/anti-slop",
          gitRef: "e8100a10da49858cfa8d26883d170e9cc8281988",
          commitSha: "e8100a10da49858cfa8d26883d170e9cc8281988",
        },
        served: {
          repoUrl: "https://github.com/dmmulroy/anti-slop",
          gitRef: "e8100a10da49858cfa8d26883d170e9cc8281988",
          commitSha: "e8100a10da49858cfa8d26883d170e9cc8281988",
        },
        freshness: "current",
        freshnessReason: "exact_current",
        availableVersions: [],
        availableRefs: [{ ref: "cd064fe602b5915ff35e1e1c20836ca9bcb3729a" }],
      }),
    ).toEqual([]);
  });

  it("suppresses current provenance even when identities use different layers", () => {
    expect(
      buildTargetResolutionNotes({
        requested: { registry: "NPM", packageName: "express" },
        resolvedRequested: {
          registry: "NPM",
          packageName: "express",
          version: "5.2.1",
          commitSha: "dbac741a49a5a64336b70c06e85c2e2706e36336",
        },
        served: {
          repoUrl: "https://github.com/expressjs/express",
          gitRef: "v5.2.1",
          commitSha: "dbac741a49a5a64336b70c06e85c2e2706e36336",
        },
        freshness: "current",
        freshnessReason: "exact_current",
        availableVersions: [],
        availableRefs: [],
      }),
    ).toEqual([]);
  });

  it("treats current as healthy even if backend identity fields disagree", () => {
    expect(
      buildTargetResolutionNotes({
        requested: { repoUrl: "https://github.com/foo/bar" },
        resolvedRequested: {
          repoUrl: "https://github.com/foo/bar",
          gitRef: "main",
          commitSha: "def456789abc",
        },
        served: {
          repoUrl: "https://github.com/foo/bar",
          gitRef: "main",
          commitSha: "abc123789def",
        },
        freshness: "current",
        freshnessReason: "unexpected_mismatch",
        availableVersions: [],
        availableRefs: [],
      }),
    ).toEqual([]);
  });
});

describe("package source correspondence", () => {
  const identity = {
    registry: "MAVEN",
    packageName: "org.example:library",
    version: "1.2.3",
    repoUrl: "https://github.com/example/library",
    gitRef: "v1.2.3",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const resolution = {
    requested: { ...identity, releaseCorrespondence: null },
    resolvedRequested: {
      ...identity,
      releaseCorrespondence: "manifest_matched",
    },
    served: { ...identity, releaseCorrespondence: "unverified" },
    freshness: "current",
    freshnessReason: "requested_ref_indexing",
    availableVersions: [{ version: "old", ref: "old-tag" }],
    availableRefs: [{ ref: "old-ref" }],
    suggestedRefs: [{ ref: "old-suggestion" }],
  };

  it.each([
    "manifest_matched",
    "tag_inferred",
    "unverified",
    "future_state",
    null,
    undefined,
  ])(
    "preserves the extensible scalar %s independently on every identity",
    (state) => {
      const projected = projectTargetResolution({
        ...resolution,
        served: { ...identity, releaseCorrespondence: state },
      });
      expect(projected?.requested?.releaseCorrespondence).toBeNull();
      expect(projected?.resolvedRequested?.releaseCorrespondence).toBe(
        "manifest_matched",
      );
      expect(projected?.served?.releaseCorrespondence).toBe(state);
      if (state === undefined)
        expect(projected?.served).not.toHaveProperty("releaseCorrespondence");
    },
  );

  it.each([
    ["tag_inferred", "version tag, match to library@1.2.3 unconfirmed"],
    ["unverified", "match to library@1.2.3 unconfirmed"],
  ])(
    "shows CURRENT %s despite matched resolved state, without obsolete retries",
    (state, expected) => {
      const notes = buildTargetResolutionNotes({
        ...resolution,
        served: { ...identity, releaseCorrespondence: state },
      });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain(expected);
      expect(notes[0]).not.toContain("check the published package");
      expect(notes[0]).toContain(
        "Source: github:example/library@v1.2.3 (commit aaaaaaa,",
      );
      expect(notes.join(" ")).not.toMatch(
        /indexing|old-tag|old-ref|old-suggestion|binary|not checked/,
      );
    },
  );

  it.each(["NPM", "PYPI"])(
    "renders shared declared-revision recovery for %s",
    (registry) => {
      const notes = buildTargetResolutionNotes({
        ...resolution,
        served: {
          ...identity,
          registry,
          packageName: "library",
          releaseCorrespondence: "declared_revision_unavailable",
        },
      });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain("library@1.2.3");
      expect(notes[0]).toContain("another revision selected");
      expect(notes[0]).toContain("listed revision for");
      expect(notes[0]).not.toContain("check the published package");
    },
  );

  it("labels a pending identity resolved, never served", () => {
    const notes = buildTargetResolutionNotes({
      ...resolution,
      freshness: "indexing",
      served: undefined,
      resolvedRequested: { ...identity, releaseCorrespondence: "unverified" },
    });
    const notice = notes.find((note) => note.includes("match to"));
    expect(notice).toContain(
      "Selected source: github:example/library@v1.2.3 (commit aaaaaaa,",
    );
    expect(notice).not.toContain("Source: ");
  });

  it("does not borrow correspondence from a different resolved SHA", () => {
    const notes = buildTargetResolutionNotes({
      ...resolution,
      resolvedRequested: { ...identity, releaseCorrespondence: "unverified" },
      served: {
        ...identity,
        commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        releaseCorrespondence: null,
      },
    });
    expect(notes).toEqual([]);
  });

  it.each([
    {
      gitRef: undefined,
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      repoUrl: "https://github.com/example/library",
      expected:
        "Source: github:example/library@aaaaaaa (match to library@1.2.3 unconfirmed)",
    },
    {
      gitRef: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      repoUrl: "https://github.com/example/library",
      expected:
        "Source: github:example/library@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (match to library@1.2.3 unconfirmed)",
    },
    {
      gitRef: "v1.2.3",
      commitSha: undefined,
      repoUrl: "https://github.com/example/library",
      expected:
        "Source: github:example/library@v1.2.3 (match to library@1.2.3 unconfirmed)",
    },
    {
      gitRef: undefined,
      commitSha: undefined,
      repoUrl: undefined,
      expected: "Source: match to library@1.2.3 unconfirmed",
    },
  ])("keeps inline source metadata accurate for $expected", (source) => {
    const { expected, ...locator } = source;
    expect(
      buildTargetResolutionNotes({
        ...resolution,
        served: {
          ...identity,
          ...locator,
          releaseCorrespondence: "unverified",
        },
      }),
    ).toEqual([expected]);
  });

  it("keeps an npm scope in the inline package label", () => {
    expect(
      buildTargetResolutionNotes({
        ...resolution,
        served: {
          ...identity,
          registry: "NPM",
          packageName: "@example/library",
          releaseCorrespondence: "unverified",
        },
      }),
    ).toEqual([
      "Source: github:example/library@v1.2.3 (commit aaaaaaa, match to @example/library@1.2.3 unconfirmed)",
    ]);
  });

  it.each(["manifest_matched", "future_state", null, undefined])(
    "does not invent notice semantics for %s",
    (state) => {
      expect(
        buildTargetResolutionNotes({
          ...resolution,
          served: { ...identity, releaseCorrespondence: state },
        }),
      ).toEqual([]);
    },
  );
});

it("names an observed repository-form served identity with its own version", () => {
  const notes = buildTargetResolutionNotes({
    requested: {
      registry: "MAVEN",
      packageName: "com.google.guava:guava-testlib",
      version: "34.0",
    },
    resolvedRequested: {
      registry: "MAVEN",
      packageName: "com.google.guava:guava-testlib",
      version: "34.0",
      releaseCorrespondence: "manifest_matched",
    },
    served: {
      version: "33.4.0-jre",
      repoUrl: "https://github.com/google/guava",
      gitRef: "v33.4.0",
      commitSha: "5c71d2a15435399fa62508d807d5cc83506f7496",
      releaseCorrespondence: "unverified",
    },
    freshness: "current",
    availableVersions: [],
    availableRefs: [],
  });
  expect(notes).toEqual([
    "Source: github:google/guava@v33.4.0 (commit 5c71d2a, match to guava-testlib@33.4.0-jre unconfirmed)",
  ]);
});
