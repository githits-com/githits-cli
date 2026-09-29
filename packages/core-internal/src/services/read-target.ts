import { z } from "zod";

/** A backend-selected address for a code or documentation read. */
export interface ReadTarget {
  target: string;
  path?: string;
  selector?: string;
  startLine?: number;
  endLine?: number;
}

/** Fields selected for a complete backend read target. */
export const READ_TARGET_SELECTION =
  "target path selector startLine endLine" as const;

const positiveLineSchema = z.number().int().positive();

const readTargetInputSchema = z
  .object({
    target: z.string().min(1),
    path: z.string().nullable().optional(),
    selector: z.string().nullable().optional(),
    startLine: positiveLineSchema.nullable().optional(),
    endLine: positiveLineSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.startLine != null &&
      value.endLine != null &&
      value.endLine < value.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message: "endLine must be greater than or equal to startLine",
      });
    }
  });

/** Omit nullable optional values without changing opaque strings. */
function normaliseReadTarget(
  value: z.infer<typeof readTargetInputSchema>,
): ReadTarget {
  return {
    target: value.target,
    ...(value.path == null ? {} : { path: value.path }),
    ...(value.selector == null ? {} : { selector: value.selector }),
    ...(value.startLine == null ? {} : { startLine: value.startLine }),
    ...(value.endLine == null ? {} : { endLine: value.endLine }),
  };
}

/** Parse a full descriptor or target-only/path projection. */
export const readTargetSchema: z.ZodType<ReadTarget> =
  readTargetInputSchema.transform(normaliseReadTarget);

/** Validate the complete nullable shape returned by a full field selection. */
export const selectedReadTargetSchema: z.ZodType<ReadTarget> =
  readTargetInputSchema
    .safeExtend({
      path: z.string().nullable(),
      selector: z.string().nullable(),
      startLine: positiveLineSchema.nullable(),
      endLine: positiveLineSchema.nullable(),
    })
    .transform(normaliseReadTarget);
