import { z } from "zod";

const severitySchema = z.object({
  type: z.string(),
  score: z.string(),
  source: z.string().nullable(),
});
const packageSchema = z.object({
  name: z.string(),
  ecosystem: z.string(),
  purl: z.string().nullable().optional(),
});
export const advisorySchema = z.object({
  osvId: z.string(),
  aliases: z.array(z.string()),
  summary: z.string().nullable(),
  details: z.string().nullable().optional(),
  sourceUrl: z.string(),
  publishedAt: z.string().nullable(),
  modifiedAt: z.string(),
  withdrawnAt: z.string().nullable(),
  severity: z.array(severitySchema),
  references: z
    .array(z.object({ type: z.string(), url: z.string().nullable() }))
    .optional(),
  affected: z.array(
    z.object({
      package: packageSchema.nullable(),
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
  contentSafety: z.object({
    filtered: z.boolean(),
    modifications: z.array(z.string()),
  }),
});
export const fullAdvisorySchema = advisorySchema
  .required({ details: true, references: true })
  .extend({
    affected: z.array(
      advisorySchema.shape.affected.element.extend({
        package: packageSchema.required({ purl: true }).nullable(),
      }),
    ),
  });

/** All typed source evidence; only full-selection fields can be absent in compact mode. */
export interface AdvisoryDetails extends z.infer<typeof fullAdvisorySchema> {}

const strings = z.array(z.string());
const safety = advisorySchema.shape.contentSafety;
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
  modifiedAt: z.string(),
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
  aliases: strings.optional(),
  isMalicious: z.boolean().nullable().optional(),
  contentSafety: safety.optional(),
});
const compactAdvisory = advisorySchema.pick({
  osvId: true,
  summary: true,
  sourceUrl: true,
  withdrawnAt: true,
});
export const lookupUnknownSchema = z.object({
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
export const lookupSchema = z.object({
  requestedId: z.string(),
  advisory: compactAdvisory
    .extend({
      aliases: strings.optional(),
      details: z.string().nullable().optional(),
      publishedAt: z.string().nullable().optional(),
      modifiedAt: z.string().optional(),
      severity: advisorySchema.shape.severity.optional(),
      references: advisorySchema.shape.references,
      affected: fullAdvisorySchema.shape.affected.optional(),
      contentSafety: safety.optional(),
    })
    .nullable()
    .optional(),
  affectedPackages: connection.nullable(),
  unknownDetails: z.array(lookupUnknownSchema),
});
export const detailedLookupSchema = lookupSchema.extend({
  advisory: fullAdvisorySchema.nullable().optional(),
  affectedPackages: connection
    .extend({
      entries: z.array(
        group.extend({
          sourceEvidence: source
            .required({ affected: true, contentSafety: true })
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

/** Evidence is kept in producer order, including unfamiliar vocabularies. */
export interface AdvisoryLookup extends z.infer<typeof lookupSchema> {}
export interface LookupUnknown extends z.infer<typeof lookupUnknownSchema> {
  /** Operation-local sanitized optional-field diagnostic; absent for typed producer outcomes. */
  path?: Array<string | number>;
}
export interface LookupPackage extends z.infer<typeof group> {}
