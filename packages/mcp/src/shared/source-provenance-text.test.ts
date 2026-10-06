import { describe, expect, it } from "bun:test";
import {
  formatPreparationRow,
  renderPreparationSection,
} from "./indexing-estimates-text.js";
import {
  formatSourceRow,
  preparationRequestedFacts,
  renderResolutionDetails,
  renderSourceSection,
  resolutionSourceFacts,
  type SourceProvenanceResolution,
} from "./source-provenance-text.js";

const repoUrl = "https://github.com/anomalyco/opencode";
const served = "bbd72fb8b0bb6de580d2041a0150016227c63ac0";
const head = "0112a92c416f5ad833d96e7a8308441f0a875d94";
const resolution: SourceProvenanceResolution = {
  requested: { kind: "repo_head", repoUrl, gitRef: "HEAD" },
  served: {
    repoUrl,
    commitSha: served,
    gitRef: "HEAD",
    committedAt: "2026-09-01T23:59:59Z",
  },
  resolvedRequested: {
    repoUrl,
    commitSha: head,
    gitRef: "HEAD",
    committedAt: "2026-10-05T00:00:01Z",
  },
  freshness: "fallback_recent",
  freshnessReason: "requested_ref_indexing",
  availableVersions: [],
  availableRefs: [{ ref: "main" }],
  suggestedRefs: [{ ref: "candidate" }],
};
const work = {
  kind: "REPOSITORY" as const,
  repositoryUrl: repoUrl,
  commitSha: head,
  targets: ["github:anomalyco/opencode@HEAD"],
  estimate: { lowerSeconds: 100, upperSeconds: 120 },
};

describe("shared source and preparation rows", () => {
  it("renders the approved served and actual-work identities with independent dates", () => {
    expect(formatSourceRow({ identity: resolution.served })).toBe(
      "github:anomalyco/opencode@bbd72fb8 (committed 2026-09-01, indexed from ref HEAD)",
    );
    expect(formatPreparationRow(work, { resolutions: [resolution] })).toBe(
      "github:anomalyco/opencode@0112a92c (indexing, estimated total: 100-120s, committed 2026-10-05, observed HEAD)",
    );
    expect(renderResolutionDetails(resolution, [work])).toEqual([
      "queryable now: refs=main",
      "suggested refs (may need indexing): candidate",
    ]);
  });
  it("does not borrow served metadata for a same-SHA preparation", () => {
    const same: SourceProvenanceResolution = {
      ...resolution,
      resolvedRequested: { repoUrl, commitSha: served, gitRef: "HEAD" },
    };
    expect(
      formatPreparationRow(
        { ...work, commitSha: served },
        { resolutions: [same] },
      ),
    ).not.toContain("committed");
    const requestedOnly = {
      ...same,
      served: { repoUrl, commitSha: served, gitRef: "HEAD" },
      resolvedRequested: {
        ...same.resolvedRequested,
        committedAt: "2099-01-01T00:00:00Z",
      },
    };
    expect(formatSourceRow({ identity: requestedOnly.served })).not.toContain(
      "committed",
    );
  });
  it.each(["repo_branch", "repo_tag", "repo_sha", "package_exact_version"])(
    "does not label explicit %s requests observed HEAD",
    (kind) => {
      expect(
        preparationRequestedFacts(work, [
          { ...resolution, requested: { kind, gitRef: "HEAD" } },
        ]).observedHead,
      ).toBe(false);
    },
  );
  it("keeps coalesced work distinct from observed HEAD and its date", () => {
    const actual = {
      ...work,
      commitSha: "cccccccccccccccccccccccccccccccccccccccc",
    };
    expect(formatPreparationRow(actual, { resolutions: [resolution] })).toBe(
      "github:anomalyco/opencode@cccccccc (indexing, estimated total: 100-120s)",
    );
    expect(
      renderResolutionDetails(resolution, [actual], { width: 200 })[0],
    ).toBe(
      "Requested: github:anomalyco/opencode@0112a92c (committed 2026-10-05, observed HEAD)",
    );
  });
  it("matches raw repository identity and full SHA, not a prefix or display spelling", () => {
    for (const identity of [
      { ...resolution.resolvedRequested, repoUrl: `${repoUrl}/` },
      {
        ...resolution.resolvedRequested,
        commitSha: `${head.slice(0, 8)}${"a".repeat(32)}`,
      },
      {
        ...resolution.resolvedRequested,
        repoUrl: "https://github.com/other/repo",
      },
    ])
      expect(
        preparationRequestedFacts(work, [
          { ...resolution, resolvedRequested: identity },
        ]),
      ).toEqual({ committedAt: undefined, observedHead: false });
  });
  it("preserves unknown/ref-pending preparation labels without inventing a commit", () => {
    expect(
      formatPreparationRow(
        { ...work, commitSha: undefined },
        { resolutions: [resolution] },
      ),
    ).toBe(
      "github:anomalyco/opencode@HEAD (indexing, estimated total: 100-120s)",
    );
  });
  it("wraps metadata safely while preserving printable Unicode and words", () => {
    const facts = {
      target: "site:docs.example.test/api",
      qualifiers: [
        "hosted documentation",
        "Unicode 路径",
        "bad\x1b[31mcontrol\nspoof",
      ],
    };
    const narrow = renderSourceSection([facts], { width: 45 });
    expect(narrow.slice(2).every((line) => line.startsWith("    "))).toBe(true);
    expect(narrow.join(" ").replace(/\s+/g, " ")).toBe(
      renderSourceSection([facts], { width: 240 })
        .join(" ")
        .replace(/\s+/g, " "),
    );
    expect(narrow.join("\n")).toContain("路径");
    expect(narrow.join("\n")).not.toContain("\x1b");
    expect(narrow.join("\n")).not.toContain("\nspoof");
  });
  it("current dates never revive diagnostics, while unavailable/deferred recovery remains", () => {
    const current = {
      ...resolution,
      freshness: "current",
      freshnessReason: "exact_current",
      resolvedRequested: {
        ...resolution.served,
        committedAt: "2099-12-31T00:00:00Z",
      },
      served: { ...resolution.served, committedAt: "2099-12-31T00:00:00Z" },
    };
    expect(formatSourceRow(resolutionSourceFacts(current)[0]!)).toContain(
      "committed 2099-12-31",
    );
    expect(renderResolutionDetails(current, [work])).toEqual([]);
    expect(
      renderResolutionDetails(
        {
          ...resolution,
          resolvedRequested: null,
          served: null,
          freshness: "unavailable",
          freshnessReason: "ref_resolution_deferred",
        },
        [],
        { width: 200 },
      ),
    ).toEqual([
      "Requested: github:anomalyco/opencode@HEAD",
      "Target unavailable.",
      "Branch resolution is deferred.",
      "queryable now: refs=main",
      "suggested refs (may need indexing): candidate",
    ]);
  });
  it("preserves caller-owned terminal temporal wording and does not mutate inputs", () => {
    const before = structuredClone(resolution);
    expect(
      renderPreparationSection([work], {
        resolutions: [resolution],
        repositoryState: "indexing when observed",
        width: 240,
      }).join("\n"),
    ).toContain("indexing when observed");
    expect(resolution).toEqual(before);
  });
});
