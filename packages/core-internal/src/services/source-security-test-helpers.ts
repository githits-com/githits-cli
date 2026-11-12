import type {
  SourceSecurity,
  SourceSecurityAssertion,
} from "./source-security.js";

/** Small distinct evidence rows shared by transport, output and parity tests. */
export function sourceAssertionFixture(
  overrides: Partial<SourceSecurityAssertion> = {},
): SourceSecurityAssertion {
  return {
    sourceId: "OSV-git-1",
    aliases: ["CVE-example"],
    status: "AFFECTED",
    complete: true,
    reasons: [],
    otherRepositoryRanges: 0,
    sourceModifiedNs: "1790000000123456789",
    contentDigest: "current-digest",
    assessedContentDigest: "assessed-digest",
    evaluatedAt: "2026-11-12T10:00:00Z",
    checkedAt: "2026-11-12T11:00:00Z",
    sourceStale: false,
    ...overrides,
  };
}

export function sourceSecurityFixture(
  overrides: Partial<SourceSecurity> = {},
): SourceSecurity {
  return {
    scope: "UPSTREAM_GIT",
    state: "READY",
    reason: null,
    repositoryUrl: "https://github.com/example/upstream",
    commitSha: "a".repeat(40),
    proofKind: "RELEASE",
    retryAt: null,
    totalAssertions: 1,
    evaluatedAssertions: 1,
    unknownAssertions: 0,
    unevaluatedAssertions: 0,
    affectedVulnerabilityCount: 1,
    sourceStale: false,
    assertionsTruncated: false,
    assertions: [sourceAssertionFixture()],
    ...overrides,
  };
}

export const sourceSecurityCases: Array<[string, SourceSecurity | null]> = [
  [
    "cold",
    sourceSecurityFixture({
      state: "PREPARING",
      reason: "needs_preparation",
      repositoryUrl: null,
      commitSha: null,
      proofKind: null,
      totalAssertions: 0,
      evaluatedAssertions: 0,
      affectedVulnerabilityCount: 0,
      assertions: [],
    }),
  ],
  [
    "ready empty local corpus",
    sourceSecurityFixture({
      totalAssertions: 0,
      evaluatedAssertions: 0,
      affectedVulnerabilityCount: 0,
      assertions: [],
    }),
  ],
  [
    "unknown",
    sourceSecurityFixture({
      unknownAssertions: 1,
      affectedVulnerabilityCount: 0,
      assertions: [
        sourceAssertionFixture({
          status: "UNKNOWN",
          complete: false,
          reasons: ["unsupported_projection_version"],
          otherRepositoryRanges: null,
        }),
      ],
    }),
  ],
  [
    "partial positive and withdrawn provenance",
    sourceSecurityFixture({
      unknownAssertions: 1,
      assertions: [
        sourceAssertionFixture({
          complete: false,
          reasons: ["unresolved_range"],
          otherRepositoryRanges: 2,
        }),
        sourceAssertionFixture({
          sourceId: "OSV-git-alias",
          aliases: ["CVE-example"],
          status: "UNAFFECTED",
        }),
        sourceAssertionFixture({
          sourceId: "OSV-withdrawn",
          status: "WITHDRAWN",
        }),
      ],
      totalAssertions: 2,
      evaluatedAssertions: 2,
    }),
  ],
  [
    "stale",
    sourceSecurityFixture({
      sourceStale: true,
      assertions: [sourceAssertionFixture({ sourceStale: true })],
    }),
  ],
  [
    "truncated",
    sourceSecurityFixture({
      totalAssertions: 22,
      evaluatedAssertions: 22,
      assertionsTruncated: true,
      assertions: Array.from({ length: 20 }, (_, i) =>
        sourceAssertionFixture({ sourceId: `OSV-${i}` }),
      ),
    }),
  ],
  [
    "unsupported correspondence",
    sourceSecurityFixture({
      state: "NOT_ASSESSED",
      reason: "unsupported_correspondence",
      repositoryUrl: null,
      commitSha: null,
      proofKind: null,
      totalAssertions: 0,
      evaluatedAssertions: 0,
      affectedVulnerabilityCount: 0,
      assertions: [],
    }),
  ],
  [
    "unevaluated",
    sourceSecurityFixture({
      state: "NOT_ASSESSED",
      evaluatedAssertions: 0,
      unevaluatedAssertions: 1,
      affectedVulnerabilityCount: 0,
      assertions: [
        sourceAssertionFixture({
          status: "UNEVALUATED",
          complete: false,
          assessedContentDigest: null,
          evaluatedAt: null,
          checkedAt: null,
        }),
      ],
    }),
  ],
  ...["DENIED", "COOLDOWN", "UNAVAILABLE"].map(
    (state): [string, SourceSecurity] => [
      state,
      sourceSecurityFixture({
        state,
        reason: "local_reason",
        retryAt: state === "COOLDOWN" ? "2026-11-13T00:00:00Z" : null,
      }),
    ],
  ),
  ["nullable source", null],
];
