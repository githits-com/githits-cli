import { z } from "zod";

/** Typed current-source metadata shared by package and advisory projections. */
export const osvSourceMetadataSchema: z.ZodObject<{
  schemaVersion: z.ZodString;
  relatedIds: z.ZodArray<z.ZodString>;
  upstreamIds: z.ZodArray<z.ZodString>;
  credits: z.ZodArray<
    z.ZodObject<{
      name: z.ZodString;
      contact: z.ZodArray<z.ZodString>;
      type: z.ZodNullable<z.ZodString>;
    }>
  >;
}> = z.object({
  schemaVersion: z.string(),
  relatedIds: z.array(z.string()),
  upstreamIds: z.array(z.string()),
  credits: z.array(
    z.object({
      name: z.string(),
      contact: z.array(z.string()),
      type: z.string().nullable(),
    }),
  ),
});

/** Shared fields consumed by package source explanations and advisory detail. */
export const OSV_SOURCE_DETAILS_FIELDS = `
  osvId aliases summary details sourceUrl publishedAt modifiedAt withdrawnAt
  schemaVersion relatedIds upstreamIds credits { name contact type }
  severity { type score source } references { type url }
  contentSafety { filtered modifications }
`;

export const osvSourceDetailsSchema: z.ZodObject<
  typeof osvSourceMetadataSchema.shape & {
    osvId: z.ZodString;
    aliases: z.ZodArray<z.ZodString>;
    summary: z.ZodNullable<z.ZodString>;
    details: z.ZodNullable<z.ZodString>;
    sourceUrl: z.ZodString;
    publishedAt: z.ZodNullable<z.ZodString>;
    modifiedAt: z.ZodString;
    withdrawnAt: z.ZodNullable<z.ZodString>;
    severity: z.ZodArray<
      z.ZodObject<{
        type: z.ZodString;
        score: z.ZodString;
        source: z.ZodNullable<z.ZodString>;
      }>
    >;
    references: z.ZodArray<
      z.ZodObject<{ type: z.ZodString; url: z.ZodNullable<z.ZodString> }>
    >;
    contentSafety: z.ZodObject<{
      filtered: z.ZodBoolean;
      modifications: z.ZodArray<z.ZodString>;
    }>;
  }
> = osvSourceMetadataSchema.extend({
  osvId: z.string(),
  aliases: z.array(z.string()),
  summary: z.string().nullable(),
  details: z.string().nullable(),
  sourceUrl: z.string(),
  publishedAt: z.string().nullable(),
  modifiedAt: z.string(),
  withdrawnAt: z.string().nullable(),
  severity: z.array(
    z.object({
      type: z.string(),
      score: z.string(),
      source: z.string().nullable(),
    }),
  ),
  references: z.array(
    z.object({ type: z.string(), url: z.string().nullable() }),
  ),
  contentSafety: z.object({
    filtered: z.boolean(),
    modifications: z.array(z.string()),
  }),
});

export interface OsvCredit {
  name: string;
  contact: string[];
  type: string | null;
}
export interface OsvSourceMetadata {
  schemaVersion: string;
  relatedIds: string[];
  upstreamIds: string[];
  credits: OsvCredit[];
}
export interface OsvSourceDetails extends OsvSourceMetadata {
  osvId: string;
  aliases: string[];
  summary: string | null;
  details: string | null;
  sourceUrl: string;
  publishedAt: string | null;
  modifiedAt: string;
  withdrawnAt: string | null;
  severity: Array<{ type: string; score: string; source: string | null }>;
  references: Array<{ type: string; url: string | null }>;
  contentSafety: { filtered: boolean; modifications: string[] };
}
export interface VulnerabilitySourceEntry {
  /** Exact representative ID from one original backend row, before assessment dedup. */
  advisoryId: string | null;
  source: OsvSourceDetails | null;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    retryAfterSeconds?: number;
  };
}
