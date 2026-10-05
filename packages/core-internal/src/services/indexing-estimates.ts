import { z } from "zod";

export interface IndexingDurationEstimate {
  lowerSeconds?: number;
  upperSeconds?: number;
  elapsedSeconds?: number;
  sampleCount?: number;
  source?: string;
}

/** Pending preparation evidence; total execution seconds, never a search ETA. */
export interface DiscoveryIndexingEstimate {
  kind: "REPOSITORY" | "DOCUMENTATION";
  targets: string[];
  repositoryUrl?: string;
  commitSha?: string;
  estimate?: IndexingDurationEstimate;
  unavailableReason?: "NO_HISTORY" | "UNSUPPORTED_WORK";
}

const INDEXING_DURATION_ESTIMATE_FIELDS = `
  lowerSeconds
  upperSeconds
  elapsedSeconds
  sampleCount
  source`;

export const INDEXING_DURATION_ESTIMATE_SELECTION: string = `
indexingEstimate {
  ${INDEXING_DURATION_ESTIMATE_FIELDS}
}`;

export const INDEXING_ESTIMATES_SELECTION: string = `
indexingEstimates {
  kind
  targets
  repositoryUrl
  commitSha
  estimate {
    ${INDEXING_DURATION_ESTIMATE_FIELDS}
  }
  unavailableReason
}`;

export const indexingDurationEstimateSchema: z.ZodType<
  | {
      lowerSeconds?: number | null;
      upperSeconds?: number | null;
      elapsedSeconds?: number | null;
      sampleCount?: number | null;
      source?: string | null;
    }
  | null
  | undefined
> = z
  .object({
    lowerSeconds: z.number().int().nullable().optional(),
    upperSeconds: z.number().int().nullable().optional(),
    elapsedSeconds: z.number().int().nullable().optional(),
    sampleCount: z.number().int().nullable().optional(),
    source: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const discoveryIndexingEstimateSchema = z.object({
  kind: z.enum(["REPOSITORY", "DOCUMENTATION"]),
  targets: z.array(z.string()),
  repositoryUrl: z.string().nullish(),
  commitSha: z.string().nullish(),
  estimate: indexingDurationEstimateSchema,
  unavailableReason: z.enum(["NO_HISTORY", "UNSUPPORTED_WORK"]).nullish(),
});

export function normaliseIndexingDurationEstimate(
  estimate: z.infer<typeof indexingDurationEstimateSchema>,
): IndexingDurationEstimate | undefined {
  if (!estimate) return undefined;
  const out: IndexingDurationEstimate = {};
  if (typeof estimate.lowerSeconds === "number") {
    out.lowerSeconds = estimate.lowerSeconds;
  }
  if (typeof estimate.upperSeconds === "number") {
    out.upperSeconds = estimate.upperSeconds;
  }
  if (typeof estimate.elapsedSeconds === "number") {
    out.elapsedSeconds = estimate.elapsedSeconds;
  }
  if (typeof estimate.sampleCount === "number") {
    out.sampleCount = estimate.sampleCount;
  }
  if (typeof estimate.source === "string") out.source = estimate.source;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Decode one uniform timing envelope without inventing missing duration evidence. */
export const indexingEstimatesSchema: z.ZodType<DiscoveryIndexingEstimate[]> = z
  .array(discoveryIndexingEstimateSchema)
  .transform((entries): DiscoveryIndexingEstimate[] =>
    entries.map((entry) => ({
      kind: entry.kind,
      targets: [...entry.targets],
      repositoryUrl: entry.repositoryUrl ?? undefined,
      commitSha: entry.commitSha ?? undefined,
      unavailableReason: entry.unavailableReason ?? undefined,
      estimate: normaliseIndexingDurationEstimate(entry.estimate),
    })),
  );
