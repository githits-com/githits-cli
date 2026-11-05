import { z } from "zod";
import {
  type OsvSourceMetadata,
  osvSourceDetailsSchema,
  osvSourceMetadataSchema,
} from "./osv-source-details.js";

const severitySchema = osvSourceDetailsSchema.shape.severity.element;
const packageSchema = z.object({
  name: z.string(),
  ecosystem: z.string(),
  purl: z.string().nullable().optional(),
});
const fullAdvisorySchema = osvSourceDetailsSchema.extend({
  affected: z.array(
    z.object({
      package: packageSchema.required({ purl: true }).nullable(),
      severity: z.array(severitySchema),
      versions: z.array(z.string()),
      ranges: z.array(
        z.object({
          type: z.string(),
          repo: z.string().nullable(),
          events: z.array(
            z.object({
              introduced: z.string().nullable(),
              fixed: z.string().nullable(),
              lastAffected: z.string().nullable(),
              limit: z.string().nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
});

const strings = z.array(z.string());
const safety = osvSourceDetailsSchema.shape.contentSafety;
const display = z
  .object({
    ranges: strings,
    totalCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .nullable();
const source = z.object({
  osvId: z.string(),
  sourceUrl: z.string(),
  modifiedAt: z.string().optional(),
  withdrawnAt: z.string().nullable(),
  affectedVersionRanges: strings.nullable(),
  fixedInVersions: strings,
  affectedVersionDisplay: display,
  affected: fullAdvisorySchema.shape.affected.optional(),
  contentSafety: safety.optional(),
});
const local = z.object({
  osvId: z.string().nullable(),
  sourceUrl: z.string(),
  summary: z.string().nullable(),
  severityScore: z.number().nullable(),
  severityType: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  affectedVersionRanges: strings.nullable(),
  fixedInVersions: strings.nullable(),
  affectedVersionDisplay: display,
  registry: z.string().nullable().optional(),
  packageName: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  modifiedAt: z.string().nullable().optional(),
  aliases: strings,
  isMalicious: z.boolean().nullable().optional(),
  contentSafety: safety.optional(),
});
const compactAdvisory = osvSourceDetailsSchema.pick({
  osvId: true,
  aliases: true,
  summary: true,
  sourceUrl: true,
  withdrawnAt: true,
});
const lookupUnknownSchema = z.object({
  section: z.string(),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  candidateIds: strings.nullable(),
  candidateIdsTruncated: z.boolean().nullable(),
  path: z.array(z.union([z.string(), z.number().int()])).optional(),
});
const group = z.object({
  package: z.object({
    name: z.string(),
    registry: z.string().nullable(),
    ecosystem: z.string().nullable(),
  }),
  sourceEvidence: source.nullable(),
  advisories: z.array(local),
});
const connection = z.object({
  entries: z.array(group),
  pageInfo: z.object({
    totalCount: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable(),
  }),
  coverage: z.object({ sourceStatus: z.string(), localStatus: z.string() }),
});
const lookupSchema = z.object({
  requestedId: z.string(),
  advisory: compactAdvisory
    .extend(osvSourceMetadataSchema.partial().shape)
    .extend({
      details: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      modifiedAt: z.string().optional(),
      severity: osvSourceDetailsSchema.shape.severity.optional(),
      references: osvSourceDetailsSchema.shape.references.optional(),
      affected: fullAdvisorySchema.shape.affected.optional(),
      contentSafety: safety.optional(),
    })
    .nullable()
    .optional(),
  affectedPackages: connection.nullable(),
  unknownDetails: z.array(lookupUnknownSchema),
});
const detailedLookupSchema = lookupSchema.extend({
  advisory: fullAdvisorySchema.nullable().optional(),
  affectedPackages: connection
    .extend({
      entries: z.array(
        group.extend({
          sourceEvidence: source
            .required({ affected: true, contentSafety: true, modifiedAt: true })
            .nullable(),
          advisories: z.array(
            local.required({
              registry: true,
              packageName: true,
              publishedAt: true,
              modifiedAt: true,
              aliases: true,
              isMalicious: true,
              contentSafety: true,
            }),
          ),
        }),
      ),
    })
    .nullable(),
});

/** Validate only the selected projection; no Zod schema leaks into declaration consumers. */
export function parseAdvisoryLookups(
  data: unknown,
  detailed: boolean,
  continuation: boolean,
): AdvisoryLookup[] | undefined {
  const shape = detailed
    ? continuation
      ? detailedLookupSchema.omit({ advisory: true })
      : detailedLookupSchema.required({ advisory: true })
    : continuation
      ? lookupSchema.omit({ advisory: true })
      : lookupSchema.required({ advisory: true });
  const parsed = z.array(shape).safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

export interface AdvisorySeverity {
  type: string;
  score: string;
  source: string | null;
}
export interface AdvisoryReference {
  type: string;
  url: string | null;
}
export interface AdvisoryPackage {
  name: string;
  ecosystem: string;
  purl: string | null;
}
export interface AdvisoryRangeEvent {
  introduced: string | null;
  fixed: string | null;
  lastAffected: string | null;
  limit: string | null;
}
export interface AdvisoryRange {
  type: string;
  repo: string | null;
  events: AdvisoryRangeEvent[];
}
export interface AdvisoryAffected {
  package: AdvisoryPackage | null;
  severity: AdvisorySeverity[];
  versions: string[];
  ranges: AdvisoryRange[];
}
export interface AdvisorySafety {
  filtered: boolean;
  modifications: string[];
}
export interface AdvisoryDisplay {
  ranges: string[];
  totalCount: number;
  truncated: boolean;
}

/** Compact source identity; detail-only fields remain optional until selected. */
export interface AdvisorySummary extends Partial<OsvSourceMetadata> {
  osvId: string;
  summary: string | null;
  sourceUrl: string;
  withdrawnAt: string | null;
  aliases?: string[];
  details?: string | null;
  publishedAt?: string | null;
  modifiedAt?: string;
  severity?: AdvisorySeverity[];
  references?: AdvisoryReference[];
  affected?: AdvisoryAffected[];
  contentSafety?: AdvisorySafety;
}
export interface AdvisoryDetails extends AdvisorySummary {
  schemaVersion: string;
  relatedIds: string[];
  upstreamIds: string[];
  credits: OsvSourceMetadata["credits"];
  aliases: string[];
  details: string | null;
  publishedAt: string | null;
  modifiedAt: string;
  severity: AdvisorySeverity[];
  references: AdvisoryReference[];
  affected: AdvisoryAffected[];
  contentSafety: AdvisorySafety;
}
export interface LookupUnknown {
  section: string;
  code: string;
  message: string;
  retryable: boolean;
  candidateIds: string[] | null;
  candidateIdsTruncated: boolean | null;
  /** Optional display-error locator into the retained result; absent for typed backend outcomes. */
  path?: Array<string | number>;
}
export interface LookupSourceEvidence {
  osvId: string;
  sourceUrl: string;
  modifiedAt?: string;
  withdrawnAt: string | null;
  affectedVersionRanges: string[] | null;
  fixedInVersions: string[];
  affectedVersionDisplay: AdvisoryDisplay | null;
  affected?: AdvisoryAffected[];
  contentSafety?: AdvisorySafety;
}
export interface LookupLocalAdvisory {
  osvId: string | null;
  sourceUrl: string;
  summary: string | null;
  severityScore: number | null;
  severityType: string | null;
  withdrawnAt: string | null;
  affectedVersionRanges: string[] | null;
  fixedInVersions: string[] | null;
  affectedVersionDisplay: AdvisoryDisplay | null;
  registry?: string | null;
  packageName?: string | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
  aliases?: string[];
  isMalicious?: boolean | null;
  contentSafety?: AdvisorySafety;
}
export interface LookupPackage {
  package: { name: string; registry: string | null; ecosystem: string | null };
  sourceEvidence: LookupSourceEvidence | null;
  advisories: LookupLocalAdvisory[];
}
export interface LookupPackageConnection {
  entries: LookupPackage[];
  pageInfo: {
    totalCount: number;
    hasNextPage: boolean;
    endCursor: string | null;
  };
  coverage: { sourceStatus: string; localStatus: string };
}
/** Evidence remains ordered and producer vocabularies remain open. */
export interface AdvisoryLookup {
  requestedId: string;
  advisory?: AdvisorySummary | null;
  affectedPackages: LookupPackageConnection | null;
  unknownDetails: LookupUnknown[];
}
