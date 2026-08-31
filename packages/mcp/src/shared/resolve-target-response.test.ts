import { describe, expect, it } from "bun:test";
import type {
  ResolveTargetResult,
  ResolveTargetTarget,
} from "@githits/core-internal";
import {
  buildResolveTargetSuccessPayload,
  findResolveTargetBestTarget,
  formatResolveTargetTerminal,
  groupResolveTargets,
  isResolveTargetActionable,
} from "./resolve-target-response.js";

interface CandidateOverrides extends Partial<ResolveTargetTarget> {
  confidence?: string;
  nameSimilarity?: number;
  matchedAliases?: string[];
  matchTier?: number;
  score?: number;
}

function candidate(
  overrides: CandidateOverrides = {},
): ResolveTargetTarget & { confidence: string } {
  const {
    confidence = "EXACT",
    nameSimilarity,
    matchedAliases = ["express"],
    matchTier = 0,
    score = 100,
    ...targetOverrides
  } = overrides;
  return {
    kind: "PACKAGE",
    canonicalKey: "npm:express",
    confidence,
    displayName: "express",
    description: "Fast web framework",
    registry: "NPM",
    latestVersion: "5.1.0",
    stars: 66_000,
    downloadsLastMonth: 89_000_000,
    docsAvailable: true,
    codeAvailable: true,
    match: {
      confidence,
      ...(nameSimilarity !== undefined ? { nameSimilarity } : {}),
      matchedAliases,
      matchTier,
      score,
    },
    ...targetOverrides,
    latestVersionMaliciousStatus:
      targetOverrides.latestVersionMaliciousStatus ?? "CLEAR",
  };
}

function result(
  overrides: Partial<ResolveTargetResult> = {},
): ResolveTargetResult {
  const best = candidate();
  return {
    best,
    protectedMatches: [best],
    targets: [best],
    targetsTruncated: false,
    ambiguous: false,
    ambiguousReason: "NOT_AMBIGUOUS",
    ...overrides,
  };
}

describe("buildResolveTargetSuccessPayload", () => {
  it("builds a lowercase, null-free diagnostic envelope", () => {
    expect(buildResolveTargetSuccessPayload(result())).toEqual({
      best: "npm:express",
      ambiguous: false,
      candidates: [
        {
          target: "npm:express",
          name: "express",
          kind: "package",
          confidence: "exact",
          direct: true,
          description: "Fast web framework",
          registry: "npm",
          latestVersion: "5.1.0",
          latestVersionMaliciousStatus: "clear",
          stars: 66_000,
          downloadsLastMonth: 89_000_000,
          matchedAliases: ["express"],
          docsAvailable: true,
          codeAvailable: true,
          matchTier: 0,
          score: 100,
        },
      ],
      protectedMatches: ["npm:express"],
      targetsTruncated: false,
    });
  });

  it("preserves numeric name similarity in the shared JSON candidate", () => {
    const fuzzy = candidate({ nameSimilarity: 0.4 });

    expect(
      buildResolveTargetSuccessPayload(
        result({ best: fuzzy, targets: [fuzzy], protectedMatches: [] }),
      ).candidates[0]?.nameSimilarity,
    ).toBe(0.4);
  });

  it("keeps protected references separate from the ordered target list", () => {
    const extra = {
      kind: "PACKAGE",
      canonicalKey: "pypi:express",
      confidence: "EXACT",
    };
    const payload = buildResolveTargetSuccessPayload(
      result({ protectedMatches: [candidate(), extra, extra] }),
    );

    expect(payload.candidates.map((entry) => entry.target)).toEqual([
      "npm:express",
    ]);
    expect(payload.protectedMatches).toEqual(["npm:express", "pypi:express"]);
  });

  it("uses safe lowercase strings for unknown enum values", () => {
    const unknown = candidate({
      kind: "WORKSPACE",
      confidence: "VERY_HIGH",
      latestVersionMaliciousStatus: "REVIEW_REQUIRED",
    });
    const payload = buildResolveTargetSuccessPayload(
      result({ best: unknown, targets: [unknown], protectedMatches: [] }),
    );
    expect(payload.candidates[0]?.kind).toBe("workspace");
    expect(payload.candidates[0]?.confidence).toBe("very_high");
    expect(payload.candidates[0]?.latestVersionMaliciousStatus).toBe(
      "review_required",
    );
  });

  it("preserves bounded malicious advisory evidence in JSON", () => {
    const affected = candidate({
      latestVersionMaliciousStatus: "AFFECTED",
      latestVersionMaliciousEvidence: {
        advisories: [
          {
            osvId: "MAL-2026-1234",
            classificationReasons: [
              "AFFECTED_VERSION_RANGE_MATCH",
              "FUTURE_REASON",
            ],
          },
        ],
        totalCount: 3,
        truncated: true,
      },
    });

    expect(
      buildResolveTargetSuccessPayload(
        result({ best: affected, targets: [affected] }),
      ).candidates[0]?.latestVersionMaliciousEvidence,
    ).toEqual({
      advisories: [
        {
          osvId: "MAL-2026-1234",
          classificationReasons: [
            "affected_version_range_match",
            "future_reason",
          ],
        },
      ],
      totalCount: 3,
      truncated: true,
    });
  });

  it("preserves presentation order, grouping, relation state, counts, and truncation", () => {
    const direct = candidate({
      groupKey: "github:expressjs/express",
      docsPageCount: 0,
      codeFileCount: 1_234,
      license: "MIT",
    });
    const related = candidate({
      kind: "SITE",
      canonicalKey: "site:expressjs.com",
      groupKey: "github:expressjs/express",
      match: undefined,
      stars: undefined,
      downloadsLastMonth: undefined,
      latestVersion: undefined,
      license: "",
      docsPageCount: undefined,
      codeFileCount: undefined,
      codeAvailable: false,
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });
    const payload = buildResolveTargetSuccessPayload(
      result({ targets: [direct, related], targetsTruncated: true }),
    );

    expect(payload.targetsTruncated).toBe(true);
    expect(payload.candidates.map((target) => target.target)).toEqual([
      "npm:express",
      "site:expressjs.com",
    ]);
    expect(payload.candidates[0]).toMatchObject({
      direct: true,
      confidence: "exact",
      groupKey: "github:expressjs/express",
      docsPageCount: 0,
      codeFileCount: 1_234,
      license: "MIT",
    });
    expect(payload.candidates[1]).toMatchObject({
      direct: false,
      groupKey: "github:expressjs/express",
    });
    expect(payload.candidates[1]).not.toHaveProperty("confidence");
    expect(payload.candidates[1]).not.toHaveProperty("docsPageCount");
    expect(payload.candidates[1]?.license).toBe("");
  });

  it("does not sort presentation groups back into direct rank order", () => {
    const lead = candidate({
      canonicalKey: "npm:project",
      groupKey: "github:owner/project",
      matchTier: 0,
      score: 100,
    });
    const groupedLowerRank = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:owner/project",
      groupKey: "github:owner/project",
      confidence: "HIGH",
      matchTier: 2,
      score: 80,
    });
    const ungroupedHigherRank = candidate({
      canonicalKey: "npm:other",
      groupKey: undefined,
      confidence: "HIGH",
      matchTier: 1,
      score: 90,
    });

    expect(
      buildResolveTargetSuccessPayload(
        result({
          targets: [lead, groupedLowerRank, ungroupedHigherRank],
        }),
      ).candidates.map(({ target, matchTier }) => ({ target, matchTier })),
    ).toEqual([
      { target: "npm:project", matchTier: 0 },
      { target: "github:owner/project", matchTier: 2 },
      { target: "npm:other", matchTier: 1 },
    ]);
  });

  it("emits the compact empty envelope", () => {
    expect(
      buildResolveTargetSuccessPayload(
        result({
          best: undefined,
          targets: [],
          protectedMatches: [],
        }),
      ),
    ).toEqual({
      ambiguous: false,
      candidates: [],
      protectedMatches: [],
      targetsTruncated: false,
    });
  });

  it("keeps backend license spelling lossless in JSON", () => {
    const raw = candidate({ license: "mit" });

    expect(
      buildResolveTargetSuccessPayload(result({ best: raw, targets: [raw] }))
        .candidates[0]?.license,
    ).toBe("mit");
  });
});

describe("isResolveTargetActionable", () => {
  it("accepts only non-ambiguous EXACT and HIGH best results", () => {
    for (const confidence of ["EXACT", "HIGH"] as const) {
      const best = candidate({ confidence });
      expect(
        isResolveTargetActionable(
          result({ best, targets: [best], protectedMatches: [] }),
        ),
      ).toBe(true);
    }

    for (const confidence of ["MEDIUM", "LOW"] as const) {
      const best = candidate({ confidence });
      expect(
        isResolveTargetActionable(
          result({ best, targets: [best], protectedMatches: [] }),
        ),
      ).toBe(false);
    }

    for (const confidence of ["exact", "high", "VERY_HIGH"] as const) {
      const best = candidate({ confidence });
      expect(
        isResolveTargetActionable(
          result({ best, targets: [best], protectedMatches: [] }),
        ),
      ).toBe(false);
    }

    expect(isResolveTargetActionable(result({ ambiguous: true }))).toBe(false);
    expect(
      isResolveTargetActionable(
        result({ best: undefined, targets: [], protectedMatches: [] }),
      ),
    ).toBe(false);
  });

  it("accepts only CLEAR and NOT_APPLICABLE malicious statuses", () => {
    for (const latestVersionMaliciousStatus of [
      "CLEAR",
      "NOT_APPLICABLE",
    ] as const) {
      const best = candidate({ latestVersionMaliciousStatus });
      expect(
        isResolveTargetActionable(
          result({ best, targets: [best], protectedMatches: [] }),
        ),
      ).toBe(true);
    }

    for (const latestVersionMaliciousStatus of [
      "AFFECTED",
      "UNKNOWN",
      "REVIEW_REQUIRED",
      "clear",
    ] as const) {
      const best = candidate({ latestVersionMaliciousStatus });
      expect(
        isResolveTargetActionable(
          result({ best, targets: [best], protectedMatches: [] }),
        ),
      ).toBe(false);
    }

    expect(
      isResolveTargetActionable(
        result({ best: candidate(), targets: [], protectedMatches: [] }),
      ),
    ).toBe(false);
  });
});

describe("groupResolveTargets", () => {
  it("groups only contiguous equal non-null keys while preserving order", () => {
    const targets = [
      candidate({ canonicalKey: "npm:a", groupKey: "project:a" }),
      candidate({
        kind: "REPOSITORY",
        canonicalKey: "github:a/a",
        groupKey: "project:a",
        match: undefined,
      }),
      candidate({ canonicalKey: "npm:singleton", groupKey: undefined }),
      candidate({ canonicalKey: "npm:a-again", groupKey: "project:a" }),
      candidate({ canonicalKey: "npm:null-2", groupKey: undefined }),
    ];

    expect(
      groupResolveTargets(targets).map((group) => ({
        groupKey: group.groupKey,
        targets: group.targets.map((target) => target.canonicalKey),
      })),
    ).toEqual([
      {
        groupKey: "project:a",
        targets: ["npm:a", "github:a/a"],
      },
      { groupKey: undefined, targets: ["npm:singleton"] },
      { groupKey: "project:a", targets: ["npm:a-again"] },
      { groupKey: undefined, targets: ["npm:null-2"] },
    ]);
  });
});

describe("findResolveTargetBestTarget", () => {
  it("matches by kind and canonical key rather than canonical key alone", () => {
    const wrongKind = candidate({ kind: "SITE" });
    const exact = candidate();

    expect(
      findResolveTargetBestTarget(result({ targets: [wrongKind, exact] })),
    ).toBe(exact);
  });
});

describe("formatResolveTargetTerminal", () => {
  it("renders direct and relation-only identities as one understandable group", () => {
    const packageTarget = candidate({
      groupKey: "github:expressjs/express",
      docsPageCount: 128,
      codeFileCount: 1_234,
      license: "MIT",
      repositoryUrl: "https://github.com/expressjs/express",
    });
    const repository = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      groupKey: "github:expressjs/express",
      match: undefined,
      downloadsLastMonth: undefined,
      docsAvailable: false,
      codeFileCount: 1_234,
      license: "mit",
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });
    const site = candidate({
      kind: "SITE",
      canonicalKey: "site:expressjs.com",
      groupKey: "github:expressjs/express",
      match: undefined,
      stars: undefined,
      downloadsLastMonth: undefined,
      docsPageCount: 128,
      codeAvailable: false,
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });
    const output = formatResolveTargetTerminal(
      result({ targets: [packageTarget, repository, site] }),
      { name: "express", useColors: false },
    );

    expect(output).toContain(
      "  1. npm:express [exact] · package · protected exact-name match · 89M downloads/mo · license MIT",
    );
    expect(output).not.toContain("repo github:expressjs/express");
    expect(output).toContain(
      "     Related targets:\n       github:expressjs/express · related repository · 66k stars · indexed repository snapshot (1.2k files)",
    );
    expect(output).toContain(
      "       site:expressjs.com · related site · docs 128 pages\n         Fast web framework",
    );
    expect(output).not.toContain("license mit");
    expect(output.match(/license MIT/g)).toHaveLength(1);
    expect(output).not.toContain("no docs");
    expect(output).not.toContain("no code");
    expect(output).not.toContain("readiness");
  });

  it("keeps metrics in semantic lanes and lifts absent relation evidence to packages", () => {
    const packageTarget = candidate({
      groupKey: "github:expressjs/express",
      docsPageCount: 128,
      codeFileCount: 1_234,
      license: "MIT",
      repositoryUrl: "https://github.com/expressjs/express",
    });
    const repository = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      groupKey: "github:expressjs/express",
      match: undefined,
      downloadsLastMonth: undefined,
      docsAvailable: false,
      codeFileCount: 1_234,
      license: "mit",
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });
    const site = candidate({
      kind: "SITE",
      canonicalKey: "site:expressjs.com",
      groupKey: "github:expressjs/express",
      match: undefined,
      stars: undefined,
      downloadsLastMonth: undefined,
      docsPageCount: 96,
      codeAvailable: false,
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });

    const withoutSite = formatResolveTargetTerminal(
      result({ targets: [packageTarget, repository] }),
      { name: "express", useColors: false },
    );
    expect(withoutSite).toContain(
      "npm:express [exact] · package · protected exact-name match · 89M downloads/mo · license MIT · docs 128 pages",
    );
    expect(withoutSite).toContain(
      "github:expressjs/express · related repository · 66k stars · indexed repository snapshot (1.2k files)",
    );
    expect(withoutSite).not.toContain("repo github:expressjs/express");

    const repositoryWithoutStars = formatResolveTargetTerminal(
      result({
        targets: [packageTarget, { ...repository, stars: undefined }],
      }),
      { name: "express", useColors: false },
    );
    expect(repositoryWithoutStars).not.toContain("66k stars");

    const withoutRepository = formatResolveTargetTerminal(
      result({ targets: [packageTarget, site] }),
      { name: "express", useColors: false },
    );
    expect(withoutRepository).toContain(
      "npm:express [exact] · package · protected exact-name match · 66k stars · 89M downloads/mo · repo github:expressjs/express · license MIT · indexed package snapshot (1.2k files)",
    );
    expect(withoutRepository).toContain(
      "site:expressjs.com · related site · docs 96 pages",
    );
    expect(withoutRepository).not.toContain("docs 128 pages");

    const solo = formatResolveTargetTerminal(
      result({ targets: [packageTarget] }),
      { name: "express", useColors: false },
    );
    expect(solo).toContain(
      "66k stars · 89M downloads/mo · repo github:expressjs/express · license MIT · docs 128 pages · indexed package snapshot (1.2k files)",
    );
  });

  it("canonicalizes the verified MIT spelling for a standalone repository", () => {
    const repository = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      downloadsLastMonth: undefined,
      docsAvailable: false,
      codeFileCount: 1_234,
      license: "mit",
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });
    const output = formatResolveTargetTerminal(
      result({ best: repository, targets: [repository], protectedMatches: [] }),
      { name: "express repository", useColors: false },
    );

    expect(output).toContain(
      "github:expressjs/express [exact] · repository · 66k stars · license MIT · indexed repository snapshot (1.2k files)",
    );
    expect(output).not.toContain("license mit");
  });

  it("preserves unverified mixed-case license spellings", () => {
    const repository = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      downloadsLastMonth: undefined,
      license: "Mit",
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });
    const output = formatResolveTargetTerminal(
      result({ best: repository, targets: [repository], protectedMatches: [] }),
      { name: "express repository", useColors: false },
    );

    expect(output).toContain("license Mit");
  });

  it("keeps a related malicious warning local without blocking a safe best target", () => {
    const directSite = candidate({
      kind: "SITE",
      canonicalKey: "site:expressjs.com",
      groupKey: "github:expressjs/express",
      docsAvailable: true,
      codeAvailable: false,
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });
    const relatedPackage = candidate({
      groupKey: "github:expressjs/express",
      match: undefined,
      docsAvailable: false,
      codeAvailable: false,
      latestVersionMaliciousStatus: "UNKNOWN",
      license: "",
    });
    const output = formatResolveTargetTerminal(
      result({
        best: { ...directSite, confidence: "EXACT" },
        targets: [directSite, relatedPackage],
        protectedMatches: [],
        targetsTruncated: true,
      }),
      { name: "expressjs", useColors: false },
    );

    expect(output).toContain("npm:express · related package");
    expect(output).toContain(
      "site:expressjs.com [exact] · site · docs available",
    );
    expect(output).toContain(
      "npm:express · related package · 66k stars · 89M downloads/mo",
    );
    expect(output).not.toContain("no docs");
    expect(output).not.toContain("no code");
    expect(output).not.toContain("license ");
    expect(output).toContain(
      "Warning: Malicious-content status is uncertain. Verify the advisory details before using this version.",
    );
    expect(output).toContain(
      "Note: Additional related targets were omitted; direct matches are complete.",
    );
    expect(output).toContain(
      "Next: githits search '<query>' --in 'site:expressjs.com' --source docs",
    );
    expect(output).not.toContain("Some candidates are not actionable");
  });

  it("renders a compact candidate list and copyable supplied-query follow-up", () => {
    const output = formatResolveTargetTerminal(result(), {
      name: "express",
      query: "router's middleware",
      useColors: false,
    });

    expect(output).toContain(
      "Targets:\n  1. npm:express [exact] · package · protected exact-name match · 66k stars · 89M downloads/mo · docs available · indexed package snapshot\n     Fast web framework",
    );
    expect(output).not.toContain("Warning:");
    expect(output).not.toContain("malicious");
    expect(output).toContain(
      `Next: githits search 'router'"'"'s middleware' --in 'npm:express'`,
    );
  });

  it("renders coarse similarity only when verbose without changing order or gates", () => {
    const lodashEs = candidate({
      canonicalKey: "npm:lodash-es",
      displayName: "lodash-es",
      confidence: "MEDIUM",
      nameSimilarity: 0.333,
    });
    const lodash = candidate({
      canonicalKey: "npm:lodash",
      displayName: "lodash",
      confidence: "MEDIUM",
      nameSimilarity: 0.4,
    });
    const resolved = result({
      best: lodashEs,
      targets: [lodashEs, lodash],
      protectedMatches: [],
    });
    const compactOutput = formatResolveTargetTerminal(resolved, {
      name: "lodahs",
      useColors: false,
    });
    const output = formatResolveTargetTerminal(resolved, {
      name: "lodahs",
      verbose: true,
      useColors: false,
    });

    expect(compactOutput).not.toContain("name similarity");
    expect(compactOutput).not.toContain("coarse lexical support");
    expect(compactOutput).not.toContain("readiness");
    expect(output).toContain(
      "1. npm:lodash-es [medium] · package · 66k stars · 89M downloads/mo · docs available · indexed package snapshot · 33% name similarity",
    );
    expect(output).toContain(
      "2. npm:lodash [medium] · package · 66k stars · 89M downloads/mo · docs available · indexed package snapshot · 40% name similarity",
    );
    expect(output.indexOf("npm:lodash-es")).toBeLessThan(
      output.indexOf("npm:lodash ["),
    );
    expect(output).toContain(
      "Name similarity is coarse lexical support; candidate order follows broader backend policy.",
    );
    expect(output).not.toContain("readiness");
    expect(output).toContain("Targets:");
    expect(output).not.toContain("Unconfirmed ranked targets:");
    expect(output).not.toContain("--in 'npm:lodash-es'");
  });

  it("renders protected matches inline without changing candidate order", () => {
    const protectedExtra = candidate({
      canonicalKey: "pypi:express",
      registry: "PYPI",
    });
    const alternative = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      displayName: "expressjs/express",
      downloadsLastMonth: undefined,
      confidence: "HIGH",
      codeAvailable: false,
    });
    const output = formatResolveTargetTerminal(
      result({
        protectedMatches: [candidate(), protectedExtra],
        targets: [candidate(), protectedExtra, alternative],
      }),
      { name: "express", useColors: false },
    );

    expect(output).toContain(
      "1. npm:express [exact] · package · protected exact-name match",
    );
    expect(output).toContain(
      "2. pypi:express [exact] · package · protected exact-name match",
    );
    expect(output).toContain("3. github:expressjs/express [high] · repository");
    expect(output).not.toContain("Also consider:");
    expect(output).not.toContain("Protected exact-name matches:");
    expect(output).toContain("githits search '<query>'");
  });

  it("renders standalone documentation sites as a known target kind", () => {
    const site = candidate({
      kind: "SITE",
      canonicalKey:
        "site:developer.apple.com/design/human-interface-guidelines",
      displayName: "Apple Human Interface Guidelines",
      stars: undefined,
      downloadsLastMonth: undefined,
      documentationUrl:
        "https://developer.apple.com/design/human-interface-guidelines",
      codeAvailable: false,
    });

    const output = formatResolveTargetTerminal(
      result({ best: site, targets: [site], protectedMatches: [] }),
      { name: "Apple human interface guidelines", useColors: false },
    );

    expect(output).toContain(
      "site:developer.apple.com/design/human-interface-guidelines [exact] · site · docs available\n     Fast web framework",
    );
    expect(output).toContain(
      "Next: githits search '<query>' --in 'site:developer.apple.com/design/human-interface-guidelines' --source docs",
    );
  });

  it("does not synthesize missing protected or best references into presentation order", () => {
    const protectedExtra = {
      kind: "PACKAGE",
      canonicalKey: "pypi:express",
      confidence: "EXACT",
    };
    const best = {
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      confidence: "HIGH",
    };
    const output = formatResolveTargetTerminal(
      result({
        best,
        protectedMatches: [candidate(), protectedExtra],
        targets: [candidate()],
      }),
      { name: "express", useColors: false },
    );

    expect(output.match(/^ {2}\d+\. \S+/gm)).toEqual(["  1. npm:express"]);
    expect(output).not.toContain("pypi:express");
    expect(output).not.toContain("github:expressjs/express");
    expect(output).toContain(
      "Warning: Malicious-content status is unavailable for the best match. Do not use this target.",
    );
    expect(output.match(/Warning:/g)).toHaveLength(1);
  });

  it("shows total downloads or a linked repository when monthly downloads are unavailable", () => {
    const crates = candidate({
      canonicalKey: "crates:serde",
      stars: undefined,
      downloadsLastMonth: undefined,
      downloadsTotal: 500_000_000,
      repositoryUrl: "https://github.com/serde-rs/serde/",
    });
    const maven = candidate({
      canonicalKey: "maven:com.google.guava:guava",
      stars: undefined,
      downloadsLastMonth: undefined,
      downloadsTotal: undefined,
      repositoryUrl: "https://github.com/google/guava",
      description: "Google core libraries for Java",
    });
    const output = formatResolveTargetTerminal(
      result({ targets: [candidate(), crates, maven] }),
      { name: "libraries", useColors: false },
    );

    expect(output).toContain(
      "crates:serde [exact] · package · 500M downloads · repo github:serde-rs/serde · docs available · indexed package snapshot\n     Fast web framework",
    );
    expect(output).toContain(
      "maven:com.google.guava:guava [exact] · package · repo github:google/guava · docs available · indexed package snapshot\n     Google core libraries for Java",
    );
    expect(output).toContain("     Google core libraries for Java");
  });

  it("omits counts and negative labels when availability is false", () => {
    const unavailable = candidate({
      docsAvailable: false,
      codeAvailable: false,
      docsPageCount: 12,
      codeFileCount: 3,
    });
    const output = formatResolveTargetTerminal(
      result({ best: unavailable, targets: [unavailable] }),
      { name: "express", useColors: false },
    );

    expect(output).not.toContain("12 pages");
    expect(output).not.toContain("3 files");
    expect(output).not.toContain("no docs");
    expect(output).not.toContain("no code");
    expect(output).not.toContain("unavailable");
  });

  it("renders specific ambiguity guidance and a generic follow-up target", () => {
    const messages = {
      DUPLICATE_EXACT_NAME:
        "multiple exact package names match; narrow with --registry",
      CLOSE_CANDIDATES: "top candidates are equally plausible",
      LOW_CONFIDENCE: "only low-confidence matches were found",
      NEW_REASON: "review the candidates below before use",
    };
    for (const [ambiguousReason, message] of Object.entries(messages)) {
      const output = formatResolveTargetTerminal(
        result({ ambiguous: true, ambiguousReason }),
        { name: "express", useColors: false },
      );
      expect(output).toContain(`Ambiguous: ${message}`);
      expect(output).toContain("Targets:\n  1. npm:express");
      expect(output).toContain(
        "Next after choosing: githits search '<query>' --in '<target>'",
      );
    }
  });

  it("preserves ambiguous guidance when the best result has LOW confidence", () => {
    const best = candidate({ confidence: "LOW" });
    const output = formatResolveTargetTerminal(
      result({
        best,
        targets: [best],
        protectedMatches: [],
        ambiguous: true,
        ambiguousReason: "LOW_CONFIDENCE",
      }),
      { name: "express", useColors: false },
    );

    expect(output).toContain(
      "Ambiguous: only low-confidence matches were found",
    );
    expect(output).toContain("Targets:\n  1. npm:express [low]");
    expect(output).toContain(
      "Next after choosing: githits search '<query>' --in '<target>'",
    );
    expect(output).not.toContain("Unconfirmed ranked targets:");
    expect(output).not.toContain("--in 'npm:express'");
  });

  it("emits direct canonical next actions for EXACT and HIGH results", () => {
    for (const confidence of ["EXACT", "HIGH"] as const) {
      const best = candidate({ confidence });
      const output = formatResolveTargetTerminal(
        result({ best, targets: [best], protectedMatches: [] }),
        { name: "express", query: "middleware", useColors: false },
      );

      expect(output).toContain("Targets:\n  1. npm:express");
      expect(output).toContain(
        "Next: githits search 'middleware' --in 'npm:express'",
      );
      expect(output).not.toContain("Unconfirmed ranked targets:");
      expect(output).not.toContain("Warning:");
      expect(output).not.toContain("malicious");
    }
  });

  it("renders NOT_APPLICABLE repositories as actionable", () => {
    const repository = candidate({
      kind: "REPOSITORY",
      canonicalKey: "github:expressjs/express",
      latestVersionMaliciousStatus: "NOT_APPLICABLE",
    });
    const output = formatResolveTargetTerminal(
      result({
        best: repository,
        targets: [repository],
        protectedMatches: [],
      }),
      { name: "express", query: "middleware", useColors: false },
    );

    expect(output).not.toContain("Warning:");
    expect(output).not.toContain("malicious");
    expect(output).toContain("indexed repository snapshot");
    expect(output).not.toContain("readiness");
    expect(output).toContain(
      "Next: githits search 'middleware' --in 'github:expressjs/express'",
    );
  });

  it("fails closed for affected, unknown, and future malicious statuses", () => {
    const expectedEvidence = new Map([
      [
        "AFFECTED",
        "Malicious content affects the latest version. Do not use the latest version. Verify another version against the linked evidence.",
      ],
      [
        "UNKNOWN",
        "Malicious-content status is uncertain. Verify the advisory details before using this version.",
      ],
      [
        "REVIEW_REQUIRED",
        "Unrecognized malicious-content status: REVIEW_REQUIRED. Do not use this target.",
      ],
    ]);

    for (const [latestVersionMaliciousStatus, evidence] of expectedEvidence) {
      const best = candidate({ latestVersionMaliciousStatus });
      const output = formatResolveTargetTerminal(
        result({ best, targets: [best], protectedMatches: [] }),
        { name: "express", query: "middleware", useColors: false },
      );

      expect(output).toContain(evidence);
      expect(output).toContain("Warning:");
      expect(output).not.toContain("Next:");
      expect(output).not.toContain("Next after choosing:");
      expect(output).not.toContain("githits search");
    }
  });

  it("renders malicious-content findings as red warnings", () => {
    const affected = candidate({
      latestVersionMaliciousStatus: "AFFECTED",
      latestVersionMaliciousEvidence: {
        advisories: [
          {
            osvId: "MAL-2026-1234",
            classificationReasons: ["AFFECTED_VERSION_RANGE_MATCH"],
          },
        ],
        totalCount: 1,
        truncated: false,
      },
    });
    const output = formatResolveTargetTerminal(
      result({ best: affected, targets: [affected], protectedMatches: [] }),
      { name: "express", useColors: true },
    );

    expect(output).toContain(
      "\u001b[31mWarning: Malicious content affects the latest version — MAL-2026-1234: https://osv.dev/vulnerability/MAL-2026-1234. Do not use the latest version. Verify another version against the linked evidence.\u001b[0m",
    );
  });

  it("explains unknown malicious evidence and reports truncation", () => {
    const unknown = candidate({
      latestVersionMaliciousStatus: "UNKNOWN",
      latestVersionMaliciousEvidence: {
        advisories: [
          {
            osvId: "MAL-2026/unsafe id",
            classificationReasons: ["INVALID_AFFECTED_RANGE", "FUTURE_REASON"],
          },
        ],
        totalCount: 3,
        truncated: true,
      },
    });
    const output = formatResolveTargetTerminal(
      result({ best: unknown, targets: [unknown], protectedMatches: [] }),
      { name: "express", useColors: false },
    );

    expect(output).toContain(
      "Warning: Malicious-content status is uncertain — MAL-2026/unsafe id (affected range invalid, unrecognized reason FUTURE_REASON): https://osv.dev/vulnerability/MAL-2026%2Funsafe%20id; +2 more. Verify the advisory details before using this version.",
    );
    expect(output).not.toContain("Next:");
  });

  it("explains every known unknown-evidence classification reason", () => {
    const reasons = new Map([
      ["MISSING_DISPLAYED_VERSION", "latest version missing"],
      ["INVALID_DISPLAYED_VERSION", "latest version invalid"],
      ["MISSING_AFFECTED_RANGES", "affected ranges missing"],
      ["EMPTY_AFFECTED_RANGES", "affected ranges empty"],
      ["INVALID_AFFECTED_RANGE", "affected range invalid"],
    ]);

    for (const [reason, label] of reasons) {
      const unknown = candidate({
        latestVersionMaliciousStatus: "UNKNOWN",
        latestVersionMaliciousEvidence: {
          advisories: [
            {
              osvId: "MAL-2026-1234",
              classificationReasons: [reason],
            },
          ],
          totalCount: 1,
          truncated: false,
        },
      });
      const output = formatResolveTargetTerminal(
        result({ best: unknown, targets: [unknown], protectedMatches: [] }),
        { name: "express", useColors: false },
      );

      expect(output).toContain(`MAL-2026-1234 (${label})`);
    }
  });

  it("restricts ambiguous continuation when any candidate is non-actionable", () => {
    const clear = candidate();
    const affected = candidate({
      canonicalKey: "npm:express-lookalike",
      latestVersionMaliciousStatus: "AFFECTED",
    });
    const output = formatResolveTargetTerminal(
      result({
        best: clear,
        targets: [clear, affected],
        protectedMatches: [],
        ambiguous: true,
        ambiguousReason: "CLOSE_CANDIDATES",
      }),
      { name: "express", useColors: false },
    );

    expect(output).toContain(
      "Warning: Some candidates are not actionable. Narrow the result before continuing.",
    );
    expect(output).not.toContain("Next after choosing:");
    expect(output).not.toContain("githits search");
  });

  it("fails closed when the best reference is missing from presentation targets", () => {
    const best = candidate({ confidence: "EXACT" });
    const output = formatResolveTargetTerminal(
      result({
        best,
        targets: [],
        protectedMatches: [],
      }),
      { name: "express", query: "middleware", useColors: false },
    );

    expect(output).toContain(
      "Warning: Malicious-content status is unavailable for the best match. Do not use this target.",
    );
    expect(output.match(/Warning:/g)).toHaveLength(1);
    expect(output).not.toContain("Next:");
    expect(output).not.toContain("githits search");
  });

  it("requires narrowing or an explicit choice for MEDIUM and LOW results", () => {
    for (const confidence of ["MEDIUM", "LOW"] as const) {
      const best = candidate({ confidence });
      const output = formatResolveTargetTerminal(
        result({ best, targets: [best], protectedMatches: [] }),
        { name: "express", query: "middleware", useColors: false },
      );

      expect(output).toContain("Targets:\n  1. npm:express");
      expect(output).not.toContain("Unconfirmed ranked targets:");
      expect(output).toContain("narrow the name or filters");
      expect(output).toContain("explicitly choose a candidate");
      expect(output).toContain("--in '<target>'");
      expect(output).not.toContain("--in 'npm:express'");
    }
  });

  it("normalizes and caps candidate descriptions at 240 characters", () => {
    const long = candidate({ description: `first\n${"x".repeat(300)}` });
    const output = formatResolveTargetTerminal(
      result({ best: long, targets: [long] }),
      { name: "express", useColors: false },
    );
    const description = output.split("\n")[2]?.trim() ?? "";
    expect(description).toStartWith("first x");
    expect(description.length).toBe(240);
    expect(description).toEndWith("...");
  });

  it("uses generic terminal wording for unknown confidence and kind values", () => {
    const drifted = candidate({ confidence: "VERY_HIGH", kind: "WORKSPACE" });
    const output = formatResolveTargetTerminal(
      result({ best: drifted, targets: [drifted], protectedMatches: [] }),
      { name: "express", useColors: false },
    );
    expect(output).toContain("1. npm:express [unknown] · target");
    expect(output).not.toContain("very_high");
    expect(output).not.toContain("workspace");
  });

  it("strips terminal control sequences from backend-provided text", () => {
    const hostile = candidate({
      canonicalKey: "npm:x\u001b[31m",
      description:
        "safe\u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007 \u009bred \u0007 bell\treturn \rcarriage",
    });
    const output = formatResolveTargetTerminal(
      result({ best: hostile, targets: [hostile], protectedMatches: [] }),
      { name: "express", useColors: false },
    );
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\u0007");
    expect(output).not.toContain("\u009b");
    expect(output).not.toContain("\r");
    expect(output).toContain("1. npm:x [");
    expect(output).toContain("--in 'npm:x'");
    expect(output).toContain("safeclick red bell return carriage");
    expect(output).not.toContain("red  bell");

    expect(
      formatResolveTargetTerminal(
        result({ best: undefined, targets: [], protectedMatches: [] }),
        { name: "\u001b]0;owned\u0007missing", useColors: false },
      ),
    ).toBe(
      "No targets found for 'missing'.\nCheck the spelling or adjust --registry filters; --query, --prefer-kind, and --intent-hint only rank existing candidates.\n",
    );
  });

  it("renders corrected-spelling and filter guidance for empty results", () => {
    expect(
      formatResolveTargetTerminal(
        result({ best: undefined, targets: [], protectedMatches: [] }),
        { name: "missing", useColors: false },
      ),
    ).toBe(
      "No targets found for 'missing'.\nCheck the spelling or adjust --registry filters; --query, --prefer-kind, and --intent-hint only rank existing candidates.\n",
    );
  });

  it("renders optional ANSI colors", () => {
    expect(
      formatResolveTargetTerminal(result(), {
        name: "express",
        useColors: true,
      }),
    ).toContain("\x1b[");
  });
});
