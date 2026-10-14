import { describe, expect, it, mock } from "bun:test";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceBackendError,
  PackageIntelligenceServiceImpl,
  type PackageUpgradeReviewParams,
  packageUpgradeReviewQuery,
} from "./package-intelligence-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

const identity = {
  registry: "NPM",
  name: "express",
  currentVersion: "0.0.0",
  targetVersion: "1.0.0",
} as const;
function statement(position: number, tier = "MUST_ACT", ambiguous = false) {
  return {
    version: "1.0.0",
    position,
    sourceIndex: 0,
    sourcePosition: position + 1,
    heading: null,
    source: "RELEASES",
    url: "https://example.com/notes",
    text: `Statement ${position}`,
    textTruncated: false,
    fullText: `Full statement ${position}`,
    context: null,
    classification: {
      tier,
      ambiguous,
      kind: null,
      tierConfidence: 0.1,
      kindConfidence: null,
      model: "jev",
      formulation: "v3",
    },
  };
}
function coverage(total: number) {
  return [
    {
      version: "1.0.0",
      status: "CLASSIFIED",
      statementsTotal: total,
      statementsAssessed: total,
      statementsNotAssessed: 0,
      statementsNoImpact: 0,
      statementsUnclassified: 0,
    },
  ];
}
function page(total = 101, offset = 0) {
  const count = Math.min(100, total - offset);
  const remainingCount = total - offset - count;
  return {
    items: Array.from({ length: count }, (_, i) => statement(offset + i)),
    coverage: coverage(total),
    totalCount: total,
    matchingCount: total,
    remainingCount,
    hasMore: remainingCount > 0,
    nextOffset: remainingCount > 0 ? offset + count : null,
  };
}
function review(statements = page()) {
  return {
    ...identity,
    latestVersion: null,
    versionDelta: "MAJOR",
    unknowns: [],
    security: {
      current: null,
      target: null,
      added: [],
      removed: [],
      notAddressed: [],
      fixed: [],
      introduced: [],
      unchanged: [],
    },
    changelog: {
      statements,
      riskCoverage: {
        versionsClassified: 1,
        versionsNotAssessed: 0,
        versionsWithoutNotes: 0,
        versionsUnparseable: 0,
        unitsNoImpact: 0,
        itemsMustActConfident: statements.totalCount,
        itemsMustActAmbiguous: 0,
        itemsShouldKnowConfident: 0,
        itemsShouldKnowAmbiguous: 0,
        itemsUnclassified: 0,
      },
      entries: [],
      sampledEntries: [],
      keywordEntries: [],
      totalKeywordEntries: 0,
      totalEntries: 1,
      totalEntriesWithBodies: 1,
      truncated: true,
      hasReleaseNoteBodies: true,
      breakingSignals: [],
      migrationSignals: [],
    },
  };
}
const summary = {
  total: 1,
  withUnknowns: 0,
  withAddedAdvisories: 0,
  withBreakingSignals: 0,
  withDirectDependencyChanges: 0,
  withTransitiveVulnerabilityAdditions: 0,
};
function initial(
  reviews: (Omit<ReturnType<typeof review>, keyof typeof identity> & {
    registry: string;
    name: string;
    currentVersion: string;
    targetVersion: string;
  })[] = [review()],
) {
  return {
    data: {
      packageUpgradeReview: {
        summary: { ...summary, total: reviews.length },
        reviews,
      },
    },
  };
}
function continuation(statements = page(101, 100)) {
  return {
    data: {
      packageUpgradeReview: {
        reviews: [{ ...identity, changelog: { statements } }],
      },
    },
  };
}
function setup(
  responses: unknown[],
  changes: Partial<PackageUpgradeReviewParams> = {},
) {
  const requests: {
    query: string;
    variables: Record<string, unknown> & {
      packages: PackageUpgradeReviewParams["packages"];
      offset?: number;
      tiers?: PackageUpgradeReviewParams["statementTiers"];
    };
  }[] = [];
  const fetchFn = mock(
    async (_: unknown, init?: RequestInit): Promise<Response> => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(responses[requests.length - 1]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const service = new PackageIntelligenceServiceImpl(
    "https://example.test",
    createMockTokenProvider(),
    fetchFn as unknown as typeof fetch,
  );
  const params: PackageUpgradeReviewParams = {
    packages: [identity],
    includeTransitiveSecurity: true,
    includeDependencyIssues: true,
    changelogLimit: 20,
    statementTiers: ["MUST_ACT", "SHOULD_KNOW", "UNCLASSIFIED"],
    changelogView: "json",
    ...changes,
  };
  return { requests, run: () => service.packageUpgradeReview(params) };
}

describe("complete upgrade statement retrieval", () => {
  for (const enabled of [true, false])
    it(`preserves initial security variables and minimal projection when enabled=${enabled}`, async () => {
      const { run, requests } = setup([initial([review(page(1))])], {
        minSeverity: 7,
        changelogLimit: 12,
        includeTransitiveSecurity: enabled,
        includeDependencyIssues: enabled,
      });
      await run();
      expect(requests[0]?.variables).toMatchObject({
        packages: [identity],
        minSeverity: 7,
        changelogLimit: 12,
        includeTransitiveSecurity: enabled,
        includeDependencyIssues: enabled,
      });
      const query = requests[0]!.query;
      expect(query).toContain(
        "dependencyIssues @include(if: $includeDependencyIssues)",
      );
      expect(query).toContain(
        "transitive @include(if: $includeTransitiveSecurity)",
      );
      for (const field of [
        "duplicateIds",
        "matchedAffectedVersionRanges",
        "affectsInspectedVersion",
        "affectedVersionRangesCount",
        "affectedVersionRangesTruncated",
      ])
        expect(query).not.toContain(field);
    });
  it("preserves added security advisory mapping", async () => {
    const body = initial([review(page(1))]);
    const advisory = {
      id: "GHSA-added",
      aliases: ["CVE-added"],
      summary: "Observed advisory",
      severity: 7.5,
      severityLabel: "HIGH",
      fixedIn: ["2.0.0"],
      isMalicious: false,
    };
    Reflect.set(body.data.packageUpgradeReview.reviews[0]!.security, "added", [
      advisory,
    ]);
    const result = await setup([body]).run();
    expect(result.reviews[0]!.security.added).toEqual([advisory]);
  });
  for (const field of ["security", "versionDelta"])
    it(`keeps strict aggregate review validation for ${field}`, async () => {
      const body = initial([review(page(1))]);
      Reflect.deleteProperty(body.data.packageUpgradeReview.reviews[0]!, field);
      await expect(setup([body]).run()).rejects.toThrow(
        MalformedPackageIntelligenceResponseError,
      );
    });
  it("rejects null selected fullText", async () => {
    const body = initial([review(page(1))]);
    Reflect.set(
      body.data.packageUpgradeReview.reviews[0]!.changelog.statements.items[0]!,
      "fullText",
      null,
    );
    await expect(setup([body]).run()).rejects.toThrow(
      MalformedPackageIntelligenceResponseError,
    );
  });
  it("passes through backend validation above the public batch maximum", async () => {
    const { run, requests } = setup(
      [
        {
          errors: [
            {
              message: "packages must contain at most 30 upgrades",
              extensions: { code: "VALIDATION_ERROR" },
            },
          ],
        },
      ],
      {
        packages: Array.from({ length: 31 }, () => ({ ...identity })),
      },
    );
    await expect(run()).rejects.toThrow(
      "packages must contain at most 30 upgrades",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.variables.packages).toHaveLength(31);
  });
  it("collects past both the legacy cap and first page without repeating aggregate fields", async () => {
    const { run, requests } = setup([initial(), continuation()]);
    const result = await run();
    expect(result.reviews[0]!.changelog.statements?.items).toHaveLength(101);
    expect(
      result.reviews[0]!.changelog.statements?.items[100]?.classification,
    ).toMatchObject({ ambiguous: false, tierConfidence: 0.1 });
    expect(requests[0]!.variables.offset).toBe(0);
    expect(requests[1]!.variables).toEqual({
      packages: [identity],
      offset: 100,
      tiers: ["MUST_ACT", "SHOULD_KNOW", "UNCLASSIFIED"],
    });
    expect(requests[1]!.query).toContain(
      "includeTransitiveSecurity: false, changelogLimit: 1",
    );
    for (const field of [
      "security {",
      "summary {",
      "riskCoverage",
      "entries {",
      "dependencyChanges",
      "riskItems",
      "itemsOmitted",
    ])
      expect(requests[1]!.query).not.toContain(field);
  });
  for (const count of [1, 3, 30])
    it(`initial aggregate keeps ${count} packages in one request`, async () => {
      const base = review(page(1));
      const reviews = Array.from({ length: count }, (_, i) => ({
        ...base,
        name: `p${i}`,
      }));
      const { run, requests } = setup([initial(reviews)], {
        packages: reviews.map(
          ({ registry, name, currentVersion, targetVersion }) => ({
            registry: registry as "NPM",
            name,
            currentVersion,
            targetVersion,
          }),
        ),
      });
      expect((await run()).reviews).toHaveLength(count);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.variables.packages).toHaveLength(count);
    });
  it("continues duplicate canonical reviews in original review order", async () => {
    const go = {
      ...review(),
      registry: "GO",
      name: "example.com/pkg",
      currentVersion: "v0.0.0",
      targetVersion: "v1.0.0",
    };
    const next = {
      data: {
        packageUpgradeReview: {
          reviews: [
            {
              registry: go.registry,
              name: go.name,
              currentVersion: go.currentVersion,
              targetVersion: go.targetVersion,
              changelog: { statements: page(101, 100) },
            },
          ],
        },
      },
    };
    const { run, requests } = setup([initial([go, go]), next, next], {
      packages: Array.from({ length: 2 }, () => ({
        registry: "GO",
        name: go.name,
        currentVersion: "0.0.0",
        targetVersion: "1.0.0",
      })),
    });
    const result = await run();
    expect(result.reviews).toHaveLength(2);
    expect(requests).toHaveLength(3);
    expect(
      requests.slice(1).map((r) => r.variables.packages[0]?.currentVersion),
    ).toEqual(["v0.0.0", "v0.0.0"]);
    expect(requests.slice(1).map((r) => r.variables.offset)).toEqual([
      100, 100,
    ]);
  });
  it("accepts filtered position gaps and coverage beyond the ordinary entry sample", async () => {
    const body = initial([review(page(3))]);
    const r = body.data.packageUpgradeReview.reviews[0]!;
    r.changelog.statements.items.splice(1, 1);
    r.changelog.statements.matchingCount = 2;
    r.changelog.statements.coverage[0]!.statementsNoImpact = 1;
    r.changelog.riskCoverage.unitsNoImpact = 1;
    r.changelog.riskCoverage.itemsMustActConfident = 2;
    const result = await setup([body]).run();
    expect(
      result.reviews[0]!.changelog.statements!.items.map(
        (item) => item.position,
      ),
    ).toEqual([0, 2]);
    expect(result.reviews[0]!.changelog.entries).toEqual([]);
  });
  it("returns entirely unassessed all evidence while focused returns zero matches", async () => {
    for (const all of [false, true]) {
      const body = initial([review(page(2))]);
      const r = body.data.packageUpgradeReview.reviews[0]!;
      for (const item of r.changelog.statements.items)
        Reflect.set(item, "classification", null);
      Object.assign(r.changelog.statements.coverage[0]!, {
        status: "NOT_ASSESSED",
        statementsAssessed: 0,
        statementsNotAssessed: 2,
      });
      Object.assign(r.changelog.riskCoverage, {
        versionsClassified: 0,
        versionsNotAssessed: 1,
        itemsMustActConfident: 0,
      });
      if (!all) {
        r.changelog.statements.items = [];
        r.changelog.statements.matchingCount = 0;
      }
      const result = await setup([body], {
        statementTiers: all
          ? undefined
          : ["MUST_ACT", "SHOULD_KNOW", "UNCLASSIFIED"],
      }).run();
      expect(result.reviews[0]!.changelog.statements!.items).toHaveLength(
        all ? 2 : 0,
      );
      expect(
        result.reviews[0]!.changelog.statements!.coverage[0]!
          .statementsNotAssessed,
      ).toBe(2);
    }
  });
  it("accepts zero parsed units with honest missing-note coverage", async () => {
    const body = initial([review(page(0))]);
    const r = body.data.packageUpgradeReview.reviews[0]!;
    r.changelog.statements.coverage[0]!.status = "WITHOUT_NOTES";
    Object.assign(r.changelog.riskCoverage, {
      versionsClassified: 0,
      versionsWithoutNotes: 1,
    });
    expect(
      (await setup([body]).run()).reviews[0]!.changelog.statements!.items,
    ).toEqual([]);
  });
  it("retains oversize statement truncation and nullable confidence without interpreting it", async () => {
    const body = initial([review(page(1))]);
    const r = body.data.packageUpgradeReview.reviews[0]!;
    const item = r.changelog.statements.items[0]!;
    item.textTruncated = true;
    item.classification.tier = "UNCLASSIFIED";
    Reflect.set(item.classification, "tierConfidence", null);
    Object.assign(r.changelog.riskCoverage, {
      itemsMustActConfident: 0,
      itemsUnclassified: 1,
    });
    r.changelog.statements.coverage[0]!.statementsUnclassified = 1;
    const result = await setup([body]).run();
    expect(result.reviews[0]!.changelog.statements!.items[0]).toMatchObject({
      textTruncated: true,
      fullText: item.fullText,
      classification: { tier: "UNCLASSIFIED", ambiguous: false },
    });
  });
  it("triage omits selected arrays without fabricating empty evidence", async () => {
    const body = initial([review(page(1))]);
    const changelog = body.data.packageUpgradeReview.reviews[0]!.changelog;
    for (const field of [
      "statements",
      "entries",
      "sampledEntries",
      "keywordEntries",
    ])
      Reflect.deleteProperty(changelog, field);
    const { run, requests } = setup([body], { changelogView: "triage" });
    const result = await run();
    expect(result.reviews[0]!.changelog.statements).toBeUndefined();
    expect(result.reviews[0]!.changelog.entries).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.query).not.toContain("statements(");
  });
  it("keeps all nullable classification and no-impact evidence distinct", async () => {
    const body = initial([review(page(2))]);
    const r = body.data.packageUpgradeReview.reviews[0]!;
    r.changelog.statements.items[0]!.classification.tier = "NO_IMPACT";
    Reflect.set(r.changelog.statements.items[1]!, "classification", null);
    Object.assign(r.changelog.statements.coverage[0]!, {
      status: "NOT_ASSESSED",
      statementsAssessed: 1,
      statementsNotAssessed: 1,
      statementsNoImpact: 1,
    });
    Object.assign(r.changelog.riskCoverage, {
      versionsClassified: 0,
      versionsNotAssessed: 1,
      itemsMustActConfident: 0,
      unitsNoImpact: 1,
    });
    const { run } = setup([body], { statementTiers: undefined });
    const items = (await run()).reviews[0]!.changelog.statements!.items;
    expect(items[0]!.classification?.tier).toBe("NO_IMPACT");
    expect(items[1]!.classification).toBeNull();
  });
  for (const filtered of [false, true])
    it(`rejects changing assessment coverage even when filtered=${filtered}`, async () => {
      const next = continuation();
      next.data.packageUpgradeReview.reviews[0]!.changelog.statements
        .coverage[0]!.statementsAssessed--;
      const { run } = setup([initial(), next], {
        statementTiers: filtered ? ["MUST_ACT"] : undefined,
      });
      await expect(run()).rejects.toThrow(PackageIntelligenceBackendError);
    });
  for (const field of ["totalCount", "matchingCount"] as const)
    it(`reports observed ${field} changes as retryable evidence changes`, async () => {
      const next = continuation();
      const p = next.data.packageUpgradeReview.reviews[0]!.changelog.statements;
      p[field]++;
      if (field === "matchingCount") {
        p.remainingCount++;
        p.hasMore = true;
        p.nextOffset = 101;
      }
      const { run } = setup([initial(), next]);
      await expect(run()).rejects.toThrow("evidence changed");
    });
  for (const mutate of [
    (p: ReturnType<typeof page>) => {
      p.nextOffset = 0;
    },
    (p: ReturnType<typeof page>) => {
      p.remainingCount = 50;
    },
    (p: ReturnType<typeof page>) => {
      p.items.push(statement(100));
    },
    (p: ReturnType<typeof page>) => {
      p.items[1]!.position = 0;
    },
    (p: ReturnType<typeof page>) => {
      p.items[0]!.version = "missing";
    },
    (p: ReturnType<typeof page>) => {
      p.items[0]!.classification.tier = "NO_IMPACT";
    },
  ])
    it(`rejects malformed selected page %#`, async () => {
      const body = initial();
      mutate(body.data.packageUpgradeReview.reviews[0]!.changelog.statements);
      const { run } = setup([body, continuation()]);
      await expect(run()).rejects.toThrow(
        MalformedPackageIntelligenceResponseError,
      );
    });
  it("rejects continuation identity mismatch", async () => {
    const next = continuation();
    Reflect.set(next.data.packageUpgradeReview.reviews[0]!, "name", "wrong");
    await expect(setup([initial(), next]).run()).rejects.toThrow(
      "identity mismatch",
    );
  });
  it("counter disagreement without observed page change is malformed, not a retry", async () => {
    const body = initial();
    body.data.packageUpgradeReview.reviews[0]!.changelog.riskCoverage
      .itemsMustActConfident--;
    await expect(setup([body, continuation()]).run()).rejects.toThrow(
      MalformedPackageIntelligenceResponseError,
    );
  });
  for (const field of [
    "fullText",
    "sourcePosition",
    "model",
    "formulation",
    "tierConfidence",
    "kindConfidence",
  ])
    it(`requires selected JSON ${field}`, async () => {
      const body = initial([review(page(1))]);
      const item =
        body.data.packageUpgradeReview.reviews[0]!.changelog.statements
          .items[0]!;
      Reflect.deleteProperty(
        ["fullText", "sourcePosition"].includes(field)
          ? item
          : item.classification,
        field,
      );
      await expect(setup([body]).run()).rejects.toThrow("evidence fields");
    });
});

describe("upgrade statement projections", () => {
  for (const view of ["text", "json", "triage"] as const)
    it(`fetches only consumed changelog fields for ${view}`, () => {
      const params: PackageUpgradeReviewParams = {
        packages: [identity],
        includeTransitiveSecurity: true,
        includeDependencyIssues: true,
        changelogLimit: 20,
        changelogView: view,
      };
      const query = packageUpgradeReviewQuery(params);
      expect(query).not.toContain("riskItems");
      expect(query).not.toContain("itemsOmitted");
      expect(query.includes("statements(")).toBe(view !== "triage");
      expect(query.includes("fullText")).toBe(view === "json");
      expect(query.includes("tierConfidence")).toBe(view === "json");
      expect(query.includes("sourcePosition")).toBe(view === "json");
      if (view === "text") {
        expect(query.match(/entries \{([^}]+)\}/)?.[1]).not.toContain("body");
        expect(query.match(/keywordEntries \{([^}]+)\}/)?.[1]).toContain(
          "body",
        );
        expect(query).not.toContain("bodyPreview");
      }
      if (view === "triage")
        for (const field of [
          "entries {",
          "keywordEntries {",
          "sampledEntries {",
        ])
          expect(
            query.slice(
              query.indexOf("changelog {"),
              query.indexOf("compatibility {"),
            ),
          ).not.toContain(field);
    });
});
