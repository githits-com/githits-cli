import { OSV_SOURCE_DETAILS_FIELDS } from "./osv-source-details.js";

const unknown = `unknownDetails { section code message retryable candidateIds candidateIdsTruncated }`;
const display = (max: number): string =>
  `affectedVersionDisplay(maxRanges: ${max}) { ranges totalCount truncated }`;
const affected = `fragment LookupAffected on VulnerabilityAffected {
  package { name ecosystem purl } severity { type score source } versions
  ranges { type repo events { introduced fixed lastAffected limit } }
}`;

/** Exact durable core field selection; only paging arguments differ for continuation. */
export function buildAdvisoryLookupQuery(
  detailed: boolean,
  continuation: boolean = false,
): string {
  const root = detailed
    ? `
    advisory {
      ${OSV_SOURCE_DETAILS_FIELDS}
      affected { ...LookupAffected }
    }`
    : `advisory { osvId aliases summary sourceUrl withdrawnAt }`;
  const source = detailed
    ? `
    osvId sourceUrl modifiedAt withdrawnAt affected { ...LookupAffected }
    affectedVersionRanges fixedInVersions ${display(10)} contentSafety { filtered modifications }
  `
    : `osvId sourceUrl withdrawnAt affectedVersionRanges fixedInVersions ${display(10)}`;
  const local = detailed
    ? `
    osvId sourceUrl registry packageName summary severityScore severityType
    affectedVersionRanges fixedInVersions publishedAt modifiedAt withdrawnAt aliases isMalicious
    ${display(10)} contentSafety { filtered modifications }
  `
    : `osvId aliases sourceUrl summary severityScore severityType withdrawnAt isMalicious affectedVersionRanges fixedInVersions ${display(10)}`;
  return `query AdvisoryLookup($ids: [String!]!, $first: Int!, $after: String) {
    vulnerabilityLookup(ids: $ids) {
      requestedId ${continuation ? "" : root}
      affectedPackages(first: $first, after: $after) {
        entries {
          package { name registry ecosystem }
          sourceEvidence { ${source} }
          advisories { ${local} }
        }
        pageInfo { totalCount hasNextPage endCursor }
        coverage { sourceStatus localStatus }
      }
      ${unknown}
    }
  } ${detailed ? affected : ""}`;
}
