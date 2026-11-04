import { mock } from "bun:test";
import type {
  AdvisoryDetails,
  AdvisoryLookup,
  AdvisoryService,
} from "./advisory-service.js";

/** Small source-shaped fixture retaining distinct evidence kinds. */
export const defaultAdvisoryDetails: AdvisoryDetails = {
  schemaVersion: "1.9.0",
  relatedIds: [],
  upstreamIds: [],
  credits: [],
  osvId: "OSV-example",
  aliases: ["CVE-example"],
  summary: "Source résumé with Unicode",
  details: "Full source explanation.\n\nSecond paragraph.",
  sourceUrl: "https://osv.dev/vulnerability/OSV-example",
  publishedAt: null,
  modifiedAt: "2026-11-03T12:34:56.123456789Z",
  withdrawnAt: null,
  severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L", source: null }],
  references: [{ type: "FUTURE_REFERENCE", url: "" }],
  affected: [
    {
      package: null,
      severity: [],
      versions: ["source-version"],
      ranges: [
        {
          type: "GIT",
          repo: "https://example.com/repo",
          events: [
            {
              introduced: "ffff",
              fixed: null,
              lastAffected: null,
              limit: null,
            },
            {
              introduced: null,
              fixed: "aaaa",
              lastAffected: null,
              limit: null,
            },
            {
              introduced: null,
              fixed: null,
              lastAffected: "zzzz",
              limit: null,
            },
            { introduced: null, fixed: null, lastAffected: null, limit: "*" },
          ],
        },
      ],
    },
  ],
  contentSafety: {
    filtered: true,
    modifications: ["UNSAFE_LINKS_NEUTRALIZED"],
  },
};

/** Factory for interface-level CLI tests without transport coupling. */
export function createMockAdvisoryService(
  overrides: Partial<AdvisoryService> = {},
): AdvisoryService {
  return {
    lookup: mock(async (ids: string[]) =>
      ids.map((requestedId) => ({
        ...structuredClone(defaultAdvisoryLookup),
        requestedId,
      })),
    ),
    ...overrides,
  };
}

/** One package group with separately attributed local evidence; source retains Git evidence. */
export const defaultAdvisoryLookup: AdvisoryLookup = {
  requestedId: "CVE-example",
  advisory: defaultAdvisoryDetails,
  affectedPackages: {
    entries: [
      {
        package: { name: "minimatch", registry: "NPM", ecosystem: "npm" },
        sourceEvidence: null,
        advisories: [
          {
            osvId: "GHSA-example",
            sourceUrl: "https://osv.dev/vulnerability/GHSA-example",
            registry: "NPM",
            packageName: "minimatch",
            summary: "Local source evidence",
            severityScore: 7.5,
            severityType: "CVSS_V3",
            affectedVersionRanges: [">=10.0.0 <10.2.1"],
            fixedInVersions: ["10.2.1"],
            affectedVersionDisplay: {
              ranges: [">=10.0.0 <10.2.1"],
              totalCount: 1,
              truncated: false,
            },
            publishedAt: null,
            modifiedAt: "2026-11-03T00:00:00Z",
            withdrawnAt: null,
            aliases: ["CVE-example"],
            isMalicious: null,
            contentSafety: { filtered: false, modifications: [] },
          },
        ],
      },
    ],
    pageInfo: { totalCount: 1, hasNextPage: false, endCursor: null },
    coverage: { sourceStatus: "AVAILABLE", localStatus: "AVAILABLE" },
  },
  unknownDetails: [],
};
