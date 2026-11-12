import { z } from "zod";

/** One original upstream assertion; aliases do not collapse these evidence rows. */
export interface SourceSecurityAssertion {
  sourceId: string;
  aliases: string[];
  status: string;
  complete: boolean;
  reasons: string[];
  otherRepositoryRanges: number | null;
  sourceModifiedNs: string;
  contentDigest: string;
  assessedContentDigest: string | null;
  evaluatedAt: string | null;
  checkedAt: string | null;
  sourceStale: boolean;
}

/** Local upstream Git evidence, independent of native findings and build applicability. */
export interface SourceSecurity {
  scope: string;
  state: string;
  reason: string | null;
  repositoryUrl: string | null;
  commitSha: string | null;
  proofKind: string | null;
  retryAt: string | null;
  totalAssertions: number;
  evaluatedAssertions: number;
  unknownAssertions: number;
  unevaluatedAssertions: number;
  affectedVulnerabilityCount: number;
  sourceStale: boolean;
  assertionsTruncated: boolean;
  assertions: SourceSecurityAssertion[];
}

const count = z.number().int().nonnegative();

// Keep future status/reason strings and nullable provenance exactly as served.
// Unknown counts can overlap affected findings, so they are not a partition.
export const sourceSecuritySchema: z.ZodType<SourceSecurity> = z.object({
  scope: z.string(),
  state: z.string(),
  reason: z.string().nullable(),
  repositoryUrl: z.string().nullable(),
  commitSha: z.string().nullable(),
  proofKind: z.string().nullable(),
  retryAt: z.string().nullable(),
  totalAssertions: count,
  evaluatedAssertions: count,
  unknownAssertions: count,
  unevaluatedAssertions: count,
  affectedVulnerabilityCount: count,
  sourceStale: z.boolean(),
  assertionsTruncated: z.boolean(),
  assertions: z
    .array(
      z.object({
        sourceId: z.string(),
        aliases: z.array(z.string()),
        status: z.string(),
        complete: z.boolean(),
        reasons: z.array(z.string()),
        otherRepositoryRanges: count.nullable(),
        sourceModifiedNs: z.string(),
        contentDigest: z.string(),
        assessedContentDigest: z.string().nullable(),
        evaluatedAt: z.string().nullable(),
        checkedAt: z.string().nullable(),
        sourceStale: z.boolean(),
      }),
    )
    .max(20),
});

/** Full bounded evidence projection, retained losslessly in CLI/MCP JSON. */
export const SOURCE_SECURITY_FIELDS = `
  scope state reason repositoryUrl commitSha proofKind retryAt
  totalAssertions evaluatedAssertions unknownAssertions unevaluatedAssertions
  affectedVulnerabilityCount sourceStale assertionsTruncated
  assertions {
    sourceId aliases status complete reasons otherRepositoryRanges
    sourceModifiedNs contentDigest assessedContentDigest evaluatedAt checkedAt sourceStale
  }
`;
