import { describe, expect, it, mock } from "bun:test";
import { defaultAdvisoryDetails } from "./advisory-test-helpers.js";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceServiceImpl,
} from "./package-intelligence-service.js";
import { createMockTokenProvider } from "./test-helpers.js";

function source(id = "OSV-example") {
  const { affected: _, ...detail } = structuredClone(defaultAdvisoryDetails);
  return {
    ...detail,
    osvId: id,
    schemaVersion: "1.9.0",
    relatedIds: ["RELATED-example"],
    upstreamIds: ["UPSTREAM-example"],
    credits: [
      {
        name: "Researcher",
        contact: ["", "researcher@example.org"],
        type: "FUTURE_ROLE",
      },
    ],
  };
}
function row(id = "OSV-example", sourceDetails: unknown = source(id)) {
  return {
    osvId: id,
    summary: "Imported assessment",
    aliases: [],
    affectsInspectedVersion: true,
    matchedAffectedVersionRanges: ["<2"],
    affectedVersionRanges: ["<2"],
    affectedVersionRangesCount: 1,
    affectedVersionRangesTruncated: false,
    fixedInVersions: ["2"],
    duplicateIds: [],
    sourceDetails,
  };
}
function page(
  entries = [row()],
  next: string | null = null,
  total = entries.length,
) {
  return {
    data: {
      packageVulnerabilities: {
        package: { registry: "NPM", name: "example", version: "1" },
        security: {
          affectedVulnerabilityCount: total,
          nonAffectingVulnerabilityCount: 0,
          allVulnerabilityCount: total,
          currentVersionAffected: true,
          advisories: {
            entries,
            pageInfo: {
              hasNextPage: next !== null,
              endCursor: next,
              totalCount: total,
            },
          },
        },
      },
    },
  };
}
function setup(bodies: unknown[]) {
  const requests: Array<{ query: string; variables: Record<string, unknown> }> =
    [];
  const fetchFn = mock(async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    if (!bodies.length) throw new Error("Unexpected request");
    return new Response(JSON.stringify(bodies.shift()));
  });
  return {
    requests,
    service: new PackageIntelligenceServiceImpl(
      "https://example.test/graphql",
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    ),
  };
}
const params = { registry: "NPM", packageName: "example" } as const;
const sourcePath = [
  "packageVulnerabilities",
  "security",
  "advisories",
  "entries",
  0,
  "sourceDetails",
];
function error(
  code: string,
  path: Array<string | number> = sourcePath,
  retryable = true,
) {
  return {
    message: "Private provider message must not be displayed",
    path,
    extensions: { code, retryable, retry_after_ms: 1500 },
  };
}

describe("package current OSV source details", () => {
  it.each([undefined, false])(
    "does not select source fields when opt-in=%s",
    async (includeSourceDetails) => {
      const { service, requests } = setup([page()]);
      const report = await service.packageVulnerabilities({
        ...params,
        includeSourceDetails,
      });
      expect(requests[0]!.query).toContain("first: 100");
      expect(requests[0]!.query).not.toMatch(
        /sourceDetails|schemaVersion|credits|\bdetails\b/,
      );
      expect(report.sourceDetails).toBeUndefined();
    },
  );
  it("drains six source rows at three per page without changing local evidence", async () => {
    const first = page([row("OSV-1"), row("OSV-2"), row("OSV-3")], "next", 6);
    const second = page([row("OSV-4"), row("OSV-5"), row("OSV-6")], null, 6);
    const { service, requests } = setup([first, second]);
    const report = await service.packageVulnerabilities({
      ...params,
      includeSourceDetails: true,
    });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.query).toContain("first: 3");
      expect(request.query).toContain("sourceDetails {");
      expect(request.query).toContain("credits { name contact type }");
      expect(request.query).not.toMatch(/sourceDetails\s+@|affected \{/);
    }
    expect(requests.map((r) => r.variables.after)).toEqual([null, "next"]);
    expect(report.security!.affectedVulnerabilityCount).toBe(6);
    expect(report.security!.vulnerabilities).toHaveLength(6);
    expect(report.security!.vulnerabilities![0]!.summary).toBe(
      "Imported assessment",
    );
    expect(report.sourceDetails!.map((s) => s.advisoryId)).toEqual([
      "OSV-1",
      "OSV-2",
      "OSV-3",
      "OSV-4",
      "OSV-5",
      "OSV-6",
    ]);
    expect(report.sourceDetails![0]!.source).toEqual(source("OSV-1"));
  });
  it.each(["NOT_FOUND", "RATE_LIMITED", "TIMEOUT", "UPSTREAM_ERROR"])(
    "retains local assessment alongside %s on a nullable source",
    async (code) => {
      const body = {
        ...page([row("OSV-example", null)]),
        errors: [error(code, sourcePath, code !== "NOT_FOUND")],
      };
      const { service } = setup([body]);
      const report = await service.packageVulnerabilities({
        ...params,
        includeSourceDetails: true,
      });
      expect(report.security!.affectedVulnerabilityCount).toBe(1);
      expect(report.sourceDetails![0]).toMatchObject({
        advisoryId: "OSV-example",
        source: null,
        error: {
          code,
          retryable: code !== "NOT_FOUND",
          retryAfterSeconds: 1.5,
        },
      });
      expect(JSON.stringify(report)).not.toContain("Private provider");
    },
  );
  it("preserves permanent upstream failures and later-page diagnostics", async () => {
    const second = {
      ...page([row("OSV-2", null)], null, 2),
      errors: [error("UPSTREAM_ERROR", sourcePath, false)],
    };
    const { service } = setup([page([row("OSV-1")], "next", 2), second]);
    const report = await service.packageVulnerabilities({
      ...params,
      includeSourceDetails: true,
    });
    expect(report.sourceDetails![1]!.error!.retryable).toBe(false);
    expect(report.sourceDetails![0]!.source!.osvId).toBe("OSV-1");
  });
  it("keeps unexplained null sources without inventing errors", async () => {
    const { service } = setup([page([row("OSV-example", null)])]);
    const report = await service.packageVulnerabilities({
      ...params,
      includeSourceDetails: true,
    });
    expect(report.sourceDetails).toEqual([
      { advisoryId: "OSV-example", source: null },
    ]);
  });
  it.each([
    error("AUTH_REQUIRED"),
    error("TIMEOUT", [...sourcePath, "details"]),
    error("TIMEOUT", [...sourcePath.slice(0, 4), -1, "sourceDetails"]),
    error("TIMEOUT", [...sourcePath.slice(0, 4), 1, "sourceDetails"]),
    error("TIMEOUT", [...sourcePath.slice(0, 5), "summary"]),
    error("NOT_FOUND", ["packageVulnerabilities"]),
  ])(
    "rejects errors outside the exact nullable-source contract",
    async (problem) => {
      const { service } = setup([
        { ...page([row("OSV-example", null)]), errors: [problem] },
      ]);
      await expect(
        service.packageVulnerabilities({
          ...params,
          includeSourceDetails: true,
        }),
      ).rejects.toBeInstanceOf(Error);
    },
  );
  it("rejects source errors on a nonnull child or unselected field", async () => {
    for (const includeSourceDetails of [true, false]) {
      const { service } = setup([{ ...page(), errors: [error("TIMEOUT")] }]);
      await expect(
        service.packageVulnerabilities({ ...params, includeSourceDetails }),
      ).rejects.toBeInstanceOf(Error);
    }
  });
  it.each([
    { ...source(), schemaVersion: null },
    { ...source(), credits: [{ name: "X", contact: null, type: null }] },
    { ...source(), upstreamIds: [null] },
    { ...source(), osvId: "OTHER-ID" },
  ])(
    "rejects malformed selected metadata and different source identity",
    async (invalid) => {
      const { service } = setup([page([row("OSV-example", invalid)])]);
      await expect(
        service.packageVulnerabilities({
          ...params,
          includeSourceDetails: true,
        }),
      ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
    },
  );
  it("requires the selected source key instead of silently treating omission as null", async () => {
    const entry = row();
    delete (entry as Partial<typeof entry>).sourceDetails;
    const { service } = setup([page([entry])]);
    await expect(
      service.packageVulnerabilities({ ...params, includeSourceDetails: true }),
    ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
  });
});

it("retains existing error-envelope precedence after excluding nullable source failures", async () => {
  for (const includeSourceDetails of [false, true]) {
    const problems: unknown[] = [
      { message: "unclassified supporting failure" },
      { message: "not displayed", extensions: { code: "UNAUTHORIZED" } },
    ];
    if (includeSourceDetails) problems.unshift(error("NOT_FOUND"));
    const body = { ...page([row("OSV-example", null)]), errors: problems };
    const { service } = setup([body, body]);
    await expect(
      service.packageVulnerabilities({ ...params, includeSourceDetails }),
    ).rejects.toMatchObject({ name: "AuthenticationError" });
  }
});
