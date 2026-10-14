import { describe, expect, it, mock } from "bun:test";
import {
  MalformedPackageIntelligenceResponseError,
  type PackageChangelogParams,
  PackageIntelligenceBackendError,
  PackageIntelligenceServiceImpl,
} from "./package-intelligence-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

function statement(position = 0, classified = true, json = false) {
  return {
    version: "1.0.0",
    position,
    sourceIndex: 0,
    heading: null,
    source: "RELEASES",
    url: "https://example.com/1.0.0",
    text: `* Statement ${position}`,
    textTruncated: false,
    context: null as {
      heading: string;
      text: string;
      textTruncated: boolean;
      fullText: string;
    } | null,
    ...(json
      ? { sourcePosition: position, fullText: `* Full statement ${position}` }
      : {}),
    classification: classified
      ? {
          tier: "MUST_ACT",
          ambiguous: true,
          kind: null,
          ...(json
            ? {
                tierConfidence: 0.95,
                kindConfidence: null,
                model: "jev",
                formulation: "s-hier-v5",
              }
            : {}),
        }
      : null,
  };
}
function coverage(total = 1, assessed = total) {
  return [
    {
      version: "1.0.0",
      status: assessed === total ? "CLASSIFIED" : "NOT_ASSESSED",
      statementsTotal: total,
      statementsAssessed: assessed,
      statementsNotAssessed: total - assessed,
      statementsNoImpact: 0,
      statementsUnclassified: 0,
    },
  ];
}
function page(
  items = [statement()],
  total = items.length,
  offset = 0,
  cov = coverage(total),
) {
  const remainingCount = total - offset - items.length;
  return {
    items,
    totalCount: total,
    matchingCount: total,
    remainingCount,
    hasMore: remainingCount > 0,
    nextOffset: remainingCount > 0 ? offset + items.length : null,
    coverage: cov,
  };
}
function setup(pages: unknown[], params: Partial<PackageChangelogParams> = {}) {
  const requests: { query: string; variables: Record<string, unknown> }[] = [];
  const fetchFn = mock(
    async (_url: unknown, init?: RequestInit): Promise<Response> => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      const index = requests.length - 1;
      const metadata =
        index === 0
          ? {
              source: "releases",
              entries: [
                {
                  version: "1.0.0",
                  body: "raw notes",
                  htmlUrl: "https://example.com/1.0.0",
                },
              ],
              detailSource: "RELEASES",
              hasChangelog: true,
              entry: {
                body: "raw notes",
                htmlUrl: "https://example.com/1.0.0",
              },
            }
          : {};
      const block = {
        ...metadata,
        ...(pages[index] === undefined ? {} : { statements: pages[index] }),
      };
      return new Response(
        JSON.stringify({
          data:
            params.version !== undefined
              ? {
                  packageInfo: {
                    selectedVersion: {
                      ...(index === 0 ? { resolvedVersion: "1.0.0" } : {}),
                      changelog: block,
                    },
                  },
                }
              : { packageChangelog: block },
        }),
      );
    },
  );
  const service = new PackageIntelligenceServiceImpl(
    "https://pkgseer.dev",
    createMockTokenProvider(),
    fetchFn as unknown as typeof fetch,
  );
  return {
    requests,
    fetchFn,
    call: () =>
      service.packageChangelog({
        registry: "NPM",
        packageName: "example",
        ...params,
      }),
  };
}

describe("changelog view projections", () => {
  for (const version of [undefined, "1.0.0"]) {
    for (const view of ["statements", "verbatim", "timeline"] as const) {
      for (const includeJsonFields of [false, true]) {
        for (const statementTiers of [undefined, ["MUST_ACT"] as const]) {
          it(`${version ? "exact" : "range"} ${view} json=${includeJsonFields} filter=${Boolean(statementTiers)}`, async () => {
            const run = setup([page([statement(0, true, includeJsonFields)])], {
              version,
              view,
              includeJsonFields,
              statementTiers: statementTiers ? [...statementTiers] : undefined,
              ...(!version ? { fromVersion: "0.9.0", toVersion: "1.0.0" } : {}),
            });
            const result = await run.call();
            const wire = run.requests[0]!;
            expect(run.fetchFn).toHaveBeenCalledTimes(1);
            expect(wire.query).not.toContain("riskItems");
            expect(wire.query).not.toContain("riskCoverage");
            expect(wire.query).not.toMatch(/package\s*\{/);
            expect(wire.query.includes("source entries")).toBe(
              version === undefined && includeJsonFields,
            );
            expect(wire.query.includes("detailSource")).toBe(
              version !== undefined && includeJsonFields,
            );
            expect(wire.query.includes("hasChangelog")).toBe(
              version !== undefined &&
                (includeJsonFields || view !== "statements"),
            );
            expect(wire.query.includes("normalizedVersion")).toBe(
              includeJsonFields,
            );
            expect(wire.query.match(/\bbody\b/) !== null).toBe(
              view === "verbatim",
            );
            expect(wire.query.includes("statements(first: 100")).toBe(
              view === "statements",
            );
            expect(wire.query.includes("fullText")).toBe(
              view === "statements" && includeJsonFields,
            );
            expect(wire.query.includes("model formulation")).toBe(
              view === "statements" && includeJsonFields,
            );
            expect(wire.query.includes("statementsAssessed")).toBe(
              view === "statements" && Boolean(statementTiers),
            );
            expect(wire.variables.offset).toBe(
              view === "statements" ? 0 : undefined,
            );
            expect(wire.variables.tiers).toEqual(
              view === "statements" ? statementTiers : undefined,
            );
            expect(result.entries[0]?.body).toBe(
              view === "verbatim" ? "raw notes" : undefined,
            );
            if (view === "statements") {
              expect(
                result.statements?.items[0]?.classification?.ambiguous,
              ).toBe(true);
              expect(result.statements?.items[0]?.classification?.model).toBe(
                includeJsonFields ? "jev" : undefined,
              );
              expect(
                result.statements?.items[0]?.classification?.tierConfidence,
              ).toBe(includeJsonFields ? 0.95 : undefined);
            } else expect(result.statements).toBeUndefined();
          });
        }
      }
    }
  }
});

describe("complete changelog pagination", () => {
  it.each([undefined, "1.0.0"])(
    "collects over100 statements for selector %s, omitting repeat metadata",
    async (version) => {
      const run = setup(
        [
          page(
            Array.from({ length: 100 }, (_, i) => statement(i)),
            101,
          ),
          page([statement(100)], 101, 100),
        ],
        { version },
      );
      const result = await run.call();
      expect(result.statements?.items).toHaveLength(101);
      expect(result.statements?.matchingCount).toBe(101);
      expect(run.requests).toHaveLength(2);
      expect(run.requests[1]?.variables).toMatchObject({
        offset: 100,
        ...(version ? { version } : {}),
      });
      for (const field of [
        "entries",
        "entry {",
        "detailSource",
        "hasChangelog",
        "resolvedVersion",
        "publishedAt",
        "normalizedVersion",
        "body",
        "source entries",
      ])
        expect(run.requests[1]?.query).not.toContain(field);
    },
  );

  it("allows answers arriving between all-mode pages and reports only collected assessment", async () => {
    const run = setup([
      page(
        Array.from({ length: 100 }, (_, i) => statement(i, false)),
        101,
        0,
        coverage(101, 0),
      ),
      page([statement(100)], 101, 100, coverage(101)),
    ]);
    const result = await run.call();
    expect(result.statements?.coverage[0]).toMatchObject({
      status: "NOT_ASSESSED",
      statementsAssessed: 1,
      statementsNotAssessed: 100,
    });
    expect(result.statements?.items[0]?.classification).toBeNull();
    expect(result.statements?.items[100]?.classification).not.toBeNull();
  });

  it("fails explicitly when filtered offsets change during assessment, with no automatic retry", async () => {
    // First response total is all parsed units, matching is filtered units.
    const first = page(
      Array.from({ length: 100 }, (_, i) => statement(i)),
      101,
      0,
      coverage(103, 101),
    );
    first.totalCount = 103;
    const stableRun = setup(
      [
        first,
        {
          ...page([statement(100)], 102, 100, coverage(103, 102)),
          totalCount: 103,
        },
      ],
      { statementTiers: ["MUST_ACT"] },
    );
    await expect(stableRun.call()).rejects.toThrow(
      PackageIntelligenceBackendError,
    );
    expect(stableRun.fetchFn).toHaveBeenCalledTimes(2);
    // No third request even when the second response advertises another page.
  });

  it("filtered pages allow position gaps and preserve full coverage", async () => {
    const p = page([statement(3), statement(7)], 2, 0, coverage(10, 9));
    p.totalCount = 10;
    const result = await setup([p], { statementTiers: ["MUST_ACT"] }).call();
    expect(result.statements?.items.map((item) => item.position)).toEqual([
      3, 7,
    ]);
    expect(result.statements?.coverage[0]?.statementsNotAssessed).toBe(1);
  });

  it("keeps no-impact, oversize, missing and unparseable evidence distinct", async () => {
    const p = page([statement(), statement(1), statement(2, false)]);
    p.items[0]!.classification!.tier = "NO_IMPACT";
    p.items[1]!.classification!.tier = "UNCLASSIFIED";
    const result = await setup([p]).call();
    expect(result.statements?.coverage[0]).toMatchObject({
      statementsAssessed: 2,
      statementsNotAssessed: 1,
      statementsNoImpact: 1,
      statementsUnclassified: 1,
    });
    for (const status of ["WITHOUT_NOTES", "UNPARSEABLE"] as const) {
      const empty = page([], 0, 0, [{ ...coverage(0)[0]!, status }]);
      expect(
        (await setup([empty]).call()).statements?.coverage[0]?.status,
      ).toBe(status);
    }
  });

  it.each([{ nextOffset: 0 }, { hasMore: false }, { remainingCount: 0 }])(
    "rejects malformed progress %j",
    async (patch) => {
      const run = setup([{ ...page([statement()], 2), ...patch }]);
      await expect(run.call()).rejects.toThrow(
        MalformedPackageIntelligenceResponseError,
      );
      expect(run.fetchFn).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { items: [statement(0), statement(0)] },
    { items: [statement(1)] },
    { items: [statement(0), { ...statement(1), version: "unknown" }] },
  ])(
    "rejects duplicate, skipped or unknown all-mode positions",
    async ({ items }) => {
      await expect(setup([page([...items])]).call()).rejects.toThrow(
        MalformedPackageIntelligenceResponseError,
      );
    },
  );
  it("rejects coverage for releases absent from the displayed timeline", async () => {
    const p = page([{ ...statement(), version: "2.0.0" }], 1, 0, [
      { ...coverage()[0]!, version: "2.0.0" },
    ]);
    await expect(setup([p]).call()).rejects.toThrow(
      MalformedPackageIntelligenceResponseError,
    );
  });
  it("rejects missing selected fields instead of inventing coverage", async () => {
    await expect(setup([undefined]).call()).rejects.toThrow(
      MalformedPackageIntelligenceResponseError,
    );
    await expect(
      setup([page()], { includeJsonFields: true }).call(),
    ).rejects.toThrow(MalformedPackageIntelligenceResponseError);
    const p = page();
    await expect(
      setup(
        [
          {
            ...p,
            coverage: [
              { version: "1.0.0", status: "CLASSIFIED", statementsTotal: 1 },
            ],
          },
        ],
        { statementTiers: ["MUST_ACT"] },
      ).call(),
    ).rejects.toThrow(MalformedPackageIntelligenceResponseError);
  });
  it("retains fullText, context, mixed formulation and confidence only as evidence", async () => {
    const first = statement(0, true, true);
    const second = {
      ...statement(1, true, true),
      classification: {
        ...statement(1, true, true).classification!,
        formulation: "s-hier-v3",
        ambiguous: false,
        tierConfidence: 0.1,
      },
      context: {
        heading: "Context heading",
        text: "bounded",
        textTruncated: true,
        fullText: "uncut predecessor",
      },
    };
    const result = await setup([page([first, second])], {
      includeJsonFields: true,
    }).call();
    expect(result.statements?.items[0]?.fullText).toBe("* Full statement 0");
    expect(result.statements?.items[1]?.context?.fullText).toBe(
      "uncut predecessor",
    );
    expect(result.statements?.items[1]?.classification).toMatchObject({
      formulation: "s-hier-v3",
      ambiguous: false,
      tierConfidence: 0.1,
    });
  });
});
