import { describe, expect, it, mock } from "bun:test";
import {
  MalformedPackageIntelligenceResponseError,
  PackageIntelligenceBackendError,
  PackageIntelligenceServiceImpl,
} from "./package-intelligence-service.js";
import { SOURCE_SECURITY_FIELDS } from "./source-security.js";
import {
  sourceSecurityCases,
  sourceSecurityFixture,
} from "./source-security-test-helpers.js";
import { createMockTokenProvider } from "./test-helpers.js";

const params = {
  registry: "NPM",
  packageName: "example",
  version: "1",
} as const;
function page(source: unknown, next: string | null = null) {
  return {
    data: {
      packageVulnerabilities: {
        package: { registry: "NPM", name: "example", version: "1" },
        security: {
          source,
          affectedVulnerabilityCount: 2,
          nonAffectingVulnerabilityCount: 4,
          unknownVulnerabilityCount: 3,
          allVulnerabilityCount: 9,
          advisories: {
            entries: [
              {
                osvId: "native-id",
                sourceDetails: null,
                affectsInspectedVersion: true,
                matchedAffectedVersionRanges: ["<2"],
                duplicateIds: [],
                affectedVersionRangesCount: 1,
                affectedVersionRangesTruncated: false,
              },
            ],
            pageInfo: {
              hasNextPage: next !== null,
              endCursor: next,
              totalCount: 2,
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
  const fetchFn = mock(
    async (_url: unknown, init?: RequestInit): Promise<Response> => {
      requests.push(JSON.parse(String(init?.body)));
      if (!bodies.length) throw new Error("Unexpected request");
      return Response.json(bodies.shift());
    },
  );
  return {
    requests,
    service: new PackageIntelligenceServiceImpl(
      "https://example.test/graphql",
      createMockTokenProvider(),
      fetchFn as unknown as typeof fetch,
    ),
  };
}

describe("upstream Git security transport", () => {
  it("locks the full selected evidence projection", () => {
    expect(SOURCE_SECURITY_FIELDS.replace(/\s+/g, " ").trim()).toBe(
      "scope state reason repositoryUrl commitSha proofKind retryAt totalAssertions evaluatedAssertions unknownAssertions unevaluatedAssertions affectedVulnerabilityCount sourceStale assertionsTruncated assertions { sourceId aliases status complete reasons otherRepositoryRanges sourceModifiedNs contentDigest assessedContentDigest evaluatedAt checkedAt sourceStale }",
    );
  });

  it.each(sourceSecurityCases)(
    "retains %s evidence exactly and leaves native counts intact",
    async (_name, source) => {
      const { service } = setup([
        page(source, "next"),
        page(sourceSecurityFixture()),
      ]);
      const report = await service.packageVulnerabilities({
        ...params,
        minSeverity: 9,
        includeWithdrawn: true,
        advisoryScope: "UNKNOWN",
      });
      expect(report.security?.source).toEqual(source);
      expect(report.security).toMatchObject({
        affectedVulnerabilityCount: 2,
        nonAffectingVulnerabilityCount: 4,
        unknownVulnerabilityCount: 3,
        allVulnerabilityCount: 9,
      });
      expect(report.security?.vulnerabilities).toHaveLength(2);
    },
  );

  it.each([false, true])(
    "selects source only on the first page with OSV details=%s",
    async (includeSourceDetails) => {
      const { service, requests } = setup([
        page(null, "next"),
        page(undefined),
      ]);
      await service.packageVulnerabilities({ ...params, includeSourceDetails });
      expect(requests).toHaveLength(2);
      expect(requests[0]!.query).toContain(
        `source { ${SOURCE_SECURITY_FIELDS} }`,
      );
      expect(requests[0]!.query).toContain(
        `first: ${includeSourceDetails ? 2 : 100}`,
      );
      expect(requests[1]!.query).not.toMatch(
        /\bsource\s*\{|sourceModifiedNs|assertions/,
      );
      expect(requests[1]!.query).toContain(
        `first: ${includeSourceDetails ? 3 : 100}`,
      );
      expect(requests.map((r) => r.variables.after)).toEqual([null, "next"]);
      expect(requests[0]!.query.includes("sourceDetails {")).toBe(
        includeSourceDetails,
      );
    },
  );

  it.each([
    undefined,
    {},
    { ...sourceSecurityFixture(), evaluatedAssertions: null },
    {
      ...sourceSecurityFixture(),
      assertions: [
        { ...sourceSecurityFixture().assertions[0], checkedAt: undefined },
      ],
    },
  ])(
    "rejects absent or malformed selected evidence without a compatibility retry: %p",
    async (source) => {
      const { service, requests } = setup([page(source)]);
      await expect(
        service.packageVulnerabilities(params),
      ).rejects.toBeInstanceOf(MalformedPackageIntelligenceResponseError);
      expect(requests).toHaveLength(1);
    },
  );

  it("retains future status/reason strings without reclassifying counts", async () => {
    const source = sourceSecurityFixture({ state: "FUTURE_STATE" });
    source.assertions[0]!.status = "FUTURE_STATUS";
    source.assertions[0]!.reasons = ["future_reason"];
    const { service } = setup([page(source, "next"), page(null)]);
    expect(
      (await service.packageVulnerabilities(params)).security?.source,
    ).toEqual(source);
  });

  it("keeps undeployed-schema errors fatal without retrying an older query", async () => {
    const { service, requests } = setup([
      {
        errors: [
          {
            message:
              'Cannot query field "source" on type "VulnerabilitySecurityDetails".',
          },
        ],
      },
    ]);
    await expect(service.packageVulnerabilities(params)).rejects.toBeInstanceOf(
      PackageIntelligenceBackendError,
    );
    expect(requests).toHaveLength(1);
  });

  it("does not select source on implicit package summaries", async () => {
    const { service, requests } = setup([
      {
        data: {
          packageSummary: { package: { name: "example" }, security: null },
        },
      },
    ]);
    await service.packageSummary(params);
    expect(requests[0]!.query).not.toMatch(
      /\bsource\s*\{|sourceModifiedNs|assertions/,
    );
  });
});
