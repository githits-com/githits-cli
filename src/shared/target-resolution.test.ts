import { describe, expect, it } from "bun:test";
import {
  buildRetryCandidateLine,
  buildTargetResolutionNotes,
  projectTargetResolution,
} from "./target-resolution.js";

describe("target-resolution helpers", () => {
  it("projects undefined targetResolution as absent", () => {
    expect(projectTargetResolution(undefined)).toBeUndefined();
  });

  it("renders fallback_recent as a compact recent-index note", () => {
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
      freshnessReason: "head_refresh_deferred",
      availableVersions: [],
      availableRefs: [{ ref: "main" }],
    });

    expect(notes[0]).toContain("using recent index");
    expect(notes[0]).toContain(
      "served=https://github.com/foo/bar#main@abc1237",
    );
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
      freshnessReason: "head_refresh_deferred",
      availableVersions: [],
      availableRefs: [],
    });

    expect(notes[0]).toContain("using recent index");
    expect(notes[0]).toContain(
      "served=https://github.com/foo/bar#v1.0.0@abc1237",
    );
    expect(notes[0]).toContain("fresh=https://github.com/foo/bar#main@def4567");
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
